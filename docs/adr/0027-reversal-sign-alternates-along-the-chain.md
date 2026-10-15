# ADR 0027 — The reversal sign alternates along the reversalOf chain

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Pikou (Lead, IT Committee)
- **Amends:** ADR 0002, 0007 (the reversal flip). **Delivers:** ADR 0020.

## Context

ADR 0002 and 0007 flip a row's effect by −1 "when `reversalOf` is set". ADR 0020
says a mistaken reversal is undone by reversing *it*, and that the chain
`original ← reversal ← reversal-of-reversal` nets back to the original effect.

Both cannot hold. A reversal-of-reversal is a near-copy of the reversal, so it
also has `reversalOf` set and the plain rule flips it −1 again. On a 1 500 income:
`+1 500 − 1 500 − 1 500 = −1 500`. The "undo" would destroy real money a second
time, which is exactly what ADR 0020 exists to prevent. The M1 tests caught this.

## Decision

A row's flip is **−1 for each link** in its `reversalOf` chain:

```
flip(t) = +1                     if t.reversalOf is not set
flip(t) = −flip(t.reversalOf)    otherwise
```

So an original is +1, its reversal −1, a reversal-of-reversal +1, and so on.
`effect(t, X)` is ADR 0007's table × `flip(t)` × the status gate. Nothing about
storage changes: a reversal is still a near-copy with `reversalOf` set (ADR 0002).

## Consequences

- ADR 0020's chain now nets back to the original, and the original can be
  reversed again once its reversal has been undone.
- Computing a balance follows `reversalOf` links for reversal rows only. Chains
  are short (one or two links), so the cost is negligible.
- Category and event rollups (M3, M6) use the same `flip` so a reversed item
  still nets to zero inside its own category and event.
- Implemented in `convex/ledger.ts` (`reversalFlip`) and covered by
  `ledger.test.ts` and `transactions.test.ts`.
