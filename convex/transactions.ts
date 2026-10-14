import { mutation, query, type QueryCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { currentOfficer } from "./auth";
import { writeAudit } from "./audit";
import { changedFields, validateEntry } from "./ledger";
import { txType } from "./schema";

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
    const doc = {
      type: args.type,
      amount: args.amount,
      occurredAt: committed ? undefined : (args.occurredAt ?? Date.now()),
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

/** True when `id` has a reversal that is not itself reversed (ADR 0020). */
async function activeReversal(ctx: QueryCtx, id: Id<"transactions">): Promise<Id<"transactions"> | null> {
  const reversals = await ctx.db
    .query("transactions")
    .withIndex("by_reversalOf", (q) => q.eq("reversalOf", id))
    .collect();
  for (const r of reversals) {
    if (!(await activeReversal(ctx, r._id))) return r._id;
  }
  return null;
}

/** Cancel an entry with a near-copy (ADR 0002); at most one active reversal (ADR 0020). */
export const reverse = mutation({
  args: { transactionId: v.id("transactions"), reason: v.string(), occurredAt: v.optional(v.number()) },
  returns: v.object({ reversalId: v.id("transactions"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const officer = await currentOfficer(ctx);
    const target = await getOrThrow(ctx, args.transactionId, "transaction");
    if (args.reason.trim() === "") throw new ConvexError("A reason is required.");
    // ponytail: no ADR covers cancelling an unpaid withdrawal; refuse rather than
    // leave a reversal that stays at 0 while the original later becomes paid.
    if (target.status === "committed") {
      throw new ConvexError("This withdrawal is not paid yet, so there is nothing to reverse.");
    }

    const existing = await activeReversal(ctx, target._id);
    if (existing) return { reversalId: existing, created: false }; // guarded no-op

    const doc = {
      type: target.type,
      amount: target.amount,
      occurredAt: args.occurredAt ?? Date.now(),
      accountId: target.accountId,
      toAccountId: target.toAccountId,
      reason: args.reason.trim(),
      categoryId: target.categoryId,
      eventId: target.eventId,
      source: "manual",
      kind: "income" as const,
      status: target.status,
      recordedBy: officer._id,
      reversalOf: target._id,
      createdAt: Date.now(),
    };
    const reversalId = await ctx.db.insert("transactions", doc);
    await writeAudit(ctx, { actor: officer._id, action: "reverse", targetId: reversalId, after: changedFields({}, doc).after });
    return { reversalId, created: true };
  },
});

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

    const before = { status: tx.status, toAccountId: tx.toAccountId, occurredAt: tx.occurredAt };
    const after = { status: "paid" as const, toAccountId: args.toAccountId, occurredAt: args.occurredAt ?? Date.now() };
    await ctx.db.patch(tx._id, after);
    await writeAudit(ctx, { actor: officer._id, action: "mark_paid", targetId: tx._id, ...changedFields(before, after) });
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

/** Latest entries for Home. The full filtered list is M3. */
export const recent = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("transactions"),
      type: v.string(),
      amount: v.number(),
      reason: v.string(),
      status: v.string(),
      accountId: v.id("accounts"),
      toAccountId: v.optional(v.id("accounts")),
      occurredAt: v.optional(v.number()),
      isReversal: v.boolean(),
      reversed: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    await currentOfficer(ctx);
    // ponytail: newest 20 by insertion; M3's list adds filters and pagination.
    const rows = await ctx.db.query("transactions").order("desc").take(20);
    return Promise.all(
      rows.map(async (t) => ({
        _id: t._id,
        type: t.type,
        amount: t.amount,
        reason: t.reason,
        status: t.status,
        accountId: t.accountId,
        toAccountId: t.toAccountId,
        occurredAt: t.occurredAt,
        isReversal: t.reversalOf !== undefined,
        reversed: (await activeReversal(ctx, t._id)) !== null,
      })),
    );
  },
});
