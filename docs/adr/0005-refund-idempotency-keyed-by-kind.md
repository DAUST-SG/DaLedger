# ADR 0005 — Refunds are distinct intake records keyed by (source, externalId, kind)

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Pikou (Lead, IT Committee)

## Context

Two intake rules collided:

- **Duplicate rule:** a record with an existing `(source, externalId)` is a
  duplicate — do nothing, return the existing one (makes retries safe).
- **Refund rule:** a refund call carries the *original* `externalId` and must
  create a reversal of that income.

If a refund arrives with the same `(source, externalId)` as the sale, the
duplicate rule fires first and the reversal is never created. Refunds also need
to be retry-safe (a retried refund must yield exactly one reversal).

## Decision

Make intake idempotency key **`(source, externalId, kind)`**, where `kind` is
`income` or `refund`.

- The sale is idempotent on `(source, externalId, income)`.
- The refund is idempotent on `(source, externalId, refund)`.
- On a refund, the tracker finds the original by `(source, externalId, income)`
  to set `reversalOf`, then writes the reversal keyed as `refund`.

A sale and its refund share the human order ID but are two distinct,
each-idempotent records.

## Consequences

- The idempotency key `idx_tx_source_external` becomes
  `(source, externalId, kind)`, enforced **in-mutation** (Convex has no unique
  indexes — see ADR 0025). `kind` is a new discriminator (sale vs refund); it is
  independent of `type`/`reversalOf` and exists to scope idempotency.
- A retried refund finds its own `refund` row already present and does nothing —
  exactly one reversal.
- A refund for which no matching `income` exists has nothing to reverse; route
  it to Needs-review rather than creating a dangling reversal.
- Reversals created this way still follow ADR 0002 (near-copy of the original,
  flipped by the reversal sign rule).
