/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const DAY = 24 * 3600 * 1000;

async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.accounts, { opening: { naboopay: 0, wave: 10_000, om: 0, cash: 85_000, school: 100_000 } });
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "o@daust.sg", name: "Awa", role: "officer", active: true }));
  const as = t.withIdentity({ subject: `${userId}|s` });
  const ids = await t.run(async (ctx) => ({
    acc: Object.fromEntries((await ctx.db.query("accounts").collect()).map((a) => [a.key, a._id])) as Record<string, Id<"accounts">>,
    cat: Object.fromEntries((await ctx.db.query("categories").collect()).map((c) => [c.name, c._id])) as Record<string, Id<"categories">>,
  }));
  const balance = async (key: string) => {
    const v = await as.query(api.balances.list, {});
    return key === "school" ? v.school!.balance : v.accounts.find((a) => a.key === key)!.balance;
  };
  const statusOf = async (id: Id<"accounts">) => (await as.query(api.reconciliations.status, {})).find((s) => s.accountId === id)!;
  const expense = (accountId: Id<"accounts">, amount: number, occurredAt?: number) =>
    as.mutation(api.transactions.create, { type: "expense", amount, accountId, reason: "x", categoryId: ids.cat["Supplies"], occurredAt });
  return { t, as, userId, ...ids, balance, statusOf, expense };
}

describe("reconciliations.create (ADR 0001, 0004)", () => {
  test("real below computed → adjustment_down for the gap; balance then equals real", async () => {
    const { as, acc, balance } = await setup();
    const r = await as.mutation(api.reconciliations.create, { accountId: acc.cash, realBalance: 84_000, adjust: true, reason: "Till short" });
    expect(r).toMatchObject({ computedBalance: 85_000, realBalance: 84_000, difference: -1_000, adjustmentType: "adjustment_down" });
    expect(await balance("cash")).toBe(84_000);
  });

  test("real above computed → adjustment_up", async () => {
    const { as, acc, balance } = await setup();
    const r = await as.mutation(api.reconciliations.create, { accountId: acc.wave, realBalance: 12_500, adjust: true, reason: "Unrecorded transfer in" });
    expect(r).toMatchObject({ difference: 2_500, adjustmentType: "adjustment_up" });
    expect(await balance("wave")).toBe(12_500);
  });

  test("equal → no adjustment; a gap can be left open; adjusting needs a reason", async () => {
    const { as, acc, balance, statusOf } = await setup();
    expect((await as.mutation(api.reconciliations.create, { accountId: acc.wave, realBalance: 10_000, adjust: true })).adjustmentId).toBeUndefined();
    const open = await as.mutation(api.reconciliations.create, { accountId: acc.cash, realBalance: 80_000, adjust: false });
    expect(open.difference).toBe(-5_000);
    expect(open.adjustmentId).toBeUndefined();
    expect(await balance("cash")).toBe(85_000);
    expect(await statusOf(acc.cash)).toMatchObject({ openDifference: -5_000, stale: false });
    await expect(as.mutation(api.reconciliations.create, { accountId: acc.cash, realBalance: 1, adjust: true, reason: " " })).rejects.toThrow(/why/);
  });

  test("School reconciles on the same engine and may be negative; cash accounts may not (M4 Q3)", async () => {
    const { as, acc, balance } = await setup();
    await as.mutation(api.reconciliations.create, { accountId: acc.school, realBalance: -20_000, adjust: true, reason: "Statement shows an advance" });
    expect(await balance("school")).toBe(-20_000);
    await expect(as.mutation(api.reconciliations.create, { accountId: acc.cash, realBalance: -1, adjust: false })).rejects.toThrow(/less than 0/);
    await expect(as.mutation(api.reconciliations.create, { accountId: acc.cash, realBalance: 10.5, adjust: false })).rejects.toThrow(/whole/);
  });

  test("the adjustment is a normal ledger entry with an 'adjust' audit entry", async () => {
    const { t, as, acc } = await setup();
    const { adjustmentId } = await as.mutation(api.reconciliations.create, { accountId: acc.cash, realBalance: 84_000, adjust: true, reason: "Till short" });
    const history = await as.query(api.audit.forTransaction, { transactionId: adjustmentId! });
    expect(history).toMatchObject([{ action: "adjust", actor: "Awa" }]);
    expect(await t.run((ctx) => ctx.db.get(adjustmentId!))).toMatchObject({ type: "adjustment_down", amount: 1_000, reason: "Till short", status: "confirmed" });
  });
});

describe("staleness (ADR 0010, value-based per M4 Q1)", () => {
  test("a fresh check holds; an entry dated after it doesn't change that", async () => {
    const { as, acc, statusOf, expense } = await setup();
    await as.mutation(api.reconciliations.create, { accountId: acc.cash, realBalance: 85_000, adjust: false });
    expect((await statusOf(acc.cash)).stale).toBe(false);
    await expense(acc.cash, 500, Date.now() + DAY);
    expect((await statusOf(acc.cash)).stale).toBe(false);
  });

  test("a back-dated entry makes it stale; a new check clears it", async () => {
    const { as, acc, statusOf, expense } = await setup();
    await as.mutation(api.reconciliations.create, { accountId: acc.cash, realBalance: 85_000, adjust: false });
    await expense(acc.cash, 500, Date.now() - DAY);
    expect((await statusOf(acc.cash)).stale).toBe(true);
    await as.mutation(api.reconciliations.create, { accountId: acc.cash, realBalance: 84_500, adjust: false });
    expect((await statusOf(acc.cash)).stale).toBe(false);
  });

  test("a withdrawal marked paid with an earlier date makes both legs stale (the case timestamps miss)", async () => {
    const { as, acc, statusOf } = await setup();
    const { id } = await as.mutation(api.transactions.create, { type: "school_withdrawal", amount: 30_000, accountId: acc.school, reason: "Gala" });
    await as.mutation(api.reconciliations.create, { accountId: acc.school, realBalance: 100_000, adjust: false });
    await as.mutation(api.reconciliations.create, { accountId: acc.om, realBalance: 0, adjust: false });
    await as.mutation(api.transactions.markWithdrawalPaid, { transactionId: id, toAccountId: acc.om, occurredAt: Date.now() - DAY });
    expect((await statusOf(acc.school)).stale).toBe(true);
    expect((await statusOf(acc.om)).stale).toBe(true);
  });

  test("a back-dated reversal makes it stale; an adjusted check holds after its own adjustment", async () => {
    const { as, acc, statusOf, expense } = await setup();
    const { id } = await expense(acc.cash, 2_000, Date.now() - 2 * DAY);
    await as.mutation(api.reconciliations.create, { accountId: acc.cash, realBalance: 82_000, adjust: true, reason: "Till short" });
    expect((await statusOf(acc.cash)).stale).toBe(false);
    await as.mutation(api.transactions.reverse, { transactionId: id, reason: "wrong account", occurredAt: Date.now() - DAY });
    expect((await statusOf(acc.cash)).stale).toBe(true);
  });

  test("an account never checked is not stale", async () => {
    const { acc, statusOf } = await setup();
    expect(await statusOf(acc.naboopay)).toEqual({ accountId: acc.naboopay, openDifference: 0, stale: false });
  });
});

describe("opening-balance correction (ADR 0018)", () => {
  test("writes a cutover-dated adjustment; openingBalance itself never changes", async () => {
    const { t, as, acc, balance } = await setup();
    const r = await as.mutation(api.reconciliations.correctOpening, { accountId: acc.cash, correctOpeningBalance: 90_000, reason: "Recount found 5 000 more" });
    expect(r.difference).toBe(5_000);
    const [account, adj] = await t.run(async (ctx) => [await ctx.db.get(acc.cash), await ctx.db.get(r.adjustmentId!)] as const);
    expect(account!.openingBalance).toBe(85_000);
    expect(adj).toMatchObject({ type: "adjustment_up", amount: 5_000, occurredAt: Math.floor(account!._creationTime) });
    expect(await balance("cash")).toBe(90_000);
    const asOfCutover = await as.query(api.balances.asOf, { date: Math.floor(account!._creationTime) });
    expect(asOfCutover.accounts.find((a) => a.key === "cash")!.balance).toBe(90_000);
  });

  test("a second correction is relative to the first; zero difference writes nothing", async () => {
    const { as, acc, balance } = await setup();
    await as.mutation(api.reconciliations.correctOpening, { accountId: acc.cash, correctOpeningBalance: 90_000, reason: "a" });
    const second = await as.mutation(api.reconciliations.correctOpening, { accountId: acc.cash, correctOpeningBalance: 88_000, reason: "b" });
    expect(second.difference).toBe(-2_000);
    expect(await balance("cash")).toBe(88_000);
    expect(await as.mutation(api.reconciliations.correctOpening, { accountId: acc.cash, correctOpeningBalance: 88_000, reason: "c" })).toEqual({ difference: 0 });
  });

  test("a correction makes a later check stale, since it rewrites that point in time", async () => {
    const { as, acc, statusOf } = await setup();
    await as.mutation(api.reconciliations.create, { accountId: acc.cash, realBalance: 85_000, adjust: false });
    await as.mutation(api.reconciliations.correctOpening, { accountId: acc.cash, correctOpeningBalance: 86_000, reason: "late count" });
    expect((await statusOf(acc.cash)).stale).toBe(true);
  });
});

describe("audit history (ADR 0014)", () => {
  test("lists every change to a transaction, newest first, with actor and changed fields", async () => {
    const { as, acc, cat } = await setup();
    const { id } = await as.mutation(api.transactions.create, { type: "expense", amount: 700, accountId: acc.cash, reason: "Pens", categoryId: cat["Supplies"] });
    await as.mutation(api.transactions.editLabels, { transactionId: id, categoryId: cat["Catering"], reason: "Pens and water" });
    const history = await as.query(api.audit.forTransaction, { transactionId: id });
    expect(history.map((h) => h.action)).toEqual(["edit", "create"]);
    expect(history[0]).toMatchObject({ actor: "Awa", before: { categoryId: cat["Supplies"], reason: "Pens" }, after: { categoryId: cat["Catering"], reason: "Pens and water" } });
  });

  test("automatic entries show the source as the actor", async () => {
    const { t, as, acc } = await setup();
    const id = await t.run((ctx) => ctx.db.insert("transactions", {
      type: "income", amount: 1, accountId: acc.naboopay, reason: "r", source: "shop", kind: "income", status: "confirmed",
      recordedBy: "shop", occurredAt: 1, createdAt: 1,
    }));
    await t.run((ctx) => ctx.db.insert("auditLog", { actor: "shop", action: "create", targetId: id, at: 1 }));
    expect((await as.query(api.audit.forTransaction, { transactionId: id }))[0].actor).toBe("shop");
  });
});
