import { query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { currentOfficer } from "./auth";
import { LIVE_STATUSES, reversalFlip } from "./ledger";
import { direction } from "./schema";

/**
 * Event view: the event's ALL-TIME income, expense and net by category
 * (ADR 0022). Counts live entries plus pre-cutover `memo` summaries (ADR 0011);
 * a reversal carries its chain sign, so a reversed sale nets to zero inside its
 * own category (ADR 0002, 0027). Closing an event does not change its totals.
 */
export const event = query({
  args: { eventId: v.id("events") },
  returns: v.object({
    name: v.string(),
    active: v.boolean(),
    income: v.number(),
    expense: v.number(),
    net: v.number(),
    entries: v.number(),
    categories: v.array(
      v.object({ categoryId: v.optional(v.id("categories")), name: v.string(), direction, total: v.number() }),
    ),
  }),
  handler: async (ctx, args) => {
    await currentOfficer(ctx);
    const event = await ctx.db.get(args.eventId);
    if (!event) throw new ConvexError("Unknown event.");
    const rows = await ctx.db.query("transactions").withIndex("by_eventId", (q) => q.eq("eventId", args.eventId)).collect();

    const totals = new Map<string, { categoryId?: (typeof rows)[number]["categoryId"]; direction: "income" | "expense"; total: number }>();
    let entries = 0;
    for (const t of rows) {
      if (t.type !== "income" && t.type !== "expense") continue; // P&L is income and expense only
      if (!LIVE_STATUSES.has(t.status) && t.status !== "memo") continue;
      const signed = t.amount * (await reversalFlip(t, (id) => ctx.db.get(id)));
      const key = `${t.type}:${t.categoryId ?? ""}`;
      const bucket = totals.get(key) ?? { categoryId: t.categoryId, direction: t.type, total: 0 };
      bucket.total += signed;
      totals.set(key, bucket);
      entries++;
    }

    const categories = await Promise.all(
      [...totals.values()].map(async (b) => ({
        ...b,
        name: b.categoryId ? ((await ctx.db.get(b.categoryId))?.name ?? "Unknown") : "No category",
      })),
    );
    categories.sort((a, b) => a.direction.localeCompare(b.direction) || b.total - a.total);
    const income = categories.filter((c) => c.direction === "income").reduce((s, c) => s + c.total, 0);
    const expense = categories.filter((c) => c.direction === "expense").reduce((s, c) => s + c.total, 0);
    return { name: event.name, active: event.active, income, expense, net: income - expense, entries, categories };
  },
});
