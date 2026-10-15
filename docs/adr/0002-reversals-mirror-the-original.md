# ADR 0002 — A reversal mirrors the original entry and flips via a sign rule

- **Status:** Accepted — balance-formula portion **superseded by ADR 0007**
- **Date:** 2026-10-13
- **Deciders:** Pikou (Lead, IT Committee)

> **Partial supersession:** the single-account contribution formula below
> (`directionOfType(type) × amount × (reversalOf ? −1 : +1)`) is replaced by
> ADR 0007's two-leg, per-account table, which also resolves the "open
> sub-question" about transfers. The **storage decision still stands**: a reversal
> is a near-copy of the original with `reversalOf` set, flipped by the −1 sign
> rule. Read 0007 for the authoritative engine. **ADR 0027** (accepted) refines
> the flip so it alternates along the `reversalOf` chain, as ADR 0020 requires.

## Context

Nothing in the ledger is deleted; a mistake is corrected by appending a
*reversal* entry linked to the original via `reversalOf`. The brief promises
"the balance formula never needs a special case for reversals."

The open question was how the reversal row is stored. Two tempting options both
fail:

- Store the reversal as an **opposite type** (e.g. a reversed income becomes an
  expense). Account balances come out right, but category/event reports show a
  phantom expense and leave the original category total inflated. Reports lie.
- Keep the same type but have the balance formula check "is this a reversal?".
  That reintroduces the special case the brief wanted to avoid.

## Decision

A reversal is stored as a **near-copy of the original**: same `type`, `amount`,
`accountId`, `toAccountId`, `categoryId`, `eventId`, with `reversalOf` pointing
at the original and its own `reason`/`recordedBy`.

Every entry's signed effect on a balance (and on every category/event rollup) is
defined by one uniform rule applied to all rows:

```
contribution = directionOfType(type) * amount * (reversalOf ? -1 : +1)
```

## Consequences

- The "no special case" promise holds literally: a reversal is just a row whose
  reversal multiplier is −1; the same function runs over every row.
- Reports stay honest: a reversed sale nets to zero *inside* its own category
  and event rather than creating a phantom expense elsewhere.
- The single nuance to the core rule: direction comes from the type, **flipped
  if the row is a reversal**. This applies uniformly to balances and rollups.
- A reversal must copy the original's category/event; it is not re-labelled.
- Open sub-question for later: whether a transfer or school_withdrawal reversal
  needs `accountId`/`toAccountId` copied as-is (sign rule handles both legs) —
  revisit when transfers are modelled in detail.
