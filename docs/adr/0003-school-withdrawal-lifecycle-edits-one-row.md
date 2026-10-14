# ADR 0003 — A school withdrawal is one row that transitions committed → paid

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Pikou (Lead, IT Committee)

## Context

A `school_withdrawal` has two stages. **Committed**: approved by the university
but not yet paid — shown under the School balance, changes no balance. **Paid**:
the money has landed in a destination account — the School balance drops and the
destination account rises, in one operation.

How to record the transition to paid, given the "nothing is deleted /
append-only" rule? Either edit the existing row in place, or freeze the
committed row and append a separate paid row.

## Decision

**Edit the single row in place.** One `school_withdrawal` row represents the
withdrawal through its whole lifecycle. Marking it paid flips `status` from
`committed` to `paid`, stamps `occurredAt` with the payment time, and the audit
log records the before/after.

## Consequences

- "Append-only" is understood as: real money movements are never erased. A
  status transition on a not-yet-real movement is a legitimate, audited edit.
- **Balance math counts a `school_withdrawal` only when `status = paid`.**
  Committed withdrawals contribute nothing to any balance; they are displayed
  under the School balance only. This is a status-dependent contribution rule.
- A committed withdrawal has **no payment time yet**: `occurredAt` is set only on
  the transition to paid. Until then the row is ordered by its created/approval
  time.
- One row = one withdrawal: simpler to reverse, filter, and report than a
  two-row scheme.
- A paid withdrawal carries its own distinct status **`paid`**, not the generic
  `confirmed` used for captured income. Keeping them separate makes the
  withdrawal lifecycle legible in lists and reports at a glance.
- The full `status` enum is therefore:
  `confirmed | needs_review | committed | paid | draft`. Schema docs that omit
  `paid` must add it.
