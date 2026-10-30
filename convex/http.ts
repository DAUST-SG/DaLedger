import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { sourceForKey } from "./intakeKeys";
import { verifySignature } from "./naboopay";
import { rateLimiter } from "./rateLimits";

const http = httpRouter();

auth.addHttpRoutes(http);

type Code = "UNAUTHORIZED" | "VALIDATION" | "NOT_FOUND" | "RATE_LIMITED" | "SERVER_ERROR";
const STATUS: Record<Code, number> = { UNAUTHORIZED: 401, VALIDATION: 422, NOT_FOUND: 404, RATE_LIMITED: 429, SERVER_ERROR: 500 };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fail = (code: Code, message: string) => json(STATUS[code], { error: { code, message } });

class Invalid extends Error {}

/** 429 with Retry-After in whole seconds; the caller retries later (ADR 0005). */
const tooMany = (retryAfterMs: number) =>
  new Response(
    JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many requests. Retry after the Retry-After delay; retries are safe." } }),
    { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) } },
  );

/** A bad key or signature: 401, or 429 once the shared cap on rejected calls is spent. */
async function reject(ctx: ActionCtx, message: string): Promise<Response> {
  const { ok, retryAfter } = await rateLimiter.limit(ctx, "rejected");
  return ok ? fail("UNAUTHORIZED", message) : tooMany(retryAfter ?? 0);
}

/** Key check, per-source limit, then JSON parse; shared by both intake routes. Returns the source or a Response. */
async function authenticate(ctx: ActionCtx, req: Request): Promise<{ source: string; body: Record<string, unknown> } | Response> {
  const source = sourceForKey(req.headers.get("X-Intake-Key"));
  if (!source) return reject(ctx, "Unknown or revoked intake key.");
  // After the key check, so a caller without a key cannot spend a source's allowance.
  const { ok, retryAfter } = await rateLimiter.limit(ctx, "intake", { key: source });
  if (!ok) return tooMany(retryAfter ?? 0);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION", "The body must be JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return fail("VALIDATION", "The body must be a JSON object.");
  const claimed = (body as Record<string, unknown>).source;
  if (claimed !== source) return fail("UNAUTHORIZED", "This key does not belong to that source.");
  return { source, body: body as Record<string, unknown> };
}

function text(body: Record<string, unknown>, field: string, required: true): string;
function text(body: Record<string, unknown>, field: string, required: false): string | undefined;
function text(body: Record<string, unknown>, field: string, required: boolean) {
  const value = body[field];
  if (value !== undefined && value !== null && (typeof value !== "string" || value.length > 500)) {
    throw new Invalid(`"${field}" must be text (up to 500 characters).`);
  }
  // Trim before the required check: "  " must not become an empty externalId,
  // which would make every later blank id a silent duplicate.
  const trimmed = value?.trim();
  if (!trimmed) {
    if (required) throw new Invalid(`"${field}" is required.`);
    return undefined;
  }
  return trimmed;
}

async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Invalid) return fail("VALIDATION", err.message);
    // A rule the ledger enforces (amount, date window, reason length): fix the data, don't retry.
    if (err instanceof ConvexError) return fail("VALIDATION", String(err.data));
    console.error("intake failed", err);
    return fail("SERVER_ERROR", "Unexpected failure. Retry later; retries are safe.");
  }
}

// POST /intake/income: one paid shop/DaBus order (API_CONTRACT, ADR 0005).
http.route({
  path: "/intake/income",
  method: "POST",
  handler: httpAction((ctx, req) =>
    guarded(async () => {
      const auth = await authenticate(ctx, req);
      if (auth instanceof Response) return auth;
      const { source, body } = auth;

      const amount = body.amount;
      if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
        throw new Invalid('"amount" must be a whole, positive number of FCFA.');
      }
      const paidAtText = text(body, "paidAt", true);
      const paidAt = Date.parse(paidAtText);
      if (Number.isNaN(paidAt)) throw new Invalid('"paidAt" must be an ISO 8601 date-time.');

      const result = await ctx.runMutation(internal.intake.recordIncome, {
        source,
        externalId: text(body, "externalId", true),
        amount,
        paidAt,
        description: text(body, "description", true),
        naboopayReference: text(body, "naboopayReference", true),
        category: text(body, "category", false),
        event: text(body, "event", false),
      });
      return result.duplicate
        ? json(200, { id: result.id, status: result.status, duplicate: true })
        : json(201, { id: result.id, status: result.status, duplicate: false, accountId: "naboopay", amount });
    }),
  ),
});

// POST /intake/income/refund: reverse a recorded order (ADR 0005, amended by M2 Q1).
http.route({
  path: "/intake/income/refund",
  method: "POST",
  handler: httpAction((ctx, req) =>
    guarded(async () => {
      const auth = await authenticate(ctx, req);
      if (auth instanceof Response) return auth;
      const { source, body } = auth;
      const externalId = text(body, "externalId", true);

      const result = await ctx.runMutation(internal.intake.recordRefund, {
        source,
        externalId,
        reason: text(body, "reason", false),
      });
      if (result.result === "not_found") {
        // Retryable: the sale may simply not have arrived yet.
        return fail("NOT_FOUND", `No income found for (${source}, ${externalId}). Retry later.`);
      }
      if (result.result === "duplicate") return json(200, { reversalId: result.reversalId, duplicate: true });
      return json(201, { reversalId: result.reversalId, reversalOf: result.reversalOf, amount: result.amount });
    }),
  ),
});

// POST /intake/naboopay: Naboopay's signed webhook (ADR 0008, 0026). It CREATES
// NOTHING: on a match it confirms, otherwise the sweep handles it after the grace
// window. The signature is checked over the raw bytes before any parsing.
http.route({
  path: "/intake/naboopay",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.NABOOPAY_WEBHOOK_SECRET;
    if (!secret) return json(503, { error: { code: "SERVER_ERROR", message: "Webhook secret not configured." } });
    const raw = await req.arrayBuffer();
    if (!(await verifySignature(raw, req.headers.get("X-Signature"), secret))) {
      return reject(ctx, "Invalid webhook signature.");
    }
    const { ok, retryAfter } = await rateLimiter.limit(ctx, "naboopayWebhook");
    if (!ok) return tooMany(retryAfter ?? 0); // safe: the webhook writes nothing, the sweep catches up
    let orderId: unknown;
    let amount: unknown;
    try {
      ({ order_id: orderId, amount } = JSON.parse(new TextDecoder().decode(raw)));
    } catch {
      return json(200, { matched: false, action: "none", note: "unreadable body" });
    }
    if (typeof orderId !== "string") return json(200, { matched: false, action: "none" });
    const sale = await ctx.runQuery(internal.sweep.findSale, { orderId });
    if (!sale) {
      return json(200, { matched: false, action: "none", note: "left to the safety-net sweep after the grace window" });
    }
    if (typeof amount === "number" && amount !== sale.amount) {
      console.warn(`Naboopay order ${orderId}: webhook amount ${amount} ≠ recorded ${sale.amount}`);
    }
    return json(200, { matched: true, incomeId: sale.id });
  }),
});

export default http;
