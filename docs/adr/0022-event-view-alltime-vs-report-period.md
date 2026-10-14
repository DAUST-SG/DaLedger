# ADR 0022 — Event view is all-time; report by-event is period-scoped; both labelled

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Pikou (Lead, IT Committee)

## Context

Two surfaces show an event's net: the Event view and the term report's by-event
line. For an event inside one term they agree; for a cross-term event (deposit
one term, rest the next) they differ — and an officer who doesn't know why will
think one is a bug.

## Decision

Define both precisely and label them:

- **Event view = all-time** for that event: every live entry tagged to it, by
  `occurredAt`, across all time — the event's one true lifetime P&L.
- **Report by-event = period-scoped**: only entries with `occurredAt` inside the
  report window (ADR 0016).
- An event's all-time net = the sum of its per-period nets, so the two
  reconcile rather than contradict.
- **Label on screen:** "Gala — all time" vs "Gala — this period (Sep–Dec)".

## Consequences

- "Did the Gala make money?" has two valid, reconciling answers (lifetime vs this
  term); the UI names which one is shown.
- Both use the same per-category income/expense grouping and the ADR 0007 engine;
  only the date filter differs.
- `events.active` gates whether an event accepts *new* tags; it does not affect
  either total (historical entries still roll up).
