# ADR 0013 — part_paid counts only after an officer enters the actual amount received

- **Status:** Superseded by ADR 0026
- **Date:** 2026-10-13
- **Deciders:** Pikou (Lead, IT Committee)

> **Superseded by ADR 0026.** Naboopay API v2 has no `part_paid` status, so the
> `provisional` status and the enter-the-amount flow (`enterPartial`) are removed.

## Context

Naboopay payment states include `part_paid` (customer paid part of the order).
The partial money really is held in the Naboopay account, so for "how much do we
hold" it should be reflected — this is the Treasurer's requirement.

The obstacle is the **amount**, not the reality. Naboopay's transaction/webhook
data exposes the order's **nominal amount** and `amount_to_pay`, but **no field
for how much was actually received** on a partial. Auto-booking the nominal
amount would overstate the balance (e.g. book 12 000 when only 5 000 was paid) —
the exact error the app exists to prevent.

## Decision

A `part_paid` payment surfaces as a **Needs-review item that does not
auto-count**, prompting: "Partial payment on order X — enter the amount actually
received." The officer reads the real figure from the Naboopay dashboard and
confirms it. **At confirmation it becomes a normal settled income for the true
amount and counts** toward the balance. When the order later flips to
`paid`/`done`, the remainder flows through the normal path.

Only the brief window between "Naboopay says partial" and "officer entered the
real amount" is excluded from balances.

## Consequences

- Refines ADR 0007: "needs_review counts toward balance" means **settled,
  fully-known** unreported income. A part_paid placeholder is **provisional** —
  inbox-visible but balance-excluded until the officer supplies the amount.
- Adds a `provisional` status: in the inbox (so it is chased), excluded from
  balances (gate alongside `committed`/`draft`/`memo`/`skipped`). Full enum:
  `confirmed | needs_review | committed | paid | draft | memo | skipped | provisional`.
- The system never invents a partial amount; a human supplies the one number the
  API will not give.
- Backstop: the weekly Naboopay reconciliation against `GET /account/` catches
  any un-actioned partial and closes it with an adjustment.
