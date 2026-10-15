import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { currentOfficer } from "./auth";

/** Every event, open ones first. */
export const list = query({
  args: {},
  returns: v.array(v.object({ _id: v.id("events"), name: v.string(), active: v.boolean() })),
  handler: async (ctx) => {
    await currentOfficer(ctx);
    const events = await ctx.db.query("events").collect();
    return events
      .map(({ _id, name, active }) => ({ _id, name, active }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  },
});

/** Add an event. A name that already exists returns that event (and reopens it). */
export const create = mutation({
  args: { name: v.string() },
  returns: v.object({ id: v.id("events"), created: v.boolean() }),
  handler: async (ctx, args) => {
    await currentOfficer(ctx);
    const name = args.name.trim().replace(/\s+/g, " ");
    if (!name) throw new ConvexError("Give the event a name.");
    if (name.length > 80) throw new ConvexError("Keep the event name under 80 characters.");
    const existing = await ctx.db.query("events").withIndex("by_name", (q) => q.eq("name", name)).unique();
    if (existing) {
      if (!existing.active) await ctx.db.patch(existing._id, { active: true });
      return { id: existing._id, created: false };
    }
    return { id: await ctx.db.insert("events", { name, active: true }), created: true };
  },
});

/**
 * Close or reopen. Closing only stops new tags; totals keep every past entry
 * (ADR 0022). Events are never deleted, because transactions point at them.
 */
export const setActive = mutation({
  args: { eventId: v.id("events"), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await currentOfficer(ctx);
    if (!(await ctx.db.get(args.eventId))) throw new ConvexError("Unknown event.");
    await ctx.db.patch(args.eventId, { active: args.active });
    return null;
  },
});
