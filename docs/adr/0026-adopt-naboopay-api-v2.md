# ADR 0026 — Build against Naboopay API v2

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Pikou (Lead, IT Committee)
- **Supersedes:** ADR 0013. **Revises:** ADR 0015. **Amends:** ADR 0005, 0006, 0007.
- **Revised by:** ADR 0032 (the sweep *records* refunds, wrong-fee fees and payouts instead of flagging them; no manual `recordPayout` in v1) and ADR 0031 (late sale takes over its placeholder)

## Context

The feasibility report and ADRs 0001–0025 were checked against Naboopay API
**v1** (`/api/v1`). Naboopay's current docs and agent skill describe API **v2**
(`https://api.naboopay.com/api/v2`) and mark v1 as deprecated. Several limits we
designed around were v1 limits that v2 removes:

| v1 assumption | v2 reality |
|---|---|
| A `part_paid` status exists, so partial payments need special handling (ADR 0013) | No `part_paid`. Transaction statuses are `pending`, `paid`, `paid_and_blocked`, `cancelled`, `refunded` |
| The webhook gives only the nominal amount, so fees are unknown | The webhook (v2 body) carries `amount`, `fees`, `fees_customer_side`, `paid_at`, `products` |
| No payout feed, so payouts are entered by hand (ADR 0015) | `GET /payouts` and `GET /payouts/{order_id}` list payouts with amount, fees, status, `paid_at` |
| No refund API; a refund is a manual cash-out | `GET /refund/{order_id}` performs a full refund; the transaction becomes `refunded` |
| Balance via `GET /account/` | Balance via `GET /accounts` |
| `order_id` is the only match key | Unchanged: Naboopay generates `order_id`; there is still no merchant reference |

## Decision

Build against **Naboopay API v2** only. Register webhooks with the **v2 payload**.

1. **No `provisional` status.** v2 has no partial-payment state, so ADR 0013 is
   superseded: the `provisional` status, the "enter the amount actually
   received" flow and `transactions.enterPartial` are removed. The status enum
   goes from 8 values to 7:
   `confirmed | needs_review | committed | paid | draft | memo | skipped`.
   The inbox is `status ∈ {needs_review, draft}` again (ADR 0006).
2. **Paid means `paid` or `paid_and_blocked`.** Both are treated as paid for
   matching and for the safety-net sweep (ADR 0008). The SG does not use escrow,
   so `paid_and_blocked` is not expected, but it is not ignored.
3. **Fee policy: `fees_customer_side: true`.** The v2 default is `false` (the SG
   pays). The shop and DaBus backends must set `true` explicitly on every
   transaction they create, so the customer pays the fee and income equals
   `amount` with no per-sale expense. Because v2 reports `fees` and
   `fees_customer_side` per transaction, a payment created with the wrong policy
   is detectable exactly; the sweep flags it for review instead of guessing.
4. **Payouts are captured from the feed.** A scheduled sweep reads `GET /payouts`
   and records each `completed` payout once, idempotent on the payout's
   `order_id`, using ADR 0015's shape (a transfer of the net amount plus a
   "Provider fees" expense for the fee). *(Superseded by ADR 0032: there is no
   manual `recordPayout` in v1 — an officer corrects anything the feed misses with
   an adjustment.)* The tracker still never creates payouts.
5. **Refunds are detectable in the feed.** A Naboopay transaction that turns
   `refunded` while its income has no reversal is surfaced by the sweep after the
   ADR 0008 grace window, deduped by `order_id`, and self-heals when the source's
   refund intake (ADR 0005) arrives. The tracker never calls `GET /refund`.
6. **Key scope: `read` only.** The tracker's server key needs `read` (for
   `/transactions`, `/accounts`, `/payouts`). Intake needs no Naboopay key (the
   backends hold their own). The tracker never needs `payout`, `write` or
   `checkout`, because it never moves money.

## Consequences

- One status fewer in the schema, the balance gate and the inbox (7 at the time
  of this ADR; ADR 0028 later re-added one as `cancelled` → 8 — see the schema
  status table for the authoritative set).
- The "we cannot know the fee" problem disappears: fees are exact per
  transaction and per payout.
- Payout entry moves from manual to automatic, removing the commonest source of
  Naboopay reconciliation gaps. (ADR 0032: no manual `recordPayout` in v1;
  anything the feed misses is corrected with an adjustment.)
- The exact sweep mechanics (mapping a payout's destination wallet to the Wave or
  OM account, what a payout to a wallet the SG does not own becomes, and the
  shape of a flagged refund or wrong-fee payment) are settled in the M5 plan,
  within the rules above.
- `NABOOPAY_BASE_URL` defaults to `https://api.naboopay.com/api/v2`.
- The two secrets stay distinct: the webhook secret verifies inbound webhooks;
  the server API key (scope `read`) calls Naboopay.
