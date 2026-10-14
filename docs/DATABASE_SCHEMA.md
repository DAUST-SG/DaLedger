# Database Schema — Finance Tracker

| | |
|---|---|
| **Database** | Convex document-relational store |
| **Naming** | camelCase fields; table names plural; ids are Convex references |
| **Money** | integer FCFA, always positive in `amount`; direction comes from `type` |

> SQL is shown below as a portable illustration of indexes, relationships, and access rules. In Convex these map to `defineTable`, `.index()`, and function-level auth checks respectively. The authoritative definition lives in `convex/schema.ts`.

> **Decision records:** this schema reflects ADRs 0001–0015 in `docs/adr/`. Where
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
| `status` | enum | not null | `confirmed`\|`needs_review`\|`committed`\|`paid`\|`draft`\|`memo`\|`skipped`\|`provisional` (see status table below) |
| `receiptUrl` | string | null | Optional photo/PDF |
| `recordedBy` | ref → users / string | not null | Officer id, or source name for automatic |
| `reversalOf` | ref → transactions | null | The transaction this one cancels |
| `recurringId` | ref → recurringTemplates | null | Template that generated this draft; unique with due month |
| `createdAt` | timestamp | not null | When the record was created in the app |

#### Status values and their effect on balances (ADR 0007, 0011, 0012, 0013)

| Status | In Needs-review inbox? | Counts toward balances? | Meaning |
|--------|------------------------|-------------------------|---------|
| `confirmed` | no | **yes** | A real, labelled entry |
| `needs_review` | yes | **yes** | Real, settled money awaiting a label (ADR 0006, 0007) |
| `committed` | no (shown under School) | no | Approved school withdrawal, not yet paid (ADR 0003) |
| `paid` | no | **yes** | A school withdrawal that has been paid out (ADR 0003) |
| `draft` | yes | no | Recurring-template draft awaiting confirmation (v1.1) |
| `skipped` | no | no | A recurring draft the officer skipped; kept so the job can't recreate it (ADR 0012) |
| `memo` | no | no (but **included in reports**) | Pre-cutover event summary; the one place balances and reports diverge (ADR 0011) |
| `provisional` | yes | no | A Naboopay `part_paid` of unknown actual amount, awaiting an officer-entered figure (ADR 0013) |

#### Balance formula (ADR 0007)

`balance(X) = openingBalance(X) + Σ effect(t, X)` over every transaction `t`, where
`effect(t, X)` is read from the per-account table (income/expense/adjustment_up/
adjustment_down/allocation act on `accountId`; `transfer` and paid
`school_withdrawal` act −amount on `accountId` and +amount on `toAccountId`), then
multiplied by −1 when `reversalOf` is set, then gated to 0 unless the status
counts (table above). The School receivable uses the same engine:
`allocations − paid withdrawals`.

### categories

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `_id` | id | pk | Category id |
| `name` | string | unique | e.g. Shop sales, Catering, Provider fees, Unlabeled |
| `direction` | enum | not null | `income` \| `expense`. A **write-time guard**: an `income` entry may use only an income-direction category, an `expense` entry only an expense-direction one (ADR 0009) |
| `isSystem` | bool | not null | True for `Unlabeled` / `Provider fees`. `Unlabeled` is only ever applied to auto-captured income (ADR 0009); `Provider fees` is the category for Naboopay payout fees (ADR 0015) |

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
| `action` | string | not null | `create`\|`edit`\|`reverse`\|`adjust`\|`mark_paid`\|`confirm_draft`\|`skip_draft`\|`assign_category`\|`enter_partial`\|… (ADR 0014) |
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

```sql
-- Idempotent intake & refund lookup: kind distinguishes a sale from its refund (ADR 0005)
CREATE UNIQUE INDEX idx_tx_source_external_kind ON transactions(source, externalId, kind);
-- Naboopay feed matching
CREATE INDEX idx_tx_naboopay_ref ON transactions(naboopayReference);
-- Balance computation per account
CREATE INDEX idx_tx_account_occurred ON transactions(accountId, occurredAt);
-- Review inbox
CREATE INDEX idx_tx_status ON transactions(status);
-- Event rollups
CREATE INDEX idx_tx_event ON transactions(eventId);
-- One draft per template per month
CREATE UNIQUE INDEX idx_tx_recurring_month ON transactions(recurringId, occurredAtMonth);
-- Reconciliation freshness per account
CREATE INDEX idx_recon_account_checked ON reconciliations(accountId, checkedAt);
```

## Relationships

- `transactions.accountId` → `accounts._id` — every transaction affects exactly one account (the source account for transfers). One-to-many.
- `transactions.toAccountId` → `accounts._id` — destination for transfers and paid school withdrawals. Optional.
- `transactions.categoryId` → `categories._id` — required; `Unlabeled` by default.
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
```

## Migrations

```text
convex/
└── migrations/
    ├── 0001_init_core.ts          # accounts, transactions, categories, events
    ├── 0002_users_auth.ts         # users table + Convex Auth wiring
    ├── 0003_reconciliations.ts    # reconciliations + auditLog
    ├── 0004_intake_indexes.ts     # (source, externalId, kind) unique, naboopayReference
    ├── 0005_seed_accounts.ts      # 5 accounts + opening balances (cutover)
    ├── 0006_seed_categories.ts    # starting category list
    └── 0007_recurring.ts          # recurringTemplates + one-draft-per-month index (v1.1)
```
