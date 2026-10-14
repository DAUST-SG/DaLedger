# ADR 0010 — Back-dating is allowed but flags affected reconciliations stale

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Pikou (Lead, IT Committee)

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
