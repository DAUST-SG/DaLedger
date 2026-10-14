# API Contract — Finance Tracker

Full request/response shapes for the machine-to-machine HTTP layer and the core officer operations. All amounts are **whole FCFA integers, positive**. All JSON is UTF-8.

---

## Intake

### POST /intake/income

Record one confirmed shop/DaBus payment. Idempotent on `(source, externalId, kind)` with `kind=income` (ADR 0005).

**Request**

```json
{
  "source": "shop",                       // required — identified by X-Intake-Key; must match
  "externalId": "ORD-1042",               // required — order/booking id in the source system
  "amount": 253650,                        // required — whole FCFA, positive
  "paidAt": "2026-10-13T12:04:00Z",       // required — when Naboopay confirmed payment
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
  "amount": -253650
}
```

**Response (error) — 404 Not Found**

```json
{ "error": { "code": "NOT_FOUND", "message": "No income found for (shop, ORD-1042)." } }
```

---

### POST /intake/naboopay

Receive a signed Naboopay webhook. The handler reads the **raw body**, verifies `X-Signature`, then matches.

**Request** (body as sent by Naboopay — `WebhookModel`)

```json
{
  "order_id": "order_9fA…",
  "amount": 253650,
  "currency": "XOF",
  "created_at": "2026-10-13T12:04:00",
  "transaction_status": "paid"
}
```

The webhook **creates nothing** (ADR 0008): on a match it confirms, on a non-match it does nothing. Unmatched payments are surfaced later by the scheduled sweep after a grace window — not by this handler.

**Response (matched) — 200 OK**

```json
{ "matched": true, "incomeId": "jd7c8s…" }
```

**Response (no match) — 200 OK**

```json
{ "matched": false, "action": "none", "note": "left to the safety-net sweep after the grace window" }
```

**Response (error) — 401 Unauthorized**

```json
{ "error": { "code": "UNAUTHORIZED", "message": "Invalid webhook signature." } }
```

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
  "occurredAt": "2026-10-13T18:00:00Z", // optional, defaults to now
  "receiptUrl": null             // optional
}
```

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
  "byCategory": [ { "category": "Shop sales", "income": 1200000, "expense": 0 } ],
  "byEvent": [ { "event": "Gala", "income": 800000, "expense": 650000, "net": 150000 } ],
  "movement": {
    "startTotalHeld": 1500000,
    "income": 1200000,
    "expense": 650000,
    "paidWithdrawalsIn": 500000,
    "netAdjustments": -1000,
    "transfers": 0,
    "endTotalHeld": 1975500
  },
  "school": { "allocations": 3500000, "paidWithdrawals": 500000, "balance": 3000000 },
  "reconciliations": [ { "accountId": "naboopay", "date": "2026-10-10", "difference": 0 } ]
}
```

> `movement` is the full period reconciliation (ADR 0021): `startTotalHeld +
> income − expense + paidWithdrawalsIn ± netAdjustments + transfers =
> endTotalHeld`. Every change in total held is on a labelled line — nothing
> unexplained. All figures are period-scoped by `occurredAt` (ADR 0016).
