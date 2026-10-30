# API Contract — Finance Tracker

Full request/response shapes for the machine-to-machine HTTP layer and the core officer operations. All amounts are **whole FCFA integers, positive**. All JSON is UTF-8.

---

## Intake

### POST /intake/income

Record one confirmed shop/DaBus payment. Idempotent on `(source, externalId, kind)` with `kind=income` (ADR 0005).

**For the shop and DaBus backends**
- Call this **only on the transition to `paid`**, never at checkout. There is no "pending" path, so an unpaid order can never appear.
- Retry on any 5xx, a `429`, or a network error. On `429`, wait at least the `Retry-After` seconds first (ADR 0005, amended). Retries are safe: a repeat returns `200` with `duplicate: true` and creates nothing.
- **Category:** send `category` if you know it. The tracker uses it if it names an income category, else your source's default, else `Unlabeled` for an officer to label (ADR 0029). A category is never a reason for an error.
- **Event:** an unknown or closed event name is dropped, not rejected; the sale is still recorded.

**Request**

```json
{
  "source": "shop",                       // required — identified by X-Intake-Key; must match
  "externalId": "ORD-1042",               // required — order/booking id in the source system
  "amount": 253650,                        // required — whole FCFA, positive
  "paidAt": "2026-10-13T12:04:00Z",       // required — when Naboopay confirmed payment; not in the future, not before cutover
  "description": "Hoodie x3 — Integration Week", // required — becomes the reason
  "naboopayReference": "order_9fA…",       // required — Naboopay order_id, for matching
  "category": "Shop sales",                // optional — overrides source default
  "event": "Integration Week"              // optional — event name or id
}
```

**Response (success) — 201 Created**

```json
{
  "id": "jd7c8s…",
  "status": "confirmed",
  "duplicate": false,
  "accountId": "naboopay",
  "amount": 253650
}
```

**Response (idempotent replay) — 200 OK**

```json
{
  "id": "jd7c8s…",
  "status": "confirmed",
  "duplicate": true
}
```

**Response (error) — 401 Unauthorized**

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Unknown or revoked intake key." } }
```

**Response (error) — 422 Unprocessable**: a field is missing, blank (whitespace only counts as blank) or invalid, or `paidAt` is more than 10 minutes in the future or before cutover (a pre-cutover sale is already in the opening balance, ADR 0018). Nothing is written; fix the data, do not retry as is.

```json
{ "error": { "code": "VALIDATION", "message": "That date is before cutover; the opening balance already includes it (ADR 0018)." } }
```

**Response (error) — 429 Too Many Requests**, with a `Retry-After` header (seconds). Each source may send about 60 requests a minute with bursts up to 120, shared with refunds. Requests with a bad key are capped together (about 30 a minute, bursts up to 60) and then also get 429. Nothing is written; retry after the delay.

```json
{ "error": { "code": "RATE_LIMITED", "message": "Too many requests. Retry after the Retry-After delay; retries are safe." } }
```

---

### POST /intake/income/refund

Reverse a previously recorded income.

**Request**

```json
{
  "source": "shop",          // required
  "externalId": "ORD-1042",  // required — the original order
  "reason": "Customer refund — defective item" // optional
}
```

**Response (success) — 201 Created**

```json
{
  "reversalId": "k1b…",
  "reversalOf": "jd7c8s…",
  "amount": 253650
}
```

> `amount` is always a **positive** integer (ADR 0007); the reversal's cancelling
> effect comes from the `reversalOf` link (the −1 sign rule, ADR 0002), not a
> negative amount. The data model stores **only `reversalOf`** — there is no
> `isReversal` column; a consumer derives "is a reversal" from `reversalOf != null`.

**Response (error) — 404 Not Found**

```json
{ "error": { "code": "NOT_FOUND", "message": "No income found for (shop, ORD-1042). Retry later." } }
```

> **Backends must treat this 404 as retryable**, not as a final client error.
> Nothing is written. The usual cause is a refund that reached the tracker before
> its sale did; the next retry, after the sale lands, creates the reversal. A sale
> that was never captured is caught by the M5 sweep (ADR 0026) and by Naboopay
> reconciliation (ADR 0005, amended).

**Response (already refunded) — 200 OK** — a repeat, or a sale an officer already reversed by hand (ADR 0020). Nothing new is written.

```json
{ "reversalId": "k1b…", "duplicate": true }
```

---

### POST /intake/naboopay

Receive a signed Naboopay webhook. The handler reads the **raw body**, verifies `X-Signature`, then matches.

**Request** (body as sent by Naboopay, webhook payload v2 — ADR 0026; abridged)

```json
{
  "order_id": "550e8400-e29b-41d4-a716-446655440000",
  "selected_payment_method": "wave",
  "amount": 253650,
  "fees": 5073,
  "fees_customer_side": true,
  "currency": "XOF",
  "transaction_status": "paid",
  "products": [{ "name": "Hoodie", "price": 84550, "quantity": 3 }],
  "created_at": "2026-10-13T12:00:00Z",
  "paid_at": "2026-10-13T12:04:00Z"
}
```

Webhooks fire when a transaction becomes paid. `transaction_status` is `paid` or `paid_and_blocked` (both treated as paid). Deliveries can repeat, so matching is idempotent. Refunds are performed in Naboopay (`GET /refund/{order_id}`), never by the tracker.

The webhook **creates nothing** (ADR 0008): on a match it confirms, on a non-match it does nothing. Unmatched payments are surfaced later by the scheduled sweep after a grace window — not by this handler.

**Response (matched) — 200 OK**

```json
{ "matched": true, "incomeId": "jd7c8s…" }
```

**Not configured — 503** if `NABOOPAY_WEBHOOK_SECRET` is not set on the deployment.

**Response (no match) — 200 OK**

```json
{ "matched": false, "action": "none", "note": "left to the safety-net sweep after the grace window" }
```

**Response (error) — 401 Unauthorized**

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Invalid webhook signature." } }
```

**Response (error) — 429 Too Many Requests**, with `Retry-After`: past about 120 signed calls a minute (bursts up to 240), or once the shared cap on bad signatures is spent. Safe, because the webhook writes nothing and the sweep catches up.

---

## Officer operations (Convex functions)

Shown as request args → return shape. Called via the Convex client, not REST; a session identity is required for all.

### query balances.list

**Request**

```json
{}
```

**Response (success)**

```json
{
  "accounts": [
    { "accountId": "naboopay", "name": "Naboopay", "balance": 1250000 },
    { "accountId": "wave", "name": "Wave", "balance": 430000 },
    { "accountId": "om", "name": "Orange Money", "balance": 210500 },
    { "accountId": "cash", "name": "Cash", "balance": 85000 }
  ],
  "totalHeld": 1975500,
  "school": { "balance": 3000000, "committed": 500000 },
  "lastReconciled": { "naboopay": "2026-10-10", "wave": "2026-10-08" }
}
```

### mutation transactions.create

**Request**

```json
{
  "type": "expense",            // income | expense | transfer | allocation | school_withdrawal | adjustment_up | adjustment_down
  "amount": 253650,             // required, positive integer FCFA
  "accountId": "cash",          // required (source account for a transfer / paid withdrawal)
  "toAccountId": null,          // required for transfer / school_withdrawal
  "reason": "Catering — Gala",  // required
  "categoryId": "catering",     // required ONLY for income/expense, direction-matched; omit otherwise (ADR 0009)
  "eventId": "gala-2026",       // optional
  "occurredAt": "2026-10-13T18:00:00Z", // optional, defaults to now; not in the future (10 min skew), not before cutover
  "receiptUrl": null             // optional
}
```

The same date window applies to `transactions.reverse`, `transactions.markWithdrawalPaid` and `recurring.confirmDraft` (ADR 0016, 0018).

**Response (success)**

```json
{ "id": "n4k…", "status": "confirmed", "accountId": "cash", "newBalance": 85000 }
```

**Response (error)**

```json
{ "error": { "code": "VALIDATION", "message": "A reason is required." } }
```

### mutation transactions.reverse

**Request**

```json
{ "transactionId": "n4k…", "reason": "Entered on wrong account" }
```

**Response (success)**

```json
{ "reversalId": "p9x…", "reversalOf": "n4k…" }
```

Only an entry that counts (`confirmed`, `paid`, `needs_review`) or a `memo` can be reversed. A `draft` is skipped instead (ADR 0012), a `committed` withdrawal is cancelled (ADR 0028), and `skipped`/`cancelled` rows moved no money. A memo's reversal keeps the memo's date, so it nets out in the same period.

### mutation transactions.createMemo

A pre-cutover event summary (ADR 0011): report-only, never in a balance.

```json
{
  "type": "income",             // income | expense
  "amount": 400000,             // positive integer FCFA
  "reason": "Gala ticket sales, from the 2025 Excel",
  "categoryId": "fundraising",  // direction-matched
  "eventId": "gala-2025",       // required, open event
  "occurredAt": "2025-06-01T12:00:00Z" // required, before cutover
}
```

**Response (success)**

```json
{ "id": "m2q…" }
```

### mutation reconciliations.create

**Request**

```json
{
  "accountId": "cash",
  "realBalance": 84000,          // counted/observed
  "adjust": true,                // create an adjustment for the difference?
  "reason": "Till short 1 000 FCFA — unrecorded snack purchase"
}
```

**Response (success)**

```json
{
  "reconciliationId": "rc1…",
  "computedBalance": 85000,
  "realBalance": 84000,
  "difference": -1000,
  "adjustmentId": "adj7…",
  "adjustmentType": "adjustment_down"
}
```

> `difference = real − computed`; a negative difference yields an `adjustment_down`,
> a positive one an `adjustment_up` (ADR 0001). The School receivable reconciles
> against the university statement, not a cash count (ADR 0004). A later
> back-dated entry marks this reconciliation stale (ADR 0010).

### query reports.term

**Request**

```json
{ "from": "2026-09-01", "to": "2026-12-31" }
```

**Response (success)**

```json
{
  "openingTotal": 1500000,
  "closingTotal": 1975500,
  "byCategory": [
    { "category": "Shop sales",  "income": 426500, "expense": 0 },
    { "category": "Sponsorship", "income": 200000, "expense": 0 },
    { "category": "Catering",    "income": 0,      "expense": 450000 },
    { "category": "Venue",       "income": 0,      "expense": 200000 }
  ],
  "byEvent": [ { "event": "Gala", "income": 200000, "expense": 650000, "net": -450000 } ],
  "movement": {
    "startTotalHeld": 1500000,
    "income": 626500,
    "expense": 650000,
    "paidWithdrawalsIn": 500000,
    "netAdjustments": -1000,
    "transfers": 0,
    "endTotalHeld": 1975500
  },
  "school": { "allocations": 3500000, "paidWithdrawals": 500000, "balance": 3000000 },
  "reconciliations": [
    { "accountId": "naboopay", "date": "2026-10-10", "difference": 0 },
    { "accountId": "cash",     "date": "2026-10-12", "difference": -1000 }
  ]
}
```

> This example reconciles on every axis: account balances
> (1 250 000 + 430 000 + 210 500 + 85 000 = 1 975 500 = `closingTotal` =
> `endTotalHeld`); the movement identity
> (1 500 000 + 626 500 − 650 000 + 500 000 − 1 000 + 0 = 1 975 500); `byCategory`
> income/expense sums (626 500 / 650 000) equal `movement.income`/`expense`; the
> −1 000 `netAdjustments` matches the Cash reconcile.

> `movement` is the full period reconciliation (ADR 0021): `startTotalHeld +
> income − expense + paidWithdrawalsIn ± netAdjustments + transfers =
> endTotalHeld`. Every change in total held is on a labelled line — nothing
> unexplained. All figures are period-scoped by `occurredAt` (ADR 0016).
