# Architecture — Finance Tracker

| | |
|---|---|
| **Version** | 1.0 |
| **Last Updated** | 2026-10-13 |

## 1. Overview

Finance Tracker is a **reactive monolith**: a React + Vite single-page app talking to a single Convex backend. There is deliberately no separate API server, database server, realtime layer, or cron runner — Convex provides all four. The design philosophy is *computed truth*: no balance is ever stored or typed; every balance is a pure function of an opening balance plus an append-only transaction log. Convex **live queries** push recomputed balances to every connected device the instant a transaction is written, which is what makes "record fast, trust the number" possible. External events (shop/DaBus income, Naboopay webhooks) enter through idempotent HTTP actions; periodic work (safety-net sweep, monthly drafts) runs as scheduled functions.

## 2. System Diagram

```mermaid
flowchart TD
    subgraph Client["Phone / Browser (React + Vite SPA)"]
        UI[Officer UI\nHome · Add · Inbox · Reconcile · Report]
    end

    subgraph Convex["Convex Backend"]
        Q[Queries\nlive balances, lists]
        M[Mutations\nmanual entry, reversal, adjust]
        H[HTTP Actions\n/intake/income\n/intake/naboopay]
        C[Scheduled Functions\nsafety-net sweep\nmonthly drafts]
        DB[(Convex DB\naccounts · transactions\ncategories · events\nreconciliations · users\nauditLog · recurringTemplates)]
        A[Convex Auth]
    end

    subgraph External["SG-controlled & third-party"]
        SHOP[Shop backend]
        DABUS[DaBus backend]
        NABOO[Naboopay API\napi.naboopay.com/api/v2]
    end

    UI <-->|live queries / mutations| Q
    UI --> M
    UI --> A
    Q --- DB
    M --- DB
    H --- DB
    C --- DB
    SHOP -->|POST paid order + secret key| H
    DABUS -->|POST paid order + secret key| H
    NABOO -->|signed webhook| H
    C -->|GET /transactions, /payouts, /accounts| NABOO
    SHOP -->|create-transaction| NABOO
    DABUS -->|create-transaction| NABOO
```

## 3. Components

### Frontend — React + Vite SPA
- **Purpose:** Phone-first UI for finance officers.
- **Key pages/routes:** `/` (Home), `/add` (Add transaction), `/review` (Needs-review inbox), `/transactions` (list + filters + CSV), `/events/:id` (Event view), `/reconcile` (Reconcile), `/report` (Review report), `/recurring` (v1.1), `/login`.
- **Framework:** React 18, Vite, TypeScript, React Router, Convex React client.
- **Key responsibilities:** render live balances, capture manual entries in < 10 s, surface the review inbox, never compute financial truth client-side (display only).

### Backend — Convex functions
- **Purpose:** The single source of truth and all business logic.
- **Key modules:** `transactions.ts`, `balances.ts`, `reconciliations.ts`, `recurring.ts`, `http.ts`, `naboopay.ts`, `crons.ts`.
- **Framework:** Convex (queries, mutations, httpAction, scheduled functions).
- **Key responsibilities:** enforce the design rules (computed balances, reason required, nothing deleted, one capture point, transfers neutral, integer FCFA, idempotent intake), **guard every in-place status transition by expected-current-status so it applies exactly once** (ADR 0019), enforce **at most one active reversal per target** (ADR 0020), compute **point-in-time balances by `occurredAt`** for reports (ADR 0016), write the audit log, verify webhooks over the raw body.

### Database — Convex store
- **Purpose:** Persist the ledger and supporting tables.
- **Tables:** `accounts`, `transactions`, `categories`, `events`, `reconciliations`, `users`, `auditLog`, `recurringTemplates`.
- **Key responsibilities:** hold the append-only transaction log; indexes for balance computation, matching (`source + externalId`, `naboopayReference`), and the review inbox.

### Auth — Convex Auth
- **Purpose:** Gate the app to the closed officer set.
- **Key responsibilities:** authenticate officers, expose identity to mutations so `recordedBy` is trustworthy. Intake keys and the webhook secret are **separate** from user auth.

## 4. Key Data Flows

1. **Officer records a manual expense:** UI form → `mutations.createTransaction` → validates (reason, positive integer amount, account) → inserts transaction + audit entry → live `balances` query recomputes → every device updates.
2. **Shop sale (automatic income):** customer pays via Naboopay → shop backend confirmed → `POST /intake/income` with source key + `externalId` (+ `kind=income`) + `naboopayReference` → httpAction checks key, dedupes on `(source, externalId, kind)`, inserts income (status `confirmed`) on Naboopay account.
3. **Naboopay webhook:** Naboopay `POST /intake/naboopay` → httpAction reads **raw body**, verifies HMAC-SHA256 (`X-Signature`) → matches `order_id` to an income's `naboopayReference`. The webhook **creates nothing**: on a match it confirms, on a non-match it does nothing — removing the webhook-vs-intake race (ADR 0008).
4. **Safety-net sweep (scheduled):** cron calls `GET /transactions` → a `paid`/`paid_and_blocked` `order_id` still unmatched **after a ~30-min grace window** is inserted once as `needs_review` (deduped by `order_id`, self-healing when the real income arrives). A `refunded` order whose income has no reversal is flagged the same way (ADR 0008, 0026). Each run reads from 7 days before the last successful run (from cutover on the first run, or with `full: true`) and writes in batches of 100, so the work stays bounded as history grows; every write is idempotent, so a failed batch is redone by the next run.
5. **Reconciliation:** officer enters real balance → `reconciliations.create` stores computed, real, difference → optional `adjustment_up`/`adjustment_down` transaction with reason → audit entry. A later back-dated entry flips the account to "needs re-checking" (ADR 0010).
6. **Refund:** the refund itself is done in Naboopay (`GET /refund/{order_id}`), never by the tracker; the source then calls the tracker's refund endpoint with original `externalId` → tracker finds the original by `(source, externalId, income)` and writes a reversal keyed `(source, externalId, refund)` — independently idempotent (ADR 0005).
7. **Naboopay payout with fee:** a payout sweep reads `GET /payouts` and records each completed payout once (idempotent on its `order_id`); the manual "record a payout" fallback takes gross-out and net-in. Either way it writes a **transfer of the net amount** + a **"Provider fees" expense** for the fee, keeping transfers neutral (ADR 0015, 0026).
8. **Monthly recurring draft (scheduled, v1.1):** cron creates ≤ 1 `draft` expense per active template per month → appears in inbox → officer confirms (edits then counts) or skips (terminal `skipped`, not recreated) (ADR 0012).
9. **Term report:** `reports.term(from, to)` → `balanceAsOf(start−1)` and `balanceAsOf(end)` by `occurredAt` → period entries grouped by category/event → a full **movement reconciliation** (`start + income − expense + paid-withdrawals-in ± adjustments + transfers = end`) so nothing is unexplained (ADR 0016, 0021). Event view uses the same engine all-time; the report uses it period-scoped (ADR 0022).

## 5. External Services

| Service | Purpose | Notes / Cost |
|---------|---------|--------------|
| Convex | Backend, DB, auth, HTTP, cron, live queries | Free tier likely sufficient for SG volume <!-- assumed --> |
| Naboopay | Payment gateway for shop/DaBus; income & balance data | `…/api/v2` (ADR 0026); Bearer auth, `read` scope; no sandbox; rate limit 100 req/60 s; webhook and payout feed report exact fees |
| Static host (Vite build) | Serve the SPA | Vercel/Netlify free tier <!-- assumed --> |
| Shop backend | Reports confirmed sales to intake | SG-controlled; needs a small integration change |
| DaBus backend | Reports confirmed bookings to intake | SG-controlled; needs a small integration change |

## 6. Scalability Notes

- **Volume** is small (one student government); Convex live queries and the single-table ledger are far within free-tier limits.
- **Balance computation** is O(transactions per account). If a term's volume grows large, add periodic **balance checkpoints** (store a computed balance at a reconciliation point and sum only transactions since) — not needed for v1.
- **Naboopay rate limit** (100 req/60 s): the sweep lists transactions in pages on a schedule rather than calling per-item.
- **Offline:** v1 relies on Convex's native reconnect queue; a persistent IndexedDB outbox can be added later without backend changes, since intake/mutations are idempotent.
