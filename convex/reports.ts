import { query, type QueryCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { currentOfficer } from "./auth";
import { effect, LIVE_STATUSES, reversalFlip } from "./ledger";
import { balanceOf } from "./balances";
import type { Doc, Id } from "./_generated/dataModel";
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

// ---------------------------------------------------------------------------
// M6: the term report (ADR 0016, 0021, 0022)

const lines = v.object({
  income: v.number(),
  expense: v.number(), // positive: money out
  withdrawalsIn: v.number(), // paid school withdrawals landing in cash
  adjustments: v.number(), // signed
  transfersIn: v.number(),
  transfersOut: v.number(), // positive: money out
});
type Lines = typeof lines.type;
const zero = (): Lines => ({ income: 0, expense: 0, withdrawalsIn: 0, adjustments: 0, transfersIn: 0, transfersOut: 0 });
const net = (l: Lines) => l.income - l.expense + l.withdrawalsIn + l.adjustments + l.transfersIn - l.transfersOut;

/** Put one signed effect on one account's movement line, by type (ADR 0021). */
function addTo(l: Lines, type: Doc<"transactions">["type"], e: number) {
  if (type === "income") l.income += e;
  else if (type === "expense") l.expense -= e;
  else if (type === "school_withdrawal") l.withdrawalsIn += e;
  else if (type === "adjustment_up" || type === "adjustment_down") l.adjustments += e;
  else if (type === "transfer") {
    if (e >= 0) l.transfersIn += e;
    else l.transfersOut -= e;
  }
  // allocation never touches a cash account (ADR 0004)
}

async function nameOf(ctx: QueryCtx, id: Id<"categories"> | Id<"events"> | undefined, fallback: string) {
  return id ? ((await ctx.db.get(id))?.name ?? "Unknown") : fallback;
}

/** The earliest account creation: "since cutover" on the report screen. */
export const cutover = query({
  args: {},
  returns: v.union(v.number(), v.null()),
  handler: async (ctx) => {
    await currentOfficer(ctx);
    const accounts = await ctx.db.query("accounts").collect();
    return accounts.length ? Math.floor(Math.min(...accounts.map((a) => a._creationTime))) : null;
  },
});

/**
 * Term report for [from, to] by occurredAt (ADR 0016). Start = balanceAsOf(from − 1),
 * end = balanceAsOf(to). Every live entry in the period lands on exactly one
 * movement line, through the same effect() and chain-aware sign as balances, so
 * start + lines = end by construction; `balanced` re-checks it (ADR 0021).
 * Memos are report-only and kept in their own block (ADR 0011, M6 Q1).
 */
export const term = query({
  args: { from: v.number(), to: v.number() },
  returns: v.object({
    from: v.number(),
    to: v.number(),
    generatedAt: v.number(),
    balanced: v.boolean(),
    total: v.object({ start: v.number(), end: v.number(), lines }),
    accounts: v.array(v.object({ accountId: v.id("accounts"), name: v.string(), start: v.number(), end: v.number(), lines })),
    school: v.object({ start: v.number(), end: v.number(), allocations: v.number(), paidWithdrawals: v.number(), adjustments: v.number() }),
    byCategory: v.array(v.object({ name: v.string(), direction, total: v.number() })),
    byEvent: v.array(v.object({ eventId: v.id("events"), name: v.string(), income: v.number(), expense: v.number(), net: v.number(), memoNet: v.number() })),
    memos: v.array(v.object({ reason: v.string(), direction, amount: v.number(), event: v.string(), occurredAt: v.optional(v.number()) })),
    checks: v.array(v.object({ accountName: v.string(), checkedAt: v.number(), difference: v.number(), adjusted: v.boolean() })),
  }),
  handler: async (ctx, args) => {
    await currentOfficer(ctx);
    if (!(args.from <= args.to)) throw new ConvexError("The start date must be before the end date.");
    const accounts = await ctx.db.query("accounts").collect();
    const cash = accounts.filter((a) => !a.isSchool);
    const school = accounts.find((a) => a.isSchool);

    const rows = await ctx.db
      .query("transactions")
      .withIndex("by_occurredAt", (q) => q.gte("occurredAt", args.from).lte("occurredAt", args.to))
      .collect();

    const perAccount = new Map(cash.map((a) => [a._id as string, zero()]));
    const schoolLines = { allocations: 0, paidWithdrawals: 0, adjustments: 0 };
    const categories = new Map<string, { name: string; direction: "income" | "expense"; total: number }>();
    const events = new Map<string, { eventId: Id<"events">; income: number; expense: number; memoNet: number }>();
    const memos = [];
    const load = (id: Id<"transactions">) => ctx.db.get(id);

    for (const t of rows) {
      const flip = await reversalFlip(t, load);
      if (t.status === "memo") {
        if (t.type !== "income" && t.type !== "expense") continue;
        const signed = t.amount * flip;
        memos.push({ reason: t.reason, direction: t.type, amount: signed, event: await nameOf(ctx, t.eventId, "No event"), occurredAt: t.occurredAt });
        if (t.eventId) {
          const ev = events.get(t.eventId) ?? { eventId: t.eventId, income: 0, expense: 0, memoNet: 0 };
          ev.memoNet += t.type === "income" ? signed : -signed;
          events.set(t.eventId, ev);
        }
        continue;
      }
      if (!LIVE_STATUSES.has(t.status)) continue;

      for (const a of cash) {
        const e = effect(t, a._id, flip);
        if (e !== 0) addTo(perAccount.get(a._id)!, t.type, e);
      }
      if (school) {
        const e = effect(t, school._id, flip);
        if (t.type === "allocation") schoolLines.allocations += e;
        else if (t.type === "school_withdrawal") schoolLines.paidWithdrawals -= e;
        else if (t.type === "adjustment_up" || t.type === "adjustment_down") schoolLines.adjustments += e;
      }

      if (t.type === "income" || t.type === "expense") {
        const signed = t.amount * flip;
        const fallback = t.type === "income" ? "Unlabeled" : "Awaiting category";
        const name = await nameOf(ctx, t.categoryId, fallback);
        const key = `${t.type}:${name}`;
        const c = categories.get(key) ?? { name, direction: t.type, total: 0 };
        c.total += signed;
        categories.set(key, c);
        if (t.eventId) {
          const ev = events.get(t.eventId) ?? { eventId: t.eventId, income: 0, expense: 0, memoNet: 0 };
          if (t.type === "income") ev.income += signed;
          else ev.expense += signed;
          events.set(t.eventId, ev);
        }
      }
    }

    const accountRows = await Promise.all(
      cash.map(async (a) => ({
        accountId: a._id,
        name: a.name,
        start: await balanceOf(ctx, a, args.from - 1),
        end: await balanceOf(ctx, a, args.to),
        lines: perAccount.get(a._id)!,
      })),
    );
    const totalLines = zero();
    for (const r of accountRows) for (const k of Object.keys(totalLines) as (keyof Lines)[]) totalLines[k] += r.lines[k];
    const start = accountRows.reduce((s, r) => s + r.start, 0);
    const end = accountRows.reduce((s, r) => s + r.end, 0);
    const schoolStart = school ? await balanceOf(ctx, school, args.from - 1) : 0;
    const schoolEnd = school ? await balanceOf(ctx, school, args.to) : 0;

    const balanced =
      start + net(totalLines) === end &&
      accountRows.every((r) => r.start + net(r.lines) === r.end) &&
      schoolStart + schoolLines.allocations - schoolLines.paidWithdrawals + schoolLines.adjustments === schoolEnd;

    const checks = [];
    for (const a of accounts) {
      const found = await ctx.db
        .query("reconciliations")
        .withIndex("by_accountId_and_checkedAt", (q) => q.eq("accountId", a._id).gte("checkedAt", args.from).lte("checkedAt", args.to))
        .collect();
      checks.push(...found.map((r) => ({ accountName: a.name, checkedAt: r.checkedAt, difference: r.difference, adjusted: r.adjustmentId !== undefined })));
    }
    checks.sort((a, b) => a.checkedAt - b.checkedAt);

    const byEvent = await Promise.all(
      [...events.values()].map(async (e) => ({
        ...e,
        name: await nameOf(ctx, e.eventId, "No event"),
        net: e.income - e.expense,
      })),
    );

    return {
      from: args.from,
      to: args.to,
      generatedAt: Date.now(),
      balanced,
      total: { start, end, lines: totalLines },
      accounts: accountRows,
      school: { start: schoolStart, end: schoolEnd, ...schoolLines },
      byCategory: [...categories.values()].sort((a, b) => a.direction.localeCompare(b.direction) || b.total - a.total),
      byEvent: byEvent.sort((a, b) => b.net - a.net),
      memos,
      checks,
    };
  },
});
