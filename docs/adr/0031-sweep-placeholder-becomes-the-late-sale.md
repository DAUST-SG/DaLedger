# ADR 0031 — A late intake sale takes over its sweep placeholder

- **Status:** Accepted
- **Date:** 2026-10-15
- **Deciders:** Pikou (Lead, IT Committee)
- **Delivers:** ADR 0008 §4 (self-healing). **Narrow exception to:** ADR 0030.

## Context

The safety-net sweep records a paid Naboopay order that no backend reported after
the grace window as an *unreported payment* placeholder: an `income` on Naboopay,
`source: naboopay`, `Unlabeled`, `needs_review` (ADR 0008). Sometimes the backend's
real intake call arrives later (a long outage, a retry queue). Inserting the sale
would count the money twice. Reversing the placeholder and adding the sale would
be honest but would leave two extra rows in the inbox for every late report.

## Decision

1. Intake matches on **`naboopayReference` (the Naboopay `order_id`)**, not on
   `(source, externalId, kind)`: the placeholder's source is `naboopay`, the
   intake's is `shop` or `dabus`. After its normal duplicate check misses, intake
   looks for a placeholder with that `order_id` (source `naboopay`, type `income`,
   not a reversal and not reversed).
2. **Same amount → the placeholder becomes the sale**, in one write with audit action
   `match`. The system sets:
   - identity: `source`, `externalId`, `recordedBy`;
   - labels: `reason`, `categoryId` and `eventId`, resolved by ADR 0029. A category
     an officer already gave the placeholder wins over the intake's fallback;
   - `status: confirmed` if it is now labelled.

   **Money fields never change:** `amount`, `accountId`, `occurredAt` and `type`
   stay as they are. Nothing is counted twice, and the row now satisfies the
   intake's `(source, externalId, kind)` key, so retries are duplicates.
3. **Different amount → no match:** the sale is recorded normally and the
   placeholder stays in the inbox for an officer to investigate.

## Consequences

- This is the one place the *system* writes non-label fields onto an existing row.
  It is narrow (identity plus labels, never money), audited, and limited to rows
  the sweep created.
- The sweep checks for a sale by `order_id` before creating a placeholder, so a
  matched order is never placeholdered again.
