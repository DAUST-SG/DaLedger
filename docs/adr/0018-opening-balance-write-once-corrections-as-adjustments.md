# ADR 0018 — Opening balance is write-once; corrections are audited adjustments

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Pikou (Lead, IT Committee)

## Context

Every money movement after cutover is an audited, dated, reversible transaction.
The `openingBalance` is different — a bare field. Editing it later silently
rewrites every balance from cutover to today with no transaction, no audit
entry, no date: the one change that escapes "nothing is silent, everything is
audited". Opening balances do get corrected (a miscount, a late university
statement).

## Decision

Keep `openingBalance` as a field (it honestly represents a *measured fact at
cutover*, not a money movement), but **write-once at cutover, then immutable**.
Any later correction is an **audited `adjustment_up`/`adjustment_down`
transaction dated at the cutover date**, not a field edit.

- Cutover: set `openingBalance` from reality — the anchor.
- Found wrong later: record an adjustment on that account, dated cutover, with a
  reason. It flows through the normal engine, the audit log, and reconciliation.

## Consequences

- No balance is ever rewritten silently; every change to the opening position is
  a visible, dated, audited entry — consistent with ADRs 0002, 0010, 0014.
- The alternative (model opening balance as the account's first transaction) was
  rejected to avoid re-architecting the brief's "opening + transactions" framing
  and the `openingBalance` field.
- Implementation: lock `openingBalance` edits after a cutover window; surface an
  "correct opening balance" action that creates the cutover-dated adjustment.
