# ADR 0021 — The term report reconciles the whole period, not just income/expense

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Pikou (Lead, IT Committee)

> **Refined in M6** (approved 2026-10-15):
> - **School statement:** `allocations − paid withdrawals ± adjustments = change in
>   receivable`. ADR 0017 and M4 allow adjustments on School, so the statement needs
>   that line to balance.
> - **Memos** (ADR 0011) appear in their own block, "Pre-cutover summaries (not in
>   balances)", and in by-event totals with a marker. They never appear in the
>   movement lines or the by-category totals, which therefore always equal the
>   income and expense lines.
> - **Per account:** each cash account gets its own start, end and movement lines
>   (transfers shown as in and out), so each balance explains itself the same way.
> - **Self-check:** `reports.term` returns `balanced`, which re-checks start + lines
>   = end overall, per account and for School. The screen shows ✓, or a warning
>   that should never appear.

## Context

The report groups money by income/expense category. But several live types move
a balance without being income or expense and without a category (ADR 0009):
paid school withdrawals (money into a real account), adjustments (reconciliation
corrections), and transfers (net zero but real). So an income/expense breakdown
alone leaves an unexplained gap between "net" and the actual change in total
held — the exact failure the report exists to eliminate.

## Decision

The report includes a **full movement reconciliation** that accounts for every
live type, provably balancing:

```
start total held
  + income            (by category)
  − expense           (by category)
  + paid-withdrawals-in   (money drawn from the university)
  ± net adjustments       (reconciliation corrections)
  + transfers             (net 0, shown for completeness)
= end total held
```

Plus the School receivable mini-statement: `allocations − paid withdrawals =
change in receivable`.

## Consequences

- Every franc of change between start and end total is on a labelled line —
  nothing unexplained.
- Income/expense keep their by-category detail; paid-withdrawals-in and
  adjustments get their own explicit lines.
- All figures are period-scoped by `occurredAt` (ADR 0016); `memo` entries are
  included in category/event totals but excluded from the held-balance movement
  (ADR 0011).
- Makes the report self-proving — it reproduces and explains the ledger rather
  than summarising part of it.
