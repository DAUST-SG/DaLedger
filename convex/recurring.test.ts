/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { nextDue } from "./recurring";

const modules = import.meta.glob("./**/*.ts");
const at = (y: number, m: number, d: number, h = 9) => Date.UTC(y, m - 1, d, h);
const CREATED = at(2026, 10, 15); // templates are created "today", 15 Oct 2026

beforeEach(() => vi.useFakeTimers({ now: CREATED, toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.accounts, { opening: { naboopay: 0, wave: 50_000, om: 0, cash: 20_000, school: 0 } });
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "o@daust.sg", name: "Awa", role: "officer", active: true }));
  const as = t.withIdentity({ subject: `${userId}|s` });
  const ids = await t.run(async (ctx) => ({
    acc: Object.fromEntries((await ctx.db.query("accounts").collect()).map((a) => [a.key, a._id])) as Record<string, Id<"accounts">>,
    cat: Object.fromEntries((await ctx.db.query("categories").collect()).map((c) => [c.name, c._id])) as Record<string, Id<"categories">>,
  }));
  const template = (day: number, over: Record<string, unknown> = {}) =>
    as.mutation(api.recurring.create, { reason: "Domain renewal", amount: 6_500, accountId: ids.acc.wave, categoryId: ids.cat["Other expense"], dayOfMonth: day, ...over } as never);
  const run = (now: number) => t.mutation(internal.recurring.generate, { now });
  const drafts = () => t.run((ctx) => ctx.db.query("transactions").collect());
  const wave = async () => (await as.query(api.balances.list, {})).accounts.find((a) => a.key === "wave")!.balance;
  return { t, as, template, run, drafts, wave, ...ids };
}

describe("draft generation (ADR 0012, 0025)", () => {
  test("one draft per template per month, dated the due day, only once the day has come", async () => {
    const { template, run, drafts } = await setup();
    await template(20);
    expect(await run(at(2026, 10, 19))).toBe(0);
    expect(await run(at(2026, 10, 20))).toBe(1);
    expect(await run(at(2026, 10, 20, 18))).toBe(0); // same day again
    expect(await run(at(2026, 10, 27))).toBe(0); // later in the month
    expect(await run(at(2026, 11, 20))).toBe(1); // next month
    const rows = await drafts();
    expect(rows.map((r) => [r.draftMonth, r.occurredAt, r.status])).toEqual([
      ["2026-10", at(2026, 10, 20, 0), "draft"],
      ["2026-11", at(2026, 11, 20, 0), "draft"],
    ]);
  });

  test("a template never starts overdue: day 5 created on the 15th waits for next month (M7 Q1)", async () => {
    const { template, run } = await setup();
    await template(5);
    expect(await run(at(2026, 10, 31))).toBe(0);
    expect(await run(at(2026, 11, 5))).toBe(1);
    expect(nextDue(5, CREATED)).toBe(at(2026, 11, 5, 0));
    expect(nextDue(15, CREATED)).toBe(at(2026, 10, 15, 0)); // due today counts
  });

  test("a skipped or confirmed month is never recreated", async () => {
    const { as, template, run, drafts } = await setup();
    await template(20);
    await template(21, { reason: "Phone plan" });
    await run(at(2026, 10, 25));
    const [a, b] = await drafts();
    await as.mutation(api.recurring.skipDraft, { transactionId: a._id, reason: "Paid yearly" });
    await as.mutation(api.recurring.confirmDraft, { transactionId: b._id });
    expect(await run(at(2026, 10, 30))).toBe(0);
    expect(await drafts()).toHaveLength(2);
  });

  test("a deactivated template creates nothing; an edit changes only future drafts", async () => {
    const { as, template, run, drafts } = await setup();
    const id = await template(20);
    await run(at(2026, 10, 20));
    await as.mutation(api.recurring.update, { templateId: id, reason: "Domain renewal", amount: 7_000, accountId: (await drafts())[0].accountId, categoryId: (await drafts())[0].categoryId!, dayOfMonth: 20 });
    expect((await drafts())[0].amount).toBe(6_500);
    await run(at(2026, 11, 20));
    expect((await drafts())[1].amount).toBe(7_000);
    await as.mutation(api.recurring.setActive, { templateId: id, active: false });
    expect(await run(at(2026, 12, 20))).toBe(0);
  });

  test("validation: expenses only, cash account, expense category, day 1–28, whole amount", async () => {
    const { template, acc, cat } = await setup();
    await expect(template(31)).rejects.toThrow(/1 to 28/);
    await expect(template(10, { amount: 99.5 })).rejects.toThrow(/whole/);
    await expect(template(10, { accountId: acc.school })).rejects.toThrow(/not School/);
    await expect(template(10, { categoryId: cat["Shop sales"] })).rejects.toThrow(/not an expense/);
  });
});

describe("confirm and skip (ADR 0012, 0019)", () => {
  test("a draft moves no money; confirming counts it once, with corrections (M7 Q2)", async () => {
    const { as, template, run, drafts, wave, acc, cat } = await setup();
    await template(20);
    await run(at(2026, 10, 20));
    const [d] = await drafts();
    expect(await wave()).toBe(50_000);
    const r1 = await as.mutation(api.recurring.confirmDraft, { transactionId: d._id, amount: 7_200, accountId: acc.cash, categoryId: cat["Supplies"], occurredAt: at(2026, 10, 21) });
    const r2 = await as.mutation(api.recurring.confirmDraft, { transactionId: d._id, amount: 9_999 });
    expect([r1.changed, r2.changed]).toEqual([true, false]);
    expect(await wave()).toBe(50_000);
    const cash = (await as.query(api.balances.list, {})).accounts.find((a) => a.key === "cash")!.balance;
    expect(cash).toBe(20_000 - 7_200);
    const history = await as.query(api.audit.forTransaction, { transactionId: d._id });
    expect(history.map((h) => h.action)).toEqual(["confirm_draft", "create"]);
    expect(history[0].before).toMatchObject({ amount: 6_500, status: "draft" });
  });

  test("skip needs a reason, moves no money, and can't be undone by confirm", async () => {
    const { as, template, run, drafts, wave } = await setup();
    await template(20);
    await run(at(2026, 10, 20));
    const [d] = await drafts();
    await expect(as.mutation(api.recurring.skipDraft, { transactionId: d._id, reason: " " })).rejects.toThrow(/why/);
    expect((await as.mutation(api.recurring.skipDraft, { transactionId: d._id, reason: "Cancelled plan" })).changed).toBe(true);
    expect((await as.mutation(api.recurring.confirmDraft, { transactionId: d._id })).changed).toBe(false);
    expect((await as.mutation(api.recurring.skipDraft, { transactionId: d._id, reason: "again" })).changed).toBe(false);
    expect(await wave()).toBe(50_000);
    expect(await as.query(api.review.count, {})).toBe(0);
  });

  test("drafts sit in the inbox; overdue counts only past due days", async () => {
    const { as, template, run } = await setup();
    await template(15);
    await template(16, { reason: "Phone plan" });
    await run(at(2026, 10, 16));
    expect(await as.query(api.review.count, {})).toBe(2);
    vi.setSystemTime(at(2026, 10, 16, 12));
    expect(await as.query(api.recurring.overdue, {})).toBe(1); // the 15th is past, the 16th is today
  });

  test("confirming a draft dated before a check makes that check stale (M4)", async () => {
    const { as, template, run, drafts, acc } = await setup();
    await template(15);
    await run(at(2026, 10, 15, 10));
    vi.setSystemTime(at(2026, 10, 18));
    await as.mutation(api.reconciliations.create, { accountId: acc.wave, realBalance: 50_000, adjust: false });
    await as.mutation(api.recurring.confirmDraft, { transactionId: (await drafts())[0]._id });
    const s = (await as.query(api.reconciliations.status, {})).find((x) => x.accountId === acc.wave)!;
    expect(s.stale).toBe(true);
  });
});
