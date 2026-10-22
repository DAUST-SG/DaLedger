# Implementation Roadmap — Finance Tracker

| | |
|---|---|
| **Version** | 1.0 |
| **Last Updated** | 2026-10-13 |
| **Total Sprints** | 8 |
| **Sprint Length** | 1 week <!-- assumed --> |

> **Sprints → PRD milestones:** the 8 sprints deliver the PRD's 7 milestones.
> **M1 spans two sprints** — Sprint 1 (Foundation & schema) + Sprint 2 (Auth &
> manual entry, which carries the M1 acceptance) — then Sprint 3 → M2,
> Sprint 4 → M3, Sprint 5 → M4, Sprint 6 → M5, Sprint 7 → M6, Sprint 8 → M7. So
> the overall schedule is ~8 weeks (one week past the earliest per-milestone
> dates); PRD §8 carries the aligned dates.

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Done |
| 🔄 | In Progress |
| 📋 | Planned |
| ⏸ | Blocked |

---

#### Sprint 1 — Foundation & schema
**Goal:** Prove the ledger model: data in, computed balance out.
**Deliverable:** Seeded accounts with opening balances; a hand-inserted transaction changes the computed balance.

| # | Task | Type | Files Involved | Status |
|---|------|------|----------------|--------|
| 1 | Define all tables + indexes | `infra` | `convex/schema.ts` | 📋 |
| 2 | Shared TS types | `chore` | `src/types.ts` | 📋 |
| 3 | FCFA format/parse helpers | `feat` | `src/lib/fcfa.ts` | 📋 |
| 4 | Seed 5 accounts + opening balances | `infra` | `convex/seed.ts` | 📋 |
| 5 | Computed-balance live query | `feat` | `convex/balances.ts` | 📋 |

**Definition of Done:**
- [ ] `balances.list` returns correct totals from opening balance + transactions.
- [ ] School balance is separate and excluded from the SG total.

---

#### Sprint 2 — Auth & manual entry
**Goal:** An officer logs in and records a transaction from a phone.
**Deliverable:** M1 acceptance — phone entry changes the right balance live on every device; transfer keeps total unchanged; reversal restores.

| # | Task | Type | Files Involved | Status |
|---|------|------|----------------|--------|
| 1 | Convex Auth + officer guard | `infra` | `convex/auth.config.ts`, `convex/auth.ts` | 📋 |
| 2 | Login page + authed shell | `feat` | `src/routes/Login.tsx`, `src/main.tsx` | 📋 |
| 3 | `transactions.create` (+ validation, audit) | `feat` | `convex/transactions.ts`, `convex/audit.ts` | 📋 |
| 4 | `transactions.reverse` (one active reversal, guarded) + transfer/withdrawal; guarded status transitions (ADR 0019, 0020) | `feat` | `convex/transactions.ts` | 📋 |
| 5 | Add-transaction form + Home | `feat` | `src/routes/AddTransaction.tsx`, `src/routes/Home.tsx` | 📋 |

**Definition of Done:**
- [ ] Form will not save without a reason; amount is positive integer FCFA.
- [ ] Transfer does not change the total held; reversal restores the balance.
- [ ] Every write appears in the audit log.

---

#### Sprint 3 — Automatic income intake
**Goal:** Shop/DaBus income flows in exactly once.
**Deliverable:** M2 acceptance — same order twice = one transaction; unpaid never appears; bad key rejected; refund creates a reversal.

| # | Task | Type | Files Involved | Status |
|---|------|------|----------------|--------|
| 1 | httpRouter + `/intake/income` | `feat` | `convex/http.ts` | 📋 |
| 2 | Source-key resolution + 401 | `infra` | `convex/http.ts` | 📋 |
| 3 | Idempotency on `(source, externalId, kind)` | `feat` | `convex/http.ts`, `convex/schema.ts` | 📋 |
| 4 | `/intake/income/refund` → reversal keyed `kind=refund`; no-match → needs_review | `feat` | `convex/http.ts` | 📋 |
| 5 | Intake tests (dup, unpaid, bad key, refund) | `chore` | `convex/http.test.ts` | 📋 |

**Definition of Done:**
- [ ] Duplicate POST returns the existing record and creates nothing.
- [ ] Unknown key → 401; non-integer/negative amount → 422.
- [ ] Refund creates a `reversalOf` the original income.

---

#### Sprint 4 — Review inbox, filters, event view, CSV
**Goal:** Nothing is lost; everything is findable.
**Deliverable:** M3 acceptance — unlabelled items in the inbox; event totals match the list; filtered CSV export.

| # | Task | Type | Files Involved | Status |
|---|------|------|----------------|--------|
| 1 | Needs-review query + label mutation | `feat` | `convex/review.ts` | 📋 |
| 2 | Review page + Home badge | `feat` | `src/routes/Review.tsx`, `src/routes/Home.tsx` | 📋 |
| 3 | Transactions list + filters | `feat` | `convex/transactions.ts`, `src/routes/Transactions.tsx` | 📋 |
| 4 | CSV export from active filter | `feat` | `src/lib/csv.ts` | 📋 |
| 5 | Event rollup view | `feat` | `convex/reports.ts`, `src/routes/EventView.tsx` | 📋 |

**Definition of Done:**
- [ ] Every captured item without a label is in the inbox.
- [ ] Event totals reconcile with the transactions list.
- [ ] CSV reflects the active filters.

---

#### Sprint 5 — Reconciliation & audit log
**Goal:** The ledger can be proven against reality.
**Deliverable:** M4 acceptance — differences recorded and fixable via adjustment; every edit audited.

| # | Task | Type | Files Involved | Status |
|---|------|------|----------------|--------|
| 1 | `reconciliations.create` + adjustment (by sign); opening-balance correction as cutover-dated adjustment (ADR 0018); negative-School warn/flag (ADR 0017) | `feat` | `convex/reconciliations.ts` | 📋 |
| 2 | Reconcile flow UI | `feat` | `src/routes/Reconcile.tsx` | 📋 |
| 3 | Last-check-date per account on Home | `feat` | `convex/reconciliations.ts`, `src/routes/Home.tsx` | 📋 |
| 4 | Audit log viewer (read-only) | `feat` | `src/routes/Transactions.tsx` | 📋 |

**Definition of Done:**
- [ ] A difference is resolved with a reasoned `adjustment_up`/`adjustment_down` (by sign of `real − computed`).
- [ ] A back-dated entry on/before a check flips that account to "needs re-checking" (ADR 0010).
- [ ] Audit log shows who/when/what (changed fields) for every edit.

---

#### Sprint 6 — Naboopay integration
**Goal:** Webhook matching + safety net + payout capture + balance read, on Naboopay API v2 (ADR 0026).
**Deliverable:** M5 acceptance — valid webhook matched; tampered rejected; unmatched payment in inbox; completed payouts captured with their fees; refunded orders flagged.

| # | Task | Type | Files Involved | Status |
|---|------|------|----------------|--------|
| 1 | Naboopay v2 client (verify, `GET /transactions`, `GET /payouts`, `GET /accounts`; key scope `read`) | `feat` | `convex/naboopay.ts` | 📋 |
| 2 | `/intake/naboopay` webhook (raw-body HMAC) — confirm-only, creates nothing (ADR 0008) | `feat` | `convex/http.ts` | 📋 |
| 3 | Match by `naboopayReference`; no action on no-match | `feat` | `convex/http.ts` | 📋 |
| 4 | Safety-net sweep cron: `paid`/`paid_and_blocked`, grace window, dedupe by `order_id`, self-heal; flag `refunded` orders with no reversal (ADR 0008, 0026) | `infra` | `convex/crons.ts` | ⏸ |
| 5 | Auto-reconcile Naboopay balance via `GET /accounts` | `feat` | `convex/naboopay.ts`, `convex/reconciliations.ts` | ⏸ |
| 6 | Payout sweep: `GET /payouts` → each completed payout once as a transfer + "Provider fees" expense (SG wallet) or an uncategorised expense in review (other wallet); no manual `recordPayout` in v1 (ADR 0015, 0032) | `feat` | `convex/sweep.ts` | 📋 |

**Definition of Done:**
- [ ] Valid signed webhook accepted; tampered body rejected; webhook creates no record.
- [ ] A paid payment unmatched after the grace window appears once in Needs-review; a `refunded` order with no reversal is flagged once.
- [ ] A completed Naboopay payout is captured once as a transfer + a "Provider fees" expense with the reported fee (ADR 0015, 0032).
- [ ] *(Blocked on a valid Naboopay **server API key** (scope `read`) for the sweeps + balance read.)*

---

#### Sprint 7 — Review report & polish
**Goal:** One-click term report + production-quality states.
**Deliverable:** M6 acceptance — report reproduces the transactions totals; loading/empty/error states everywhere.

| # | Task | Type | Files Involved | Status |
|---|------|------|----------------|--------|
| 1 | `reports.term` aggregation: `occurredAt`-scoped, `balanceAsOf` start/end, full movement reconciliation (ADR 0016, 0021) | `feat` | `convex/reports.ts`, `convex/balances.ts` | 📋 |
| 2 | Report page (by category/event, start/end, movement reconciliation, School) | `feat` | `src/routes/Report.tsx` | 📋 |
| 3 | Loading / empty / error states | `chore` | `src/components/*`, `src/routes/*` | 📋 |
| 4 | Offline reconnect handling (native queue) | `feat` | `src/main.tsx`, `src/hooks/*` | 📋 |

**Definition of Done:**
- [ ] Report totals reproduce the transactions list for the period (`occurredAt`-scoped).
- [ ] Start balance + movement lines (income/expense/paid-withdrawals-in/adjustments/transfers) = end balance, nothing unexplained (ADR 0021).
- [ ] Event view shows all-time net, labelled distinctly from the period report (ADR 0022).
- [ ] Every screen handles loading, empty, and error gracefully.

---

#### Sprint 8 — Recurring expenses (v1.1), testing & deploy
**Goal:** Monthly drafts + harden + ship.
**Deliverable:** M7 acceptance — one draft/template/month, no balance change until confirmed; security review passed; deployed.

| # | Task | Type | Files Involved | Status |
|---|------|------|----------------|--------|
| 1 | Recurring templates CRUD | `feat` | `convex/recurring.ts`, `src/routes/Recurring.tsx` | 📋 |
| 2 | Monthly draft generation cron | `infra` | `convex/crons.ts` | 📋 |
| 3 | Security review (per SECURITY.md) | `chore` | — | 📋 |
| 4 | Production deploy + env secrets | `infra` | `convex/*`, host config | 📋 |

**Definition of Done:**
- [ ] ≤ 1 draft per template per month; draft changes no balance until confirmed; skipped month creates nothing; overdue draft visible on Home.
- [ ] Secrets set in Convex env; no secrets in the client bundle.

---

## Full Feature Checklist

- [ ] Ledger with computed live balances — Sprint 1–2
- [ ] Officer login & audit attribution — Sprint 2
- [ ] Manual entry (all types) + reversals — Sprint 2
- [ ] Automatic shop/DaBus income intake (idempotent) — Sprint 3
- [ ] Refund → reversal — Sprint 3
- [ ] Needs-review inbox — Sprint 4
- [ ] Filters + CSV export — Sprint 4
- [ ] Event view — Sprint 4
- [ ] Reconciliation + adjustments — Sprint 5
- [ ] Audit log — Sprint 2 (write) / Sprint 5 (view)
- [ ] Naboopay webhook matching — Sprint 6
- [ ] Safety-net sweep — Sprint 6 (⏸ server key)
- [ ] Auto-reconcile Naboopay balance — Sprint 6 (⏸ server key)
- [ ] Payout capture (sweep; no manual `recordPayout` in v1, ADR 0032) — Sprint 6
- [ ] End-of-term review report — Sprint 7
- [ ] Offline reconnect (native) — Sprint 7
- [ ] Recurring expense templates (v1.1) — Sprint 8

## v2 backlog (deferred, not scheduled)

- [ ] Funds: split the total held by event / fundraising campaign + a General fund — spec in [`docs/v2/FUNDS.md`](v2/FUNDS.md)
