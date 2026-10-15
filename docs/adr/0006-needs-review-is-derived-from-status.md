# ADR 0006 — Needs-review is a derived view keyed on status

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Pikou (Lead, IT Committee)
- **Amended by:** ADR 0026 (`provisional` removed)

## Context

The Needs-review inbox gathers unfinished items so it can trend to zero. Items
arrive from three places: auto-captured items with no label, unmatched Naboopay
payments (safety-net), and recurring drafts.

An unlabelled item is marked two ways at once — the sentinel category
`Unlabeled` *and* the status `needs_review`. Two signals for one fact can drift:
a code path might change one and not the other, leaving an item half in and half
out of the inbox, with screens disagreeing.

## Decision

**Status is the single source of truth for inbox membership**, and the inbox is
a derived query, not a stored flag:

> in the inbox ⇔ `status ∈ {needs_review, draft}`.

(ADR 0013 briefly added `provisional`; ADR 0026 removed it, since Naboopay v2 has
no `part_paid`.)

One enforced invariant prevents drift: **an item can never be `confirmed` while
its category is `Unlabeled`.** Assigning a real category is the single action
that flips `needs_review → confirmed`; the two changes always happen together.

## Consequences

- Captured without a category → `Unlabeled` + `needs_review` → in inbox.
- Officer assigns a real category → `confirmed` → leaves inbox (one atomic
  action does both).
- Safety-net unmatched payment → `needs_review` until matched or recorded.
- Recurring draft → `draft` until confirmed or skipped.
- `Unlabeled` explains *why* an item entered the inbox; `status` governs
  membership — they cannot contradict.
- Manual entries require a category at entry (form won't save without one), so
  they never enter the inbox as unlabelled; the inbox is fed by automation and
  drafts.
