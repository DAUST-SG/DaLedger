# ADR 0017 — Negative School receivable is warned and flagged, not blocked

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Pikou (Lead, IT Committee)

## Context

The School receivable is `allocations − paid withdrawals`. Nothing structurally
prevents it going negative: a paid withdrawal larger than what was allocated
drives it below zero. A negative "they owe us" usually means a **missing
allocation** or a **data-entry mistake** — but can also be a legitimate timing
gap (an advance paid before its allocation is recorded).

## Decision

Allow negative School, but never silently (consistent with ADR 0010's
warn-don't-lock philosophy):

- **At entry:** if a paid withdrawal would make School negative, show a soft
  warning ("This exceeds the remaining School receivable (X). A university
  allocation may be missing. Continue?") — the officer may proceed or cancel.
- **At rest:** if School is negative, a persistent home-screen flag ("School
  receivable is negative — record the missing allocation or correct a
  withdrawal").
- **Correctable** via the normal tools: a reversal (ADR 0002) or an
  `adjustment_up`/`adjustment_down` on the School receivable (ADR 0007 already
  supports adjustments on School).

## Consequences

- Negative School is possible but always visible; no hard block.
- Needs a cheap "is School < 0" check for the warning (point-in-time projected
  balance after the entry) and the home-screen flag.
- Mirrors the app-wide stance: surface anomalies, don't lock officers out.
