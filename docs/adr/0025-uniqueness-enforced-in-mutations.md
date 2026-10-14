# ADR 0025 — Uniqueness is enforced in mutations; the draft-month key is an explicit field

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Pikou (Lead, IT Committee)

## Context

The schema's SQL illustration shows `CREATE UNIQUE INDEX` for
`(source, externalId, kind)` and for one-draft-per-template-per-month. **Convex
has no unique indexes.** The month index also referenced an `occurredAtMonth`
field that was never defined on the table.

## Decision

1. **Uniqueness is enforced inside mutations, not by the database.** Before
   inserting, the mutation queries the relevant `.index()` and rejects /
   returns-existing if a match is found. Convex serialises mutations, so this
   read-then-write check is race-free (same discipline as ADR 0019).
   - Intake income/refund: query `by_source_external_kind` on
     `(source, externalId, kind)`; if present, return the existing record
     (duplicate), else insert (ADR 0005).
   - Recurring draft: query `by_recurring_month` on `(recurringId, draftMonth)`;
     insert only if absent (ADR 0012).
2. **The draft-month key is an explicit field `draftMonth`** (string `"YYYY-MM"`),
   stamped when a recurring draft is created, replacing the undefined
   `occurredAtMonth`. The index `by_recurring_month` is
   `(recurringId, draftMonth)`.

## Consequences

- The SQL `UNIQUE INDEX` lines are illustration only; the real guarantee is the
  in-mutation check plus a non-unique Convex `.index()` for the lookup.
- `transactions.draftMonth` is added to the schema (null except for
  recurring-generated drafts).
- No behavioural change versus the ADRs that assumed uniqueness — only the
  enforcement mechanism is now correct for Convex.
