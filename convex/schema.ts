import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

// ADR 0001
export const txType = v.union(
  v.literal("income"),
  v.literal("expense"),
  v.literal("transfer"),
  v.literal("allocation"),
  v.literal("school_withdrawal"),
  v.literal("adjustment_up"),
  v.literal("adjustment_down"),
);

// ADR 0003, 0007, 0011, 0012, 0026 (7 statuses; `provisional` removed)
export const txStatus = v.union(
  v.literal("confirmed"),
  v.literal("needs_review"),
  v.literal("committed"),
  v.literal("paid"),
  v.literal("draft"),
  v.literal("memo"),
  v.literal("skipped"),
);

export const accountKey = v.union(
  v.literal("naboopay"),
  v.literal("wave"),
  v.literal("om"),
  v.literal("cash"),
  v.literal("school"),
);

export const direction = v.union(v.literal("income"), v.literal("expense"));

export default defineSchema({
  ...authTables,

  // Convex Auth owns the base `users` fields; role/active are ours.
  // ponytail: role/active are optional only because Convex Auth inserts users
  // without them; currentOfficer() treats a missing `active` as inactive.
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    role: v.optional(
      v.union(v.literal("officer"), v.literal("treasurer"), v.literal("president")),
    ),
    active: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  accounts: defineTable({
    key: accountKey,
    name: v.string(),
    openingBalance: v.number(), // write-once at cutover (ADR 0018)
    isSchool: v.boolean(), // the School receivable (ADR 0004)
    automatic: v.boolean(),
  }).index("by_key", ["key"]),

  transactions: defineTable({
    type: txType,
    amount: v.number(), // positive integer FCFA (ADR 0024)
    occurredAt: v.optional(v.number()), // absent only on a committed withdrawal (ADR 0003)
    accountId: v.id("accounts"),
    toAccountId: v.optional(v.id("accounts")),
    reason: v.string(),
    categoryId: v.optional(v.id("categories")), // income/expense only (ADR 0009)
    eventId: v.optional(v.id("events")),
    source: v.string(),
    kind: v.union(v.literal("income"), v.literal("refund")), // ADR 0005
    externalId: v.optional(v.string()),
    naboopayReference: v.optional(v.string()),
    status: txStatus,
    receiptUrl: v.optional(v.string()),
    recordedBy: v.union(v.id("users"), v.string()),
    reversalOf: v.optional(v.id("transactions")),
    recurringId: v.optional(v.id("recurringTemplates")),
    draftMonth: v.optional(v.string()), // "YYYY-MM" (ADR 0025)
    createdAt: v.number(),
  })
    .index("by_accountId_and_occurredAt", ["accountId", "occurredAt"])
    .index("by_toAccountId_and_occurredAt", ["toAccountId", "occurredAt"])
    .index("by_status", ["status"])
    .index("by_reversalOf", ["reversalOf"])
    .index("by_source_and_externalId_and_kind", ["source", "externalId", "kind"])
    .index("by_naboopayReference", ["naboopayReference"])
    .index("by_eventId", ["eventId"])
    .index("by_recurringId_and_draftMonth", ["recurringId", "draftMonth"]),

  categories: defineTable({
    name: v.string(),
    direction,
    isSystem: v.boolean(),
  }).index("by_name", ["name"]),

  events: defineTable({
    name: v.string(),
    active: v.boolean(),
  }).index("by_name", ["name"]),

  reconciliations: defineTable({
    accountId: v.id("accounts"),
    computedBalance: v.number(),
    realBalance: v.number(),
    difference: v.number(), // real − computed
    adjustmentId: v.optional(v.id("transactions")),
    checkedBy: v.id("users"),
    checkedAt: v.number(),
  }).index("by_accountId_and_checkedAt", ["accountId", "checkedAt"]),

  auditLog: defineTable({
    actor: v.union(v.id("users"), v.string()),
    action: v.string(), // ADR 0014
    targetId: v.optional(v.id("transactions")),
    before: v.optional(v.record(v.string(), v.any())), // changed fields only
    after: v.optional(v.record(v.string(), v.any())),
    at: v.number(),
  }).index("by_targetId", ["targetId"]),

  recurringTemplates: defineTable({
    reason: v.string(),
    amount: v.number(),
    accountId: v.id("accounts"),
    categoryId: v.id("categories"),
    eventId: v.optional(v.id("events")),
    dayOfMonth: v.number(), // 1–28
    active: v.boolean(),
  }),
});
