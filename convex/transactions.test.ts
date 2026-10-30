/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

// Accounts are created at cutover (ADR 0018) and entries may not predate it, so
// seed with the clock at CUTOVER, then put it back as the test had it.
const CUTOVER = Date.UTC(2026, 0, 1);
async function atCutover<T>(fn: () => Promise<T>): Promise<T> {
  const fake = vi.isFakeTimers();
  const now = Date.now();
  vi.useFakeTimers({ now: CUTOVER, toFake: ["Date"] });
  try {
    return await fn();
  } finally {
    if (fake) vi.setSystemTime(now);
    else vi.useRealTimers();
  }
}

async function setup(opening = { naboopay: 0, wave: 10_000, om: 0, cash: 5_000, school: 100_000 }) {
  const t = convexTest(schema, modules);
  await atCutover(() => t.mutation(internal.seed.accounts, { opening }));
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "officer@daust.sg", name: "Officer", role: "officer", active: true }),
  );
  const as = t.withIdentity({ subject: `${userId}|session` });
  const ids = await t.run(async (ctx) => {
    const acc = Object.fromEntries((await ctx.db.query("accounts").collect()).map((a) => [a.key, a._id]));
    const cat = Object.fromEntries((await ctx.db.query("categories").collect()).map((c) => [c.name, c._id]));
    return { acc, cat } as { acc: Record<string, Id<"accounts">>; cat: Record<string, Id<"categories">> };
  });
  const balances = async () => {
    const view = await as.query(api.balances.list, {});
    const by = Object.fromEntries(view.accounts.map((a) => [a.key, a.balance])) as Record<"naboopay" | "wave" | "om" | "cash", number>;
    return { ...by, school: view.school!.balance, committed: view.school!.committed, total: view.totalHeld };
  };
  return { t, as, userId, ...ids, balances };
}

describe("auth (SECURITY.md, ADR 0023)", () => {
  test("no session is refused", async () => {
    const { t } = await setup();
    await expect(t.query(api.balances.list, {})).rejects.toThrow(/Sign in/);
  });

  test("an inactive officer is refused", async () => {
    const { t, userId, as } = await setup();
    await t.run((ctx) => ctx.db.patch(userId, { active: false }));
    await expect(as.query(api.balances.list, {})).rejects.toThrow(/not active/);
  });
});

describe("balances (ADR 0004, 0007)", () => {
  test("opening balances; School is kept out of the total", async () => {
    const { balances } = await setup();
    expect(await balances()).toMatchObject({ wave: 10_000, cash: 5_000, school: 100_000, total: 15_000 });
  });

  test("income and expense move the right account", async () => {
    const { as, acc, cat, balances } = await setup();
    await as.mutation(api.transactions.create, {
      type: "income", amount: 2_500, accountId: acc.cash, reason: "Snack sale", categoryId: cat["Other income"],
    });
    await as.mutation(api.transactions.create, {
      type: "expense", amount: 1_000, accountId: acc.wave, reason: "Printing", categoryId: cat["Supplies"],
    });
    expect(await balances()).toMatchObject({ cash: 7_500, wave: 9_000, total: 16_500 });
  });

  test("a transfer leaves the total unchanged", async () => {
    const { as, acc, balances } = await setup();
    const before = (await balances()).total;
    await as.mutation(api.transactions.create, {
      type: "transfer", amount: 4_000, accountId: acc.wave, toAccountId: acc.cash, reason: "Cash for event",
    });
    expect(await balances()).toMatchObject({ wave: 6_000, cash: 9_000, total: before });
  });

  test("allocation raises School only", async () => {
    const { as, acc, balances } = await setup();
    await as.mutation(api.transactions.create, {
      type: "allocation", amount: 50_000, accountId: acc.school, reason: "Yearly allocation",
    });
    expect(await balances()).toMatchObject({ school: 150_000, total: 15_000 });
  });

  test("balanceAsOf ignores later entries (ADR 0016)", async () => {
    const { as, acc, cat } = await setup();
    const day = 24 * 3600 * 1000;
    const t0 = Date.UTC(2026, 9, 1);
    await as.mutation(api.transactions.create, {
      type: "income", amount: 1_000, accountId: acc.cash, reason: "Day 1", categoryId: cat["Other income"], occurredAt: t0,
    });
    await as.mutation(api.transactions.create, {
      type: "income", amount: 2_000, accountId: acc.cash, reason: "Day 3", categoryId: cat["Other income"], occurredAt: t0 + 2 * day,
    });
    const cashAt = async (date: number) =>
      (await as.query(api.balances.asOf, { date })).accounts.find((a) => a.key === "cash")!.balance;
    expect(await cashAt(t0 - 1)).toBe(5_000);
    expect(await cashAt(t0)).toBe(6_000);
    expect(await cashAt(t0 + day)).toBe(6_000);
    expect(await cashAt(t0 + 2 * day)).toBe(8_000);
  });
});

describe("validation", () => {
  test.each([0, -1, 10.5])("amount %s is rejected", async (amount) => {
    const { as, acc, cat } = await setup();
    await expect(
      as.mutation(api.transactions.create, {
        type: "income", amount, accountId: acc.cash, reason: "x", categoryId: cat["Other income"],
      }),
    ).rejects.toThrow(/whole, positive/);
  });

  test("a missing reason is rejected", async () => {
    const { as, acc, cat } = await setup();
    await expect(
      as.mutation(api.transactions.create, {
        type: "expense", amount: 100, accountId: acc.cash, reason: " ", categoryId: cat["Supplies"],
      }),
    ).rejects.toThrow(/reason/);
  });

  test("a wrong-direction category is rejected", async () => {
    const { as, acc, cat } = await setup();
    await expect(
      as.mutation(api.transactions.create, {
        type: "expense", amount: 100, accountId: acc.cash, reason: "x", categoryId: cat["Shop sales"],
      }),
    ).rejects.toThrow(/not an expense/);
  });
});

describe("school withdrawal lifecycle (ADR 0003, 0019)", () => {
  test("committed moves nothing; paid moves both legs exactly once", async () => {
    const { as, acc, balances } = await setup();
    const { id, status } = await as.mutation(api.transactions.create, {
      type: "school_withdrawal", amount: 30_000, accountId: acc.school, reason: "Gala budget",
    });
    expect(status).toBe("committed");
    expect(await balances()).toMatchObject({ school: 100_000, om: 0, committed: 30_000 });

    const first = await as.mutation(api.transactions.markWithdrawalPaid, { transactionId: id, toAccountId: acc.om });
    const second = await as.mutation(api.transactions.markWithdrawalPaid, { transactionId: id, toAccountId: acc.om });
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(await balances()).toMatchObject({ school: 70_000, om: 30_000, committed: 0, total: 45_000 });
  });

  test("an approved withdrawal can be cancelled; it changes no balance (ADR 0028)", async () => {
    const { as, acc, balances } = await setup();
    const { id } = await as.mutation(api.transactions.create, {
      type: "school_withdrawal", amount: 30_000, accountId: acc.school, reason: "Gala budget",
    });
    expect(await balances()).toMatchObject({ school: 100_000, committed: 30_000 });

    const first = await as.mutation(api.transactions.cancelWithdrawal, { transactionId: id, reason: "Gala cancelled" });
    const second = await as.mutation(api.transactions.cancelWithdrawal, { transactionId: id, reason: "again" });
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false); // guarded no-op
    expect(await balances()).toMatchObject({ school: 100_000, committed: 0, total: 15_000 });

    // A cancelled withdrawal can no longer be marked paid.
    const paid = await as.mutation(api.transactions.markWithdrawalPaid, { transactionId: id, toAccountId: acc.om });
    expect(paid.changed).toBe(false);
    expect(await balances()).toMatchObject({ school: 100_000, om: 0 });
  });
});

describe("reversals (ADR 0002, 0020)", () => {
  test("a reversal restores the balance; a second reverse is a no-op", async () => {
    const { as, acc, cat, balances } = await setup();
    const { id } = await as.mutation(api.transactions.create, {
      type: "expense", amount: 2_000, accountId: acc.cash, reason: "Wrong account", categoryId: cat["Supplies"],
    });
    const r1 = await as.mutation(api.transactions.reverse, { transactionId: id, reason: "Entered on cash by mistake" });
    const r2 = await as.mutation(api.transactions.reverse, { transactionId: id, reason: "double tap" });
    expect(r1.created).toBe(true);
    expect(r2).toEqual({ reversalId: r1.reversalId, created: false });
    expect((await balances()).cash).toBe(5_000);
  });

  test("reversing the reversal restores the original, and allows reversing again", async () => {
    const { as, acc, cat, balances } = await setup();
    const { id } = await as.mutation(api.transactions.create, {
      type: "income", amount: 1_500, accountId: acc.cash, reason: "Sale", categoryId: cat["Other income"],
    });
    const { reversalId } = await as.mutation(api.transactions.reverse, { transactionId: id, reason: "oops" });
    expect((await balances()).cash).toBe(5_000);
    await as.mutation(api.transactions.reverse, { transactionId: reversalId, reason: "the sale was real" });
    expect((await balances()).cash).toBe(6_500);
    // The original's reversal is now undone, so the original can be reversed again.
    const again = await as.mutation(api.transactions.reverse, { transactionId: id, reason: "refunded after all" });
    expect(again.created).toBe(true);
    expect((await balances()).cash).toBe(5_000);
  });

  test("a transfer reversal undoes both legs", async () => {
    const { as, acc, balances } = await setup();
    const { id } = await as.mutation(api.transactions.create, {
      type: "transfer", amount: 3_000, accountId: acc.wave, toAccountId: acc.cash, reason: "Move",
    });
    await as.mutation(api.transactions.reverse, { transactionId: id, reason: "wrong direction" });
    expect(await balances()).toMatchObject({ wave: 10_000, cash: 5_000 });
  });

  test("an unpaid withdrawal cannot be reversed", async () => {
    const { as, acc } = await setup();
    const { id } = await as.mutation(api.transactions.create, {
      type: "school_withdrawal", amount: 1_000, accountId: acc.school, reason: "x",
    });
    await expect(as.mutation(api.transactions.reverse, { transactionId: id, reason: "y" })).rejects.toThrow(/not paid/);
  });

  test("a cancelled withdrawal moved no money, so it cannot be reversed", async () => {
    const { as, acc } = await setup();
    const { id } = await as.mutation(api.transactions.create, {
      type: "school_withdrawal", amount: 1_000, accountId: acc.school, reason: "x",
    });
    await as.mutation(api.transactions.cancelWithdrawal, { transactionId: id, reason: "off" });
    await expect(as.mutation(api.transactions.reverse, { transactionId: id, reason: "y" })).rejects.toThrow(/nothing to reverse/);
  });

  test("a reversal can't be dated in the future", async () => {
    const { as, acc, cat } = await setup();
    const { id } = await as.mutation(api.transactions.create, {
      type: "expense", amount: 1_000, accountId: acc.cash, reason: "x", categoryId: cat["Supplies"],
    });
    await expect(
      as.mutation(api.transactions.reverse, { transactionId: id, reason: "y", occurredAt: Date.now() + 24 * 3600 * 1000 }),
    ).rejects.toThrow(/future/);
  });
});

describe("audit log (ADR 0014)", () => {
  test("one entry per write, with changed fields only", async () => {
    const { t, as, acc, userId } = await setup();
    const { id } = await as.mutation(api.transactions.create, {
      type: "school_withdrawal", amount: 5_000, accountId: acc.school, reason: "Trip",
    });
    await as.mutation(api.transactions.markWithdrawalPaid, { transactionId: id, toAccountId: acc.cash });
    await as.mutation(api.transactions.markWithdrawalPaid, { transactionId: id, toAccountId: acc.cash }); // no-op
    const log = await t.run((ctx) =>
      ctx.db.query("auditLog").withIndex("by_targetId", (q) => q.eq("targetId", id)).collect(),
    );
    expect(log.map((e) => e.action)).toEqual(["create", "mark_paid"]);
    expect(log.every((e) => e.actor === userId)).toBe(true);
    expect(log[0].before).toBeUndefined();
    expect(log[1].before).toEqual({ status: "committed" });
    expect(log[1].after).toMatchObject({ status: "paid", toAccountId: acc.cash });
    expect(Object.keys(log[1].after!).sort()).toEqual(["occurredAt", "status", "toAccountId"]);
  });
});

describe("seed (ADR 0018)", () => {
  test("running it twice never changes an opening balance", async () => {
    const { t, balances } = await setup();
    const second = await t.mutation(internal.seed.accounts, {
      opening: { naboopay: 9, wave: 9, om: 9, cash: 9, school: 9 },
    });
    expect(second).toEqual({ accountsCreated: 0, categoriesCreated: 0 });
    expect((await balances()).wave).toBe(10_000);
  });
});
