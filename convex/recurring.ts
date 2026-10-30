import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { currentOfficer } from "./auth";
import { writeAudit } from "./audit";
import { assertOccurredAt, changedFields, cutoverOf, validateEntry } from "./ledger";
import { activeReversal } from "./transactions";

// Recurring expense drafts (ADR 0012). Dates are UTC: Dakar is UTC+0.
const DAY = 24 * 3600 * 1000;
const startOfDay = (ms: number) => Math.floor(ms / DAY) * DAY;
const monthKey = (ms: number) => new Date(ms).toISOString().slice(0, 7); // "YYYY-MM"
const dueIn = (ms: number, day: number) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day);
};

/**
 * The next due date not yet drafted: this month's if it's still ahead (or due
 * today), otherwise next month's. A template never starts already overdue (M7 Q1).
 */
export function nextDue(dayOfMonth: number, now: number): number {
  const thisMonth = dueIn(now, dayOfMonth);
  if (thisMonth >= startOfDay(now)) return thisMonth;
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, dayOfMonth);
}

const templateArgs = {
  reason: v.string(),
  amount: v.number(),
  accountId: v.id("accounts"),
  categoryId: v.id("categories"),
  eventId: v.optional(v.id("events")),
  dayOfMonth: v.number(),
};

/** A template prepares an expense, so it obeys the expense rules (ADR 0009, 0024). */
async function validateTemplate(ctx: QueryCtx, t: { reason: string; amount: number; accountId: Id<"accounts">; categoryId: Id<"categories">; dayOfMonth: number }) {
  const account = await ctx.db.get(t.accountId);
  const category = await ctx.db.get(t.categoryId);
  if (!account || !category) throw new ConvexError("Unknown account or category.");
  validateEntry({ type: "expense", amount: t.amount, reason: t.reason, account, toAccount: null, category });
  if (!Number.isInteger(t.dayOfMonth) || t.dayOfMonth < 1 || t.dayOfMonth > 28) {
    throw new ConvexError("Pick a due day from 1 to 28, so it exists every month.");
  }
}

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("recurringTemplates"),
      reason: v.string(),
      amount: v.number(),
      accountId: v.id("accounts"),
      categoryId: v.id("categories"),
      eventId: v.optional(v.id("events")),
      dayOfMonth: v.number(),
      active: v.boolean(),
      nextDraft: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    await currentOfficer(ctx);
    const now = Date.now();
    const templates = await ctx.db.query("recurringTemplates").collect();
    return templates
      .map(({ _creationTime: _ignored, ...t }) => ({ ...t, nextDraft: t.active ? nextDue(t.dayOfMonth, now) : undefined }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.dayOfMonth - b.dayOfMonth);
  },
});

export const create = mutation({
  args: templateArgs,
  returns: v.id("recurringTemplates"),
  handler: async (ctx, args) => {
    await currentOfficer(ctx);
    await validateTemplate(ctx, args);
    return ctx.db.insert("recurringTemplates", { ...args, reason: args.reason.trim(), active: true });
  },
});

/** Edits change future drafts only; drafts already created keep their values (ADR 0012). */
export const update = mutation({
  args: { templateId: v.id("recurringTemplates"), ...templateArgs },
  returns: v.null(),
  handler: async (ctx, { templateId, ...args }) => {
    await currentOfficer(ctx);
    if (!(await ctx.db.get(templateId))) throw new ConvexError("Unknown template.");
    await validateTemplate(ctx, args);
    await ctx.db.patch(templateId, { ...args, reason: args.reason.trim() });
    return null;
  },
});

/** Deactivate or reactivate; templates are never deleted (ADR 0012). */
export const setActive = mutation({
  args: { templateId: v.id("recurringTemplates"), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await currentOfficer(ctx);
    if (!(await ctx.db.get(args.templateId))) throw new ConvexError("Unknown template.");
    await ctx.db.patch(args.templateId, { active: args.active });
    return null;
  },
});

/**
 * Daily (crons.ts): one draft per active template per month, dated its due day,
 * once that day has come. The (recurringId, draftMonth) slot is checked inside the
 * mutation (ADR 0025), so a repeat run, or a skipped/confirmed month, never makes
 * a second one. A template's first month is the first due day on or after the
 * day it was created (M7 Q1).
 * ponytail: catches up within the current month only; a job down for a whole
 * month would leave that month for an officer to enter by hand.
 */
export const generate = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const month = monthKey(now);
    let created = 0;
    for (const t of await ctx.db.query("recurringTemplates").collect()) {
      if (!t.active) continue;
      const due = dueIn(now, t.dayOfMonth);
      if (due > now || due < startOfDay(t._creationTime)) continue;
      const slot = await ctx.db
        .query("transactions")
        .withIndex("by_recurringId_and_draftMonth", (q) => q.eq("recurringId", t._id).eq("draftMonth", month))
        .first();
      if (slot) continue;
      const doc = {
        type: "expense" as const,
        amount: t.amount,
        occurredAt: due,
        accountId: t.accountId,
        reason: t.reason,
        categoryId: t.categoryId,
        eventId: t.eventId,
        source: "recurring",
        kind: "income" as const,
        status: "draft" as const, // in the inbox, moves no money (ADR 0007)
        recordedBy: "recurring",
        recurringId: t._id,
        draftMonth: month,
        createdAt: Date.now(),
      };
      const id = await ctx.db.insert("transactions", doc);
      await writeAudit(ctx, { actor: "recurring", action: "create", targetId: id, after: changedFields({}, doc).after });
      created++;
    }
    return created;
  },
});

async function draftOrThrow(ctx: QueryCtx, id: Id<"transactions">): Promise<Doc<"transactions">> {
  const tx = await ctx.db.get(id);
  if (!tx || !tx.recurringId) throw new ConvexError("This is not a recurring draft.");
  return tx;
}

/**
 * Guarded draft → confirmed (ADR 0012, 0019). Amount, date, account and category
 * may be corrected first (M7 Q2): a draft has moved no money, so this is not a
 * money edit (ADR 0030 applies once confirmed). A second tap is a no-op.
 */
export const confirmDraft = mutation({
  args: {
    transactionId: v.id("transactions"),
    amount: v.optional(v.number()),
    occurredAt: v.optional(v.number()),
    accountId: v.optional(v.id("accounts")),
    categoryId: v.optional(v.id("categories")),
  },
  returns: v.object({ changed: v.boolean() }),
  handler: async (ctx, args) => {
    const officer = await currentOfficer(ctx);
    const tx = await draftOrThrow(ctx, args.transactionId);
    if (tx.status !== "draft") return { changed: false };
    // Defence in depth: a draft with a reversal (only possible from data written
    // before reverse() refused drafts) must not start counting money.
    if (await activeReversal(ctx, tx._id)) throw new ConvexError("This draft was reversed; skip it instead.");

    const after = {
      amount: args.amount ?? tx.amount,
      occurredAt: args.occurredAt ?? tx.occurredAt,
      accountId: args.accountId ?? tx.accountId,
      categoryId: args.categoryId ?? tx.categoryId,
      status: "confirmed" as const,
    };
    const account = await ctx.db.get(after.accountId);
    const category = after.categoryId ? await ctx.db.get(after.categoryId) : null;
    if (!account) throw new ConvexError("Unknown account.");
    validateEntry({ type: "expense", amount: after.amount, reason: tx.reason, account, toAccount: null, category });
    if (after.occurredAt !== undefined) assertOccurredAt(after.occurredAt, cutoverOf(account), Date.now());

    const before = { amount: tx.amount, occurredAt: tx.occurredAt, accountId: tx.accountId, categoryId: tx.categoryId, status: tx.status };
    await ctx.db.patch(tx._id, after);
    await writeAudit(ctx, { actor: officer._id, action: "confirm_draft", targetId: tx._id, ...changedFields(before, after) });
    return { changed: true };
  },
});

/** Guarded draft → skipped: terminal, keeps the month's slot, moves no money (ADR 0012). */
export const skipDraft = mutation({
  args: { transactionId: v.id("transactions"), reason: v.string() },
  returns: v.object({ changed: v.boolean() }),
  handler: async (ctx, args) => {
    const officer = await currentOfficer(ctx);
    const tx = await draftOrThrow(ctx, args.transactionId);
    const reason = args.reason.trim();
    if (!reason) throw new ConvexError("Say why this month is skipped.");
    if (tx.status !== "draft") return { changed: false };
    await ctx.db.patch(tx._id, { status: "skipped" });
    await writeAudit(ctx, {
      actor: officer._id,
      action: "skip_draft",
      targetId: tx._id,
      before: { status: "draft" },
      after: { status: "skipped", skipReason: reason },
    });
    return { changed: true };
  },
});

/** Drafts past their due day, for the Home highlight. */
export const overdue = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await currentOfficer(ctx);
    const today = startOfDay(Date.now());
    const drafts = await ctx.db.query("transactions").withIndex("by_status", (q) => q.eq("status", "draft")).collect();
    return drafts.filter((d) => (d.occurredAt ?? Infinity) < today).length;
  },
});
