# ADR 0015 — A payout with a fee is a net transfer plus a separate fee expense

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Pikou (Lead, IT Committee)
- **Revised by:** ADR 0026

> **Revised by ADR 0026.** Naboopay v2 reports each payout's amount and fee
> (`GET /payouts`), so payouts are captured automatically by a sweep in the shape
> below; the manual `recordPayout` is the fallback. The two-entry shape stands.

## Context

A transfer carries a single amount and is neutral (equal in and out). But a
Naboopay payout to Wave/OM often incurs a fee: 100 000 leaves Naboopay, the
provider keeps 1 500, and 98 500 lands in Wave. "Out" and "in" differ, so one
transfer cannot represent it without overstating one account and hiding the fee.

(Note: per-*sale* fees are avoided via `fees_customer_side = true`; this ADR is
about *payout/cashout* fees, which still exist and are entered manually.)

## Decision

Record a payout-with-fee as **two entries**:

1. A **transfer of the net amount** actually received (98 500, Naboopay → Wave).
   The transfer stays strictly equal-in/equal-out and neutral.
2. A **separate expense of the fee** (1 500, on Naboopay, category
   "Provider fees").

Net: Naboopay −100 000, Wave +98 500, fee +1 500 booked as expense; SG total
drops by exactly the fee — the real cost.

## Consequences

- Transfers remain pure (equal, neutral) with no exceptions.
- Every fee is always an **expense** (category "Provider fees"), never hidden
  inside a transfer.
- The manual "record a payout" action takes *gross out* and *net in*, computes
  the fee, and writes the transfer + fee-expense pair in one step — no arithmetic
  for the officer.
- Generalises to any Naboopay charge: it is an expense, entered manually, since
  no automatic fee feed exists.
