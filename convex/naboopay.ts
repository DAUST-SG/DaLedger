import { action } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { api } from "./_generated/api";

// Naboopay API v2, read-only (ADR 0026). This file never calls POST /payouts or
// GET /refund: the key has the `read` scope and the tracker never moves money.

export type NabooTransaction = {
  order_id: string;
  amount: number;
  fees: number;
  fees_customer_side: boolean;
  transaction_status: "pending" | "paid" | "paid_and_blocked" | "cancelled" | "refunded";
  created_at: string;
  updated_at: string;
  paid_at?: string;
};

export type NabooPayout = {
  order_id: string;
  amount: number;
  fees: number;
  selected_payment_method: "wave" | "orange_money";
  recipient?: { phone?: string; first_name?: string; last_name?: string };
  payout_status: "pending" | "completed" | "failed" | "cancelled";
  reason?: string;
  paid_at?: string;
  created_at: string;
};

const baseUrl = () => (process.env.NABOOPAY_BASE_URL ?? "https://api.naboopay.com/api/v2").replace(/\/$/, "");

/** GET a Naboopay path with the server key; readable errors for the common failures. */
async function get<T>(path: string): Promise<T> {
  const key = process.env.NABOOPAY_API_KEY;
  if (!key) throw new Error("NABOOPAY_API_KEY is not set on this deployment.");
  const res = await fetch(baseUrl() + path, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
  if (res.ok) return (await res.json()) as T;
  const detail = await res.text().catch(() => "");
  if (res.status === 401) throw new Error("Naboopay rejected the API key (401). Check NABOOPAY_API_KEY.");
  if (res.status === 403) throw new Error(`Naboopay refused this request (403): the key needs the "read" scope. ${detail}`);
  if (res.status === 429) throw new Error("Naboopay rate limit reached (429). The next run will retry.");
  throw new Error(`Naboopay ${path} failed with ${res.status}. ${detail}`);
}

/** Every page of a list endpoint (100 per page, the API maximum). */
async function all<T>(path: string, key: "transactions" | "payouts", query: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const qs = new URLSearchParams({ ...query, page: String(page), limit: "100" });
    const body = await get<Record<string, unknown>>(`${path}?${qs}`);
    out.push(...((body[key] as T[]) ?? []));
    const pages = (body.pagination as { total_pages?: number } | undefined)?.total_pages ?? 1;
    if (page >= pages) return out;
  }
}

export const listTransactions = (status: NabooTransaction["transaction_status"], since: number) =>
  all<NabooTransaction>("/transactions", "transactions", { status, start_date: new Date(since).toISOString() });

export const listPayouts = (since: number) =>
  all<NabooPayout>("/payouts", "payouts", { status: "completed", start_date: new Date(since).toISOString() });

/** The `main` account's balance, which payments credit and payouts debit. */
export async function mainBalance(): Promise<number> {
  const accounts = await get<{ name: string; balance: number }[]>("/accounts");
  const main = accounts.find((a) => a.name === "main") ?? accounts[0];
  if (!main) throw new Error("Naboopay returned no account.");
  return main.balance;
}

/**
 * Webhook signature: lowercase hex HMAC-SHA256 of the RAW body, keyed with the
 * webhook secret, compared in constant time. Never verify a re-serialised body.
 */
export async function verifySignature(rawBody: ArrayBuffer, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.trim().toLowerCase();
  let diff = expected.length ^ given.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (given.charCodeAt(i) || 0);
  return diff === 0;
}

/** "Read from Naboopay" on the Reconcile screen (M5 Q3): the officer still records the check. */
export const readBalance = action({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await ctx.runQuery(api.catalog.me, {}); // officers only
    try {
      return await mainBalance();
    } catch (err) {
      throw new ConvexError(err instanceof Error ? err.message : "Naboopay could not be reached.");
    }
  },
});
