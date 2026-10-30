# Integration guide — reporting payments to DaLedger

For the developers of any SG website that takes payments through Naboopay (the
shop, DaBus, and any future site). It is the short, practical version of
[API_CONTRACT.md](API_CONTRACT.md); where they differ, the contract wins.

**Why this matters.** DaLedger also reads Naboopay directly, so no payment is
ever lost. But Naboopay does not say which site created an order: a payment your
site does not report shows up as **"Unreported Naboopay payment — Needs a
label"** and an officer has to label it by hand. Reporting each sale is what
makes it arrive already labelled.

---

## 1. Setup (once per site, per environment)

| What | Rule |
|---|---|
| Source name | Lowercase, e.g. `dabus`. Agreed with the Treasurer. |
| Intake key | Random, **at least 16 characters**, one per site and per environment (dev ≠ prod). The Treasurer sets it on the ledger (`INTAKE_SOURCES`, `INTAKE_KEY_<SOURCE>`, [SECURITY.md §4](SECURITY.md)) and gives you your copy. |
| Where the key lives | Only in your **backend** environment variables. Never in browser code, never committed. |
| Base URL — dev | `https://bold-capybara-609.eu-west-1.convex.site` |
| Base URL — prod | `https://determined-canary-447.eu-west-1.convex.site` |

Use the dev URL and dev key from your own dev or staging environment, and the
prod pair only in production.

A **new** site (beyond `shop` and `dabus`) also needs its default category added
in `convex/intake.ts` (`SOURCE_DEFAULT_CATEGORY`); until then, send `category` on
every request or its sales land unlabelled.

## 2. Creating the Naboopay transaction

- Create it with **`fees_customer_side: true`**, so the SG receives the full price (ADR 0026).
- **Store Naboopay's returned `order_id`** on your order. It links your sale to the money.

## 3. Report each sale when it becomes paid

Call this **only on the transition to `paid`**, never at checkout or while
pending. There is no "pending" path.

```
POST {base}/intake/income
Content-Type: application/json
X-Intake-Key: <your key>
```

```json
{
  "source": "dabus",
  "externalId": "BOOK-5531",
  "amount": 3000,
  "paidAt": "2026-10-30T11:41:00Z",
  "description": "Bus ticket Dakar → Diamniadio",
  "naboopayReference": "4bc00085-e5c4-4ad6-8c1d-6e0c0328e4a8",
  "category": "DaBus",
  "event": "Integration Week"
}
```

| Field | Required | Rule |
|---|---|---|
| `source` | yes | Must be the source your key belongs to, or `401`. |
| `externalId` | yes | Your own order/booking id. Unique within your site; never reused. |
| `amount` | yes | Whole FCFA, positive, **exactly the Naboopay order amount** — no decimals, no fees added. |
| `paidAt` | yes | ISO 8601 date-time when Naboopay confirmed payment. |
| `description` | yes | Human-readable; becomes the reason in the ledger. Max 500 characters. |
| `naboopayReference` | yes | Naboopay's `order_id`. |
| `category` | no | An income category name. If missing or unknown, your site's default is used (`shop` → "Shop sales", `dabus` → "DaBus"). Never an error. |
| `event` | no | An event name or id. Unknown or closed events are ignored; the sale is still recorded. |

Example with curl:

```bash
curl -X POST "$LEDGER_URL/intake/income" \
  -H "Content-Type: application/json" \
  -H "X-Intake-Key: $LEDGER_INTAKE_KEY" \
  -d '{"source":"dabus","externalId":"BOOK-5531","amount":3000,"paidAt":"2026-10-30T11:41:00Z","description":"Bus ticket","naboopayReference":"4bc00085-e5c4-4ad6-8c1d-6e0c0328e4a8"}'
```

## 4. Report refunds

```
POST {base}/intake/income/refund
Content-Type: application/json
X-Intake-Key: <your key>
```

```json
{ "source": "dabus", "externalId": "BOOK-5531", "reason": "Trip cancelled" }
```

Use the **original** `externalId`. There is no amount: the whole sale is reversed.

## 5. Handle the response

| Status | Meaning | What your backend does |
|---|---|---|
| `201` | Recorded | Done. |
| `200` with `"duplicate": true` | Already recorded | Done — this is a success. |
| `401` | Bad key, or `source` does not match the key | Stop. Fix the configuration; do not retry. |
| `422` | A field is invalid (the message names it) | Stop. Fix the data; do not retry as is. |
| `404` (refund only) | The sale has not reached the ledger yet | **Retry later** (ADR 0005, amended). |
| `429` | Too many requests | Retry after the `Retry-After` header (seconds). |
| `5xx` or network error | Temporary | **Retry** with backoff. |

Retries are always safe: the same `(source, externalId)` never creates a second
record. The simplest reliable design is a "reported" flag on each order plus a
background job that retries unreported ones — e.g. after 1 min, 5 min, 30 min,
then hourly — until it gets `200` or `201`.

## 6. Timing and limits

- Report within **30 minutes** of payment. After that, the ledger's own Naboopay
  check (every 15 minutes) records the payment as "Unreported". A late report
  still turns that row into your labelled sale, with nothing counted twice
  (ADR 0031) — but on time is the goal.
- About **60 requests a minute per site**, bursts up to 120, shared by sales and
  refunds. Over that you get `429`.

## 7. Checklist before going live

- [ ] Naboopay transactions created with `fees_customer_side: true`; `order_id` stored.
- [ ] Sale reported on the transition to `paid`, with `naboopayReference` = `order_id` and `amount` = the Naboopay amount.
- [ ] Refunds reported with the original `externalId`.
- [ ] Retries on `5xx`, `429`, network errors, and refund `404`; no retry on `401` / `422`.
- [ ] Key only in backend env vars; separate dev and prod keys.
- [ ] Tested against dev: a sale appears in DaLedger already labelled, a repeat returns `duplicate: true`, a refund reverses it.
