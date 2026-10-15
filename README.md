# Finance Tracker — DAUST Student Government

> A ledger-first finance app for the DAUST SG: every movement of money is one transaction, and every balance is computed, never typed.

## Overview

The DAUST Student Government (SG) currently records its money in an Excel file. Keeping it complete is hard, so at the end of each term a correct financial review cannot be built. **Finance Tracker** replaces the spreadsheet with a ledger: every income, expense, and transfer is a single transaction, and every account balance is derived from those transactions plus a verified opening balance.

At any moment the app answers two questions: (1) how much money the SG holds across its accounts, and (2) how much the university still owes the SG. Income from the SG's own websites (the shop and DaBus) is recorded automatically through a secure intake endpoint; everything else is entered by hand — always with a reason — so the end-of-term review is a *report*, not a *reconstruction*.

It is built for the SG finance committee: a small, closed set of officers who need to record a transaction from a phone in under ten seconds, see live balances on every device, and reconcile against reality every week.

## Features

- **Live ledger** — computed balances for Naboopay, Wave, Orange Money, and Cash, plus a separate **School receivable** ("owed by the university"), which is never added into the SG total.
- **Manual entry** — income, expense, transfer, school allocation, school withdrawal, and up/down adjustments, phone-first, reason required.
- **Automatic income** — shop and DaBus payments arrive through a single idempotent intake endpoint, labelled by source.
- **Naboopay integration** — webhook-confirmed income matching, a scheduled sweep for unmatched payments, refunds, and payouts (captured automatically with their fees), and auto-reconciliation of the Naboopay balance.
- **Review inbox, labels, filters, CSV export** — categories, events, and sources; everything unlabelled lands in a Needs-review inbox.
- **Reconciliation & audit log** — compare computed vs. real balances; every edit is recorded with who, when, and what.
- **End-of-term review report** — totals by category and event, start/end balances, School movement, reconciliation history.
- **Recurring expense templates (v1.1)** — monthly draft expenses awaiting confirmation.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + TypeScript |
| Routing | React Router |
| State / data | Convex React client (live queries) |
| Backend | Convex (queries, mutations, HTTP actions, scheduled functions) |
| Database | Convex document-relational store |
| Auth | Convex Auth (closed officer set) |
| External API | Naboopay API v2 (`https://api.naboopay.com/api/v2`) — read only (ADR 0026) |
| Fonts / branding | IBM Plex Sans, DAUST SG branding |
| Hosting | Convex (backend) + static host for the Vite SPA <!-- assumed: Vercel/Netlify or the IT Committee's GitHub-linked host --> |

## Getting Started

### Prerequisites

- **Node.js** ≥ 20 and **npm** ≥ 10 <!-- assumed: current LTS; adjust to the IT Committee's standard -->
- A **Convex** account and the Convex CLI (`npm i -g convex`)
- Access to the SG **Naboopay** dashboard (for the webhook secret and, later, a server API key)
- Per-source **intake secret keys** for the shop and DaBus backends

### Installation

```bash
# 1. Clone
git clone https://github.com/DAUST-SG/DaLedger.git
cd DaLedger

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env.local
# fill in the values described in "Environment Variables" below

# 4. Start Convex (provisions the dev backend, watches functions)
npx convex dev

# 5. In a second terminal, start the web app
npm run dev
```

## Project Structure

```text
DaLedger/
├── convex/                  # Backend: schema, functions, HTTP endpoints, crons
│   ├── schema.ts            # Table definitions (accounts, transactions, …)
│   ├── auth.config.ts       # Convex Auth configuration
│   ├── transactions.ts      # Ledger queries & mutations
│   ├── balances.ts          # Computed-balance queries (live)
│   ├── reconciliations.ts   # Reconcile queries & mutations
│   ├── recurring.ts         # Recurring-template logic + cron
│   ├── http.ts              # httpAction routes: /intake/income, /intake/naboopay
│   ├── naboopay.ts          # Naboopay v2 client (sweeps, balance read)
│   └── crons.ts             # Scheduled jobs (sweep, monthly drafts)
├── src/                     # Frontend: React + Vite SPA (phone-first)
│   ├── routes/              # Page components (Home, AddTransaction, …)
│   ├── components/          # Reusable UI (amount input, account card, …)
│   ├── hooks/               # useBalances, useTransactions, useReconcile, …
│   ├── lib/                 # Formatting (FCFA), client helpers
│   └── main.tsx             # App entry, Convex provider, router
├── docs/                    # Project documentation (this bundle)
├── .env.example             # Template for required environment variables
└── package.json
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `CONVEX_DEPLOYMENT` | Convex deployment identifier (set by `convex dev`) | Yes |
| `VITE_CONVEX_URL` | Convex URL used by the React client | Yes |
| `INTAKE_SOURCES` | Comma-separated intake sources, e.g. `shop,dabus` (Convex cannot list env vars) | Yes |
| `INTAKE_KEY_SHOP` | Secret header key the shop backend sends to `/intake/income` (≥ 16 characters) | Yes |
| `INTAKE_KEY_DABUS` | Secret header key the DaBus backend sends to `/intake/income` | Yes |
| `NABOOPAY_WEBHOOK_SECRET` | HMAC-SHA256 secret used to verify Naboopay webhooks | Yes |
| `NABOOPAY_API_KEY` | Naboopay server API key (Bearer, scope `read`) for sweeps & balance read | Optional <!-- assumed: pending a valid server key; core capture works without it --> |
| `NABOOPAY_BASE_URL` | Naboopay API base, default `https://api.naboopay.com/api/v2` | No |

> Secrets are stored as Convex environment variables (`npx convex env set …`) and never committed or exposed to the frontend.

## License

Internal project of the DAUST Student Government. <!-- assumed: not open-source; confirm licensing with the IT Committee -->
