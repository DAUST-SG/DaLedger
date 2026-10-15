# ADR 0014 — Audit-log scope: what counts as an edit and what is stored

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Pikou (Lead, IT Committee)
- **Amended by:** ADR 0026 (`enter_partial` / part_paid removed); **refined by ADR 0030** (only labels, category/event/reason, are editable in place; money fields are reverse-and-re-enter)

## Context

"Nothing is deleted; every edit is logged with who/when/what" is a cornerstone
rule. The model now has many in-place edits — mark withdrawal paid, confirm/skip
a draft, assign a category (which flips status). "Edit" needed a precise
definition and a storage granularity.

## Decision

1. **Every state-changing write to a transaction is logged:** creates, field
   edits (**ADR 0030 limits in-place edits to labels — `categoryId`, `eventId`,
   `reason`; money fields are reverse-and-re-enter**), and status transitions
   (`committed→paid`, `needs_review→confirmed`, `draft→confirmed/skipped`).
   Pure reads are not logged; a reconciliation *check*
   is already its own stored record.
2. **Store changed fields only** in `before`/`after`, not a full snapshot. A
   create has empty `before`.
3. **Each entry carries a semantic action**: `create`, `edit`, `mark_paid`,
   `confirm_draft`, `skip_draft`, `assign_category`, `reverse`, `adjust`, …
4. **Money entries (reversals, adjustments) live in both the ledger and the audit
   log without double-counting:** the reversal/adjustment is a real transaction
   (the money record balances use); the audit entry only witnesses it (who/why).

## Consequences

- Ledger = money truth; audit log = accountability truth. They cross-reference
  but never duplicate money.
- `auditLog.action` is an open, extensible string of named actions.
- Changed-fields-only keeps the log lean while remaining sufficient to
  reconstruct a row's history.
- Every in-place edit introduced by ADRs 0003, 0006, 0012 produces an
  audit entry.
