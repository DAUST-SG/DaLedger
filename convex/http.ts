import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { sourceForKey } from "./intakeKeys";

const http = httpRouter();

auth.addHttpRoutes(http);

type Code = "UNAUTHORIZED" | "VALIDATION" | "NOT_FOUND" | "SERVER_ERROR";
const STATUS: Record<Code, number> = { UNAUTHORIZED: 401, VALIDATION: 422, NOT_FOUND: 404, SERVER_ERROR: 500 };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fail = (code: Code, message: string) => json(STATUS[code], { error: { code, message } });

class Invalid extends Error {}

/** Key check + JSON parse shared by both intake routes. Returns the source or a Response. */
async function authenticate(req: Request): Promise<{ source: string; body: Record<string, unknown> } | Response> {
  const source = sourceForKey(req.headers.get("X-Intake-Key"));
  if (!source) return fail("UNAUTHORIZED", "Unknown or revoked intake key.");
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
  if (value === undefined || value === null || value === "") {
    if (required) throw new Invalid(`"${field}" is required.`);
    return undefined;
  }
  if (typeof value !== "string" || value.length > 500) throw new Invalid(`"${field}" must be text (up to 500 characters).`);
  return value.trim();
}

async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Invalid) return fail("VALIDATION", err.message);
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
      const auth = await authenticate(req);
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
      const auth = await authenticate(req);
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

export default http;
