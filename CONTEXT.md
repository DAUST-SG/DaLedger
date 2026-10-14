# Context & Glossary — Finance Tracker

The shared language of the DAUST SG Finance Tracker. One canonical meaning per
term; when a term is sharpened or a modelling decision is made, it is recorded
here and, where it is a real choice, in `docs/adr/`.

## Glossary

### Adjustment
A ledger entry that corrects an account's balance to match reality, discovered
during [[reconciliation]]. It has an explicit direction stored as the
transaction *type*: **`adjustment_up`** increases the account, **`adjustment_down`**
decreases it. A written reason is required. See ADR 0001.

### Reconciliation
The act of comparing an account's computed balance against its real balance
(Naboopay dashboard, Wave/OM app, or a physical cash count) at a point in time,
recording the check, and — if they differ — closing the gap with an
[[adjustment]]. The `difference` is defined as `real − computed`.

### Intake kind
A discriminator (`income` or `refund`) that scopes idempotency for automatic
intake. Uniqueness is `(source, externalId, kind)`, so a sale and its refund
share the order ID yet are distinct, each-idempotent records. A refund with no
matching income goes to [[Needs-review]]. See ADR 0005.

### Needs-review
A derived inbox of unfinished items, defined as
`status ∈ {needs_review, draft, provisional}` — never a stored flag. Fed by
auto-captured items lacking a category (sentinel
category `Unlabeled`), unmatched Naboopay payments, and recurring drafts.
Invariant: an item is never `confirmed` while its category is `Unlabeled`;
assigning a real category is the one action that flips `needs_review →
confirmed`. See ADR 0006.

### Safety-net sweep
A scheduled job that lists Naboopay transactions and flags any paid/done
`order_id` with no matching income as an unmatched [[Needs-review]] item — but
only after a **grace window** (default 30 min) and deduped by `order_id`. The
Naboopay webhook itself creates nothing. An unmatched item self-heals when the
real intake income arrives. See ADR 0008.

### Unmatched payment
A Naboopay payment the safety-net sweep could not tie to an income record after
the grace window — a genuine gap (a backend that failed to report), not a timing
lag. Matched by `naboopayReference` (= Naboopay `order_id`).

### Audit log
The accountability record: every state-changing write to a transaction (create,
field edit, status transition) logged with actor, time, a semantic `action`, and
**changed fields only** in before/after. It witnesses money-moving entries
(reversals, adjustments) without re-counting them — the ledger holds the money
truth, the audit log holds the who/why. See ADR 0014.

### Stale reconciliation
A past [[reconciliation]] whose "matched" result no longer holds because a
transaction dated on-or-before its check date was written (or edited) afterwards
— e.g. a back-dated receipt. Derived (not stored); surfaced as "needs
re-checking" on the home screen. Back-dating is allowed; the period is never
hard-locked. See ADR 0010.

### Reversal
A ledger entry that cancels an earlier one. It is a **near-copy of the original**
— same type, amount, account(s), category, and event — with `reversalOf` set.
It is never stored as an opposite-type entry and never re-labelled, so a
reversed item nets to zero inside its own category and event. See ADR 0002.
A target may have **at most one active reversal**; a mistaken reversal is undone
by reversing *it* (`original ← reversal ← reversal-of-reversal`). See ADR 0020.

### School receivable
Money the university owes the SG — a claim, **not** spendable cash. Shown on the
home screen as "owed by the university" and never added into the "held by the
SG" total. Balance = allocations − paid [[school withdrawal]]s. Two invariants:
an [[allocation]] never touches a real account; reconciling it compares against
the university's statement, not a cash count. See ADR 0004.

### Allocation
An entry that raises the [[School receivable]] when the university credits the
SG. Touches no real account. Carries no [[category]]. Reversible/adjustable like
any entry.

### Negative School
A [[School receivable]] below zero — the SG drew more than was allocated. Usually
a missing allocation or a data error (sometimes a legitimate advance). Allowed
but never silent: warned at entry and flagged on the home screen; never blocked.
See ADR 0017.

### Category
A label with an income/expense `direction`, required **only** on `income` and
`expense` entries and direction-matched to them. All other types carry none.
`Unlabeled` is the sentinel for auto-captured income awaiting a real category.
See ADR 0009.

### School withdrawal
A movement of money the university owes the SG out to a real account (Wave, OM,
Cash). It is **one row with a lifecycle**: `committed` (approved, not yet paid —
shown under the School balance, changes no balance) then `paid` (money landed —
School balance drops, destination account rises). The transition is an audited
in-place edit of the same row. See ADR 0003.

### Committed (withdrawal state)
A school withdrawal approved by the university but not yet paid. Displayed under
the School balance; contributes to no balance until it becomes [[school
withdrawal|paid]].

### Contribution
The **signed effect** of one entry on one account `X`, from a per-account table (two-leg
types like [[transfer]] and paid [[school withdrawal]] hit `accountId` negative
and `toAccountId` positive), then a −1 flip if it is a [[reversal]], then a
status gate. This single rule is why the balance formula needs no special case
for reversals. See ADR 0007 for the full table.

### Opening balance
An account's verified balance at cutover — a measured fact, stored as a field and
**write-once**. Never edited afterward: corrections are audited `adjustment_up`/
`adjustment_down` entries dated at cutover, so no historical balance is ever
rewritten silently. See ADR 0018.

### Movement reconciliation
The term report's proof that `start total held + income − expense +
paid-withdrawals-in ± adjustments + transfers(0) = end total held`. Every change
in total held is on a labelled line, so income/expense-by-category plus explicit
withdrawal and adjustment lines leave no unexplained gap. See ADR 0021.

### Point-in-time balance
`balanceAsOf(X, date)` = opening balance + the [[contribution|effect]] of every
live entry with `occurredAt ≤ date`. Reports use it for start/end balances and
filter activity by `occurredAt` (not `createdAt`), so start + activity = end.
Back-dating can retroactively shift a past period's figures. See ADR 0016.

### Guarded transition
A status change that acts only if the row is still in its expected "from" status,
and is a clean no-op otherwise. Because Convex serialises mutations, double-taps,
retries, and concurrent officers apply a one-time transition exactly once — money
never moves twice. Applies to all in-place edits. See ADR 0019.

### Live status
A status that counts toward balances: `confirmed`, `paid`, `needs_review`.
`committed`, `draft`, `memo`, `skipped`, and `provisional` contribute 0. Note
[[Needs-review]] money **does** count — it is settled, fully-known money awaiting
a label — but [[provisional]] (part_paid) does not. Full status set:
`confirmed | needs_review | committed | paid | draft | memo | skipped | provisional`.

### Event view (all-time) vs report by-event (period)
Two reconciling views of an event's net: the **Event view** is all-time (the
event's whole-life P&L, by `occurredAt`); the **report by-event** is
period-scoped. An event's all-time net = sum of its per-period nets. Both are
labelled on screen so cross-term events don't look like bugs. `events.active`
only gates new tags, not totals. See ADR 0022.

### Memo
A report-only pre-cutover event summary. Excluded from every balance, included in
event/category reports. The single deliberate case where balance math and report
math diverge. See ADR 0011.

### Provisional
A Naboopay `part_paid` payment surfaced for review. Inbox-visible but
balance-excluded, because Naboopay reports the full nominal amount, not the
partial actually received. An officer enters the real amount received, which
turns it into settled income that counts. See ADR 0013.

### Recurring draft lifecycle
A template-generated `draft` expense ends one of three ways, none a delete:
`confirmed` (edited if needed, then counts), `skipped` (terminal, keeps the row
so the job can't recreate it), or still-pending. One outcome per template per
month. v1.1. See ADR 0012.

### Transfer
Moving money between two of the SG's own real accounts: one row, `accountId`
(source, −) and `toAccountId` (destination, +). Strictly equal-in/equal-out and
neutral — the SG total is unchanged. Not income or expense.

### Payout
A transfer out of Naboopay to Wave/OM/Cash. When Naboopay charges a fee, it is
recorded as **two entries**: a [[transfer]] of the *net* amount received plus a
separate "Provider fees" *expense* for the fee. Transfers never carry unequal
amounts; every fee is an expense. See ADR 0015.

### Fee
Any Naboopay charge. Per-*sale* fees are avoided via `fees_customer_side = true`
(SG receives the full nominal amount). Per-*payout* fees are real and entered
manually as a "Provider fees" expense. No automatic fee feed exists.
