# ADR 0028 — An approved-but-unpaid withdrawal is cancelled by a status, not a reversal

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Pikou (Lead, IT Committee)
- **Amends:** ADR 0003 (withdrawal lifecycle), ADR 0007 (status gate)

## Context

A `school_withdrawal` starts `committed` (approved, not yet paid) and later
transitions to `paid` (ADR 0003). But some approved withdrawals never happen —
the plan changes, the budget is pulled. There was no way to cancel one:

- A **reversal** (ADR 0002) is wrong here. A committed withdrawal has moved no
  money, so a reversal copy would sit at 0 while the original could still be
  marked `paid` later — the M1 code correctly refuses to reverse a `committed`
  row.
- Leaving it `committed` forever means it shows under the School balance as a
  pending withdrawal indefinitely.

## Decision

Cancel an approved-but-unpaid withdrawal with a **guarded status transition
`committed → cancelled`**, mirroring the recurring-draft `skipped` pattern
(ADR 0012):

- A new terminal status **`cancelled`**. It is **not live** — it contributes 0 to
  every balance (ADR 0007 status gate) and is excluded from the committed amount
  shown under School.
- The transition is guarded (`committed`-only, no-op otherwise; ADR 0019), so a
  double-tap cancels once. A `cancelled` withdrawal can no longer be marked paid.
- A **reason is required** and recorded in the audit entry (`action:
  cancel_withdrawal`, ADR 0014). Nothing is deleted.

## Consequences

- The `status` enum grows to **8**:
  `confirmed | needs_review | committed | paid | draft | memo | skipped | cancelled`.
- Only `committed` withdrawals can be cancelled; `paid` ones are corrected by a
  reversal (ADR 0002) as before.
- Implemented as `transactions.cancelWithdrawal` in M1; covered by
  `transactions.test.ts`.
- Distinct from Naboopay's own `cancelled` transaction status (ADR 0026) — this is
  an internal withdrawal-lifecycle state, unrelated to the payment gateway.
