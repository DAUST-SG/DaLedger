# v2 feature — Funds: what part of the money held belongs to which event

| | |
|---|---|
| **Status** | Deferred to v2 (not scheduled). Not a v1 decision: nothing here is binding until it becomes an ADR (planned as the next free number) and Pikou approves it. |
| **Raised by** | Treasurer, 2026-10-15 |
| **Depends on** | M1 balance engine, M3 event tags and label edits (ADR 0030). No schema change. |

## The question it answers

"Of the 324 550 FCFA we hold, how much is still from the Gala, how much did the
trays fundraiser earn, and what is general money?" v1 shows balances per account
and each event's all-time profit (Event view), but doesn't split the **total held**
by where the money came from.

## The idea

- **A fund is an event.** That includes a fundraising campaign: create it as an
  event (e.g. "Trays fundraiser – Nov 2026") and tag its sales and its costs to it.
- **General fund** = everything not tagged to an event: opening balances, untagged
  income and expenses, adjustments.
- Every entry is either tagged to one event or untagged, so **the funds always add
  up exactly to the total held**, by construction.

```
Held by the SG                      324 550 FCFA
  Gala 2026                          60 000   (80 000 in − 20 000 spent)
  Trays fundraiser – Nov 2026        34 500   (42 000 sales − 7 500 trays bought)
  Integration Week                   −4 000   (spent more than it raised; General covered it)
  General fund                      234 050
                                    ───────
                                    324 550   always equals the total held
```

When a campaign ends, close the event: its fund stays visible. Spending the profit
on its purpose (tagged to the same event) brings the fund down toward 0.

## Draft definition (for the future ADR)

- `fund(E) = Σ effect(t, X)` over the four **cash** accounts X, for every live entry
  t tagged to event E: the same engine, status gate and reversal sign as balances
  (ADR 0007, 0027).
- `General = total held − Σ fund(E)` = opening balances + every untagged entry.
- **By type:**
  - income adds and an expense subtracts;
  - a transfer tagged to an event nets to 0;
  - an adjustment tagged to an event counts;
  - an allocation never counts (School isn't held, ADR 0004);
  - a paid school withdrawal tagged to an event adds to that fund.
- **Not counted:** School, `memo` summaries (ADR 0011), anything not live.
- **Point in time:** `fundsAsOf(date)` with `occurredAt ≤ date` (ADR 0016), so the
  term report can show funds at the start and end of a term.
- **Fund vs Event view:** the Event view's net is lifetime profit (includes `memo`,
  excludes withdrawals); the fund is money still held. Both are labelled.

## What it would build

- `convex/funds.ts`: `funds.list` / `asOf`, reusing `effect` and `reversalFlip`
  through the existing `by_eventId` index.
- **Home:** a Funds section under "Held by the SG". Negative funds are shown in red;
  tap an event to open its Event view.
- **Event view:** a "Still held in this fund" line.
- **Test:** the invariant Σ funds + General = total held, now and at past dates,
  across every entry type, reversals, withdrawals and memos.

## The one rule it relies on

A fund is only as accurate as the event tags. An expense paid for an event but left
untagged comes out of General. Missing tags can be fixed at any time with the M3
label edits (audited); Add transaction would remind officers to tag event spending.

## Open questions (to settle when it's scheduled)

1. **Home list:** every event with a non-zero fund, open or closed, plus General?
2. **School withdrawals:** do paid ones tagged to an event count toward that fund?
   (Proposed: yes.)
3. **Restricted funds:** money that may only be spent on its purpose, if a sponsor
   ever imposes conditions. Would build on top of this.
4. **Link to the fundraising seller page** (live sales by non-officers, offline),
   also deferred: each campaign would be one of these events.
