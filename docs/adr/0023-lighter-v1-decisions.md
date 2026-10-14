# ADR 0023 — Lighter v1 decisions (CSV, deactivation, notifications, roles)

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Pikou (Lead, IT Committee)

## Context

After two grilling rounds (ADRs 0001–0022) the ledger, status model, intake,
matching, reversals, time/period semantics, concurrency, and reporting are fully
pinned. Four lighter threads remained. None touches the schema shape, the balance
engine, or the money math, so none can cause rework — they are routine build-time
decisions, recorded here for completeness.

## Decision

1. **CSV export.** Export the visible columns plus ids, ordered by `occurredAt`
   descending, respecting the active filters (ADR 0016 defines the ordering date).
   Pure presentation; changeable anytime.
2. **User deactivation.** `active = false` blocks login; all `recordedBy` history
   stays intact and is never reassigned. Deactivate, never delete (consistent
   with the no-delete rule). Standard Convex Auth session handling.
3. **Notifications.** In-app only for v1 — badges and home-screen highlights
   (as in `USER_BLUEPRINT.md`). No email/push until explicitly requested.
4. **Reserved roles / approval.** The `role` field exists (`officer` equal in v1;
   `treasurer`/`president` reserved). President approval of withdrawals is a
   deferred P2 feature, not a v1 design gap.

## Consequences

- The v1 design is complete and build-ready; implementation can begin at
  Milestone 1 (schema + 8-status enum + balance engine) with every dependency
  pinned in an ADR.
- The only genuinely outstanding items are **external dependencies**, not design:
  a fresh Naboopay server API key, webhook registration, shop/DaBus backends
  persisting `order_id` and calling intake on paid/done, confirmed opening
  balances, and a small live-test budget. These are catalogued in the feasibility
  report's "what we need from your side" and are procurement/coordination, not
  grillable design questions.
