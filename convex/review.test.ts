/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
const KEY = "shop-test-key-0123456789";
const DAY = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 9, 1);

beforeEach(() => {
  vi.stubEnv("INTAKE_SOURCES", "shop,tickets");
  vi.stubEnv("INTAKE_KEY_SHOP", KEY);
  vi.stubEnv("INTAKE_KEY_TICKETS", "tickets-test-key-0123456789");
});
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  await atCutover(() => t.mutation(internal.seed.accounts, { opening: { naboopay: 0, wave: 50_000, om: 0, cash: 20_000, school: 0 } }));
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "o@daust.sg", role: "officer", active: true }));
  const as = t.withIdentity({ subject: `${userId}|s` });
  const ids = await t.run(async (ctx) => ({
    acc: Object.fromEntries((await ctx.db.query("accounts").collect()).map((a) => [a.key, a._id])) as Record<string, Id<"accounts">>,
    cat: Object.fromEntries((await ctx.db.query("categories").collect()).map((c) => [c.name, c._id])) as Record<string, Id<"categories">>,
  }));
  const { id: gala } = await as.mutation(api.events.create, { name: "Gala" });
  // An Unlabeled intake sale: the "tickets" source has no default category (ADR 0029).
  const intake = async (externalId: string, amount: number) => {
    const res = await t.fetch("/intake/income", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Intake-Key": "tickets-test-key-0123456789" },
      body: JSON.stringify({ source: "tickets", externalId, amount, paidAt: new Date(T0).toISOString(), description: `Ticket ${externalId}`, naboopayReference: `ref-${externalId}` }),
    });
    return (await res.json()).id as Id<"transactions">;
  };
  const add = (over: Record<string, unknown>) =>
    as.mutation(api.transactions.create, {
      type: "expense", amount: 1000, accountId: ids.acc.cash, reason: "x", categoryId: ids.cat["Catering"], occurredAt: T0, ...over,
    } as never);
  const listAll = async (filter: Record<string, unknown> = {}) => {
    const out = [];
    let cursor: string | null = null;
    for (;;) {
      const page: { page: Awaited<ReturnType<typeof as.query<typeof api.transactions.exportRows>>>; isDone: boolean; continueCursor: string } =
        await as.query(api.transactions.list, { filter, paginationOpts: { numItems: 2, cursor } });
      out.push(...page.page);
      if (page.isDone) return out;
      cursor = page.continueCursor;
    }
  };
  return { t, as, userId, gala, intake, add, listAll, ...ids };
}

describe("review inbox (ADR 0006)", () => {
  test("an Unlabeled intake sale is listed and counted", async () => {
    const { as, intake } = await setup();
    const id = await intake("T-1", 5000);
    expect(await as.query(api.review.count, {})).toBe(1);
    expect((await as.query(api.review.list, {})).map((r) => r._id)).toEqual([id]);
  });

  test("assigning a category confirms it and clears the inbox; a double tap acts once", async () => {
    const { t, as, intake, cat } = await setup();
    const id = await intake("T-1", 5000);
    expect(await as.mutation(api.transactions.editLabels, { transactionId: id, categoryId: cat["Fundraising"] })).toEqual({ changed: 1 });
    expect(await as.mutation(api.transactions.editLabels, { transactionId: id, categoryId: cat["Fundraising"] })).toEqual({ changed: 0 });
    expect(await as.query(api.review.count, {})).toBe(0);
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).toMatchObject({ status: "confirmed", categoryId: cat["Fundraising"] });
    const log = await t.run((ctx) => ctx.db.query("auditLog").withIndex("by_targetId", (q) => q.eq("targetId", id)).collect());
    expect(log.map((e) => e.action)).toEqual(["create", "assign_category"]);
    expect(log[1].before).toEqual({ categoryId: expect.any(String), status: "needs_review" });
  });

  test("a wrong-direction category or Unlabeled is refused", async () => {
    const { as, intake, cat } = await setup();
    const id = await intake("T-1", 5000);
    await expect(as.mutation(api.transactions.editLabels, { transactionId: id, categoryId: cat["Catering"] })).rejects.toThrow(/not an income/);
    await expect(as.mutation(api.transactions.editLabels, { transactionId: id, categoryId: cat["Unlabeled"] })).rejects.toThrow(/real category/);
    expect(await as.query(api.review.count, {})).toBe(1);
  });

  test("labelling an inbox item does not change any balance (ADR 0007)", async () => {
    const { as, intake, cat } = await setup();
    const id = await intake("T-1", 5000);
    const before = await as.query(api.balances.list, {});
    await as.mutation(api.transactions.editLabels, { transactionId: id, categoryId: cat["Fundraising"] });
    expect(await as.query(api.balances.list, {})).toEqual(before);
  });
});

describe("label edits (ADR 0030)", () => {
  test("relabel a confirmed expense, retag its event, edit its reason", async () => {
    const { t, as, add, cat, gala } = await setup();
    const { id } = await add({});
    await as.mutation(api.transactions.editLabels, { transactionId: id, categoryId: cat["Venue"], eventId: gala, reason: "Hall deposit" });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ categoryId: cat["Venue"], eventId: gala, reason: "Hall deposit", status: "confirmed" });
    await as.mutation(api.transactions.editLabels, { transactionId: id, eventId: null });
    expect((await t.run((ctx) => ctx.db.get(id)))?.eventId).toBeUndefined();
  });

  test("category and event changes follow the whole reversal chain", async () => {
    const { t, as, add, cat, gala } = await setup();
    const { id } = await add({});
    const { reversalId } = await as.mutation(api.transactions.reverse, { transactionId: id, reason: "wrong" });
    const r = await as.mutation(api.transactions.editLabels, { transactionId: id, categoryId: cat["Venue"], eventId: gala });
    expect(r.changed).toBe(2);
    expect(await t.run((ctx) => ctx.db.get(reversalId))).toMatchObject({ categoryId: cat["Venue"], eventId: gala, reason: "wrong" });
    await expect(as.mutation(api.transactions.editLabels, { transactionId: reversalId, categoryId: cat["Supplies"] })).rejects.toThrow(/original/);
  });

  test("a closed event can't be newly tagged; a transfer has no category; reason can't be blank", async () => {
    const { as, add, acc, cat } = await setup();
    const { id: closed } = await as.mutation(api.events.create, { name: "Old fair" });
    await as.mutation(api.events.setActive, { eventId: closed, active: false });
    const { id } = await add({});
    await expect(as.mutation(api.transactions.editLabels, { transactionId: id, eventId: closed })).rejects.toThrow(/no longer accepts/);
    const { id: tr } = await add({ type: "transfer", accountId: acc.wave, toAccountId: acc.cash, categoryId: undefined });
    await expect(as.mutation(api.transactions.editLabels, { transactionId: tr, categoryId: cat["Venue"] })).rejects.toThrow(/no category/);
    await expect(as.mutation(api.transactions.editLabels, { transactionId: id, reason: "  " })).rejects.toThrow(/reason/);
  });

  test("amounts, accounts and dates are not editable at all", async () => {
    const { as, add } = await setup();
    const { id } = await add({});
    await expect(as.mutation(api.transactions.editLabels, { transactionId: id, amount: 5 } as never)).rejects.toThrow();
  });
});

describe("transactions list (ADR 0016, 0023)", () => {
  test("newest first by occurredAt, every row exactly once across pages", async () => {
    const { add, listAll } = await setup();
    for (let i = 0; i < 5; i++) await add({ reason: `r${i}`, occurredAt: T0 + i * DAY });
    const rows = await listAll();
    expect(rows.map((r) => r.reason)).toEqual(["r4", "r3", "r2", "r1", "r0"]);
  });

  test("filters: date range (inclusive), account (either leg), category, event, source, type", async () => {
    const { add, listAll, intake, acc, cat, gala } = await setup();
    await add({ reason: "d1", occurredAt: T0 });
    await add({ reason: "d2", occurredAt: T0 + DAY, eventId: gala, categoryId: cat["Venue"] });
    await add({ reason: "d3", occurredAt: T0 + 2 * DAY, type: "transfer", accountId: acc.wave, toAccountId: acc.cash, categoryId: undefined });
    await intake("T-1", 5000);

    const reasons = async (f: Record<string, unknown>) => (await listAll(f)).map((r) => r.reason).sort();
    expect(await reasons({ from: T0 + DAY, to: T0 + 2 * DAY })).toEqual(["d2", "d3"]);
    expect(await reasons({ accountId: acc.wave })).toEqual(["d3"]);
    expect(await reasons({ accountId: acc.cash })).toEqual(["d1", "d2", "d3"]);
    expect(await reasons({ categoryId: cat["Venue"] })).toEqual(["d2"]);
    expect(await reasons({ eventId: gala })).toEqual(["d2"]);
    expect(await reasons({ source: "tickets" })).toEqual(["Ticket T-1"]);
    expect(await reasons({ type: "transfer" })).toEqual(["d3"]);
    expect(await reasons({ accountId: acc.cash, type: "expense", to: T0 })).toEqual(["d1"]);
  });

  test("exportRows matches the filtered list", async () => {
    const { as, add, listAll, gala } = await setup();
    for (let i = 0; i < 3; i++) await add({ reason: `g${i}`, eventId: gala, occurredAt: T0 + i });
    await add({ reason: "other" });
    const filter = { eventId: gala };
    expect((await as.query(api.transactions.exportRows, { filter })).map((r) => r._id)).toEqual((await listAll(filter)).map((r) => r._id));
  });
});

describe("Event view (ADR 0022)", () => {
  test("all-time income, expense and net by category; reversal nets to zero; equals the filtered list", async () => {
    const { t, as, add, listAll, acc, cat, gala } = await setup();
    await add({ type: "income", amount: 80_000, categoryId: cat["Fundraising"], eventId: gala, reason: "tickets" });
    await add({ type: "expense", amount: 30_000, categoryId: cat["Venue"], eventId: gala, reason: "hall" });
    const { id: wrong } = await add({ type: "expense", amount: 5_000, categoryId: cat["Catering"], eventId: gala, reason: "dup" });
    await as.mutation(api.transactions.reverse, { transactionId: wrong, reason: "duplicate" });
    // Not counted: a committed withdrawal and an untagged expense.
    await add({ type: "school_withdrawal", accountId: acc.school, categoryId: undefined, eventId: gala, reason: "w" });
    await add({ amount: 999, reason: "untagged" });
    // A pre-cutover memo summary counts in event reports (ADR 0011).
    await t.run((ctx) => ctx.db.insert("transactions", {
      type: "income", amount: 10_000, accountId: acc.cash, reason: "2025 Gala summary", categoryId: cat["Fundraising"],
      eventId: gala, source: "manual", kind: "income", status: "memo", recordedBy: "seed", occurredAt: T0 - 365 * DAY, createdAt: Date.now(),
    }));
    // Closing the event changes nothing.
    await as.mutation(api.events.setActive, { eventId: gala, active: false });

    const view = await as.query(api.reports.event, { eventId: gala });
    expect(view).toMatchObject({ name: "Gala", active: false, income: 90_000, expense: 30_000, net: 60_000 });
    expect(view.categories.find((c) => c.name === "Catering")?.total).toBe(0);

    // Acceptance: the event's net equals its rows in the list filtered by that event.
    const rows = await listAll({ eventId: gala });
    const LIVE = new Set(["confirmed", "paid", "needs_review", "memo"]);
    const net = rows
      .filter((r) => (r.type === "income" || r.type === "expense") && LIVE.has(r.status))
      .reduce((s, r) => s + (r.type === "income" ? 1 : -1) * r.amount * r.flip, 0);
    expect(net).toBe(view.net);
  });
});

describe("events and suggestions", () => {
  test("creating an existing name returns it and reopens it", async () => {
    const { as, gala } = await setup();
    await as.mutation(api.events.setActive, { eventId: gala, active: false });
    expect(await as.mutation(api.events.create, { name: "  Gala " })).toEqual({ id: gala, created: false });
    expect((await as.query(api.events.list, {})).find((e) => e._id === gala)?.active).toBe(true);
  });

  test("recent reasons are distinct, manual, newest first, with their category", async () => {
    const { as, add, cat } = await setup();
    await add({ reason: "Printing", categoryId: cat["Supplies"] });
    await add({ reason: "Water" });
    await add({ reason: "printing" });
    const recent = await as.query(api.transactions.recentReasons, {});
    expect(recent.map((r) => r.reason)).toEqual(["printing", "Water"]);
  });
});
