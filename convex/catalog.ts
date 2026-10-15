import { query } from "./_generated/server";
import { v } from "convex/values";
import { currentOfficer } from "./auth";
import { accountKey, direction } from "./schema";

/** Accounts, categories and active events for the entry form. */
export const forEntry = query({
  args: {},
  returns: v.object({
    accounts: v.array(v.object({ _id: v.id("accounts"), key: accountKey, name: v.string(), isSchool: v.boolean() })),
    categories: v.array(v.object({ _id: v.id("categories"), name: v.string(), direction })),
    events: v.array(v.object({ _id: v.id("events"), name: v.string() })),
  }),
  handler: async (ctx) => {
    await currentOfficer(ctx);
    const accounts = await ctx.db.query("accounts").collect();
    const categories = await ctx.db.query("categories").collect();
    const events = await ctx.db.query("events").collect();
    return {
      accounts: accounts.map(({ _id, key, name, isSchool }) => ({ _id, key, name, isSchool })),
      // Unlabeled is for automatic income only (ADR 0009).
      categories: categories
        .filter((c) => c.name !== "Unlabeled")
        .map(({ _id, name, direction }) => ({ _id, name, direction })),
      events: events.filter((e) => e.active).map(({ _id, name }) => ({ _id, name })),
    };
  },
});

/** Every account, category and event by id, for labelling rows (includes closed events and Unlabeled). */
export const names = query({
  args: {},
  returns: v.object({
    accounts: v.array(v.object({ _id: v.id("accounts"), name: v.string() })),
    categories: v.array(v.object({ _id: v.id("categories"), name: v.string(), direction })),
    events: v.array(v.object({ _id: v.id("events"), name: v.string(), active: v.boolean() })),
  }),
  handler: async (ctx) => {
    await currentOfficer(ctx);
    return {
      accounts: (await ctx.db.query("accounts").collect()).map(({ _id, name }) => ({ _id, name })),
      categories: (await ctx.db.query("categories").collect()).map(({ _id, name, direction }) => ({ _id, name, direction })),
      events: (await ctx.db.query("events").collect()).map(({ _id, name, active }) => ({ _id, name, active })),
    };
  },
});

/** The signed-in officer, for the app shell. */
export const me = query({
  args: {},
  returns: v.object({ name: v.optional(v.string()), email: v.optional(v.string()) }),
  handler: async (ctx) => {
    const { name, email } = await currentOfficer(ctx);
    return { name, email };
  },
});
