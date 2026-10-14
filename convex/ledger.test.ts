import { describe, expect, test } from "vitest";
import { assertAmount, changedFields, effect, reversalFlip, validateEntry, type Entry } from "./ledger";
import type { Doc, Id } from "./_generated/dataModel";

const A = "acc_a" as Id<"accounts">;
const B = "acc_b" as Id<"accounts">;
const S = "acc_school" as Id<"accounts">;
const ORIGINAL = "tx_1" as Id<"transactions">;

type Tx = Parameters<typeof effect>[0];
const tx = (over: Partial<Tx>): Tx => ({
  type: "income",
  amount: 1000,
  status: "confirmed",
  accountId: A,
  ...over,
});

describe("effect: per-account table (ADR 0007)", () => {
  test.each([
    ["income", A, 1000],
    ["expense", A, -1000],
    ["adjustment_up", A, 1000],
    ["adjustment_down", A, -1000],
  ] as const)("%s on its account", (type, account, expected) => {
    expect(effect(tx({ type }), account, 1)).toBe(expected);
    expect(effect(tx({ type }), B, 1)).toBe(0);
  });

  test("allocation raises School only", () => {
    expect(effect(tx({ type: "allocation", accountId: S }), S, 1)).toBe(1000);
    expect(effect(tx({ type: "allocation", accountId: S }), A, 1)).toBe(0);
  });

  test("transfer moves both legs and nets to zero", () => {
    const t = tx({ type: "transfer", accountId: A, toAccountId: B });
    expect(effect(t, A, 1)).toBe(-1000);
    expect(effect(t, B, 1)).toBe(1000);
    expect(effect(t, A, 1) + effect(t, B, 1)).toBe(0);
  });

  test("paid withdrawal: School down, destination up", () => {
    const t = tx({ type: "school_withdrawal", status: "paid", accountId: S, toAccountId: A });
    expect(effect(t, S, 1)).toBe(-1000);
    expect(effect(t, A, 1)).toBe(1000);
  });

  test("a toAccountId on a one-leg type is ignored", () => {
    expect(effect(tx({ type: "income", toAccountId: B }), B, 1)).toBe(0);
  });
});

describe("effect: status gate (ADR 0007, 0026, 0028)", () => {
  test.each(["confirmed", "paid", "needs_review"] as const)("%s counts", (status) => {
    expect(effect(tx({ status }), A, 1)).toBe(1000);
  });

  test.each(["committed", "draft", "memo", "skipped", "cancelled"] as const)("%s contributes 0", (status) => {
    expect(effect(tx({ status }), A, 1)).toBe(0);
  });

  test("committed withdrawal moves nothing on either leg", () => {
    const t = tx({ type: "school_withdrawal", status: "committed", accountId: S, toAccountId: A });
    expect(effect(t, S, 1)).toBe(0);
    expect(effect(t, A, 1)).toBe(0);
  });
});

describe("effect: reversal flip (ADR 0002)", () => {
  const types: Doc<"transactions">["type"][] = [
    "income", "expense", "adjustment_up", "adjustment_down", "allocation", "transfer", "school_withdrawal",
  ];
  test.each(types)("a %s reversal cancels the original on every account", (type) => {
    const original = tx({ type, accountId: type === "allocation" || type === "school_withdrawal" ? S : A, toAccountId: B, status: type === "school_withdrawal" ? "paid" : "confirmed" });
    const reversal = { ...original, reversalOf: ORIGINAL };
    for (const account of [A, B, S]) {
      expect(effect(original, account, 1) + effect(reversal, account, -1)).toBe(0);
    }
  });

  test("reversing the reversal restores the original (ADR 0020)", async () => {
    const original = { ...tx({}), _id: ORIGINAL };
    const reversal = { ...tx({}), _id: "tx_2" as Id<"transactions">, reversalOf: ORIGINAL };
    const reReversal = { ...tx({}), _id: "tx_3" as Id<"transactions">, reversalOf: reversal._id };
    const rows = new Map([original, reversal, reReversal].map((r) => [r._id, r]));
    const load = async (id: Id<"transactions">) => rows.get(id) ?? null;
    expect(await reversalFlip(original, load)).toBe(1);
    expect(await reversalFlip(reversal, load)).toBe(-1);
    expect(await reversalFlip(reReversal, load)).toBe(1);
    let net = 0;
    for (const r of rows.values()) net += effect(r, A, await reversalFlip(r, load));
    expect(net).toBe(1000);
  });
});

describe("assertAmount (ADR 0024)", () => {
  test.each([1, 253650])("accepts %s", (n) => expect(() => assertAmount(n)).not.toThrow());
  test.each([0, -5, 1.5, Number.NaN])("rejects %s", (n) => expect(() => assertAmount(n)).toThrow());
});

describe("validateEntry", () => {
  const cash = { _id: A, isSchool: false };
  const other = { _id: B, isSchool: false };
  const school = { _id: S, isSchool: true };
  const incomeCat = { name: "Shop sales", direction: "income" as const };
  const expenseCat = { name: "Catering", direction: "expense" as const };
  const base: Entry = { type: "income", amount: 500, reason: "Sale", account: cash, toAccount: null, category: incomeCat };
  const ok = (e: Partial<Entry>) => expect(() => validateEntry({ ...base, ...e })).not.toThrow();
  const bad = (e: Partial<Entry>, msg: RegExp) => expect(() => validateEntry({ ...base, ...e })).toThrow(msg);

  test("valid entries of every type", () => {
    ok({});
    ok({ type: "expense", category: expenseCat });
    ok({ type: "transfer", category: null, toAccount: other });
    ok({ type: "allocation", category: null, account: school });
    ok({ type: "school_withdrawal", category: null, account: school, toAccount: cash });
    ok({ type: "school_withdrawal", category: null, account: school });
    ok({ type: "adjustment_up", category: null });
    ok({ type: "adjustment_down", category: null, account: school });
  });

  test("reason is required", () => bad({ reason: "   " }, /reason/));
  test("amount must be positive whole FCFA", () => bad({ amount: 10.5 }, /whole/));
  test("income needs a category", () => bad({ category: null }, /needs a category/));
  test("category direction must match", () => bad({ category: expenseCat }, /not an income/));
  test("Unlabeled is refused on manual entry", () =>
    bad({ category: { name: "Unlabeled", direction: "income" } }, /Unlabeled/));
  test("a transfer carries no category", () => bad({ type: "transfer", toAccount: other }, /no category/));
  test("a transfer needs two different accounts", () =>
    bad({ type: "transfer", category: null, toAccount: cash }, /two different/));
  test("a transfer cannot touch School", () =>
    bad({ type: "transfer", category: null, toAccount: school }, /cash accounts/));
  test("income cannot go on School", () => bad({ account: school }, /not School/));
  test("an allocation goes on School", () => bad({ type: "allocation", category: null }, /School receivable/));
  test("a withdrawal comes from School", () =>
    bad({ type: "school_withdrawal", category: null, toAccount: other }, /comes from the School/));
});

describe("changedFields (ADR 0014)", () => {
  test("keeps only what moved", () => {
    expect(changedFields({ status: "committed", amount: 5 }, { status: "paid", amount: 5 })).toEqual({
      before: { status: "committed" },
      after: { status: "paid" },
    });
  });
});
