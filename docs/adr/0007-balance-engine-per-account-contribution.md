# ADR 0007 — The balance engine: per-account contribution, reversal flip, status gate

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Pikou (Lead, IT Committee)
- **Amended by:** ADR 0026 (`provisional` removed), ADR 0027 (reversal flip alternates along the chain), ADR 0028 (`cancelled` status)
- **Supersedes:** the simplified single-account formula noted in ADR 0002

## Context

Every balance is `openingBalance + sum of each transaction's effect`. Most types
affect one account, but `transfer` and a paid `school_withdrawal` affect **two**
accounts in opposite directions from a single row. So an entry's effect is
defined *relative to the account being computed*, not as one global sign.

## Decision

The effect of transaction `t` on account `X`:

| Type | X = accountId | X = toAccountId |
|---|---|---|
| income | +amount | — |
| expense | −amount | — |
| adjustment_up | +amount | — |
| adjustment_down | −amount | — |
| allocation | +amount (X = School) | — |
| transfer | −amount | +amount |
| school_withdrawal | −amount (X = School) | +amount |

Then, applied uniformly:

1. **Reversal flip** — multiply the effect by the chain sign `flip(t)`: `+1` if
   `reversalOf` is unset, else `−flip(t.reversalOf)` — i.e. **−1 per link** in the
   `reversalOf` chain, so a reversal is −1, a reversal-of-reversal +1, and so on
   (ADR 0027; the naïve "−1 whenever `reversalOf` is set" was wrong for chains).
   This undoes both legs of a two-leg entry in one row.
2. **Status gate** — a row contributes 0 unless "live". Live statuses:
   `confirmed`, `paid`, `needs_review`. Excluded (contribute 0): `committed`,
   `draft`, `memo`, `skipped`, `cancelled`.
   (`needs_review` counts because it is settled, fully-known money awaiting a
   label. ADR 0013's `provisional` was removed by ADR 0026; `cancelled` added by
   ADR 0028.)

`balance(X) = openingBalance(X) + Σ effect(t, X)` over all transactions.

## Consequences

- The balance function depends on `(transaction, account)`, not just the type.
  ADR 0002's single-account formula is a special case of this.
- **`needs_review` items count toward balances.** An unmatched Naboopay payment
  is real money that arrived; excluding it would make balances understate
  reality and undermine reconciliation. It stays in the inbox (needs a label)
  but still counts.
- Only `committed` (approved-not-paid withdrawals) and `draft` (recurring,
  unconfirmed) are "not real yet" and excluded.
- Reversal of a transfer is a near-copy (ADR 0002) whose −1 flip reverses both
  legs — no special-case transfer-reversal logic.
- School receivable balance uses the same engine: allocations (+) and paid
  withdrawals (− on the School leg).
