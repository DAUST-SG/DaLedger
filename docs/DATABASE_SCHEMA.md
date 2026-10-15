# Database Schema — Finance Tracker

| | |
|---|---|
| **Database** | Convex document-relational store |
| **Naming** | camelCase fields; table names plural; ids are Convex references |
| **Money** | integer FCFA, always positive in `amount`; direction comes from `type`. Stored as `v.number()` with a runtime integer+positive guard — not `v.int64()` (ADR 0024) |

> SQL is shown below as a portable illustration of indexes, relationships, and access rules. In Convex these map to `defineTable`, `.index()`, and function-level auth checks respectively. The authoritative definition lives in `convex/schema.ts`.

> **Decision records:** this schema reflects ADRs 0001–0030 in `docs/adr/`. Where
> a field or rule cites an ADR, that record is the rationale of record.

## Tables

### accounts

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `_id` | id | pk | Account id |
| `key` | string | unique | `naboopay` \| `wave` \| `om` \| `cash` \| `school` |
| `name` | string | not null | Display name |
| `openingBalance` | int | not null | Verified balance at cutover. **Write-once**; later corrections are cutover-dated adjustments, never field edits (ADR 0018) |
| `isSchool` | bool | not null | True for the **School receivable** — money the university *owes* the SG, shown separately and never added to the SG total (ADR 0004) |
| `automatic` | bool | not null | True only for Naboopay |

### transactions

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `_id` | id | pk | Transaction id |
| `type` | enum | not null | `income`\|`expense`\|`transfer`\|`allocation`\|`school_withdrawal`\|`adjustment_up`\|`adjustment_down` (ADR 0001) |
| `amount` | int | not null, > 0 | Whole FCFA, positive; direction from `type`, flipped if `reversalOf` is set (ADR 0002, 0007) |
| `occurredAt` | timestamp | not null* | When money moved (payment time for automatic). *For a `committed` withdrawal, set only on the transition to `paid` (ADR 0003) |
| `accountId` | ref → accounts | not null | Affected account; source account for a transfer / paid school withdrawal |
| `toAccountId` | ref → accounts | null | Destination (transfers & school withdrawals only) |
| `reason` | string | not null | Required; shown in every list and report |
| `categoryId` | ref → categories | null | **Required only for `income`/`expense`, and direction-matched to the entry; empty for all other types** (ADR 0009). `Unlabeled` sentinel for auto-captured income without one |
| `eventId` | ref → events | null | Optional event tag |
| `source` | string | not null | `shop`\|`dabus`\|`naboopay`\|`manual`\|future key |
| `kind` | enum | not null | `income`\|`refund` — scopes intake idempotency so a sale and its refund are distinct records (ADR 0005). `income` for all non-intake entries |
| `externalId` | string | null | Source system id; unique with `(source, kind)` |
| `naboopayReference` | string | null | Naboopay `order_id`, for feed matching |
| `status` | enum | not null | `confirmed`\|`needs_review`\|`committed`\|`paid`\|`draft`\|`memo`\|`skipped`\|`cancelled` (see status table below; ADR 0026 removed `provisional`, ADR 0028 added `cancelled`) |
| `receiptUrl` | string | null | Optional photo/PDF |
| `recordedBy` | ref → users / string | not null | Officer id, or source name for automatic |
| `reversalOf` | ref → transactions | null | The transaction this one cancels. A target has **at most one active reversal**; un-reverse by reversing the reversal (ADR 0020) |
| `recurringId` | ref → recurringTemplates | null | Template that generated this draft; unique (in-mutation) with `draftMonth` (ADR 0012, 0025) |
| `draftMonth` | string | null | `"YYYY-MM"` of a recurring draft's due month; the one-per-month key (null otherwise) (ADR 0025) |
| `createdAt` | timestamp | not null | When the record was created in the app |

#### Status values and their effect on balances (ADR 0007, 0011, 0012, 0026, 0028)

| Status | In Needs-review inbox? | Counts toward balances? | Meaning |
|--------|------------------------|-------------------------|---------|
| `confirmed` | no | **yes** | A real, labelled entry |
| `needs_review` | yes | **yes** | Real, settled money awaiting a label (ADR 0006, 0007) |
| `committed` | no (shown under School) | no | Approved school withdrawal, not yet paid (ADR 0003) |
| `paid` | no | **yes** | A school withdrawal that has been paid out (ADR 0003) |
| `draft` | yes | no | Recurring-template draft awaiting confirmation (v1.1) |
| `skipped` | no | no | A recurring draft the officer skipped; kept so the job can't recreate it (ADR 0012) |
| `memo` | no | no (but **included in reports**) | Pre-cutover event summary; the one place balances and reports diverge (ADR 0011) |
| `cancelled` | no | no | An approved school withdrawal that will not happen; guarded `committed → cancelled` (ADR 0028) |

#### Balance formula (ADR 0007)

`balance(X) = openingBalance(X) + Σ effect(t, X)` over every transaction `t`, where
`effect(t, X)` is read from the per-account table (income/expense/adjustment_up/
adjustment_down/allocation act on `accountId`; `transfer` and paid
`school_withdrawal` act −amount on `accountId` and +amount on `toAccountId`), then
multiplied by −1 when `reversalOf` is set, then gated to 0 unless the status
counts (table above). The School receivable uses the same engine:
`allocations − paid withdrawals`.

**Point-in-time balance (ADR 0016).** Reports need the balance an account held on
a past date: `balanceAsOf(X, date) = openingBalance(X) + Σ effect(t, X)` for every
live `t` with `t.occurredAt ≤ date`. Reports scope by **`occurredAt`, not
`createdAt`**; so start + period-activity = end always reconciles, and back-dating
(ADR 0010) can retroactively shift a past period's figures.

**Negative School (ADR 0017).** `allocations − paid withdrawals` may go negative
(drew more than allocated). Allowed but never silent: warned at entry, flagged on
the home screen; never hard-blocked.

### categories

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `_id` | id | pk | Category id |
| `name` | string | unique | e.g. Shop sales, Catering, Provider fees, Unlabeled |
| `direction` | enum | not null | `income` \| `expense`. A **write-time guard**: an `income` entry may use only an income-direction category, an `expense` entry only an expense-direction one (ADR 0009) |
| `isSystem` | bool | not null | True for `Unlabeled` / `Provider fees`. `Unlabeled` is only ever applied to auto-captured income (ADR 0009); `Provider fees` is the category for Naboopay fees (ADR 0015, 0026) |

### events

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `_id` | id | pk | Event id |
| `name` | string | unique | e.g. Integration Week, Gala |
| `active` | bool | not null | Whether it accepts new tags |

### reconciliations

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `_id` | id | pk | Reconciliation id |
| `accountId` | ref → accounts | not null | Account checked |
| `computedBalance` | int | not null | Balance from the ledger at check time |
| `realBalance` | int | not null | Observed/counted balance |
| `difference` | int | not null | real − computed |
| `adjustmentId` | ref → transactions | null | Adjustment created to resolve the gap |
| `checkedBy` | ref → users | not null | Officer |
| `checkedAt` | timestamp | not null | When checked |

> **Staleness is derived, not stored** (ADR 0010): a reconciliation is "stale /
> needs re-checking" when a transaction dated (`occurredAt`) on-or-before its
> `checkedAt` was *written* (`createdAt`) or edited after it — e.g. a back-dated
> receipt. Back-dating is allowed; periods are never hard-locked.

### users

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `_id` | id | pk | User id |
| `email` | string | unique | Login identity |
| `name` | string | not null | Display name |
| `role` | enum | not null | `officer` (all equal in v1); `treasurer`/`president` reserved |
| `active` | bool | not null | Deactivate instead of delete |

### auditLog

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `_id` | id | pk | Audit entry id |
| `actor` | ref → users / string | not null | Who made the change |
| `action` | string | not null | `create`\|`edit`\|`reverse`\|`adjust`\|`mark_paid`\|`cancel_withdrawal`\|`confirm_draft`\|`skip_draft`\|`assign_category`\|… (ADR 0014) |
| `targetId` | ref → transactions | null | Affected transaction |
| `before` | json | null | **Changed fields only** before the write (empty for `create`) |
| `after` | json | null | **Changed fields only** after the write |
| `at` | timestamp | not null | When |

> **Scope (ADR 0014):** every state-changing write to a transaction is logged
> (creates, field edits, status transitions). `before`/`after` carry only the
> fields that moved, not a full snapshot. Money-moving entries (reversals,
> adjustments) are real transactions in the ledger *and* get an audit entry that
> witnesses them — the audit log never re-counts money.

### recurringTemplates

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `_id` | id | pk | Template id |
| `reason` | string | not null | Draft reason |
| `amount` | int | not null, > 0 | Default amount |
| `accountId` | ref → accounts | not null | Account to charge |
| `categoryId` | ref → categories | not null | Category |
| `eventId` | ref → events | null | Optional |
| `dayOfMonth` | int | 1–28 | Due day |
| `active` | bool | not null | Deactivate instead of delete |

## Indexes

> **Convex has no unique indexes (ADR 0025).** The `UNIQUE` lines below are
> illustration only. In Convex these are non-unique `.index()`es; **uniqueness is
> enforced inside the mutation** by querying the index first and rejecting /
> returning-existing on a hit (race-free because mutations are serialised).

```sql
-- Idempotent intake & refund lookup: kind distinguishes a sale from its refund (ADR 0005)
-- (uniqueness enforced in-mutation; Convex index = by_source_external_kind)
CREATE UNIQUE INDEX idx_tx_source_external_kind ON transactions(source, externalId, kind);
-- Naboopay feed matching
CREATE INDEX idx_tx_naboopay_ref ON transactions(naboopayReference);
-- Balance computation per account
CREATE INDEX idx_tx_account_occurred ON transactions(accountId, occurredAt);
-- Review inbox
CREATE INDEX idx_tx_status ON transactions(status);
-- Transactions list: order + date range; other filters apply within the range (M3)
CREATE INDEX idx_tx_occurred ON transactions(occurredAt);
-- Event rollups
CREATE INDEX idx_tx_event ON transactions(eventId);
-- One draft per template per month: draftMonth is a "YYYY-MM" field (ADR 0025)
-- (uniqueness enforced in-mutation; Convex index = by_recurring_month)
CREATE UNIQUE INDEX idx_tx_recurring_month ON transactions(recurringId, draftMonth);
-- Reconciliation freshness per account
CREATE INDEX idx_recon_account_checked ON reconciliations(accountId, checkedAt);
```

## Relationships

- `transactions.accountId` → `accounts._id` — every transaction affects exactly one account (the source account for transfers). One-to-many.
- `transactions.toAccountId` → `accounts._id` — destination for transfers and paid school withdrawals. Optional.
- `transactions.categoryId` → `categories._id` — **required only for `income`/`expense`** (direction-matched); empty for all other types; `Unlabeled` sentinel for auto-captured income (ADR 0009).
- `transactions.eventId` → `events._id` — optional event grouping.
- `transactions.reversalOf` → `transactions._id` — self-reference linking a reversal to its original.
- `transactions.recurringId` → `recurringTemplates._id` — links a generated draft to its template.
- `reconciliations.accountId` → `accounts._id`; `reconciliations.adjustmentId` → `transactions._id`.
- `auditLog.targetId` → `transactions._id`; `auditLog.actor` / `transactions.recordedBy` → `users._id` (or a source string for automatic).

## Access Control

Convex has no row-level SQL; access is enforced in every function. Expressed as policy:

```sql
-- Every officer operation requires an authenticated, active officer
POLICY officer_only ON ALL FUNCTIONS
  USING (auth.uid() IS NOT NULL AND users.active = true);

-- Intake endpoints bypass user auth but require a valid source key
POLICY intake_key ON /intake/income
  USING (header('X-Intake-Key') IN secrets.active_source_keys);

-- Webhook requires a valid signature over the raw body
POLICY webhook_sig ON /intake/naboopay
  USING (hmac_sha256(raw_body, secrets.naboopay_webhook) = header('X-Signature'));

-- Nothing is ever deleted; corrections are reversals
POLICY no_delete ON transactions
  USING (operation <> 'DELETE');

-- Every in-place status change is guarded by the expected current status,
-- and is a no-op otherwise, so double-taps / concurrent officers apply it once
POLICY guarded_transition ON transactions
  USING (new.status IS NULL OR old.status = expected_from(action));
```

> **Guarded transitions (ADR 0019).** `markWithdrawalPaid` and `cancelWithdrawal`
> require `committed`; `confirmDraft`/`skipDraft` require `draft`; `assignCategory`
> requires `needs_review`. Convex
> serialises mutations, so the first attempt flips the status and wins and any
> second attempt is a clean no-op — money moves exactly once.

## Schema changes and seed data

Convex applies `convex/schema.ts` itself on every deploy, so there are no
numbered migration files. Changes to tables that already hold data follow the
`v.optional` → backfill → require pattern. Seed data lives in one file:

```text
convex/
├── schema.ts      # every table and index above
└── seed.ts        # run once per deployment with `npx convex run`:
                   #   seed:accounts    5 accounts + opening balances, starting categories
                   #                    (never touches an existing row: ADR 0018)
                   #   seed:addOfficer  create an officer with a starting password
                   #   seed:addEvent    add an event tag
```

`users.role` and `users.active` are optional in the Convex schema because Convex
Auth inserts `users` rows itself; officer code treats a missing `active` as
inactive, so an officer exists only once `seed:addOfficer` has created them.
