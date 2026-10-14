# ADR 0016 — Point-in-time balances are defined by occurredAt ≤ date

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Pikou (Lead, IT Committee)

## Context

The engine computes *current* balances (opening + effect of all live
transactions). The term report needs *point-in-time* balances — what an account
held at the start and end of a period. Each transaction has two dates:
`occurredAt` (when money moved) and `createdAt` (when it was typed). Back-dating
is allowed (ADR 0010), so "the balance on 31 Dec" can change after the fact.

## Decision

Define a point-in-time balance by **`occurredAt`**:

```
balanceAsOf(X, date) = openingBalance(X)
                     + Σ effect(t, X) for every live transaction t with t.occurredAt ≤ date
```

- Report "start balance" = `balanceAsOf(start − 1)`; "end balance" =
  `balanceAsOf(end)`; period activity = entries with `occurredAt ∈ [start, end]`.
  Thus **start + activity = end** always reconciles.
- Reports filter by **`occurredAt`, not `createdAt`** — the report is about when
  money moved. `createdAt` remains the tool for audit and staleness (ADR 0010,
  0014).

## Consequences

- A finalized term report can shift slightly if an entry is later back-dated into
  that closed period — the honest mirror of ADR 0010. The Treasurer should
  reconcile and "close" a period before relying on the report.
- `effect(t, X)` and the status gate are exactly ADR 0007's; only the
  `occurredAt ≤ date` filter is added. `memo` entries remain report-only
  (ADR 0011) and are included in period category/event totals but not in
  balanceAsOf.
- Needs an index on `(accountId, occurredAt)` (already present as
  `idx_tx_account_occurred`).
