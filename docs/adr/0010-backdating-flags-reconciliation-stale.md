# ADR 0010 — Back-dating is allowed but flags affected reconciliations stale

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Pikou (Lead, IT Committee)
- **Amended:** M4 (2026-10-15): staleness is detected by **value**, not timestamps

> **Amended in M4.** The timestamp test below (an entry dated ≤ the check but
> written after it) misses one real case: marking a withdrawal paid with an earlier
> date changes an *old* row, so the balance at the check date moves with no new
> row. Staleness is therefore derived by value: a check is stale when the balance
> at its `checkedAt`, recomputed now, differs from what the check ended at (the
> real balance if it was adjusted, the computed one if the gap was left open).
> This catches every case (back-dated entries, back-dated reversals, paid
> withdrawals, opening corrections) and ignores changes that net to zero. Still
> derived, never stored.

## Context

Entries can be back-dated (`occurredAt` defaults to now but is editable). Every
balance is recomputed from the whole history. So inserting a transaction dated
*before* a completed reconciliation retroactively changes that account's
balance, silently invalidating a "checked, all good" reconciliation while the
home screen still shows green. For an app selling "trust the number", that is
corrosive.

## Decision

- **Keep back-dating allowed** — no hard "closed period" lock. Fast, forgiving
  capture (late receipts) matters more than rigidity for a student committee.
- When a transaction is **created or edited with `occurredAt` on-or-before an
  account's last reconciliation date**, mark that account's reconciliation as
  **stale** and surface "⚠ needs re-checking — a back-dated entry changed its
  history" on the home screen.
- The reconciliation keeps its original snapshot (what was seen then);
  **staleness is derived**: does any transaction dated ≤ the check date exist
  that was *written* (createdAt) after the check?

## Consequences

- A green "checked today" genuinely means the books still match as of today;
  later back-dating flips it to "recheck" instead of lying.
- Requires comparing `createdAt` against the last reconciliation's `checkedAt`
  and the entry's `occurredAt` — a derived flag, no new stored state on
  transactions.
- Editing an existing entry's date/amount can also trip staleness, so the check
  must run on edits too.
- Hard-locking back-dates before the last reconciliation is kept as a future
  option if drift becomes a real problem.
