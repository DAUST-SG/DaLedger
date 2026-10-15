import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { currentOfficer } from "./auth";
import { writeAudit } from "./audit";
import { balanceOf } from "./balances";
import { changedFields } from "./ledger";

async function accountOrThrow(ctx: QueryCtx, id: Id<"accounts">) {
  const account = await ctx.db.get(id);
  if (!account) throw new ConvexError("Unknown account.");
  return account;
}

/** Real balances are whole FCFA; only School may be negative (M4 Q3, ADR 0017). */
function assertRealBalance(account: Doc<"accounts">, real: number) {
  if (!Number.isInteger(real)) throw new ConvexError("Enter a whole number of FCFA.");
  if (real < 0 && !account.isSchool) throw new ConvexError(`${account.name} can't hold less than 0 FCFA.`);
}

/** An adjustment_up/down closing `difference` on `account`, dated `at` (ADR 0001). */
async function writeAdjustment(
  ctx: MutationCtx,
  account: Doc<"accounts">,
  difference: number,
  at: number,
  reason: string,
  officerId: Id<"users">,
  action: string,
): Promise<{ id: Id<"transactions">; type: "adjustment_up" | "adjustment_down" }> {
  const type = difference > 0 ? ("adjustment_up" as const) : ("adjustment_down" as const);
  const doc = {
    type,
    amount: Math.abs(difference),
    occurredAt: at,
    accountId: account._id,
    reason,
    source: "manual",
    kind: "income" as const,
    status: "confirmed" as const,
    recordedBy: officerId,
    createdAt: Date.now(),
  };
  const id = await ctx.db.insert("transactions", doc);
  await writeAudit(ctx, { actor: officerId, action, targetId: id, after: changedFields({}, doc).after });
  return { id, type };
}

/** The balance a check ended at: real if it was adjusted, else computed (gap left open). */
const endedAt = (r: Doc<"reconciliations">) => (r.adjustmentId ? r.realBalance : r.computedBalance);

/**
 * Stale = the balance at the check time, recomputed now, no longer equals what
 * the check ended at (ADR 0010, as amended in M4). Value-based, so it also catches
 * a withdrawal marked paid with an earlier date, and ignores entries that net to 0.
 */
async function isStale(ctx: QueryCtx, account: Doc<"accounts">, r: Doc<"reconciliations">) {
  return (await balanceOf(ctx, account, r.checkedAt)) !== endedAt(r);
}

/**
 * The computed balance for the Reconcile screen. No date filter: Convex freezes
 * Date.now() in a reactive query, which would hide entries made after it first ran.
 * create() recomputes at the check time, so the stored figure is always exact.
 */
export const preview = query({
  args: { accountId: v.id("accounts") },
  returns: v.number(),
  handler: async (ctx, args) => {
    await currentOfficer(ctx);
    return balanceOf(ctx, await accountOrThrow(ctx, args.accountId));
  },
});

/** Record a check; optionally close the gap with an adjustment dated at the check. */
export const create = mutation({
  args: {
    accountId: v.id("accounts"),
    realBalance: v.number(),
    adjust: v.boolean(),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    reconciliationId: v.id("reconciliations"),
    computedBalance: v.number(),
    realBalance: v.number(),
    difference: v.number(),
    adjustmentId: v.optional(v.id("transactions")),
    adjustmentType: v.optional(v.union(v.literal("adjustment_up"), v.literal("adjustment_down"))),
  }),
  handler: async (ctx, args) => {
    const officer = await currentOfficer(ctx);
    const account = await accountOrThrow(ctx, args.accountId);
    assertRealBalance(account, args.realBalance);

    const checkedAt = Date.now();
    // Read inside the mutation, so a just-saved entry can't make the stored check wrong.
    const computedBalance = await balanceOf(ctx, account, checkedAt);
    const difference = args.realBalance - computedBalance;

    let adjustment: { id: Id<"transactions">; type: "adjustment_up" | "adjustment_down" } | undefined;
    if (args.adjust && difference !== 0) {
      const reason = args.reason?.trim();
      if (!reason) throw new ConvexError("Say why the balances differ.");
      adjustment = await writeAdjustment(ctx, account, difference, checkedAt, reason, officer._id, "adjust");
    }

    const reconciliationId = await ctx.db.insert("reconciliations", {
      accountId: account._id,
      computedBalance,
      realBalance: args.realBalance,
      difference,
      adjustmentId: adjustment?.id,
      checkedBy: officer._id,
      checkedAt,
    });
    return {
      reconciliationId,
      computedBalance,
      realBalance: args.realBalance,
      difference,
      adjustmentId: adjustment?.id,
      adjustmentType: adjustment?.type,
    };
  },
});

/**
 * Correct an opening balance without editing it (ADR 0018): an adjustment for the
 * difference, dated at cutover (= the account's creation time, M4 Q2).
 */
export const correctOpening = mutation({
  args: { accountId: v.id("accounts"), correctOpeningBalance: v.number(), reason: v.string() },
  returns: v.object({ adjustmentId: v.optional(v.id("transactions")), difference: v.number() }),
  handler: async (ctx, args) => {
    const officer = await currentOfficer(ctx);
    const account = await accountOrThrow(ctx, args.accountId);
    assertRealBalance(account, args.correctOpeningBalance);
    const reason = args.reason.trim();
    if (!reason) throw new ConvexError("Say why the opening balance was wrong.");

    // Whole ms: _creationTime has a fractional part, occurredAt never does.
    const cutoverAt = Math.floor(account._creationTime);
    // Includes earlier corrections, so a second correction is relative to the first.
    const difference = args.correctOpeningBalance - (await balanceOf(ctx, account, cutoverAt));
    if (difference === 0) return { difference };
    const { id } = await writeAdjustment(
      ctx, account, difference, cutoverAt, `Opening balance correction: ${reason}`, officer._id, "correct_opening",
    );
    return { adjustmentId: id, difference };
  },
});

/** Per account: last check, whether it still holds, and whether School is negative. */
export const status = query({
  args: {},
  returns: v.array(
    v.object({
      accountId: v.id("accounts"),
      lastCheckedAt: v.optional(v.number()),
      openDifference: v.number(),
      stale: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    await currentOfficer(ctx);
    const accounts = await ctx.db.query("accounts").collect();
    return Promise.all(
      accounts.map(async (account) => {
        const last = await ctx.db
          .query("reconciliations")
          .withIndex("by_accountId_and_checkedAt", (q) => q.eq("accountId", account._id))
          .order("desc")
          .first();
        if (!last) return { accountId: account._id, openDifference: 0, stale: false };
        return {
          accountId: account._id,
          lastCheckedAt: last.checkedAt,
          openDifference: last.adjustmentId ? 0 : last.difference,
          stale: await isStale(ctx, account, last),
        };
      }),
    );
  },
});

/** Past checks for one account, newest first. */
export const history = query({
  args: { accountId: v.id("accounts") },
  returns: v.array(
    v.object({
      _id: v.id("reconciliations"),
      checkedAt: v.number(),
      checkedBy: v.string(),
      computedBalance: v.number(),
      realBalance: v.number(),
      difference: v.number(),
      adjusted: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    await currentOfficer(ctx);
    const rows = await ctx.db
      .query("reconciliations")
      .withIndex("by_accountId_and_checkedAt", (q) => q.eq("accountId", args.accountId))
      .order("desc")
      .take(20);
    return Promise.all(
      rows.map(async (r) => {
        const officer = await ctx.db.get(r.checkedBy);
        return {
          _id: r._id,
          checkedAt: r.checkedAt,
          checkedBy: officer?.name ?? officer?.email ?? "Unknown officer",
          computedBalance: r.computedBalance,
          realBalance: r.realBalance,
          difference: r.difference,
          adjusted: r.adjustmentId !== undefined,
        };
      }),
    );
  },
});
