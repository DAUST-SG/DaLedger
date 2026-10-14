# ADR 0009 — Category applies only to income and expense entries

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Pikou (Lead, IT Committee)

## Context

The schema requires a category on every transaction, and every category has an
income/expense direction. But `transfer`, `allocation`, `school_withdrawal`,
`adjustment_up`, and `adjustment_down` are neither income nor expense. Forcing a
category onto them pollutes category reports (e.g. a transfer booked under an
expense category). Nothing stopped an expense category being put on an income
entry either.

## Decision

1. **Category is required only for `income` and `expense`.** All other types
   carry **no category** (`categoryId` empty). They are self-describing.
2. **Direction must match:** an `income` entry may use only an income-direction
   category; an `expense` entry only an expense-direction category. Enforced at
   write time.
3. The **`Unlabeled` sentinel** applies only to auto-captured income (or any
   income/expense lacking a category) — never to transfers, allocations,
   withdrawals, or adjustments.

The rule becomes: *every income and expense has a category; nothing else does.*

## Consequences

- `categoryId` is conditionally required (one extra validation rule) rather than
  always required.
- Category and event reports sum only real income and expenses — no phantom
  "transfer expenses".
- Categories cannot contradict an entry's direction.
- The `direction` field on `categories` is now also a write-time guard, not just
  a display grouping.
- Reversals (ADR 0002) copy the original's category, so a reversed income still
  nets within its income category.
