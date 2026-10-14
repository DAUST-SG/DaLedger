# User Blueprint — Finance Tracker

| | |
|---|---|
| **Version** | 1.0 |
| **Last Updated** | 2026-10-13 |
| **Purpose** | Map every user type's journey through the app, the pages involved, and how edge cases and async events are handled. |

## User Types

| User Type | Description | Entry Point |
|-----------|-------------|-------------|
| Finance Officer | Records and reviews transactions | `/login` → `/` (Home) |
| Treasurer | Officer who also reconciles and runs the term report | `/login` → `/` → `/reconcile`, `/report` |
| Automated source (shop/DaBus) | SG backend posting confirmed payments | `POST /intake/income` (no UI) |

---

## Journey — Finance Officer

### Phase 1 — Discovery & Onboarding (goal: first transaction recorded)
| Step | Screen/Page | What user does | What happens next | Notes |
|------|-------------|----------------|-------------------|-------|
| 1 | `/login` | Signs in with officer credentials | Lands on Home with live balances | Closed user set; no self-signup |
| 2 | `/` Home | Sees account balances, School balance, review badge | Taps "Add" | Balances are live, not typed |
| 3 | `/add` | Enters amount, account, reason, category | Saves in < 10 s | Reason required; FCFA integer input |
| 4 | `/` Home | Sees the balance update instantly | Confidence established | Updates on every device via live query |

### Phase 2 — Core Usage (goal: keep the ledger complete)
| Step | Screen/Page | What user does | What happens next | Notes |
|------|-------------|----------------|-------------------|-------|
| 1 | `/add` | Records income/expense/transfer during events | Balance reflects it | Transfer leaves total unchanged |
| 2 | `/review` | Clears unlabelled items & unmatched payments | Inbox trends to zero | Badge on Home shows the count |
| 3 | `/transactions` | Filters by event/category/date; exports CSV | Gets the slice they need | CSV follows active filters |
| 4 | `/events/:id` | Checks if an event made money | Sees income/expense/net | Grouped by category |

### Phase 3 — Retention & Return (goal: officer comes back unprompted)
| Step | Screen/Page | What user does | What happens next | Notes |
|------|-------------|----------------|-------------------|-------|
| 1 | `/` Home | Notices a stale reconcile date or review badge | Acts to clear it | Freshness nudges return |
| 2 | `/review` | Confirms recurring drafts (v1.1) | Drafts become real expenses | Overdue drafts highlighted |
| 3 | `/` Home | Trusts the numbers week over week | Keeps recording | The spreadsheet is retired |

---

## Journey — Treasurer

### Phase 1 — Discovery & Onboarding (goal: accounts set from reality)
| Step | Screen/Page | What user does | What happens next | Notes |
|------|-------------|----------------|-------------------|-------|
| 1 | `/reconcile` (cutover) | Enters verified opening balances | Ledger starts from truth | From Naboopay/Wave/OM apps + cash count |
| 2 | `/reconcile` | Enters School balance from university statement | School tracked separately | Allocations − paid withdrawals |

### Phase 2 — Core Usage (goal: keep the ledger provably correct)
| Step | Screen/Page | What user does | What happens next | Notes |
|------|-------------|----------------|-------------------|-------|
| 1 | `/reconcile` | Picks an account, enters real balance | Sees computed + difference | Weekly and after each event |
| 2 | `/reconcile` | Resolves a gap with a reasoned adjustment | Ledger matches reality | Adjustment is audited |
| 3 | `/` Home | Marks an approved withdrawal paid | School balance ↓, destination ↑ | One operation; `committed` → paid |

### Phase 3 — Retention & Return (goal: effortless term close)
| Step | Screen/Page | What user does | What happens next | Notes |
|------|-------------|----------------|-------------------|-------|
| 1 | `/report` | Chooses the term period | Sees totals by category/event | Reproduces the ledger |
| 2 | `/report` | Reviews School movement & reconcile history | Submits the term review | Minutes, not days |

---

## Page Index

| Page | Route | Purpose | Used in Journey |
|------|-------|---------|-----------------|
| Login | `/login` | Officer authentication | Officer P1, Treasurer P1 |
| Home | `/` | Balances, School, review badge, last reconcile | All |
| Add transaction | `/add` | Manual entry form | Officer P1–P2 |
| Needs review | `/review` | Unlabelled, unmatched, drafts | Officer P2–P3 |
| Transactions | `/transactions` | Full list, filters, CSV, audit view | Officer P2 |
| Event view | `/events/:id` | Per-event rollup | Officer P2 |
| Reconcile | `/reconcile` | Compare & adjust; cutover | Treasurer P1–P2 |
| Review report | `/report` | Term report | Treasurer P3 |
| Recurring | `/recurring` | Templates (v1.1) | Officer P3 |

---

## Edge Cases & Alternate Flows

| Scenario | Trigger | Where user lands | How it's handled |
|----------|---------|------------------|------------------|
| Save with no reason | Officer submits incomplete form | Stays on `/add` | Inline error; save blocked |
| Duplicate shop order | Backend retries intake | n/a (API) | `(source, externalId, kind)` dedupe; one transaction (ADR 0005) |
| Naboopay payment, no match | Sweep finds no income after grace window | `/review` | Flagged `needs_review`, once, deduped by `order_id`; self-heals if income arrives late (ADR 0008) |
| Partial payment (`part_paid`) | Naboopay status partial | `/review` | Surfaced as `provisional`, excluded from balances until an officer enters the actual amount received (ADR 0013) |
| Refund | Source calls refund endpoint | `/transactions` | Reversal linked to original, keyed `kind=refund`; no-match → `/review` (ADR 0005) |
| Wrong account entry | Officer notices mistake | `/transactions` | Reverse + re-enter (never delete) |
| Offline during entry | No connection | `/add` | Queued; syncs on reconnect (native) |
| Stale reconcile (freshness) | > 7 days since check | `/` Home | Date highlighted as a nudge |
| Stale reconcile (back-dating) | Back-dated entry lands ≤ last check | `/` Home | Account flagged "needs re-checking" (ADR 0010) |
| Lost Naboopay `order_id` | Backend didn't persist it | `/review` | Payment surfaces as unmatched; resolve manually |

---

## Notifications & Async Events

| Event | Trigger | Channel | Deep link destination |
|-------|---------|---------|-----------------------|
| New unmatched payment | Sweep/webhook flags it | In-app badge | `/review` |
| Review inbox non-zero | Any `needs_review` item | Home badge | `/review` |
| Overdue recurring draft | Draft past due date (v1.1) | Home highlight | `/review` |
| Reconciliation due | > 7 days since last check | Home highlight | `/reconcile` |
| Balance updated | Any transaction saved | Live query (all devices) | current screen |

<!-- assumed: v1 notifications are in-app only (badges/highlights); no email/push until requested -->
