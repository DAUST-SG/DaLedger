import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import { currentOfficer } from "./auth";
import { writeAudit } from "./audit";
import { accountByKey } from "./balances";
import { assertOccurredAt, changedFields, cutoverOf, LIVE_STATUSES, reversalFlip, validateEntry } from "./ledger";
import { txStatus, txType } from "./schema";

async function getOrThrow<T extends "accounts" | "categories" | "events" | "transactions">(
  ctx: QueryCtx,
  id: Id<T>,
  label: string,
): Promise<Doc<T>> {
  const doc = await ctx.db.get(id);
  if (!doc) throw new ConvexError(`Unknown ${label}.`);
  return doc;
}

/** Manual entry for any of the 7 types (ADR 0001, 0009). */
export const create = mutation({
  args: {
    type: txType,
    amount: v.number(),
    accountId: v.id("accounts"),
    toAccountId: v.optional(v.id("accounts")),
    reason: v.string(),
    categoryId: v.optional(v.id("categories")),
    eventId: v.optional(v.id("events")),
    occurredAt: v.optional(v.number()),
    receiptUrl: v.optional(v.string()),
  },
  returns: v.object({ id: v.id("transactions"), status: v.string() }),
  handler: async (ctx, args) => {
    const officer = await currentOfficer(ctx);
    const account = await getOrThrow(ctx, args.accountId, "account");
    const toAccount = args.toAccountId ? await getOrThrow(ctx, args.toAccountId, "destination account") : null;
    const category = args.categoryId ? await getOrThrow(ctx, args.categoryId, "category") : null;
    validateEntry({ type: args.type, amount: args.amount, reason: args.reason, account, toAccount, category });
    if (args.eventId) {
      const event = await getOrThrow(ctx, args.eventId, "event");
      // `active` gates new tags only (ADR 0022).
      if (!event.active) throw new ConvexError(`"${event.name}" no longer accepts new entries.`);
    }

    // A withdrawal starts committed, with no payment time yet (ADR 0003).
    const committed = args.type === "school_withdrawal";
    const occurredAt = committed ? undefined : (args.occurredAt ?? Date.now());
    if (occurredAt !== undefined) assertOccurredAt(occurredAt, cutoverOf(account, toAccount), Date.now());
    const doc = {
      type: args.type,
      amount: args.amount,
      occurredAt,
      accountId: args.accountId,
      toAccountId: args.toAccountId,
      reason: args.reason.trim(),
      categoryId: args.categoryId,
      eventId: args.eventId,
      source: "manual",
      kind: "income" as const, // non-intake entries (ADR 0005)
      status: committed ? ("committed" as const) : ("confirmed" as const),
      receiptUrl: args.receiptUrl,
      recordedBy: officer._id,
      createdAt: Date.now(),
    };
    const id = await ctx.db.insert("transactions", doc);
    await writeAudit(ctx, { actor: officer._id, action: "create", targetId: id, after: changedFields({}, doc).after });
    return { id, status: doc.status };
  },
});

/**
 * A pre-cutover event summary (ADR 0011): status `memo`, so it adds 0 to every
 * balance yet shows in event and category reports. It is dated before cutover by
 * definition (the opening balances already hold that money); after cutover the
 * real entries are recorded instead. Corrected by reversal like any entry.
 */
export const createMemo = mutation({
  args: {
    type: v.union(v.literal("income"), v.literal("expense")),
    amount: v.number(),
    reason: v.string(),
    categoryId: v.id("categories"),
    eventId: v.id("events"),
    occurredAt: v.number(),
  },
  returns: v.object({ id: v.id("transactions") }),
  handler: async (ctx, args) => {
    const officer = await currentOfficer(ctx);
    // accountId is required on every row; a memo moves no money on it (ADR 0011).
    const account = await accountByKey(ctx, "cash");
    const category = await getOrThrow(ctx, args.categoryId, "category");
    validateEntry({ type: args.type, amount: args.amount, reason: args.reason, account, toAccount: null, category });
    const event = await getOrThrow(ctx, args.eventId, "event");
    if (!event.active) throw new ConvexError(`"${event.name}" no longer accepts new entries.`);
    if (!Number.isFinite(args.occurredAt) || args.occurredAt >= cutoverOf(account)) {
      throw new ConvexError("A historical summary is dated before cutover. After cutover, record the real entries instead.");
    }

    const doc = {
      type: args.type,
      amount: args.amount,
      occurredAt: args.occurredAt,
      accountId: account._id,
      reason: args.reason.trim(),
      categoryId: args.categoryId,
      eventId: args.eventId,
      source: "manual",
      kind: "income" as const,
      status: "memo" as const,
      recordedBy: officer._id,
      createdAt: Date.now(),
    };
    const id = await ctx.db.insert("transactions", doc);
    await writeAudit(ctx, { actor: officer._id, action: "create", targetId: id, after: changedFields({}, doc).after });
    return { id };
  },
});

/** The reversal of `id` that is not itself reversed, if any (ADR 0020). */
export async function activeReversal(ctx: QueryCtx, id: Id<"transactions">): Promise<Id<"transactions"> | null> {
  const reversals = await ctx.db
    .query("transactions")
    .withIndex("by_reversalOf", (q) => q.eq("reversalOf", id))
    .collect();
  for (const r of reversals) {
    if (!(await activeReversal(ctx, r._id))) return r._id;
  }
  return null;
}

// Live entries cancel money; a memo reversal corrects a pre-cutover summary in reports (ADR 0011).
const REVERSIBLE = new Set([...LIVE_STATUSES, "memo"]);

/** Cancel an entry with a near-copy (ADR 0002); at most one active reversal (ADR 0020). */
export const reverse = mutation({
  args: { transactionId: v.id("transactions"), reason: v.string(), occurredAt: v.optional(v.number()) },
  returns: v.object({ reversalId: v.id("transactions"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const officer = await currentOfficer(ctx);
    const target = await getOrThrow(ctx, args.transactionId, "transaction");
    if (args.reason.trim() === "") throw new ConvexError("A reason is required.");
    // A committed withdrawal moved no money, so it is abandoned via
    // transactions.cancelWithdrawal (ADR 0028), not reversed — a reversal copy
    // would sit at 0 while the original could still be marked paid.
    if (target.status === "committed") {
      throw new ConvexError("This withdrawal is not paid yet — cancel it instead of reversing (ADR 0028).");
    }
    // A draft is skipped, not reversed (ADR 0012): its reversal would copy the
    // `draft` status and sit in the inbox forever while the draft could still
    // be confirmed. Skipped/cancelled rows moved no money, so nothing to cancel.
    if (!REVERSIBLE.has(target.status)) {
      throw new ConvexError(
        target.status === "draft"
          ? "A recurring draft is skipped, not reversed (ADR 0012)."
          : `A ${target.status} entry moved no money, so there is nothing to reverse.`,
      );
    }

    const existing = await activeReversal(ctx, target._id);
    if (existing) return { reversalId: existing, created: false }; // guarded no-op

    let occurredAt = args.occurredAt ?? Date.now();
    if (target.status === "memo") {
      // A memo reversal stays pre-cutover, in the memo's own period, so the report nets it there.
      occurredAt = target.occurredAt!;
    } else {
      const accounts = [await ctx.db.get(target.accountId), target.toAccountId ? await ctx.db.get(target.toAccountId) : null];
      assertOccurredAt(occurredAt, cutoverOf(...accounts), Date.now());
    }
    const reversalId = await writeReversal(ctx, target, {
      reason: args.reason.trim(),
      occurredAt,
      recordedBy: officer._id,
      source: "manual",
      kind: "income",
    });
    return { reversalId, created: true };
  },
});

/**
 * Insert a near-copy of `target` that cancels it (ADR 0002), plus its audit entry.
 * Callers check `activeReversal` first so a target has at most one (ADR 0020).
 */
export async function writeReversal(
  ctx: MutationCtx,
  target: Doc<"transactions">,
  by: {
    reason: string;
    occurredAt: number;
    recordedBy: Id<"users"> | string;
    source: string;
    kind: "income" | "refund";
    externalId?: string;
  },
): Promise<Id<"transactions">> {
  const doc = {
    type: target.type,
    amount: target.amount,
    occurredAt: by.occurredAt,
    accountId: target.accountId,
    toAccountId: target.toAccountId,
    reason: by.reason,
    categoryId: target.categoryId,
    eventId: target.eventId,
    source: by.source,
    kind: by.kind,
    externalId: by.externalId,
    naboopayReference: target.naboopayReference,
    status: target.status,
    recordedBy: by.recordedBy,
    reversalOf: target._id,
    createdAt: Date.now(),
  };
  const reversalId = await ctx.db.insert("transactions", doc);
  await writeAudit(ctx, { actor: by.recordedBy, action: "reverse", targetId: reversalId, after: changedFields({}, doc).after });
  return reversalId;
}

/** Guarded committed → paid (ADR 0003, 0019). A second call is a no-op. */
export const markWithdrawalPaid = mutation({
  args: {
    transactionId: v.id("transactions"),
    toAccountId: v.id("accounts"),
    occurredAt: v.optional(v.number()),
  },
  returns: v.object({ id: v.id("transactions"), changed: v.boolean() }),
  handler: async (ctx, args) => {
    const officer = await currentOfficer(ctx);
    const tx = await getOrThrow(ctx, args.transactionId, "transaction");
    if (tx.type !== "school_withdrawal") throw new ConvexError("Only a school withdrawal can be marked paid.");
    if (tx.status !== "committed") return { id: tx._id, changed: false };
    const to = await getOrThrow(ctx, args.toAccountId, "destination account");
    if (to.isSchool) throw new ConvexError("A school withdrawal goes to a cash account.");
    const occurredAt = args.occurredAt ?? Date.now();
    assertOccurredAt(occurredAt, cutoverOf(await ctx.db.get(tx.accountId), to), Date.now());

    const before = { status: tx.status, toAccountId: tx.toAccountId, occurredAt: tx.occurredAt };
    const after = { status: "paid" as const, toAccountId: args.toAccountId, occurredAt };
    await ctx.db.patch(tx._id, after);
    await writeAudit(ctx, { actor: officer._id, action: "mark_paid", targetId: tx._id, ...changedFields(before, after) });
    return { id: tx._id, changed: true };
  },
});

/**
 * Cancel an approved-but-unpaid withdrawal that will not happen (ADR 0028).
 * Guarded `committed → cancelled`; a second call is a no-op. It changes no
 * balance (cancelled is not a live status) and clears the amount from the
 * committed total shown under School. A reason is required and recorded in the
 * audit entry.
 */
export const cancelWithdrawal = mutation({
  args: { transactionId: v.id("transactions"), reason: v.string() },
  returns: v.object({ id: v.id("transactions"), changed: v.boolean() }),
  handler: async (ctx, args) => {
    const officer = await currentOfficer(ctx);
    const tx = await getOrThrow(ctx, args.transactionId, "transaction");
    if (tx.type !== "school_withdrawal") throw new ConvexError("Only a school withdrawal can be cancelled.");
    if (args.reason.trim() === "") throw new ConvexError("A reason is required.");
    if (tx.status !== "committed") return { id: tx._id, changed: false }; // guarded no-op (ADR 0019)

    await ctx.db.patch(tx._id, { status: "cancelled" });
    await writeAudit(ctx, {
      actor: officer._id,
      action: "cancel_withdrawal",
      targetId: tx._id,
      before: { status: "committed" },
      after: { status: "cancelled", reason: args.reason.trim() },
    });
    return { id: tx._id, changed: true };
  },
});

/** Approved-but-unpaid withdrawals, listed under School on Home. */
export const committedWithdrawals = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("transactions"),
      amount: v.number(),
      reason: v.string(),
      toAccountId: v.optional(v.id("accounts")),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    await currentOfficer(ctx);
    const rows = await ctx.db
      .query("transactions")
      .withIndex("by_status", (q) => q.eq("status", "committed"))
      .collect();
    return rows
      .filter((t) => t.type === "school_withdrawal")
      .map(({ _id, amount, reason, toAccountId, createdAt }) => ({ _id, amount, reason, toAccountId, createdAt }));
  },
});

// ---------------------------------------------------------------------------
// M3: the transactions list, CSV export, label edits (ADR 0016, 0023, 0030)

/** One row as screens and the CSV see it. `flip` is the reversal sign (ADR 0027). */
export const listRow = v.object({
  _id: v.id("transactions"),
  type: txType,
  amount: v.number(),
  reason: v.string(),
  status: txStatus,
  accountId: v.id("accounts"),
  toAccountId: v.optional(v.id("accounts")),
  categoryId: v.optional(v.id("categories")),
  eventId: v.optional(v.id("events")),
  source: v.string(),
  occurredAt: v.optional(v.number()),
  createdAt: v.number(),
  reversalOf: v.optional(v.id("transactions")),
  flip: v.union(v.literal(1), v.literal(-1)),
  reversed: v.boolean(),
});

export async function toRow(ctx: QueryCtx, t: Doc<"transactions">) {
  return {
    _id: t._id,
    type: t.type,
    amount: t.amount,
    reason: t.reason,
    status: t.status,
    accountId: t.accountId,
    toAccountId: t.toAccountId,
    categoryId: t.categoryId,
    eventId: t.eventId,
    source: t.source,
    occurredAt: t.occurredAt,
    createdAt: t.createdAt,
    reversalOf: t.reversalOf,
    flip: await reversalFlip(t, (id) => ctx.db.get(id)),
    reversed: (await activeReversal(ctx, t._id)) !== null,
  };
}

export const listFilter = v.object({
  from: v.optional(v.number()),
  to: v.optional(v.number()),
  accountId: v.optional(v.id("accounts")),
  categoryId: v.optional(v.id("categories")),
  eventId: v.optional(v.id("events")),
  source: v.optional(v.string()),
  type: v.optional(txType),
});
type ListFilter = typeof listFilter.type;

/**
 * Newest first by occurredAt (ADR 0016, 0023). The date range uses the
 * by_occurredAt index; the other filters apply within it.
 * ponytail: one index + in-range filtering is fast at SG volume; add an index
 * per filter (no data change) if a term ever grows to tens of thousands of rows.
 * The account filter matches either leg, so a transfer shows under both accounts.
 */
function filtered(ctx: QueryCtx, f: ListFilter) {
  const dated = f.from !== undefined || f.to !== undefined;
  const q = ctx.db
    .query("transactions")
    .withIndex("by_occurredAt", (r) =>
      // Any date bound excludes undated (committed) withdrawals.
      dated ? r.gte("occurredAt", f.from ?? Number.MIN_SAFE_INTEGER).lte("occurredAt", f.to ?? Number.MAX_SAFE_INTEGER) : r,
    )
    .order("desc");
  return q.filter((x) =>
    x.and(
      f.accountId ? x.or(x.eq(x.field("accountId"), f.accountId), x.eq(x.field("toAccountId"), f.accountId)) : true,
      f.categoryId ? x.eq(x.field("categoryId"), f.categoryId) : true,
      f.eventId ? x.eq(x.field("eventId"), f.eventId) : true,
      f.source ? x.eq(x.field("source"), f.source) : true,
      f.type ? x.eq(x.field("type"), f.type) : true,
    ),
  );
}

export const list = query({
  args: { filter: listFilter, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(listRow),
  handler: async (ctx, args) => {
    await currentOfficer(ctx);
    const page = await filtered(ctx, args.filter).paginate(args.paginationOpts);
    return { ...page, page: await Promise.all(page.page.map((t) => toRow(ctx, t))) };
  },
});

/** Every row matching the filter, for the CSV (ADR 0023). */
export const exportRows = query({
  args: { filter: listFilter },
  returns: v.array(listRow),
  handler: async (ctx, args) => {
    await currentOfficer(ctx);
    // ponytail: capped well above a term's volume; paginate the export if a filter ever hits it.
    const rows = await filtered(ctx, args.filter).take(10_000);
    return Promise.all(rows.map((t) => toRow(ctx, t)));
  },
});

/** Distinct recent manual reasons with their category, for Add transaction (PRD §5.2). */
export const recentReasons = query({
  args: {},
  returns: v.array(v.object({ reason: v.string(), type: txType, categoryId: v.optional(v.id("categories")) })),
  handler: async (ctx) => {
    await currentOfficer(ctx);
    const rows = await ctx.db.query("transactions").order("desc").take(200);
    const seen = new Set<string>();
    const out = [];
    for (const t of rows) {
      const key = t.reason.toLowerCase();
      if (t.source !== "manual" || t.reversalOf || seen.has(key)) continue;
      seen.add(key);
      out.push({ reason: t.reason, type: t.type, categoryId: t.categoryId });
      if (out.length === 20) break;
    }
    return out;
  },
});

/** A transaction plus every reversal below it, so labels stay identical along the chain. */
async function withReversals(ctx: QueryCtx, root: Doc<"transactions">): Promise<Doc<"transactions">[]> {
  const out = [root];
  for (let i = 0; i < out.length; i++) {
    out.push(
      ...(await ctx.db
        .query("transactions")
        .withIndex("by_reversalOf", (q) => q.eq("reversalOf", out[i]._id))
        .collect()),
    );
  }
  return out;
}

/**
 * Edit labels in place: category, event, reason (ADR 0030). Money fields are
 * never editable here; those are reverse and re-enter.
 * A category on a needs_review row also confirms it, in the same write: the
 * single inbox-clearing action (ADR 0006). Category and event changes apply to
 * the whole reversal chain, so a reversal keeps netting to zero inside its own
 * category and event (ADR 0002). A repeat call changes nothing (ADR 0019).
 */
export const editLabels = mutation({
  args: {
    transactionId: v.id("transactions"),
    categoryId: v.optional(v.id("categories")),
    eventId: v.optional(v.union(v.id("events"), v.null())), // null clears the tag
    reason: v.optional(v.string()),
  },
  returns: v.object({ changed: v.number() }),
  handler: async (ctx, args) => {
    const officer = await currentOfficer(ctx);
    const target = await getOrThrow(ctx, args.transactionId, "transaction");
    const relabel = args.categoryId !== undefined || args.eventId !== undefined;
    if (relabel && target.reversalOf) {
      throw new ConvexError("Edit the original entry; its reversals follow it.");
    }

    if (args.categoryId !== undefined) {
      if (target.type !== "income" && target.type !== "expense") {
        throw new ConvexError(`A ${target.type} has no category (ADR 0009).`);
      }
      if (target.status === "draft" || target.status === "skipped") {
        throw new ConvexError("Recurring drafts are confirmed from the recurring flow.");
      }
      const category = await getOrThrow(ctx, args.categoryId, "category");
      if (category.direction !== target.type) throw new ConvexError(`"${category.name}" is not an ${target.type} category.`);
      if (category.name === "Unlabeled") throw new ConvexError("Pick a real category.");
    }
    if (args.eventId) {
      const event = await getOrThrow(ctx, args.eventId, "event");
      if (!event.active && event._id !== target.eventId) {
        throw new ConvexError(`"${event.name}" no longer accepts new entries.`);
      }
    }
    const reason = args.reason?.trim();
    if (args.reason !== undefined && !reason) throw new ConvexError("A reason is required.");

    const rows = relabel ? await withReversals(ctx, target) : [target];
    let changed = 0;
    for (const row of rows) {
      const after: Partial<Doc<"transactions">> = {};
      if (args.categoryId !== undefined) {
        after.categoryId = args.categoryId;
        if (row.status === "needs_review") after.status = "confirmed";
      }
      if (args.eventId !== undefined) after.eventId = args.eventId ?? undefined;
      if (reason !== undefined && row._id === target._id) after.reason = reason;

      const before = Object.fromEntries(Object.keys(after).map((k) => [k, row[k as keyof typeof row]]));
      const diff = changedFields(before, after);
      if (Object.keys(diff.before).length === 0 && Object.keys(diff.after).length === 0) continue;
      await ctx.db.patch(row._id, after);
      await writeAudit(ctx, {
        actor: officer._id,
        action: after.status === "confirmed" ? "assign_category" : "edit",
        targetId: row._id,
        ...diff,
      });
      changed++;
    }
    return { changed };
  },
});
