# ADR 0001 — Adjustments carry direction as two transaction types

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Pikou (Lead, IT Committee)

## Context

The ledger rule is: `amount` is always stored as a positive integer, and the
transaction `type` determines the direction of its effect on a balance (income
adds, expense subtracts, etc.).

This rule breaks for reconciliation adjustments. When an officer compares an
account's computed balance against reality, the gap can go either way: reality
can be *higher* than computed (unrecorded money in) or *lower* (unrecorded money
out). A single `adjustment` type with a positive-only `amount` cannot express
which direction closes the gap. The balance formula already assumes the
distinction ("plus positive adjustments, minus negative adjustments") but the
data model had nowhere to store it.

## Decision

Represent adjustment direction as **two distinct transaction types**:
`adjustment_up` (increases the account) and `adjustment_down` (decreases the
account). We do **not** add a separate direction field.

The `transactions.type` enum therefore becomes:
`income | expense | transfer | allocation | school_withdrawal | adjustment_up | adjustment_down`.

## Consequences

- The core rule "direction comes from the type, amount is always positive" holds
  for every type with no exceptions.
- Balance computation adds for `adjustment_up`, subtracts for `adjustment_down`;
  no special-case sign handling.
- Audit log and reports read unambiguously (e.g. "Adjustment ↓ 5 000 — cash
  recount").
- Reconciliation logic chooses the type from the sign of `difference`
  (`real − computed`): positive → `adjustment_up`, negative → `adjustment_down`.
- Any schema/docs that enumerate transaction types must list both values.
