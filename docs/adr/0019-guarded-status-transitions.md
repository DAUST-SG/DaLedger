# ADR 0019 — Every in-place status transition is a guarded, exactly-once operation

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Pikou (Lead, IT Committee)
- **Amended by:** ADR 0026 (part_paid example removed)

## Context

Round 1 introduced many one-time, balance-changing status transitions done by
editing a row in place: `committed→paid`, `draft→confirmed`, `draft→skipped`,
`needs_review→confirmed` (assign category). These are
exactly the actions a double-tap on a flaky phone, a retry, or two officers can
fire twice — risking double money movement (pay twice, two expenses from one
draft).

## Decision

Every status transition is a **guarded transition**:

- The mutation states the **expected current status** and acts only if the row is
  still in it (`markWithdrawalPaid` requires `committed`; `confirmDraft` requires
  `draft`; `assignCategory` requires `needs_review`; etc.).
- If already past that state, the mutation is a **clean no-op** returning the
  existing result — not a second application.
- Convex serialises mutations, so concurrent attempts are ordered: the first
  flips the status and wins; the second sees the new status and does nothing.

General rule: *all status transitions are guarded by expected-current-status and
are no-ops otherwise.*

## Consequences

- The status field doubles as a concurrency guard — a transition consumes its
  "from" state and cannot be applied twice.
- Extends the intake's exactly-once discipline (ADR 0005) to every in-place edit
  (ADRs 0003, 0006, 0012, 0013).
- Money moves exactly once under double-taps, retries, and concurrent officers.
- Each transition mutation writes its audit entry (ADR 0014) only on the winning
  application.
