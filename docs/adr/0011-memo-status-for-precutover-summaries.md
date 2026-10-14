# ADR 0011 — Pre-cutover event summaries use a report-only `memo` status

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Pikou (Lead, IT Committee)

## Context

At cutover the Excel history is not imported; accounts start from verified
opening balances. But the end-of-term report should still show totals for events
that happened *before* cutover, entered as per-event summary figures.

A transaction is defined as something that moves a balance. A pre-cutover
"summary income" would add to an account whose opening balance already includes
that money — double-counting and breaking the balance. These summaries must
appear in event/category reports but be invisible to balances.

## Decision

Add a report-only status **`memo`**:

- A `memo` entry **contributes 0 to every account balance** (same gate position
  as `committed`/`draft` in ADR 0007).
- It **is included in category and event reports** for its period, flagged as a
  pre-cutover summary.
- It carries `eventId`, direction (income/expense), `amount`, `reason`; it needs
  no real account effect and never touches the SG total.

Chosen over a separate `eventSummaries` table to avoid duplicating reporting
logic for a small number of historical events.

## Consequences

- **Balance math and report math diverge on purpose here:** balances exclude
  `memo`; event/category reports include it. This is the one deliberate
  divergence and must be documented loudly wherever either is computed.
- The full `status` enum is now:
  `confirmed | needs_review | committed | paid | draft | memo`.
- Report queries must opt `memo` *in*; balance queries must leave it *out*
  (balances already exclude everything not in the live set of ADR 0007).
- `memo` entries are created only during cutover; the manual form may hide the
  option behind an "add historical event summary" action.
