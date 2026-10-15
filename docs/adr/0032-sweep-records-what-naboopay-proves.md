# ADR 0032 — The sweep records what Naboopay proves: refunds, fees, payouts

- **Status:** Accepted
- **Date:** 2026-10-15
- **Deciders:** Pikou (Lead, IT Committee)
- **Revises:** ADR 0026 §3–5. **Amends:** ADR 0009 (an expense may wait for its
  category while in review). **Drops:** manual `recordPayout` for v1 (ADR 0015).

## Context

ADR 0026 planned to *flag* refunded orders and wrong-fee payments, and to keep a
manual `recordPayout` as a fallback. Building M5 showed three things. Naboopay
v2 reports these facts exactly: refunds are full only, and the fee is known. A
flag that writes nothing leaves the balances wrong until someone acts. And a
manual payout entry would be counted twice once the sweep sees the same payout.

## Decision

The order and payout sweeps **record** these as real ledger entries, each once
(idempotent on `source: naboopay` + an `externalId` derived from the Naboopay
`order_id`), with audit actor `naboopay`, listed on Review under "Detected by
Naboopay":

1. **Refunded order whose sale has no active reversal** (after the grace window):
   the sweep writes the reversal of the sale (`kind: refund`). A later backend
   refund sees the active reversal and does nothing (ADR 0020).
2. **Paid with `fees_customer_side = false` and `fees > 0`:** a "Provider fees"
   expense for the exact fee, so the overstated income is corrected and the
   backend's policy error is visible to the Treasurer.
3. **Completed payout to an SG wallet** (numbers in `NABOOPAY_SG_WALLETS`): a
   transfer Naboopay → Wave or OM for the amount, plus a "Provider fees" expense
   for its fee (ADR 0015).
4. **Completed payout to any other wallet** (a supplier, a customer): an
   **expense with no category yet**, status `needs_review`, plus its fee. It waits
   in the inbox until an officer picks the category, which confirms it (ADR 0006,
   0030). This amends ADR 0009: an expense may lack a category **only while
   `needs_review`**, mirroring `Unlabeled` income. It can never be `confirmed`
   without one.
5. **No manual `recordPayout` in v1.** Payouts come from the feed; anything the
   feed gets wrong is corrected with a reconciliation adjustment.

## Consequences

- "The feed creates nothing" (ADR 0026) now means *no income*: income is still
  captured only by the backends (one capture point). The sweep creates only what
  Naboopay itself proves: unreported-payment placeholders, refunds, fees and payouts.
- The tracker still never calls `POST /payouts` or `GET /refund`; the key stays
  `read`-only.
- Only orders and payouts after cutover are swept, so the first run doesn't
  record Naboopay's whole history.
