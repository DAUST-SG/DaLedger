import { internalAction, internalMutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { createAccount } from "@convex-dev/auth/server";

const ACCOUNTS = [
  { key: "naboopay", name: "Naboopay", isSchool: false, automatic: true },
  { key: "wave", name: "Wave", isSchool: false, automatic: false },
  { key: "om", name: "Orange Money", isSchool: false, automatic: false },
  { key: "cash", name: "Cash", isSchool: false, automatic: false },
  { key: "school", name: "School", isSchool: true, automatic: false },
] as const;

// The brief's starting list, until the Treasurer confirms it (PRD §9).
const CATEGORIES = [
  ...["Shop sales", "DaBus", "Sponsorship", "Fundraising", "Other income"].map((name) => ({
    name, direction: "income" as const, isSystem: false,
  })),
  ...["Supplies", "Catering", "Venue", "Decorations", "Merchandise purchase", "Transport", "Other expense"].map(
    (name) => ({ name, direction: "expense" as const, isSystem: false }),
  ),
  { name: "Provider fees", direction: "expense" as const, isSystem: true }, // ADR 0015
  { name: "Unlabeled", direction: "income" as const, isSystem: true }, // ADR 0009
];

/**
 * Create the 5 accounts and the categories. Safe to run twice: existing rows are
 * never touched, so an opening balance is write-once (ADR 0018).
 *   npx convex run seed:accounts '{"opening":{"naboopay":0,"wave":0,"om":0,"cash":0,"school":0}}'
 */
export const accounts = internalMutation({
  args: {
    opening: v.optional(
      v.object({ naboopay: v.number(), wave: v.number(), om: v.number(), cash: v.number(), school: v.number() }),
    ),
  },
  returns: v.object({ accountsCreated: v.number(), categoriesCreated: v.number() }),
  handler: async (ctx, args) => {
    let accountsCreated = 0;
    for (const a of ACCOUNTS) {
      const existing = await ctx.db.query("accounts").withIndex("by_key", (q) => q.eq("key", a.key)).unique();
      if (existing) continue;
      const openingBalance = args.opening?.[a.key] ?? 0;
      if (!Number.isInteger(openingBalance)) throw new ConvexError("Opening balances are whole FCFA.");
      await ctx.db.insert("accounts", { ...a, openingBalance });
      accountsCreated++;
    }
    let categoriesCreated = 0;
    for (const c of CATEGORIES) {
      const existing = await ctx.db.query("categories").withIndex("by_name", (q) => q.eq("name", c.name)).unique();
      if (existing) continue;
      await ctx.db.insert("categories", c);
      categoriesCreated++;
    }
    return { accountsCreated, categoriesCreated };
  },
});

/**
 * Add an officer with a starting password, shared with them in person.
 *   npx convex run seed:addOfficer '{"email":"…","name":"…","password":"…"}'
 */
export const addOfficer = internalAction({
  args: { email: v.string(), name: v.string(), password: v.string() },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    if (args.password.length < 8) throw new ConvexError("Use a password of at least 8 characters.");
    const email = args.email.trim().toLowerCase();
    const { user } = await createAccount(ctx, {
      provider: "password",
      account: { id: email, secret: args.password },
      profile: { email, name: args.name, role: "officer", active: true },
    });
    return user._id;
  },
});

/** Add an event tag (M1 has no events screen). */
export const addEvent = internalMutation({
  args: { name: v.string() },
  returns: v.id("events"),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("events").withIndex("by_name", (q) => q.eq("name", args.name)).unique();
    return existing?._id ?? (await ctx.db.insert("events", { name: args.name, active: true }));
  },
});
