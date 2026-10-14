# ADR 0012 — Skipping a recurring draft is a terminal `skipped` status, not a delete

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Pikou (Lead, IT Committee)
- **Scope:** v1.1 (recurring expenses)

## Context

A recurring template creates one `draft` expense per month. The officer confirms
it or skips it. Two rules meet: "at most one draft per template per month" and
"nothing is ever deleted". If skipping *deletes* the draft, the (template, month)
slot is empty again and the next scheduled run recreates it — the skip never
sticks. The "one per month" guarantee depends on the row staying to occupy the
slot.

## Decision

"Skip" is a **status change, not a deletion** (consistent with the no-delete
rule and the edit-in-place lifecycle of ADR 0003). Add a terminal **`skipped`**
status:

- **Confirm** → draft edited if needed (amount/date), then `confirmed`; counts
  toward balances, dated its due date.
- **Skip** → `skipped`: leaves the inbox, changes no balance, and stays in place
  occupying the (template, month) slot so the job never recreates it.
- The one-draft-per-month guard (`recurringId` + due-month, unique) spans
  draft/confirmed/skipped — exactly one outcome per template per month.

## Consequences

- A recurring draft has three endings — confirmed, skipped, still-pending — none
  of which is a delete.
- The `status` enum grows to:
  `confirmed | needs_review | committed | paid | draft | memo | skipped`.
- `skipped` contributes 0 to balances (like `draft`) and is absent from the
  inbox.
- Editing a template changes future drafts only; existing draft/confirmed/skipped
  rows are untouched. Templates are deactivated, not deleted.
