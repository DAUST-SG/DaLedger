# Product Requirements Document — Finance Tracker

| | |
|---|---|
| **Version** | 1.0 |
| **Status** | Draft for IT Committee review |
| **Last Updated** | 2026-10-13 |
| **Author** | Mbaye N. Diouf, Treasurer, DAUST SG |

---

## 1. Problem Statement

The SG records every transaction in a shared Excel file. In practice entries fall behind: a cash expense here, a mobile-money transfer there, a shop sale somewhere else. Because balances in the sheet are typed rather than derived, a single missing or mistyped row makes the whole file wrong, and there is no way to tell which row.

At the end of the term the Treasurer must reconstruct what happened from memory, receipts, and screenshots. This is slow, error-prone, and impossible to audit. Existing spreadsheet-based approaches fail because they (a) let balances be typed instead of computed, (b) have no concept of a reason or category per movement, and (c) cannot ingest the automatic income from the SG's own shop and DaBus websites.

## 2. Product Vision

Within 12 months, the SG runs entirely on Finance Tracker: officers record every movement from their phones in seconds, balances are always live and trustworthy on every device, shop and DaBus income flows in automatically, and the end-of-term review is produced in one click instead of reconstructed over days.

## 3. Target Users

### Finance Committee Officer
- **Who:** An elected SG member responsible for recording and reconciling money.
- **Goal:** Record any transaction correctly in under 10 seconds and trust the displayed balances.
- **Pain point:** The Excel file is tedious, easy to get wrong, and gives no confidence the numbers are right.

### Treasurer (lead officer)
- **Who:** The officer accountable for the SG's finances and the end-of-term review.
- **Goal:** Reconcile against real accounts, see what the university still owes, and generate the term report.
- **Pain point:** Reconstructing a term's finances from an inconsistent spreadsheet.

### Automated source (shop / DaBus backend) <!-- assumed: treated as a non-human "user" of the intake API -->
- **Who:** The SG-controlled websites that take payments through Naboopay.
- **Goal:** Report every confirmed payment to the tracker exactly once.
- **Pain point:** Today this income is not captured in any ledger at all.

## 4. User Stories

### P0 — Must have for v1
- As an **officer**, I want to log in securely so that only the finance committee can see and edit the ledger.
- As an **officer**, I want to add an income/expense/transfer from my phone with a required reason so that the record is complete.
- As an **officer**, I want balances to update live on every device so that I always see the truth.
- As a **shop/DaBus backend**, I want to POST a confirmed payment to an idempotent endpoint so that income is captured exactly once.
- As an **officer**, I want unmatched or unlabelled items to appear in a Needs-review inbox so that nothing is silently lost.
- As the **Treasurer**, I want to reconcile an account against its real balance and record an adjustment so that the ledger matches reality.
- As the **Treasurer**, I want an end-of-term report so that I never reconstruct a term by hand again.

### P1 — Should have
- As an **officer**, I want to filter transactions and export CSV so that I can analyse or share data.
- As an **officer**, I want to view income/expense/net per event so that I know if an event made money.
- As an **officer**, I want the Naboopay balance reconciled automatically so that I don't read it off a dashboard.
- As an **officer**, I want offline entries to sync when I reconnect so that a bad signal never loses a record.

### P2 — Nice to have / v1.1
- As an **officer**, I want recurring expense templates that create monthly drafts so that regular bills are not forgotten.
- As the **President**, I want to approve withdrawals before they are paid. <!-- assumed: explicitly deferred past v1 in the brief -->

## 5. Feature Specifications

### 5.1 Ledger & live balances
- **Priority:** P0
- **Description:** Append-only transactions; each account balance = opening balance + applicable transactions. Direction comes from the `type` (with `adjustment_up`/`adjustment_down` for corrections, ADR 0001), flipped for reversals via a −1 sign rule (ADR 0002, 0007). The **School receivable** (allocations − paid withdrawals) is money the university *owes* the SG — shown separately and never added to the SG total (ADR 0004).
- **Acceptance Criteria:**
  - [ ] A transaction entered on a phone updates the correct balance on every device immediately.
  - [ ] A transfer does not change the total held by the SG (it is strictly equal-in/equal-out; a payout fee is a separate expense, ADR 0015).
  - [ ] A reversal restores the balance with no special-case logic, and nets to zero inside its own category/event (ADR 0002); a target has at most one active reversal and double-taps apply it once (ADR 0019, 0020).
  - [ ] `committed`, `draft`, `skipped`, `memo`, and `provisional` entries are excluded from balances; `confirmed`, `paid`, and `needs_review` count (ADR 0007).

### 5.2 Manual entry
- **Priority:** P0
- **Description:** A phone-first form for all non-automatic movements; reason, amount, account, category required; event, receipt, date optional.
- **Acceptance Criteria:**
  - [ ] The form will not save without a reason.
  - [ ] Amounts are whole FCFA (integer, positive); display uses spaces as thousands separators.
  - [ ] Recent reasons/categories are suggested as the officer types.

### 5.3 Automatic income intake
- **Priority:** P0
- **Description:** HTTPS endpoint `/intake/income`; per-source secret key; idempotent on `(source, externalId, kind)` where `kind ∈ {income, refund}` so a sale and its refund are distinct, each-idempotent records (ADR 0005); income booked on the Naboopay account with the source's default category and status `confirmed`.
- **Acceptance Criteria:**
  - [ ] The same order sent twice produces exactly one transaction.
  - [ ] An unpaid order never appears (backends post only on paid/done).
  - [ ] A wrong/unknown key is rejected (401).
  - [ ] A refund call creates a reversal of the original income, and a retried refund still yields exactly one reversal (ADR 0005).
  - [ ] A refund with no matching income goes to Needs-review rather than creating a dangling reversal.

### 5.4 Naboopay integration
- **Priority:** P0 (webhook) / P1 (sweep, balance)
- **Description:** Verify Naboopay webhooks (HMAC over raw body) and match to income by `naboopayReference` (= Naboopay `order_id`). The webhook itself **creates nothing** — on a match it confirms, on a non-match it does nothing (ADR 0008). A scheduled sweep raises an unmatched Needs-review item only for paid/done payments still unmatched **after a ~30-min grace window**, deduped by `order_id`, and self-healing when the real income later arrives. A `part_paid` payment becomes a `provisional` review item that does **not** count toward balances until an officer enters the actual amount received (ADR 0013). Payouts and fees are entered manually; a payout fee is a net transfer + a "Provider fees" expense (ADR 0015). The Naboopay balance is read via `GET /account/` for reconciliation.
- **Acceptance Criteria:**
  - [ ] A valid signed webhook is accepted; a tampered body is rejected.
  - [ ] A webhook that arrives before the backend's intake creates no phantom and no duplicate (ADR 0008).
  - [ ] A paid payment still unmatched after the grace window appears in Needs-review, once.
  - [ ] A `part_paid` payment appears as `provisional`, excluded from balances, and only counts after an officer enters the real amount received (ADR 0013).

### 5.5 Needs-review inbox, filters, event view, CSV
- **Priority:** P0 (inbox) / P1 (rest)
- **Description:** The inbox is a **derived view**, not a stored flag: in the inbox ⇔ `status ∈ {needs_review, draft, provisional}` (ADR 0006, 0013). It gathers unlabelled items (`Unlabeled` + `needs_review`), unmatched Naboopay payments, part_paid provisionals, and recurring drafts. Full transaction list with filters (date, account, category, event, source, type) and CSV export. The **Event view is all-time** (the event's whole-life P&L by `occurredAt`), distinct from and reconciling with the report's period-scoped by-event line; both are labelled so cross-term events don't look like bugs (ADR 0022).
- **Acceptance Criteria:**
  - [ ] Every captured item without a label is in the inbox; assigning a real category is the single action that flips it `needs_review → confirmed` (an item is never `confirmed` while `Unlabeled`, ADR 0006).
  - [ ] Event view (all-time) and report by-event (period) are each labelled; an event's all-time net = sum of its per-period nets (ADR 0022).
  - [ ] CSV export reflects the active filters, ordered by `occurredAt`.

### 5.6 Reconciliation & audit log
- **Priority:** P0
- **Description:** Per-account reconciliation (enter real balance → see computed + difference → fix via adjustment, `difference = real − computed`, chosen type `adjustment_up`/`adjustment_down` by sign). `openingBalance` is write-once at cutover; later corrections are cutover-dated adjustments, never field edits (ADR 0018). Last-check date per account on the home screen; a check is flagged **stale** when a back-dated entry lands on or before it (ADR 0010 — back-dating is allowed, not locked). The School receivable reconciles against the **university statement**, not a cash count (ADR 0004); a negative School receivable is warned and flagged, never blocked (ADR 0017). Every state-changing write is recorded in the audit log with changed-fields-only before/after (ADR 0014).
- **Acceptance Criteria:**
  - [ ] A difference can be resolved with a reasoned adjustment.
  - [ ] Every edit appears in the audit log with who/when/what and the changed fields.
  - [ ] Entering a back-dated transaction before an account's last check flips that account to "needs re-checking" (ADR 0010).
  - [ ] Correcting an opening balance creates a cutover-dated adjustment, not a silent field edit (ADR 0018).

### 5.7 End-of-term review report
- **Priority:** P0
- **Description:** For a chosen period (scoped by `occurredAt`, ADR 0016): totals by category and event, start/end balances (`balanceAsOf`), School movement, reconciliation history. Includes a **full movement reconciliation** — `start total held + income − expense + paid-withdrawals-in ± adjustments + transfers(0) = end total held` — so every change in total held is on a labelled line with nothing unexplained (ADR 0021).
- **Acceptance Criteria:**
  - [ ] Report totals reproduce the transactions list for the period.
  - [ ] Start balance + period movement = end balance, with each movement line (income/expense/paid-withdrawals-in/adjustments/transfers) shown explicitly (ADR 0021).
  - [ ] Start/end balances use `balanceAsOf` on `occurredAt`; back-dating can retroactively adjust a closed period (ADR 0016).

### 5.8 Recurring expense templates
- **Priority:** P2 (v1.1)
- **Description:** Templates create one draft expense per month on the due day; drafts change no balance until confirmed. A draft ends one of three ways, none a delete: `confirmed` (edited if needed, then counts), `skipped` (terminal — kept so the job can't recreate it, ADR 0012), or still-pending.
- **Acceptance Criteria:**
  - [ ] At most one draft per template per month (unique on `recurringId` + due-month, spanning draft/confirmed/skipped).
  - [ ] A draft changes no balance until confirmed; skipping sets status `skipped` and creates no money movement, and the draft is not recreated that month (ADR 0012).
  - [ ] Overdue drafts are visible on the home screen.

## 6. Out of Scope (v1)

- Moving real money, or any bank/mobile-money payment connection (the app records; it does not pay).
- Generating withdrawal-request letters and budget documents.
- Access for non-finance SG members or the administration.
- Importing the old Excel history (start from verified opening balances). Past events wanted in reports may be entered as report-only `memo` summaries, excluded from balances (ADR 0011).
- Recurring *income* / subscriptions (no such source exists yet).

## 7. Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Time to record a manual entry | < 10 s median | In-app timing / officer testing |
| Needs-review inbox size | Trending to 0 | Count of `needs_review` items over time |
| Reconciliation freshness | Every account checked ≤ 7 days | Last reconcile date per account |
| Automatic income captured | 100% of paid shop/DaBus orders | Sweep finds 0 unmatched over a week |
| End-of-term report effort | < 1 hour (from days) | Treasurer self-report |

## 8. Timeline & Milestones

| Milestone | Target Date | Deliverable |
|-----------|-------------|-------------|
| M1 Schema, login, manual entry, live balances | 2026-10-27 | Phone entry changes balances live |
| M2 Shop & DaBus intake | 2026-11-03 | Idempotent income capture + refund reversal |
| M3 Inbox, filters, event view, CSV | 2026-11-10 | Review workflow usable |
| M4 Reconciliation & audit log | 2026-11-17 | Reconcile + adjustments + audit trail |
| M5 Naboopay integration | 2026-11-24 | Webhook match + safety-net sweep + balance read |
| M6 Review report | 2026-12-01 | One-click term report |
| M7 Recurring expenses (v1.1) | 2026-12-08 | Monthly drafts awaiting confirmation |

<!-- assumed: 1-week milestones starting 2026-10-20; adjust to committee availability -->

## 9. Open Questions

- [ ] Can the SG obtain a working Naboopay **server API key** (the current publishable key is rejected)? Needed for sweep + balance auto-read.
- [ ] Who maintains the shop and DaBus backends, and when can they add the intake call + persist Naboopay `order_id`?
- [ ] Confirm `fees_customer_side = true` as the fee policy.
- [ ] Agree the starting category list and the default category/event per source.
- [ ] Is offline capture required for the first release, or staged?
- [ ] Final cutover date and source of verified opening balances + university statement.
