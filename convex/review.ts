import { query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { currentOfficer } from "./auth";
import { listRow, toRow } from "./transactions";

// The inbox is a query on status, never a stored flag (ADR 0006, 0026).
const INBOX = ["needs_review", "draft"] as const;

async function inboxRows(ctx: QueryCtx) {
  const groups = await Promise.all(
    INBOX.map((status) => ctx.db.query("transactions").withIndex("by_status", (q) => q.eq("status", status)).collect()),
  );
  return groups.flat().sort((a, b) => (b.occurredAt ?? b.createdAt) - (a.occurredAt ?? a.createdAt));
}

/** Everything waiting for an officer, newest first. Labelling uses transactions.editLabels. */
export const list = query({
  args: {},
  returns: v.array(listRow),
  handler: async (ctx) => {
    await currentOfficer(ctx);
    return Promise.all((await inboxRows(ctx)).map((t) => toRow(ctx, t)));
  },
});

/** The Home badge. */
export const count = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await currentOfficer(ctx);
    return (await inboxRows(ctx)).length;
  },
});
