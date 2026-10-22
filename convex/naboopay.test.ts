/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { GRACE_MS } from "./sweep";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "whsec-test-0123456789abcdef";
const SHOP_KEY = "shop-test-key-0123456789";
const HOUR = 3600 * 1000;

beforeEach(() => {
  vi.stubEnv("NABOOPAY_API_KEY", "test-read-key");
  vi.stubEnv("NABOOPAY_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("NABOOPAY_SG_WALLETS", "wave:+221 77 000 00 01, om:+221780000002");
  vi.stubEnv("INTAKE_SOURCES", "shop");
  vi.stubEnv("INTAKE_KEY_SHOP", SHOP_KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Tx = Record<string, unknown>;
/** A fake Naboopay v2 API: GET only, paged, filtered by status. */
function fakeNaboopay(data: { transactions?: Tx[]; payouts?: Tx[]; balance?: number; pageSize?: number }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const u = new URL(url);
    const page = Number(u.searchParams.get("page") ?? 1);
    const size = data.pageSize ?? 100;
    const paged = (rows: Tx[]) => {
      const total_pages = Math.max(1, Math.ceil(rows.length / size));
      return { rows: rows.slice((page - 1) * size, page * size), pagination: { page, total_pages } };
    };
    if (u.pathname.endsWith("/transactions")) {
      const { rows, pagination } = paged((data.transactions ?? []).filter((t) => t.transaction_status === u.searchParams.get("status")));
      return Response.json({ transactions: rows, pagination });
    }
    if (u.pathname.endsWith("/payouts")) {
      const { rows, pagination } = paged((data.payouts ?? []).filter((p) => p.payout_status === u.searchParams.get("status")));
      return Response.json({ payouts: rows, pagination });
    }
    if (u.pathname.endsWith("/accounts")) return Response.json([{ name: "main", balance: data.balance ?? 0 }]);
    return new Response("not found", { status: 404 });
  });
  return calls;
}

const iso = (ms: number) => new Date(ms).toISOString();
const paidOrder = (id: string, amount: number, paidAgo: number, over: Tx = {}) => ({
  order_id: id, amount, fees: 0, fees_customer_side: true, transaction_status: "paid",
  created_at: iso(Date.now() - paidAgo - 60_000), updated_at: iso(Date.now() - paidAgo), paid_at: iso(Date.now() - paidAgo), ...over,
});

async function setup() {
  const t = convexTest(schema, modules);
  rateLimiter.register(t);
  await t.mutation(internal.seed.accounts, { opening: { naboopay: 0, wave: 0, om: 0, cash: 0, school: 0 } });
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "o@daust.sg", name: "Awa", role: "officer", active: true }));
  const as = t.withIdentity({ subject: `${userId}|s` });
  const acc = await t.run(async (ctx) =>
    Object.fromEntries((await ctx.db.query("accounts").collect()).map((a) => [a.key, a._id])) as Record<string, Id<"accounts">>,
  );
  const balance = async (key: string) => (await as.query(api.balances.list, {})).accounts.find((a) => a.key === key)!.balance;
  const rows = () => t.run((ctx) => ctx.db.query("transactions").collect());
  const sweep = () => t.action(internal.sweep.run, {});
  const lastRun = async () => (await as.query(api.sweep.detected, {})).lastRun;
  const sale = (order: string, amount: number, externalId = `ORD-${order}`, category?: string) =>
    t.fetch("/intake/income", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Intake-Key": SHOP_KEY },
      body: JSON.stringify({ source: "shop", externalId, amount, paidAt: iso(Date.now() - 2 * HOUR), description: `Sale ${order}`, naboopayReference: order, category }),
    });
  return { t, as, acc, balance, rows, sweep, lastRun, sale };
}

// The cutover is the Naboopay account's creation time. Tests run right after seeding,
// so "paid 2 hours ago" would be before cutover; shift the clock forward instead.
async function afterCutover<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ now: Date.now() + 6 * HOUR, toFake: ["Date"] });
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

async function sign(body: string, secret = SECRET) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("webhook /intake/naboopay (ADR 0008)", () => {
  const body = '{"order_id":"ord-1","amount":5000,"transaction_status":"paid"}';
  const post = (t: ReturnType<typeof convexTest>, raw: string, sig: string | null) =>
    t.fetch("/intake/naboopay", { method: "POST", headers: sig ? { "X-Signature": sig } : {}, body: raw });

  test("bad signatures are capped, then valid calls past the webhook limit get 429", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    try {
      const { t } = await setup();
      for (let i = 0; i < 60; i++) expect((await post(t, body, "00")).status).toBe(401);
      expect((await post(t, body, "00")).status).toBe(429);
      const sig = await sign(body);
      for (let i = 0; i < 240; i++) expect((await post(t, body, sig)).status).toBe(200);
      const res = await post(t, body, sig);
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a valid signature over the raw body is accepted and writes nothing", async () => {
    const { t, rows } = await setup();
    const res = await post(t, body, await sign(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ matched: false, action: "none" });
    expect(await rows()).toHaveLength(0);
  });

  test("a matching sale is confirmed, still writing nothing", async () => {
    const { t, rows, sale } = await setup();
    await sale("ord-1", 5000);
    const res = await post(t, body, await sign(body));
    expect(await res.json()).toMatchObject({ matched: true });
    expect(await rows()).toHaveLength(1);
  });

  test("tampered body, re-serialised body, wrong secret or no header → 401", async () => {
    const { t } = await setup();
    const sig = await sign(body);
    expect((await post(t, body.replace("5000", "9000"), sig)).status).toBe(401);
    expect((await post(t, JSON.stringify(JSON.parse(body), null, 1), sig)).status).toBe(401);
    expect((await post(t, body, await sign(body, "other-secret"))).status).toBe(401);
    expect((await post(t, body, null)).status).toBe(401);
  });
});

describe("order sweep (ADR 0008, 0026)", () => {
  test("a reported sale is left alone; an unreported one becomes one placeholder only after the grace window", async () => {
    const { rows, sweep, sale, balance } = await setup();
    await afterCutover(async () => {
      await sale("ord-a", 5000);
      fakeNaboopay({
        transactions: [
          paidOrder("ord-a", 5000, 2 * HOUR),
          paidOrder("ord-b", 7000, 2 * HOUR),
          paidOrder("ord-c", 3000, GRACE_MS - 60_000), // still inside the grace window
          paidOrder("ord-d", 1000, 2 * HOUR, { transaction_status: "paid_and_blocked" }),
        ],
      });
      await sweep();
      await sweep(); // a second run adds nothing
      const all = await rows();
      const placeholders = all.filter((r) => r.source === "naboopay");
      expect(placeholders.map((r) => r.externalId).sort()).toEqual(["ord-b", "ord-d"]);
      expect(placeholders.every((r) => r.status === "needs_review" && r.type === "income")).toBe(true);
      expect(await balance("naboopay")).toBe(5000 + 7000 + 1000);
    });
  });

  test("orders paid before cutover are ignored", async () => {
    const { rows, sweep } = await setup();
    fakeNaboopay({ transactions: [paidOrder("old", 9000, 2 * HOUR)] }); // no clock shift: before cutover
    await sweep();
    expect(await rows()).toHaveLength(0);
  });

  test("every page is read", async () => {
    const { rows, sweep } = await setup();
    await afterCutover(async () => {
      const calls = fakeNaboopay({ transactions: [1, 2, 3, 4, 5].map((i) => paidOrder(`p${i}`, 100 * i, 2 * HOUR)), pageSize: 2 });
      await sweep();
      expect((await rows()).length).toBe(5);
      expect(calls.filter((c) => c.includes("status=paid&")).length).toBe(3);
      expect(calls.every((c) => c.startsWith("GET "))).toBe(true); // read-only, never moves money
    });
  });

  test("a late intake sale becomes the placeholder: counted once, inbox clears (ADR 0031)", async () => {
    const { as, rows, sweep, sale, balance } = await setup();
    await afterCutover(async () => {
      fakeNaboopay({ transactions: [paidOrder("ord-late", 4000, 2 * HOUR)] });
      await sweep();
      expect(await as.query(api.review.count, {})).toBe(1);
      const res = await sale("ord-late", 4000, "ORD-77");
      expect(res.status).toBe(201);
      const all = await rows();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ source: "shop", externalId: "ORD-77", status: "confirmed", naboopayReference: "ord-late" });
      expect(await balance("naboopay")).toBe(4000);
      expect(await as.query(api.review.count, {})).toBe(0);
      expect((await sale("ord-late", 4000, "ORD-77")).status).toBe(200); // retry: duplicate
      await sweep();
      expect(await rows()).toHaveLength(1); // the sweep sees the sale, makes no new placeholder
      const history = await as.query(api.audit.forTransaction, { transactionId: all[0]._id });
      expect(history.map((h) => h.action)).toEqual(["match", "create"]);
    });
  });

  test("a late sale with a different amount is recorded normally; the placeholder stays for an officer", async () => {
    const { rows, sweep, sale } = await setup();
    await afterCutover(async () => {
      fakeNaboopay({ transactions: [paidOrder("ord-x", 4000, 2 * HOUR)] });
      await sweep();
      await sale("ord-x", 4500);
      expect((await rows()).map((r) => r.source).sort()).toEqual(["naboopay", "shop"]);
    });
  });

  test("a refunded order whose sale has no reversal gets one; the backend's refund then no-ops (ADR 0020)", async () => {
    const { t, rows, sweep, sale, balance } = await setup();
    await afterCutover(async () => {
      await sale("ord-r", 6000);
      fakeNaboopay({ transactions: [paidOrder("ord-r", 6000, 2 * HOUR, { transaction_status: "refunded" })] });
      await sweep();
      await sweep();
      expect(await balance("naboopay")).toBe(0);
      expect((await rows()).filter((r) => r.reversalOf)).toHaveLength(1);
      const res = await t.fetch("/intake/income/refund", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Intake-Key": SHOP_KEY },
        body: JSON.stringify({ source: "shop", externalId: "ORD-ord-r" }),
      });
      expect(res.status).toBe(200);
      expect(await balance("naboopay")).toBe(0);
    });
  });

  test("fees_customer_side = false books the known fee once", async () => {
    const { rows, sweep, sale, balance } = await setup();
    await afterCutover(async () => {
      await sale("ord-f", 10_000);
      fakeNaboopay({ transactions: [paidOrder("ord-f", 10_000, 2 * HOUR, { fees_customer_side: false, fees: 300 })] });
      await sweep();
      await sweep();
      expect(await balance("naboopay")).toBe(9_700);
      expect((await rows()).filter((r) => r.type === "expense")).toHaveLength(1);
    });
  });
});

describe("payout sweep (ADR 0015, 0026)", () => {
  const payout = (id: string, amount: number, fees: number, phone: string, over: Tx = {}) => ({
    order_id: id, amount, fees, selected_payment_method: "wave", recipient: { phone, first_name: "Moussa" },
    payout_status: "completed", created_at: iso(Date.now() - 2 * HOUR), paid_at: iso(Date.now() - 2 * HOUR), ...over,
  });

  test("to an SG wallet: transfer + Provider fees expense, once; the SG total drops by exactly the fee", async () => {
    const { as, rows, sweep, sale, balance } = await setup();
    await afterCutover(async () => {
      await sale("ord-s", 100_000);
      fakeNaboopay({ payouts: [payout("po-1", 98_500, 1_500, "+221770000001"), payout("po-2", 5_000, 0, "+221780000002", { payout_status: "pending" })] });
      await sweep();
      await sweep();
      expect(await balance("naboopay")).toBe(0);
      expect(await balance("wave")).toBe(98_500);
      expect((await as.query(api.balances.list, {})).totalHeld).toBe(98_500);
      expect((await rows()).filter((r) => r.externalId?.startsWith("payout"))).toHaveLength(2);
    });
  });

  test("to another wallet: an uncategorised expense waits in the inbox; an officer labels it (ADR 0032)", async () => {
    const { t, as, rows, sweep, sale } = await setup();
    await afterCutover(async () => {
      await sale("ord-s", 50_000);
      fakeNaboopay({ payouts: [payout("po-3", 20_000, 300, "+221771112233", { reason: "Banners" })] });
      await sweep();
      const outside = (await rows()).find((r) => r.externalId === "payout:po-3")!;
      expect(outside).toMatchObject({ type: "expense", status: "needs_review", amount: 20_000 });
      expect(outside.categoryId).toBeUndefined();
      expect(await as.query(api.review.count, {})).toBe(1);
      const decorations = await t.run(async (ctx) => (await ctx.db.query("categories").withIndex("by_name", (q) => q.eq("name", "Decorations")).unique())!._id);
      await as.mutation(api.transactions.editLabels, { transactionId: outside._id, categoryId: decorations });
      expect(await as.query(api.review.count, {})).toBe(0);
    });
  });
});

describe("errors and balance", () => {
  test("no key: the run is logged as skipped and nothing is called", async () => {
    vi.stubEnv("NABOOPAY_API_KEY", "");
    const { sweep, lastRun } = await setup();
    const calls = fakeNaboopay({});
    await sweep();
    expect(calls).toHaveLength(0);
    expect(await lastRun()).toMatchObject({ ok: false, message: expect.stringContaining("NABOOPAY_API_KEY") });
  });

  test("a 403 (wrong scope) is logged, writes nothing, and names the read scope", async () => {
    const { rows, sweep, lastRun } = await setup();
    vi.stubGlobal("fetch", async () => new Response('{"error":"You don\'t have permission"}', { status: 403 }));
    await sweep();
    expect(await rows()).toHaveLength(0);
    expect(await lastRun()).toMatchObject({ ok: false, message: expect.stringContaining('"read" scope') });
  });

  test("Read from Naboopay returns the main account balance, officers only", async () => {
    const { t, as } = await setup();
    fakeNaboopay({ balance: 152_000 });
    expect(await as.action(api.naboopay.readBalance, {})).toBe(152_000);
    await expect(t.action(api.naboopay.readBalance, {})).rejects.toThrow(/Sign in/);
  });
});
