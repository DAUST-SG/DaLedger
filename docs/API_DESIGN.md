# API Design — Finance Tracker

| | |
|---|---|
| **Base URL** | `https://<deployment>.convex.site` (HTTP actions) |
| **Protocol** | HTTPS only |
| **Auth method** | Officer app: Convex Auth session. Intake: per-source secret header. Webhook: HMAC-SHA256 signature. |
| **Format** | JSON (UTF-8) |
| **Version** | v1 |

> Note: officer-facing reads/writes go through **Convex queries & mutations** (typed RPC via the Convex client), not REST. The REST-style surface below is the **machine-to-machine HTTP layer**: the intake endpoint for the shop/DaBus backends and the Naboopay webhook. Both are implemented as Convex `httpAction`s.

## Design Principles

1. **Idempotent by key** — intake dedupes on `(source, externalId, kind)` where `kind ∈ {income, refund}`; sending the same record twice records it once, and a refund never collides with its original sale (ADR 0005).
2. **One capture point** — income is created only by the source backend's intake call; the Naboopay webhook/sweep never creates income, only matches or flags it.
3. **Verify at the edge** — intake validates the source key; the webhook verifies the HMAC over the **raw** body before parsing.
4. **Whole FCFA integers** — amounts are positive integers; non-integer or non-positive amounts are rejected.
5. **Never delete** — refunds and corrections are reversals (`reversalOf`), never deletions.
6. **Least authority** — each source has its own key so one can be revoked without affecting the others.
7. **Guarded, exactly-once transitions** — every in-place status change (mark paid, confirm/skip draft, assign category, enter partial, reverse) acts only from its expected current status and is a no-op otherwise, so double-taps and concurrent officers apply it once (ADR 0019, 0020).

## Authentication

**Officer app (queries/mutations):** handled by Convex Auth; the session identity is attached server-side and used for `recordedBy` and the audit log.

**Intake (shop / DaBus → tracker):**

```text
POST /intake/income
X-Intake-Key: <per-source secret>
Content-Type: application/json
```

**Naboopay webhook (Naboopay → tracker):**

```text
POST /intake/naboopay
X-Signature: <hex HMAC-SHA256 of the raw request body, key = NABOOPAY_WEBHOOK_SECRET>
Content-Type: application/json
```

<!-- assumed: exact signature header name to be confirmed with Naboopay; verification logic is header-name agnostic -->

**Public routes (no auth):** none. Every endpoint requires either a session, an intake key, or a valid signature.

## Resource Map

### Intake (HTTP actions)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/intake/income` | Record one confirmed shop/DaBus payment (idempotent) | `X-Intake-Key` |
| POST | `/intake/income/refund` | Reverse a previously recorded income by `externalId` | `X-Intake-Key` |
| POST | `/intake/naboopay` | Receive a signed Naboopay webhook event | `X-Signature` |

### Officer operations (Convex functions, shown as logical resources)

| Operation | Function | Description | Auth |
|-----------|----------|-------------|------|
| List balances | `balances.list` (query) | Live computed balances per account + SG total + School; `balanceAsOf(date)` for point-in-time (ADR 0016) | Session |
| Event view | `reports.event` (query) | **All-time** income/expense/net for one event, by category (ADR 0022) | Session |
| List transactions | `transactions.list` (query) | Filtered, paginated ledger | Session |
| Create transaction | `transactions.create` (mutation) | Manual income/expense/transfer/allocation/withdrawal/`adjustment_up`/`adjustment_down` | Session |
| Reverse transaction | `transactions.reverse` (mutation) | Create a `reversalOf` near-copy (same type/category/event, flipped by sign rule); at most one active reversal per target, no-op if already reversed (ADR 0020) | Session |
| Mark withdrawal paid | `transactions.markWithdrawalPaid` (mutation) | Guarded `committed` → `paid`, no-op otherwise (ADR 0003, 0019) | Session |
| Record payout | `transactions.recordPayout` (mutation) | Net transfer + "Provider fees" expense from gross-out/net-in (ADR 0015) | Session |
| Review inbox | `review.list` (query) | Unlabelled, unmatched, drafts | Session |
| Reconcile | `reconciliations.create` (mutation) | Record a check + optional adjustment | Session |
| Review report | `reports.term` (query) | **Period-scoped** (by `occurredAt`) totals by category/event, start/end `balanceAsOf`, full movement reconciliation, School movement, reconciliation history (ADR 0016, 0021) | Session |

## Error Responses

HTTP-layer errors use a consistent JSON shape:

```json
{
  "error": {
    "code": "DUPLICATE",
    "message": "A record for (shop, ORD-1042) already exists.",
    "existingId": "jd7c…"
  }
}
```

| Code | HTTP | Meaning |
|------|------|---------|
| `UNAUTHORIZED` | 401 | Missing/invalid intake key or webhook signature |
| `VALIDATION` | 422 | Non-integer/non-positive amount, missing required field |
| `DUPLICATE` | 200 | `(source, externalId, kind)` already recorded — returns existing record, creates nothing |
| `NOT_FOUND` | 404 | Refund references an unknown `externalId` — the tracker also surfaces it as a Needs-review item rather than creating a dangling reversal (ADR 0005) |
| `RATE_LIMITED` | 429 | Too many requests |
| `SERVER_ERROR` | 500 | Unexpected failure |

> `DUPLICATE` returns **200** (not an error status) because idempotent replay is a success case for the caller.

## Pagination Shape

Officer list queries use Convex cursor pagination:

```json
{
  "page": [ { "_id": "…", "amount": 253650, "reason": "Catering" } ],
  "isDone": false,
  "continueCursor": "eyJ…"
}
```

## Rate Limiting

| Category | Limit | Notes |
|----------|-------|-------|
| `/intake/income` | 60 req/min per source key <!-- assumed --> | Backends retry on failure; duplicates are safe |
| `/intake/naboopay` | 120 req/min <!-- assumed --> | Bursty on settlement |
| Outbound to Naboopay | ≤ 100 req/60 s | Hard limit imposed by Naboopay; sweep paginates |
| Officer queries/mutations | Convex platform defaults | Small closed user set |
