# ADR 0020 — At most one active reversal per target; un-reverse by reversing the reversal

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Pikou (Lead, IT Committee)

## Context

A reversal cancels an entry via an opposite-effect near-copy (ADR 0002). Nothing
stopped an entry from being reversed more than once: reversing a 5 000 income
twice yields two −5 000 entries and drives the balance to −5 000 — silently
destroying real money. This is the reversal-side mirror of the double-pay
problem (ADR 0019). Officers also reverse things by mistake and need to undo
that.

## Decision

- **At most one active reversal per target.** If a transaction already has a
  standing (non-reversed) reversal, a further reverse attempt is blocked /
  no-ops — guarded like ADR 0019 (check for an existing non-reversed reversal
  pointing at the target).
- **Reversing a reversal is allowed** and is the sanctioned un-reverse: the chain
  `original ← reversal ← reversal-of-reversal` nets back to the original effect.
- With guarded transitions, a double-tap on reverse yields exactly one reversal.

## Consequences

- No accidental double-cancellation; balances cannot go negative by repeated
  reversal.
- "I reversed the wrong thing" is fixable by reversing up the chain — never a
  delete, fully audited (ADR 0014).
- "Active reversal" = a reversal whose own `reversalOf` chain is not itself
  reversed. The reverse mutation must walk/one-step-check this before acting.
