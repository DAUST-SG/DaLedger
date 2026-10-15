# ADR 0030 — Only labels are editable in place; money fields are reverse-and-re-enter

- **Status:** Accepted
- **Date:** 2026-10-15
- **Deciders:** Pikou (Lead, IT Committee)
- **Refines:** ADR 0014 (what an in-place `edit` may touch)

## Context

ADR 0014 says every in-place edit is logged, and lists amount, date, category,
reason and account as editable fields. But editing an amount, an account or a
date changes a balance with no ledger entry of its own. That breaks the design
spine, "a balance never changes without a ledger entry", and it makes back-dating
and staleness (ADR 0010) much harder to reason about.

## Decision

1. **Only labels are editable in place:** `categoryId`, `eventId` and `reason`.
   Each change writes an audit entry with the changed fields only (ADR 0014).
2. **Money fields are never edited:** `amount`, `accountId`, `toAccountId`,
   `occurredAt` and `type`. To fix one, reverse the entry (ADR 0002) and add it
   again.
3. **A category edit has two shapes, one mechanism** (`transactions.editLabels`):
   - Relabelling a `confirmed` income or expense (action `edit`).
   - Labelling a `needs_review` item, which sets the category and flips the status
     to `confirmed` in the same write (action `assign_category`). This is the single
     inbox-clearing action of ADR 0006.

   Both enforce ADR 0009's direction match and never accept `Unlabeled`, so an item
   can never be `confirmed` while `Unlabeled`.
4. **Labels move with the reversal chain.** A category or event change on an
   original applies to every reversal below it, so a reversed item keeps netting to
   zero inside its own category and event (ADR 0002). A reversal's own category and
   event can't be edited directly; its reason can.
5. **Events:** a row can be tagged only with an open event, or keep the closed event
   it already has (ADR 0022). Clearing the tag is allowed.
6. Edits are guarded: repeating the same edit changes nothing and writes no audit
   entry (ADR 0019).

## Consequences

- Every change to a balance is a ledger entry. Edits change only how money is
  labelled, never how much or where.
- The fix for an unknown event dropped at intake (ADR 0029) is a label edit.
- Recurring drafts are excluded: their confirm and skip flow (ADR 0012) is a
  separate status transition in M7.
