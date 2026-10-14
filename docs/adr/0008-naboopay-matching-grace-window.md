# ADR 0008 — Naboopay matching: webhook is passive, unmatched comes from a sweep with a grace window

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Pikou (Lead, IT Committee)

## Context

Income is captured once, by the shop/DaBus backend (rule 4); the Naboopay side
must never create income again. On a payment, Naboopay fires a webhook to the
tracker *and* notifies the backend, which then calls intake. These arrive in
**either order**. If the webhook (or a sweep) checks for a match before intake
lands and immediately files an "unmatched payment", it creates a phantom
Needs-review item that self-resolves seconds later — eroding trust in the inbox.

## Decision

1. **The webhook creates nothing.** No income (backend's job), no unmatched flag.
   On a match it is a quiet confirmation/no-op; on a non-match it does nothing.
   This removes the race from the webhook path entirely.
2. **Only the scheduled safety-net sweep raises unmatched items, and only after
   a grace window.** A paid/done `order_id` is flagged unmatched only if it is
   older than the window (default **30 minutes**, configurable) with still no
   matching income — long enough for intake plus retries to land.
3. **Unmatched items are deduped by `order_id` (`naboopayReference`)** so repeated
   sweeps never pile up duplicates of the same gap.
4. **Self-healing:** when the real intake income later arrives carrying that
   `naboopayReference`, the existing unmatched placeholder is auto-resolved —
   matched and cleared — not left as a second record.

## Consequences

- An "unmatched payment" in the inbox means a *real* gap (a backend that failed
  to report after the grace window), never a timing hiccup.
- The webhook's value is confirmation/observability, not capture; the sweep is
  the authoritative safety net. The system still works if the webhook is down.
- Requires a lookup of unmatched placeholders by `naboopayReference` at intake
  time (self-heal) and a dedupe check in the sweep.
- Grace window is a tunable constant; 30 min is the starting value, revisit if
  backend retry behaviour is slower.
