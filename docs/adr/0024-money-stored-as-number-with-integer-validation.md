# ADR 0024 — Money is stored as `v.number()` with an integer+positive guard

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Pikou (Lead, IT Committee)

## Context

Earlier docs (CLAUDE.md, schema notes) said "integer FCFA — use `v.int64()`".
But Convex's `v.int64()` stores/returns **bigint**, which clashes with the
TypeScript `number` type used everywhere in the app (`Transaction.amount:
number`, formatting, CSV, arithmetic). Using bigint would force `BigInt`
ergonomics across the whole frontend for no benefit: FCFA magnitudes are tiny
(well under 2^53), so `number` represents them exactly. The feasibility report
confirms `v.number()` is safe for these magnitudes.

## Decision

Store money as **`v.number()`**, and enforce integrality and positivity with an
explicit **runtime guard** at every write boundary:

```
assert Number.isInteger(amount) && amount > 0   // reject otherwise (422 on intake)
```

- `amount` is a positive integer `number` (ADR 0007's positivity rule stands).
- Validate on manual create, on intake (reject non-integer / ≤ 0), and on any
  computed write.

## Consequences

- TS types stay `number` end to end — no bigint plumbing in UI, CSV, or
  formatting (`lib/fcfa.ts`).
- Integrality is a validated invariant, not a storage-type side effect.
- **Supersedes** the `v.int64()` guidance in CLAUDE.md and the schema notes;
  those are updated to reference this ADR.
- The "whole FCFA, no floats" rule is unchanged — it is now enforced in code.
