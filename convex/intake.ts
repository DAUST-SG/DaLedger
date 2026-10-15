import { internalMutation, type QueryCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { writeAudit } from "./audit";
import { assertAmount, changedFields } from "./ledger";
import { activeReversal, writeReversal } from "./transactions";

// Step 2 of the category order (ADR 0029). Values pending the Treasurer (PRD §9).
const SOURCE_DEFAULT_CATEGORY: Record<string, string> = {
  shop: "Shop sales",
  dabus: "DaBus",
};

/**
 * ADR 0029: the request's category if it names an income category, else the
 * source's default, else Unlabeled (which puts the sale in the review inbox).
 */
async function resolveCategory(ctx: QueryCtx, source: string, requested?: string) {
  for (const name of [requested, SOURCE_DEFAULT_CATEGORY[source]]) {
    if (!name) continue;
    const cat = await ctx.db.query("categories").withIndex("by_name", (q) => q.eq("name", name)).unique();
    if (cat && cat.direction === "income" && cat.name !== "Unlabeled") return { id: cat._id, labelled: true };
  }
  const unlabeled = await ctx.db.query("categories").withIndex("by_name", (q) => q.eq("name", "Unlabeled")).unique();
  if (!unlabeled) throw new Error("The Unlabeled category is missing; run seed:accounts.");
  return { id: unlabeled._id, labelled: false };
}

/** An active event by name, or by id. Unknown or closed events are dropped (M2 Q3). */
async function resolveEvent(ctx: QueryCtx, nameOrId?: string): Promise<Id<"events"> | undefined> {
  if (!nameOrId) return undefined;
  const byName = await ctx.db.query("events").withIndex("by_name", (q) => q.eq("name", nameOrId)).unique();
  const id = byName?._id ?? ctx.db.normalizeId("events", nameOrId);
  const event = id ? await ctx.db.get(id) : null;
  return event?.active ? event._id : undefined;
}

async function findIntake(ctx: QueryCtx, source: string, externalId: string, kind: "income" | "refund") {
  return ctx.db
    .query("transactions")
    .withIndex("by_source_and_externalId_and_kind", (q) =>
      q.eq("source", source).eq("externalId", externalId).eq("kind", kind),
    )
    .first();
}

/** One paid shop/DaBus order, recorded once (ADR 0005, 0025). */
export const recordIncome = internalMutation({
  args: {
    source: v.string(),
    externalId: v.string(),
    amount: v.number(),
    paidAt: v.number(),
    description: v.string(),
    naboopayReference: v.string(),
    category: v.optional(v.string()),
    event: v.optional(v.string()),
  },
  returns: v.object({ id: v.id("transactions"), status: v.string(), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await findIntake(ctx, args.source, args.externalId, "income");
    if (existing) return { id: existing._id, status: existing.status, duplicate: true };

    assertAmount(args.amount);
    const naboopay = await ctx.db.query("accounts").withIndex("by_key", (q) => q.eq("key", "naboopay")).unique();
    if (!naboopay) throw new Error("The Naboopay account is missing; run seed:accounts.");
    const category = await resolveCategory(ctx, args.source, args.category);
    const eventId = await resolveEvent(ctx, args.event);

    const doc = {
      type: "income" as const,
      amount: args.amount,
      occurredAt: args.paidAt,
      accountId: naboopay._id,
      reason: args.description.trim(),
      categoryId: category.id,
      eventId,
      source: args.source,
      kind: "income" as const,
      externalId: args.externalId,
      naboopayReference: args.naboopayReference,
      // Unlabeled money still counts; it waits in the inbox for a label (ADR 0006, 0007).
      status: category.labelled ? ("confirmed" as const) : ("needs_review" as const),
      recordedBy: args.source,
      createdAt: Date.now(),
    };
    const id = await ctx.db.insert("transactions", doc);
    const after: Record<string, unknown> = changedFields({}, doc).after;
    if (args.event && !eventId) after.unknownEvent = args.event; // kept for an officer to fix (M3)
    await writeAudit(ctx, { actor: args.source, action: "create", targetId: id, after });
    return { id, status: doc.status, duplicate: false };
  },
});

/** Reverse a recorded sale, once; 404 when we never recorded it (ADR 0005, 0020). */
export const recordRefund = internalMutation({
  args: { source: v.string(), externalId: v.string(), reason: v.optional(v.string()) },
  returns: v.union(
    v.object({ result: v.literal("created"), reversalId: v.id("transactions"), reversalOf: v.id("transactions"), amount: v.number() }),
    v.object({ result: v.literal("duplicate"), reversalId: v.id("transactions") }),
    v.object({ result: v.literal("not_found") }),
  ),
  handler: async (ctx, args) => {
    const existing = await findIntake(ctx, args.source, args.externalId, "refund");
    if (existing) return { result: "duplicate" as const, reversalId: existing._id };

    const original = await findIntake(ctx, args.source, args.externalId, "income");
    if (!original) return { result: "not_found" as const }; // write nothing; the backend retries

    // An officer may already have reversed this sale by hand: never cancel it twice.
    const active = await activeReversal(ctx, original._id);
    if (active) return { result: "duplicate" as const, reversalId: active };

    const reason = args.reason?.trim() || `Refund of ${args.externalId}`;
    if (reason.length > 500) throw new ConvexError("The refund reason is too long.");
    const reversalId = await writeReversal(ctx, original, {
      reason,
      occurredAt: Date.now(),
      recordedBy: args.source,
      source: args.source,
      kind: "refund",
      externalId: args.externalId,
    });
    return { result: "created" as const, reversalId, reversalOf: original._id, amount: original.amount };
  },
});
