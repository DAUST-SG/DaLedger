import type { MutationCtx } from "./_generated/server";
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
