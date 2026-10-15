import { query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { currentOfficer } from "./auth";
import type { Id } from "./_generated/dataModel";

/** One audit entry per state-changing write; changed fields only (ADR 0014). */
export async function writeAudit(
  ctx: MutationCtx,
  entry: {
    actor: Id<"users"> | string;
    action: string;
    targetId: Id<"transactions">;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", { ...entry, at: Date.now() });
}

/** One transaction's history, newest first, with the officer's name or the source (ADR 0014). */
export const forTransaction = query({
  args: { transactionId: v.id("transactions") },
  returns: v.array(
    v.object({
      _id: v.id("auditLog"),
      action: v.string(),
      at: v.number(),
      actor: v.string(),
      before: v.optional(v.record(v.string(), v.any())),
      after: v.optional(v.record(v.string(), v.any())),
    }),
  ),
  handler: async (ctx, args) => {
    await currentOfficer(ctx);
    const entries = await ctx.db
      .query("auditLog")
      .withIndex("by_targetId", (q) => q.eq("targetId", args.transactionId))
      .collect();
    const out = await Promise.all(
      entries.map(async (e) => {
        const userId = ctx.db.normalizeId("users", e.actor);
        const user = userId ? await ctx.db.get(userId) : null;
        return {
          _id: e._id,
          action: e.action,
          at: e.at,
          actor: user ? (user.name ?? user.email ?? "Officer") : e.actor,
          before: e.before,
          after: e.after,
        };
      }),
    );
    // Same-millisecond entries keep insertion order, newest first (sort is stable).
    return out.reverse().sort((a, b) => b.at - a.at);
  },
});
