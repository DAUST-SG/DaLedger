/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const SHOP_KEY = "shop-test-key-0123456789";
const DABUS_KEY = "dabus-test-key-0123456789";

beforeEach(() => {
  vi.stubEnv("INTAKE_SOURCES", "shop, dabus");
  vi.stubEnv("INTAKE_KEY_SHOP", SHOP_KEY);
  vi.stubEnv("INTAKE_KEY_DABUS", DABUS_KEY);
});
afterEach(() => vi.unstubAllEnvs());

const sale = (over: Record<string, unknown> = {}) => ({
  source: "shop",
  externalId: "ORD-1042",
  amount: 253650,
  paidAt: "2026-10-13T12:04:00Z",
  description: "Hoodie x3",
  naboopayReference: "550e8400-e29b-41d4-a716-446655440000",
  ...over,
});

async function setup() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  await t.mutation(internal.seed.accounts, { opening: { naboopay: 1000, wave: 0, om: 0, cash: 0, school: 0 } });
  await t.mutation(internal.seed.addEvent, { name: "Integration Week" });
  const post = (path: string, body: unknown, key: string | null = SHOP_KEY) =>
    t.fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "X-Intake-Key": key } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const naboopayBalance = () =>
    t.run(async (ctx) => {
      const acc = (await ctx.db.query("accounts").withIndex("by_key", (q) => q.eq("key", "naboopay")).unique())!;
      const { balanceOf } = await import("./balances");
      return balanceOf(ctx, acc);
    });
  const rows = () => t.run((ctx) => ctx.db.query("transactions").collect());
  const audit = () => t.run((ctx) => ctx.db.query("auditLog").collect());
  return { t, post, naboopayBalance, rows, audit };
}

describe("POST /intake/income", () => {
  test("records a paid sale on Naboopay, labelled with the source default", async () => {
    const { post, naboopayBalance, rows } = await setup();
    const res = await post("/intake/income", sale());
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "confirmed", duplicate: false, amount: 253650 });
    expect(await naboopayBalance()).toBe(1000 + 253650);
    const [tx] = await rows();
    expect(tx).toMatchObject({
      type: "income", source: "shop", kind: "income", externalId: "ORD-1042", recordedBy: "shop",
      reason: "Hoodie x3", occurredAt: Date.parse("2026-10-13T12:04:00Z"),
    });
  });

  test("the same order twice gives one transaction (ADR 0005)", async () => {
    const { post, rows, audit } = await setup();
    const first = await (await post("/intake/income", sale())).json();
    const res = await post("/intake/income", sale());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: first.id, status: "confirmed", duplicate: true });
    expect(await rows()).toHaveLength(1);
    expect(await audit()).toHaveLength(1);
  });

  test("the same order id from two sources gives two transactions", async () => {
    const { post, rows } = await setup();
    await post("/intake/income", sale());
    await post("/intake/income", sale({ source: "dabus" }), DABUS_KEY);
    expect(await rows()).toHaveLength(2);
  });

  test.each([
    ["no key", null],
    ["an unknown key", "not-a-real-key-0123456789"],
  ])("%s is rejected with 401", async (_, key) => {
    const { post, rows } = await setup();
    const res = await post("/intake/income", sale(), key);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Unknown or revoked intake key." } });
    expect(await rows()).toHaveLength(0);
  });

  test("a shop key cannot post as dabus", async () => {
    const { post } = await setup();
    expect((await post("/intake/income", sale({ source: "dabus" }))).status).toBe(401);
  });

  test.each([
    ["amount 0", { amount: 0 }],
    ["a negative amount", { amount: -5 }],
    ["a decimal amount", { amount: 10.5 }],
    ["an amount as text", { amount: "2500" }],
    ["no externalId", { externalId: undefined }],
    ["no naboopayReference", { naboopayReference: undefined }],
    ["no description", { description: "" }],
    ["a bad paidAt", { paidAt: "yesterday" }],
  ])("%s is rejected with 422", async (_, over) => {
    const { post, rows } = await setup();
    const res = await post("/intake/income", sale(over));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("VALIDATION");
    expect(await rows()).toHaveLength(0);
  });

  test("a body that is not JSON is rejected with 422", async () => {
    const { post } = await setup();
    expect((await post("/intake/income", "{not json")).status).toBe(422);
  });
});

describe("category and event (ADR 0029, M2 Q3)", () => {
  test("a valid income category in the request wins", async () => {
    const { t, post, rows } = await setup();
    await post("/intake/income", sale({ category: "Fundraising" }));
    const [tx] = await rows();
    const cat = await t.run((ctx) => ctx.db.get(tx.categoryId!));
    expect(cat?.name).toBe("Fundraising");
    expect(tx.status).toBe("confirmed");
  });

  test("an expense category falls through to the source default", async () => {
    const { t, post, rows } = await setup();
    await post("/intake/income", sale({ category: "Catering" }));
    const [tx] = await rows();
    expect((await t.run((ctx) => ctx.db.get(tx.categoryId!)))?.name).toBe("Shop sales");
  });

  test("a source with no default and no category lands Unlabeled + needs_review, and still counts", async () => {
    vi.stubEnv("INTAKE_SOURCES", "shop, dabus, tickets");
    vi.stubEnv("INTAKE_KEY_TICKETS", "tickets-test-key-0123456789");
    const { t, post, rows, naboopayBalance } = await setup();
    const res = await post("/intake/income", sale({ source: "tickets" }), "tickets-test-key-0123456789");
    expect(await res.json()).toMatchObject({ status: "needs_review" });
    const [tx] = await rows();
    expect((await t.run((ctx) => ctx.db.get(tx.categoryId!)))?.name).toBe("Unlabeled");
    expect(await naboopayBalance()).toBe(1000 + 253650);
  });

  test("a known event is tagged; an unknown one is dropped and kept in the audit", async () => {
    const { post, rows, audit } = await setup();
    await post("/intake/income", sale({ event: "Integration Week" }));
    await post("/intake/income", sale({ externalId: "ORD-2", event: "Mystery Night" }));
    const [tagged, untagged] = await rows();
    expect(tagged.eventId).toBeDefined();
    expect(untagged.eventId).toBeUndefined();
    expect((await audit())[1].after).toMatchObject({ unknownEvent: "Mystery Night" });
  });
});

describe("POST /intake/income/refund", () => {
  test("reverses the sale exactly once; a retry is a duplicate", async () => {
    const { post, naboopayBalance, rows } = await setup();
    const { id } = await (await post("/intake/income", sale())).json();
    const res = await post("/intake/income/refund", { source: "shop", externalId: "ORD-1042", reason: "Defective" });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ reversalOf: id, amount: 253650 });
    expect(await naboopayBalance()).toBe(1000);

    const retry = await post("/intake/income/refund", { source: "shop", externalId: "ORD-1042" });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ reversalId: created.reversalId, duplicate: true });
    expect(await rows()).toHaveLength(2);
    expect((await rows())[1]).toMatchObject({ kind: "refund", externalId: "ORD-1042", reversalOf: id, reason: "Defective" });
  });

  test("a refund for an unknown order is a retryable 404 that writes nothing", async () => {
    const { post, rows, audit } = await setup();
    const res = await post("/intake/income/refund", { source: "shop", externalId: "ORD-404" });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
    expect(await rows()).toHaveLength(0);
    expect(await audit()).toHaveLength(0);
  });

  test("a refund that arrives before its sale succeeds on retry", async () => {
    const { post, naboopayBalance } = await setup();
    expect((await post("/intake/income/refund", { source: "shop", externalId: "ORD-1042" })).status).toBe(404);
    await post("/intake/income", sale());
    expect((await post("/intake/income/refund", { source: "shop", externalId: "ORD-1042" })).status).toBe(201);
    expect(await naboopayBalance()).toBe(1000);
  });

  test("a sale an officer already reversed is not reversed twice (ADR 0020)", async () => {
    const { t, post, rows, naboopayBalance } = await setup();
    const { id } = await (await post("/intake/income", sale())).json();
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: "o@daust.sg", active: true, role: "officer" }));
    const { api } = await import("./_generated/api");
    const manual = await t.withIdentity({ subject: `${userId}|s` }).mutation(api.transactions.reverse, {
      transactionId: id, reason: "Duplicate sale",
    });
    const res = await post("/intake/income/refund", { source: "shop", externalId: "ORD-1042" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reversalId: manual.reversalId, duplicate: true });
    expect(await rows()).toHaveLength(2);
    expect(await naboopayBalance()).toBe(1000);
  });

  test("the sale and its refund are separate records sharing the order id", async () => {
    const { post, rows } = await setup();
    await post("/intake/income", sale());
    await post("/intake/income/refund", { source: "shop", externalId: "ORD-1042" });
    const [s, r] = await rows();
    expect([s.kind, r.kind]).toEqual(["income", "refund"]);
    expect(s.externalId).toBe(r.externalId);
    // Replaying the sale after the refund is still a duplicate, not a new sale.
    expect((await post("/intake/income", sale())).status).toBe(200);
  });

  test("a refund needs a valid key too", async () => {
    const { post } = await setup();
    expect((await post("/intake/income/refund", { source: "shop", externalId: "X" }, null)).status).toBe(401);
  });
});

describe("rate limits (pre-go-live, CLAUDE.md §4)", () => {
  // Freeze the clock so the token buckets do not refill mid-test.
  beforeEach(() => vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  test("past the burst a source gets 429 with Retry-After, and nothing is written", async () => {
    const { post, rows } = await setup();
    for (let i = 0; i < 120; i++) expect((await post("/intake/income", sale({ externalId: `B-${i}` }))).status).toBe(201);
    const res = await post("/intake/income", sale({ externalId: "B-over" }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(await res.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(await rows()).toHaveLength(120);
  });

  test("one source over its limit does not block another; refunds share the allowance", async () => {
    const { post } = await setup();
    for (let i = 0; i < 119; i++) await post("/intake/income", sale({ externalId: `S-${i}` }));
    expect((await post("/intake/income/refund", { source: "shop", externalId: "S-0" })).status).toBe(201);
    expect((await post("/intake/income/refund", { source: "shop", externalId: "S-1" })).status).toBe(429);
    expect((await post("/intake/income", sale({ source: "dabus" }), DABUS_KEY)).status).toBe(201);
  });

  test("bad keys do not spend a source's allowance, and are capped as a whole", async () => {
    const { post } = await setup();
    for (let i = 0; i < 60; i++) expect((await post("/intake/income", sale(), "wrong-key-0123456789")).status).toBe(401);
    expect((await post("/intake/income", sale(), "wrong-key-0123456789")).status).toBe(429);
    expect((await post("/intake/income", sale(), null)).status).toBe(429);
    expect((await post("/intake/income", sale())).status).toBe(201);
  });
});
