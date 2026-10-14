# Technical Roadmap — Finance Tracker

A code-level map of the codebase before implementation: file structure, types, function signatures, data flows, and build order. Stack: React + Vite (TS) frontend, Convex backend/DB/auth.

## 1. Project File Structure

```text
DaLedger/
├── convex/                       # Backend (Convex)
│   ├── schema.ts                 # Table + index definitions
│   ├── auth.config.ts            # Convex Auth providers
│   ├── auth.ts                   # currentOfficer() helper, guards
│   ├── accounts.ts               # account queries, opening-balance seed
│   ├── balances.ts               # computed-balance live queries
│   ├── transactions.ts           # create / reverse / markWithdrawalPaid / recordPayout / enterPartial / list
│   ├── review.ts                 # needs-review inbox query + label mutation
│   ├── reconciliations.ts        # reconcile mutation + freshness query
│   ├── reports.ts                # term report aggregation query
│   ├── recurring.ts              # template CRUD + draft generation (v1.1)
│   ├── naboopay.ts               # Naboopay client: verify, sweep, readBalance
│   ├── audit.ts                  # writeAudit() helper
│   ├── http.ts                   # httpRouter: /intake/income(/refund), /intake/naboopay
│   ├── crons.ts                  # scheduled: safetyNetSweep, monthlyDrafts
│   └── migrations/               # ordered migrations (see DATABASE_SCHEMA.md)
├── src/                          # Frontend (React + Vite)
│   ├── main.tsx                  # ConvexProvider + Router bootstrap
│   ├── routes/
│   │   ├── Home.tsx              # balances + review badge + last reconcile
│   │   ├── AddTransaction.tsx    # phone-first entry form
│   │   ├── Review.tsx            # needs-review inbox
│   │   ├── Transactions.tsx      # list + filters + CSV
│   │   ├── EventView.tsx         # per-event rollup
│   │   ├── Reconcile.tsx         # reconcile flow
│   │   ├── Report.tsx            # term report
│   │   ├── Recurring.tsx         # templates (v1.1)
│   │   └── Login.tsx
│   ├── components/
│   │   ├── AmountInput.tsx       # integer FCFA, large touch target
│   │   ├── AccountCard.tsx       # balance tile
│   │   ├── CategoryPicker.tsx    # with recent suggestions
│   │   └── TransactionRow.tsx
│   ├── hooks/
│   │   ├── useBalances.ts
│   │   ├── useTransactions.ts
│   │   ├── useReview.ts
│   │   └── useReconcile.ts
│   ├── lib/
│   │   ├── fcfa.ts               # formatFCFA / parseFCFA (integers, space sep)
│   │   └── csv.ts                # client-side CSV from a filtered list
│   └── types.ts                  # shared TS types (mirror of entities)
├── .env.example
├── vite.config.ts
└── package.json
```

## 2. Type Definitions

```typescript
// Entities (mirror DB tables)
type AccountKey = "naboopay" | "wave" | "om" | "cash" | "school";
type TxType = "income" | "expense" | "transfer" | "allocation" | "school_withdrawal" | "adjustment_up" | "adjustment_down"; // ADR 0001
type TxStatus = "confirmed" | "needs_review" | "committed" | "paid" | "draft" | "memo" | "skipped" | "provisional"; // ADR 0003,0007,0011,0012,0013
type TxKind = "income" | "refund"; // scopes intake idempotency (ADR 0005)
type Source = "shop" | "dabus" | "naboopay" | "manual" | (string & {});

interface Account { _id: string; key: AccountKey; name: string; openingBalance: number; isSchool: boolean; automatic: boolean; }

interface Transaction {
  _id: string;
  type: TxType;
  amount: number;            // positive integer FCFA
  occurredAt: number;        // epoch ms
  accountId: string;
  toAccountId?: string | null;
  reason: string;
  categoryId?: string | null;   // required only for income/expense, direction-matched (ADR 0009)
  eventId?: string | null;
  source: Source;
  kind: TxKind;                 // "income" for all non-intake entries (ADR 0005)
  externalId?: string | null;
  naboopayReference?: string | null;
  status: TxStatus;
  receiptUrl?: string | null;
  recordedBy: string;        // user id or source name
  reversalOf?: string | null;
  recurringId?: string | null;
  draftMonth?: string | null;   // "YYYY-MM" for recurring drafts; one-per-month key (ADR 0025)
  createdAt: number;
}

interface Reconciliation { _id: string; accountId: string; computedBalance: number; realBalance: number; difference: number; adjustmentId?: string | null; checkedBy: string; checkedAt: number; }
interface RecurringTemplate { _id: string; reason: string; amount: number; accountId: string; categoryId: string; eventId?: string | null; dayOfMonth: number; active: boolean; }

// Input types
interface CreateTransactionInput {
  type: TxType; amount: number; accountId: string; toAccountId?: string | null;
  reason: string; categoryId?: string | null; eventId?: string | null; occurredAt?: number; receiptUrl?: string | null; // categoryId required only for income/expense (ADR 0009)
}
interface IntakeIncomeInput {
  source: Source; externalId: string; amount: number; paidAt: string;
  description: string; naboopayReference: string; category?: string; event?: string;
}
interface ReconcileInput { accountId: string; realBalance: number; adjust: boolean; reason?: string; }

// API wrappers (HTTP layer)
interface ApiResponse<T> { data?: T; error?: ApiError; }
interface ApiError { code: "UNAUTHORIZED" | "VALIDATION" | "DUPLICATE" | "NOT_FOUND" | "RATE_LIMITED" | "SERVER_ERROR"; message: string; [k: string]: unknown; }
interface PaginatedResponse<T> { page: T[]; isDone: boolean; continueCursor: string; }

// Balances
interface AccountBalance { accountId: string; name: string; balance: number; }
interface BalancesView { accounts: AccountBalance[]; totalHeld: number; school: { balance: number; committed: number }; lastReconciled: Record<string, string>; }
```

## 3. Function Signatures

```typescript
// convex/balances.ts
export const list = query(async (ctx): Promise<BalancesView> => { /* opening + sum(tx) per account */ });
export const asOf = query(async (ctx, args: { date: number }): Promise<BalancesView> => { /* ADR 0016: live tx with occurredAt <= date */ });

// convex/transactions.ts
export const create = mutation(async (ctx, args: CreateTransactionInput): Promise<{ id: string; newBalance: number }> => {});
export const reverse = mutation(async (ctx, args: { transactionId: string; reason: string }): Promise<{ reversalId: string }> => { /* ADR 0020: no-op if target already has an active reversal */ });
export const markWithdrawalPaid = mutation(async (ctx, args: { transactionId: string; toAccountId: string }): Promise<{ id: string }> => { /* ADR 0019: guarded committed->paid, no-op otherwise */ });
export const recordPayout = mutation(async (ctx, args: { fromAccountId: string; toAccountId: string; grossOut: number; netIn: number; reason: string; occurredAt?: number }): Promise<{ transferId: string; feeExpenseId: string | null }> => { /* ADR 0015: net transfer + "Provider fees" expense for (grossOut - netIn) */ });
export const enterPartial = mutation(async (ctx, args: { provisionalId: string; amountReceived: number }): Promise<{ id: string }> => { /* ADR 0013: guarded provisional->confirmed with officer-entered amount */ });
export const list = query(async (ctx, args: { filter?: Partial<Record<"accountId"|"categoryId"|"eventId"|"source"|"type", string>>; from?: number; to?: number; cursor?: string }): Promise<PaginatedResponse<Transaction>> => {});

// convex/reports.ts
export const event = query(async (ctx, args: { eventId: string }): Promise<EventReport> => { /* ADR 0022: ALL-TIME income/expense/net by category */ });
export const term  = query(async (ctx, args: { from: number; to: number }): Promise<TermReport> => { /* ADR 0016,0021: occurredAt-scoped; balanceAsOf start/end; full movement reconciliation */ });
```

```typescript
// convex/auth.ts
export async function currentOfficer(ctx): Promise<{ _id: string } >; // throws if unauthenticated/inactive
export function requireOfficer(ctx): Promise<void>;
```

```typescript
// convex/naboopay.ts (external service wrapper)
export function verifyWebhook(rawBody: string, signature: string, secret: string): WebhookEvent | null; // HMAC over raw bytes
export async function listTransactions(opts: { limit: number; status?: string }): Promise<NabooTx[]>;    // GET /transaction/get-transactions
export async function readBalance(): Promise<number>;                                                    // GET /account/
```

```typescript
// convex/http.ts (route handlers — Convex httpAction)
export const intakeIncome  = httpAction(async (ctx, req) => { /* key check → validate → dedupe → insert */ });
export const intakeRefund  = httpAction(async (ctx, req) => { /* find original by (source,externalId,income) → write reversal keyed (source,externalId,refund); no match → needs_review */ });
export const naboopayHook  = httpAction(async (ctx, req) => { /* raw body → verify → match/flag */ });
```

```typescript
// src/hooks/useBalances.ts
export function useBalances(): { data?: BalancesView; isLoading: boolean };
// src/hooks/useTransactions.ts
export function useTransactions(filter?: TxFilter): { items: Transaction[]; loadMore: () => void; isDone: boolean };
// src/hooks/useReconcile.ts
export function useReconcile(): { submit: (input: ReconcileInput) => Promise<void>; lastByAccount: Record<string,string> };
```

## 4. Exact Data Flow

```text
Manual expense entry
  AddTransaction.tsx (form submit)
    → useMutation(api.transactions.create)(input)
      → convex/transactions.ts:create
        → requireOfficer(ctx)
        → validate: reason present, amount integer > 0, account exists
        → ctx.db.insert("transactions", {... status:"confirmed", recordedBy: officer._id})
        → audit.writeAudit(ctx, "create", id)
      ← { id, newBalance }
    → balances.list live query re-runs on every device
  ← Home.tsx balance tiles update instantly
```

```text
Shop sale → automatic income
  Shop backend (on Naboopay paid/done)
    → POST /intake/income  (X-Intake-Key, body with naboopayReference)
      → convex/http.ts:intakeIncome
        → resolve source from key (else 401)
        → validate amount/fields (else 422)
        → lookup (source, externalId, kind=income) → if exists: return existing (200, duplicate:true)
        → ctx.db.insert income on naboopay account, status:"confirmed"
      ← 201 { id }
```

```text
Naboopay webhook
  Naboopay → POST /intake/naboopay (X-Signature)
    → convex/http.ts:naboopayHook
      → raw = await req.text()
      → verifyWebhook(raw, sig, secret)  // constant-time HMAC
        → if invalid → 401
      → parse event; find tx by naboopayReference == order_id
        → matched → 200 { matched:true }  (confirmation only)
        → no match → 200 { matched:false, action:"none" }  (webhook creates NOTHING — ADR 0008)
```

```text
Safety-net sweep (cron)
  crons.ts:safetyNetSweep (scheduled)
    → naboopay.listTransactions({status:"paid"}) paginated
    → for each paid/done order_id older than the grace window (~30 min) with no
      matching income AND no existing unmatched row → insert needs_review (deduped by order_id; ADR 0008)
    → part_paid → insert provisional (balance-excluded) awaiting officer amount (ADR 0013)
```

## 5. Files to Create vs. Modify

**Create from scratch**

| File | Purpose |
|------|---------|
| `convex/schema.ts` | All tables + indexes |
| `convex/transactions.ts` | Ledger write/read logic |
| `convex/balances.ts` | Computed-balance live query |
| `convex/http.ts` | Intake + webhook endpoints |
| `convex/naboopay.ts` | Naboopay client + HMAC verify |
| `convex/crons.ts` | Sweep + monthly drafts |
| `src/routes/*` | All page components |
| `src/lib/fcfa.ts` | Integer FCFA format/parse |

**Modify existing (outside this repo)**

| File | What to change |
|------|----------------|
| Shop backend payment handler | On Naboopay paid/done: persist returned `order_id`, call `/intake/income` with retry |
| DaBus backend booking handler | Same as shop |
| Naboopay dashboard | Register webhook URL + secret; (later) issue server API key |

## 6. Component Interaction Map

```text
App (ConvexProvider, Router)
├── Login
└── AuthedShell (requires session)
    ├── Home            → useBalances, useReview(count)
    ├── AddTransaction  → useMutation(transactions.create); AmountInput, CategoryPicker
    ├── Review          → useReview; TransactionRow (label/confirm actions)
    ├── Transactions    → useTransactions(filter); lib/csv
    ├── EventView       → useQuery(reports.event)
    ├── Reconcile       → useReconcile
    ├── Report          → useQuery(reports.term)
    └── Recurring       → useQuery/useMutation(recurring.*)  (v1.1)
```

**State ownership**

| State | Lives in | Shared via |
|-------|----------|-----------|
| Session / current officer | Convex Auth | Convex client context |
| Balances | Convex (computed) | `useBalances` live query |
| Transaction list + filters | Convex + local filter state | `useTransactions`, URL query params |
| Review inbox count | Convex (computed) | `useReview`, Home badge |
| Draft form fields | Local component state | `AddTransaction` only |

## 7. Build Order

1. `convex/schema.ts` + types in `src/types.ts` (unblocks everything).
2. Convex Auth + `requireOfficer` + Login page.
3. `transactions.create` + `balances.list` + Home + AddTransaction (M1 acceptance).
4. `transactions.reverse` + transfer/withdrawal handling.
5. `http.ts` intake (income + refund) with idempotency (M2).
6. Review inbox + filters + CSV + Event view (M3).
7. Reconciliation + audit log (M4).
8. `naboopay.ts` verify/sweep/balance + webhook route + cron, plus manual `recordPayout` (net transfer + fee expense) and `enterPartial` (resolve provisional) (M5).
9. `reports.term` + Report page (M6).
10. `recurring.ts` + cron + Recurring page (M7 / v1.1).
11. Edge cases: `part_paid`, refunds, offline reconnect, empty/loading/error states.
