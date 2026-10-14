# ADR 0004 — School is a receivable, not a cash account

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Pikou (Lead, IT Committee)

## Context

The home screen shows five balances. Four (Naboopay, Wave, OM, Cash) are money
the SG physically holds. "School" is "money the university owes the SG" — a
different kind of thing. Treating it as just another account risks an officer
reading a large School balance as spendable cash.

## Decision

Model School as a **receivable** — an amount *owed to* the SG, not held by it.
It is kept in the `accounts` table for machinery reuse but flagged `isSchool`
and labelled in the UI as **"owed by the university"**, never summed into the
"held by the SG" total. The canonical term is **School receivable**, not
"School account".

Two firm invariants:

1. **An allocation never touches a real account.** It only raises the School
   receivable. Money becomes spendable cash *only* via a paid
   [[school withdrawal]].
2. **Reconciling School is different.** It is not counted like cash or read off
   an app; it is checked against the **university's statement** of what is still
   owed.

## Consequences

- SG total = Naboopay + Wave + OM + Cash, strictly cash-on-hand. School is shown
  separately and never added in.
- School receivable balance = allocations − paid withdrawals (committed
  withdrawals excluded).
- Drawing down the allocation converts a claim into cash: School shrinks, a real
  account and the SG total grow, at the moment of payment.
- School reconciliation compares the computed receivable against the university
  statement; its "real balance" source differs from the cash accounts.
- Open sub-questions for later: can the School receivable go negative (withdrawals
  exceeding allocations)? Are allocations themselves reversible/adjustable? —
  revisit when allocation handling is modelled.
