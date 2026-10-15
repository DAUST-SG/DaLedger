import { internalAction, internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { currentOfficer } from "./auth";
import { writeAudit } from "./audit";
import { changedFields } from "./ledger";
import { listPayouts, listTransactions } from "./naboopay";
import { activeReversal, listRow, toRow, writeReversal } from "./transactions";

// ADR 0008: only orders older than this are treated as unreported; tunable.
export const GRACE_MS = 30 * 60 * 1000;
const SOURCE = "naboopay";

const order = v.object({
  order_id: v.string(),
  amount: v.number(),
  fees: v.number(),
  fees_customer_side: v.boolean(),
  paidAt: v.optional(v.number()),
  updatedAt: v.number(),
});
const payout = v.object({
  order_id: v.string(),
  amount: v.number(),
  fees: v.number(),
  method: v.string(),
  phone: v.optional(v.string()),
  name: v.optional(v.string()),
  reason: v.optional(v.string()),
  paidAt: v.optional(v.number()),
});

const ms = (iso?: string) => (iso ? Date.parse(iso) : undefined);
const digits = (phone?: string) => (phone ?? "").replace(/\D/g, "");

/** Cutover = the Naboopay account's creation, whole ms (M4). Nothing older is swept. */
export const context = internalQuery({
  args: {},
  returns: v.union(v.object({ cutover: v.number() }), v.null()),
  handler: async (ctx) => {
    const naboopay = await ctx.db.query("accounts").withIndex("by_key", (q) => q.eq("key", "naboopay")).unique();
    return naboopay ? { cutover: Math.floor(naboopay._creationTime) } : null;
  },
});

/** The sale for an order id, for the webhook's confirmation (it writes nothing). */
export const findSale = internalQuery({
  args: { orderId: v.string() },
  returns: v.union(v.object({ id: v.id("transactions"), amount: v.number() }), v.null()),
  handler: async (ctx, args) => {
    const sale = await saleFor(ctx, args.orderId);
    return sale ? { id: sale._id, amount: sale.amount } : null;
  },
});

/** Every 15 minutes (crons.ts). Reads Naboopay, writes through the mutations below. */
export const run = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const record = (ok: boolean, message: string) => ctx.runMutation(internal.sweep.recordRun, { ok, message });
    if (!process.env.NABOOPAY_API_KEY) {
      await record(false, "Skipped: NABOOPAY_API_KEY is not set on this deployment.");
      return null;
    }
    const c = await ctx.runQuery(internal.sweep.context, {});
    if (!c) {
      await record(false, "Skipped: accounts are not seeded yet.");
      return null;
    }
    try {
      const now = Date.now();
      const [paid, blocked, refunded, payouts] = await Promise.all([
        listTransactions("paid", c.cutover),
        listTransactions("paid_and_blocked", c.cutover),
        listTransactions("refunded", c.cutover),
        listPayouts(c.cutover),
      ]);
      const toOrder = (t: (typeof paid)[number]) => ({
        order_id: t.order_id,
        amount: t.amount,
        fees: t.fees ?? 0,
        fees_customer_side: t.fees_customer_side,
        paidAt: ms(t.paid_at),
        updatedAt: ms(t.updated_at) ?? now,
      });
      const o = await ctx.runMutation(internal.sweep.applyOrders, {
        now,
        cutover: c.cutover,
        paid: [...paid, ...blocked].map(toOrder),
        refunded: refunded.map(toOrder),
      });
      const p = await ctx.runMutation(internal.sweep.applyPayouts, {
        cutover: c.cutover,
        payouts: payouts.map((x) => ({
          order_id: x.order_id,
          amount: x.amount,
          fees: x.fees ?? 0,
          method: x.selected_payment_method,
          phone: x.recipient?.phone,
          name: [x.recipient?.first_name, x.recipient?.last_name].filter(Boolean).join(" ") || undefined,
          reason: x.reason || undefined,
          paidAt: ms(x.paid_at),
        })),
      });
      await record(
        true,
        `Read ${paid.length + blocked.length} paid, ${refunded.length} refunded, ${payouts.length} payouts. ` +
          `Recorded ${o.placeholders} unreported, ${o.refunds} refunds, ${o.fees} fee corrections, ${p.recorded} payouts.`,
      );
    } catch (err) {
      await record(false, err instanceof Error ? err.message : "The sweep failed.");
    }
    return null;
  },
});

export const recordRun = internalMutation({
  args: { ok: v.boolean(), message: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("sweepRuns", { at: Date.now(), ...args });
    return null;
  },
});

async function findSwept(ctx: QueryCtx, externalId: string, kind: "income" | "refund") {
  return ctx.db
    .query("transactions")
    .withIndex("by_source_and_externalId_and_kind", (q) => q.eq("source", SOURCE).eq("externalId", externalId).eq("kind", kind))
    .first();
}

/** The sale for an order, whoever reported it (intake or a placeholder): not a reversal. */
export async function saleFor(ctx: QueryCtx, orderId: string) {
  const rows = await ctx.db.query("transactions").withIndex("by_naboopayReference", (q) => q.eq("naboopayReference", orderId)).collect();
  return rows.find((t) => t.type === "income" && !t.reversalOf) ?? null;
}

async function account(ctx: QueryCtx, key: Doc<"accounts">["key"]) {
  const a = await ctx.db.query("accounts").withIndex("by_key", (q) => q.eq("key", key)).unique();
  if (!a) throw new Error(`The ${key} account is missing; run seed:accounts.`);
  return a;
}

async function category(ctx: QueryCtx, name: string) {
  return (await ctx.db.query("categories").withIndex("by_name", (q) => q.eq("name", name)).unique())?._id;
}

/** Insert one sweep row and its audit entry (actor: naboopay). Callers check uniqueness first. */
async function insert(ctx: MutationCtx, doc: Omit<Doc<"transactions">, "_id" | "_creationTime">) {
  const id = await ctx.db.insert("transactions", doc);
  await writeAudit(ctx, { actor: SOURCE, action: "create", targetId: id, after: changedFields({}, doc).after });
  return id;
}

const base = { source: SOURCE, recordedBy: SOURCE, createdAt: 0 };

/**
 * Orders (ADR 0008, 0026 as revised in M5):
 * - paid, unreported after the grace window → one Unlabeled needs_review placeholder;
 * - refunded while its sale has no active reversal → the sweep writes the reversal;
 * - paid with fees_customer_side = false → the known fee as a "Provider fees" expense.
 */
export const applyOrders = internalMutation({
  args: { now: v.number(), cutover: v.number(), paid: v.array(order), refunded: v.array(order) },
  returns: v.object({ placeholders: v.number(), refunds: v.number(), fees: v.number() }),
  handler: async (ctx, args) => {
    const naboopay = await account(ctx, "naboopay");
    const unlabeled = await category(ctx, "Unlabeled");
    const providerFees = await category(ctx, "Provider fees");
    let placeholders = 0, refunds = 0, fees = 0;

    for (const o of args.paid) {
      const paidAt = o.paidAt ?? o.updatedAt;
      if (paidAt < args.cutover || !Number.isInteger(o.amount) || o.amount <= 0) continue;
      const settled = paidAt <= args.now - GRACE_MS;

      if (settled && !(await saleFor(ctx, o.order_id)) && !(await findSwept(ctx, o.order_id, "income"))) {
        await insert(ctx, {
          ...base, createdAt: Date.now(),
          type: "income", amount: o.amount, occurredAt: paidAt, accountId: naboopay._id,
          reason: `Unreported Naboopay payment ${o.order_id}`, categoryId: unlabeled,
          kind: "income", externalId: o.order_id, naboopayReference: o.order_id, status: "needs_review",
        });
        placeholders++;
      }

      const feeKey = `fee:${o.order_id}`;
      if (!o.fees_customer_side && o.fees > 0 && Number.isInteger(o.fees) && !(await findSwept(ctx, feeKey, "income"))) {
        await insert(ctx, {
          ...base, createdAt: Date.now(),
          type: "expense", amount: o.fees, occurredAt: paidAt, accountId: naboopay._id,
          reason: `Naboopay fee on ${o.order_id} (order created with fees_customer_side = false)`,
          categoryId: providerFees, kind: "income", externalId: feeKey, naboopayReference: o.order_id, status: "confirmed",
        });
        fees++;
      }
    }

    for (const o of args.refunded) {
      if (o.updatedAt > args.now - GRACE_MS) continue;
      const sale = await saleFor(ctx, o.order_id);
      if (!sale || (await activeReversal(ctx, sale._id)) || (await findSwept(ctx, o.order_id, "refund"))) continue;
      await writeReversal(ctx, sale, {
        reason: `Refunded in Naboopay (detected by the sweep)`,
        occurredAt: o.updatedAt,
        recordedBy: SOURCE,
        source: SOURCE,
        kind: "refund",
        externalId: o.order_id,
      });
      refunds++;
    }
    return { placeholders, refunds, fees };
  },
});

/** "wave:+221 77…,om:+221 78…" → digits → account key. */
function sgWallets(): Map<string, "wave" | "om"> {
  const map = new Map<string, "wave" | "om">();
  for (const part of (process.env.NABOOPAY_SG_WALLETS ?? "").split(",")) {
    const [kind, phone] = part.split(":").map((s) => s.trim());
    if ((kind === "wave" || kind === "om") && digits(phone)) map.set(digits(phone), kind);
  }
  return map;
}

/**
 * Completed payouts, each recorded once (ADR 0015, 0026):
 * - to an SG wallet → transfer Naboopay → that account + "Provider fees" expense;
 * - to any other wallet → an expense awaiting its category in the inbox (M5 Q2) + the fee.
 */
export const applyPayouts = internalMutation({
  args: { cutover: v.number(), payouts: v.array(payout) },
  returns: v.object({ recorded: v.number() }),
  handler: async (ctx, args) => {
    const naboopay = await account(ctx, "naboopay");
    const providerFees = await category(ctx, "Provider fees");
    const wallets = sgWallets();
    let recorded = 0;

    for (const p of args.payouts) {
      const at = p.paidAt;
      const key = `payout:${p.order_id}`;
      if (!at || at < args.cutover || !Number.isInteger(p.amount) || p.amount <= 0) continue;
      if (await findSwept(ctx, key, "income")) continue;

      const ownKey = wallets.get(digits(p.phone));
      const to = ownKey ? await account(ctx, ownKey) : null;
      const who = p.name ? `${p.name} (${p.phone ?? "?"})` : (p.phone ?? "unknown wallet");
      const note = p.reason ? `: ${p.reason}` : "";
      if (to) {
        await insert(ctx, {
          ...base, createdAt: Date.now(),
          type: "transfer", amount: p.amount, occurredAt: at, accountId: naboopay._id, toAccountId: to._id,
          reason: `Naboopay payout to ${to.name}${note}`, kind: "income", externalId: key, naboopayReference: p.order_id, status: "confirmed",
        });
      } else {
        await insert(ctx, {
          ...base, createdAt: Date.now(),
          type: "expense", amount: p.amount, occurredAt: at, accountId: naboopay._id,
          reason: `Naboopay payout to ${who}${note}`, kind: "income", externalId: key, naboopayReference: p.order_id,
          status: "needs_review", // no category yet: an officer picks one in the inbox (ADR 0032)
        });
      }
      if (p.fees > 0 && Number.isInteger(p.fees)) {
        await insert(ctx, {
          ...base, createdAt: Date.now(),
          type: "expense", amount: p.fees, occurredAt: at, accountId: naboopay._id,
          reason: `Naboopay payout fee (${p.order_id})`, categoryId: providerFees,
          kind: "income", externalId: `payout-fee:${p.order_id}`, naboopayReference: p.order_id, status: "confirmed",
        });
      }
      recorded++;
    }
    return { recorded };
  },
});

/** Review's "Detected by Naboopay" section and the last sweep run. */
export const detected = query({
  args: {},
  returns: v.object({
    lastRun: v.union(v.object({ at: v.number(), ok: v.boolean(), message: v.string() }), v.null()),
    rows: v.array(listRow),
  }),
  handler: async (ctx) => {
    await currentOfficer(ctx);
    const last = await ctx.db.query("sweepRuns").withIndex("by_at").order("desc").first();
    const rows = await ctx.db
      .query("transactions")
      .withIndex("by_source_and_externalId_and_kind", (q) => q.eq("source", SOURCE))
      .collect();
    const recent = rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
    return {
      lastRun: last ? { at: last.at, ok: last.ok, message: last.message } : null,
      rows: await Promise.all(recent.map((t) => toRow(ctx, t))),
    };
  },
});

