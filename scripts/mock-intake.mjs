// Post a fake shop/DaBus sale or refund to a dev deployment (CLAUDE.md §4: dev is
// tested with a mocked intake, never real Naboopay money).
//
//   npm run mock:intake -- sale ORD-1 2500 [category] [event]
//   npm run mock:intake -- refund ORD-1
//
// Reads VITE_CONVEX_SITE_URL (or CONVEX_SITE_URL), MOCK_INTAKE_KEY and
// MOCK_INTAKE_SOURCE (default "shop") from the environment or .env.local.
import { readFileSync } from "node:fs";

const env = { ...Object.fromEntries(
  (() => { try { return readFileSync(".env.local", "utf8").split("\n"); } catch { return []; } })()
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]),
), ...process.env };

const site = env.CONVEX_SITE_URL ?? env.VITE_CONVEX_SITE_URL;
const key = env.MOCK_INTAKE_KEY;
const source = env.MOCK_INTAKE_SOURCE ?? "shop";
const [action, externalId, amount, category, event] = process.argv.slice(2);

if (!site || !key || !["sale", "refund"].includes(action) || !externalId || (action === "sale" && !amount)) {
  console.error("Usage: npm run mock:intake -- sale ORD-1 2500 [category] [event] | refund ORD-1");
  console.error("Needs VITE_CONVEX_SITE_URL and MOCK_INTAKE_KEY (in .env.local or the environment).");
  process.exit(1);
}

const [path, body] = action === "sale"
  ? ["/intake/income", { source, externalId, amount: Number(amount), paidAt: new Date().toISOString(),
      description: `Mock ${source} sale ${externalId}`, naboopayReference: `mock-${externalId}`, category, event }]
  : ["/intake/income/refund", { source, externalId, reason: `Mock refund of ${externalId}` }];

const res = await fetch(site + path, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Intake-Key": key },
  body: JSON.stringify(body),
});
console.log(res.status, await res.text());
