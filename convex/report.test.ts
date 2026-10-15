/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const DAY = 24 * 3600 * 1000;
const SEP1 = Date.UTC(2030, 8, 1); // the term starts well after seeding (cutover)
const DEC31 = Date.UTC(2030, 11, 31, 23, 59, 59, 999);

async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.accounts, { opening: { naboopay: 100_000, wave: 50_000, om: 0, cash: 20_000, school: 300_000 } });
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "o@daust.sg", name: "Awa", role: "officer", active: true }));
  const as = t.withIdentity({ subject: `${userId}|s` });
  const ids = await t.run(async (ctx) => ({
    acc: Object.fromEntries((await ctx.db.query("accounts").collect()).map((a) => [a.key, a._id])) as Record<string, Id<"accounts">>,
    cat: Object.fromEntries((await ctx.db.query("categories").collect()).map((c) => [c.name, c._id])) as Record<string, Id<"categories">>,
  }));
  const add = (o: Record<string, unknown>) =>
    as.mutation(api.transactions.create, { reason: "x", accountId: ids.acc.cash, ...o } as never);
  const report = (from = SEP1, to = DEC31) => as.query(api.reports.term, { from, to });
  return { t, as, add, report, ...ids };
}

/** A ledger with every kind of entry, some before the term, some inside, some after. */
async function mixedLedger(s: Awaited<ReturnType<typeof setup>>) {
  const { t, as, add, acc, cat } = s;
  const { id: gala } = await as.mutation(api.events.create, { name: "Gala" });
  // Before the term: lands in the start balance.
  await add({ type: "income", amount: 5_000, categoryId: cat["Fundraising"], occurredAt: SEP1 - DAY });
  // Inside the term.
  await add({ type: "income", amount: 80_000, accountId: acc.naboopay, categoryId: cat["Shop sales"], eventId: gala, occurredAt: SEP1 + DAY });
  await add({ type: "expense", amount: 30_000, categoryId: cat["Venue"], eventId: gala, occurredAt: SEP1 + 2 * DAY });
  const { id: dup } = await add({ type: "expense", amount: 4_000, categoryId: cat["Catering"], eventId: gala, occurredAt: SEP1 + 3 * DAY });
  const { reversalId } = await as.mutation(api.transactions.reverse, { transactionId: dup, reason: "duplicate", occurredAt: SEP1 + 4 * DAY });
  await as.mutation(api.transactions.reverse, { transactionId: reversalId, reason: "it was real", occurredAt: SEP1 + 5 * DAY });
  await add({ type: "transfer", amount: 25_000, accountId: acc.naboopay, toAccountId: acc.wave, occurredAt: SEP1 + 6 * DAY });
  await add({ type: "allocation", amount: 200_000, accountId: acc.school, occurredAt: SEP1 + 7 * DAY });
  const { id: wd } = await add({ type: "school_withdrawal", amount: 60_000, accountId: acc.school });
  await as.mutation(api.transactions.markWithdrawalPaid, { transactionId: wd, toAccountId: acc.om, occurredAt: SEP1 + 8 * DAY });
  await add({ type: "school_withdrawal", amount: 9_999, accountId: acc.school }); // committed: moves nothing
  await add({ type: "adjustment_down", amount: 1_000, occurredAt: SEP1 + 9 * DAY });
  await add({ type: "adjustment_up", amount: 7_000, accountId: acc.school, occurredAt: SEP1 + 10 * DAY });
  // An Unlabeled sale still in review counts (ADR 0007), and a memo does not move balances.
  await t.run(async (ctx) => {
    const base = { source: "test", kind: "income" as const, recordedBy: "test", createdAt: Date.now() };
    await ctx.db.insert("transactions", { ...base, type: "income", amount: 3_000, accountId: acc.naboopay, reason: "?", categoryId: cat["Unlabeled"], status: "needs_review", occurredAt: SEP1 + 11 * DAY });
    await ctx.db.insert("transactions", { ...base, type: "income", amount: 40_000, accountId: acc.cash, reason: "2029 Gala summary", categoryId: cat["Fundraising"], eventId: gala, status: "memo", occurredAt: SEP1 + 12 * DAY });
  });
  // After the term: excluded.
  await add({ type: "expense", amount: 2_500, categoryId: cat["Supplies"], occurredAt: DEC31 + 1 });
  return { gala };
}

describe("term report (ADR 0016, 0021)", () => {
  test("start + every movement line = end, overall, per account and for School", async () => {
    const s = await setup();
    await mixedLedger(s);
    const r = await s.report();
    expect(r.balanced).toBe(true);
    const l = r.total.lines;
    expect(r.total.start).toBe(170_000 + 5_000);
    expect(l).toEqual({ income: 83_000, expense: 34_000, withdrawalsIn: 60_000, adjustments: -1_000, transfersIn: 25_000, transfersOut: 25_000 });
    expect(r.total.end).toBe(r.total.start + 83_000 - 34_000 + 60_000 - 1_000);
    // End equals the four accounts at `to`.
    const asOf = await s.as.query(api.balances.asOf, { date: DEC31 });
    expect(r.total.end).toBe(asOf.totalHeld);
    // School: allocations − paid withdrawals ± adjustments = change (M6 Q2).
    expect(r.school).toMatchObject({ start: 300_000, allocations: 200_000, paidWithdrawals: 60_000, adjustments: 7_000, end: 447_000 });
    // Per account: Wave got the transfer in, Naboopay sent it out.
    const by = Object.fromEntries(r.accounts.map((a) => [a.name, a]));
    expect(by["Wave"].lines.transfersIn).toBe(25_000);
    expect(by["Naboopay"].lines.transfersOut).toBe(25_000);
    expect(by["Orange Money"]).toMatchObject({ start: 0, end: 60_000 });
  });

  test("acceptance: income and expense equal the transactions list for the same dates; categories sum to the lines", async () => {
    const s = await setup();
    await mixedLedger(s);
    const r = await s.report();
    const rows = await s.as.query(api.transactions.exportRows, { filter: { from: SEP1, to: DEC31 } });
    const LIVE = new Set(["confirmed", "paid", "needs_review"]);
    const sum = (type: string) => rows.filter((x) => x.type === type && LIVE.has(x.status)).reduce((a, x) => a + x.amount * x.flip, 0);
    expect(sum("income")).toBe(r.total.lines.income);
    expect(sum("expense")).toBe(r.total.lines.expense);
    const cat = (d: string) => r.byCategory.filter((c) => c.direction === d).reduce((a, c) => a + c.total, 0);
    expect(cat("income")).toBe(r.total.lines.income);
    expect(cat("expense")).toBe(r.total.lines.expense);
    expect(r.byCategory.find((c) => c.name === "Unlabeled")?.total).toBe(3_000);
    // The reversed-then-restored Catering expense nets to its original 4 000.
    expect(r.byCategory.find((c) => c.name === "Catering")?.total).toBe(4_000);
  });

  test("memos stay in their own block and in by-event, never in the lines (M6 Q1)", async () => {
    const s = await setup();
    await mixedLedger(s);
    const r = await s.report();
    expect(r.memos).toEqual([expect.objectContaining({ amount: 40_000, direction: "income", event: "Gala" })]);
    expect(r.byEvent.find((e) => e.name === "Gala")).toMatchObject({ income: 80_000, expense: 34_000, net: 46_000, memoNet: 40_000 });
  });

  test("boundaries: an entry at exactly from/to is in; a millisecond before from is in the start", async () => {
    const s = await setup();
    await s.add({ type: "income", amount: 1, categoryId: s.cat["Fundraising"], occurredAt: SEP1 });
    await s.add({ type: "income", amount: 10, categoryId: s.cat["Fundraising"], occurredAt: DEC31 });
    await s.add({ type: "income", amount: 100, categoryId: s.cat["Fundraising"], occurredAt: SEP1 - 1 });
    const r = await s.report();
    expect(r.total.lines.income).toBe(11);
    expect(r.total.start).toBe(170_000 + 100);
    expect(r.balanced).toBe(true);
  });

  test("consecutive periods chain, and back-dating into a past period keeps it balanced", async () => {
    const s = await setup();
    await mixedLedger(s);
    const mid = SEP1 + 45 * DAY;
    const a = await s.report(SEP1, mid);
    const b = await s.report(mid + 1, DEC31);
    expect(a.total.end).toBe(b.total.start);
    expect(a.balanced && b.balanced).toBe(true);
    await s.add({ type: "expense", amount: 700, categoryId: s.cat["Supplies"], occurredAt: SEP1 + 20 * DAY });
    const a2 = await s.report(SEP1, mid);
    expect(a2.total.end).toBe(a.total.end - 700);
    expect(a2.balanced).toBe(true);
  });

  test("an event's per-period nets add up to its all-time Event view net (ADR 0022)", async () => {
    const s = await setup();
    const { id: fair } = await s.as.mutation(api.events.create, { name: "Fair" });
    await s.add({ type: "income", amount: 9_000, categoryId: s.cat["Fundraising"], eventId: fair, occurredAt: SEP1 + DAY });
    await s.add({ type: "expense", amount: 2_000, categoryId: s.cat["Venue"], eventId: fair, occurredAt: DEC31 + DAY });
    const t1 = await s.report(SEP1, DEC31);
    const t2 = await s.report(DEC31 + 1, DEC31 + 120 * DAY);
    const allTime = await s.as.query(api.reports.event, { eventId: fair });
    const netOf = (r: typeof t1) => r.byEvent.find((e) => e.name === "Fair")?.net ?? 0;
    expect(netOf(t1) + netOf(t2)).toBe(allTime.net);
  });

  test("checks in the period are listed; a reversed period is refused", async () => {
    const s = await setup();
    await s.as.mutation(api.reconciliations.create, { accountId: s.acc.cash, realBalance: 20_000, adjust: false });
    const now = Date.now();
    const r = await s.report(now - DAY, now + DAY);
    expect(r.checks).toEqual([expect.objectContaining({ accountName: "Cash", difference: 0, adjusted: false })]);
    await expect(s.report(DEC31, SEP1)).rejects.toThrow(/before the end/);
  });
});
