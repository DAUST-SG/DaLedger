// Pure ledger rules: no database access, so they are unit-tested directly.
import type { Doc, Id } from "./_generated/dataModel";
import { ConvexError } from "convex/values";

type Tx = Pick<
  Doc<"transactions">,
  "type" | "amount" | "status" | "accountId" | "toAccountId" | "reversalOf"
>;

// ADR 0007 status gate. `needs_review` counts: settled money awaiting a label.
export const LIVE_STATUSES = new Set(["confirmed", "paid", "needs_review"]);

// Effect on `accountId` (the row's main account), per ADR 0007's table.
const MAIN_SIGN: Record<Doc<"transactions">["type"], 1 | -1> = {
  income: 1,
  expense: -1,
  adjustment_up: 1,
  adjustment_down: -1,
  allocation: 1, // accountId is School
  transfer: -1,
  school_withdrawal: -1, // accountId is School
};

// Only these two types have a second leg on `toAccountId`.
const TWO_LEG = new Set(["transfer", "school_withdrawal"]);

/**
 * Signed effect of one transaction on one account (ADR 0002, 0007).
 * `flip` is **required** (ADR 0027) and must come from `reversalFlip`: −1 for a
 * reversal, +1 for a reversal of a reversal, and so on, so the chain
 * original ← reversal ← reversal-of-reversal nets back to the original (ADR 0020).
 * It is not defaulted on purpose — a naïve `reversalOf ? -1 : 1` is wrong for
 * chains of depth ≥ 2, so callers are forced to pass the chain-aware value.
 */
export function effect(tx: Tx, accountId: string, flip: 1 | -1): number {
  if (!LIVE_STATUSES.has(tx.status)) return 0;
  let e = 0;
  if (tx.accountId === accountId) e += MAIN_SIGN[tx.type] * tx.amount;
  if (TWO_LEG.has(tx.type) && tx.toAccountId === accountId) e += tx.amount;
  return flip * e;
}

/** −1 per link in the reversalOf chain: alternates so un-reversing restores money. */
export async function reversalFlip(
  tx: Pick<Doc<"transactions">, "reversalOf">,
  load: (id: Id<"transactions">) => Promise<Pick<Doc<"transactions">, "reversalOf"> | null>,
): Promise<1 | -1> {
  let flip: 1 | -1 = 1;
  let current: Pick<Doc<"transactions">, "reversalOf"> | null = tx;
  while (current?.reversalOf) {
    flip = flip === 1 ? -1 : 1;
    current = await load(current.reversalOf);
  }
  return flip;
}

/** Whole positive FCFA, or throw (ADR 0024). */
export function assertAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ConvexError("Amount must be a whole, positive number of FCFA.");
  }
}

type Account = Pick<Doc<"accounts">, "_id" | "isSchool">;
type Category = Pick<Doc<"categories">, "name" | "direction">;

export type Entry = {
  type: Doc<"transactions">["type"];
  amount: number;
  reason: string;
  account: Account;
  toAccount: Account | null;
  category: Category | null;
};

/** Field rules for a manual entry. Throws a readable error on the first problem. */
export function validateEntry(e: Entry): void {
  assertAmount(e.amount);
  if (e.reason.trim() === "") throw new ConvexError("A reason is required.");

  const needsCategory = e.type === "income" || e.type === "expense";
  if (needsCategory) {
    if (!e.category) throw new ConvexError(`An ${e.type} needs a category.`);
    if (e.category.direction !== e.type) {
      throw new ConvexError(`"${e.category.name}" is not an ${e.type} category.`);
    }
    if (e.category.name === "Unlabeled") {
      throw new ConvexError("Pick a real category; Unlabeled is only for automatic income.");
    }
  } else if (e.category) {
    throw new ConvexError(`A ${e.type} has no category (ADR 0009).`);
  }

  switch (e.type) {
    case "income":
    case "expense":
      if (e.account.isSchool) throw new ConvexError("Income and expenses go on a cash account, not School.");
      if (e.toAccount) throw new ConvexError(`An ${e.type} has no destination account.`);
      break;
    case "adjustment_up":
    case "adjustment_down":
      if (e.toAccount) throw new ConvexError("An adjustment has no destination account.");
      break;
    case "allocation":
      if (!e.account.isSchool) throw new ConvexError("An allocation goes on the School receivable.");
      if (e.toAccount) throw new ConvexError("An allocation has no destination account.");
      break;
    case "transfer":
      if (!e.toAccount) throw new ConvexError("A transfer needs a destination account.");
      if (e.account.isSchool || e.toAccount.isSchool) {
        throw new ConvexError("Transfers move money between cash accounts only.");
      }
      if (e.account._id === e.toAccount._id) {
        throw new ConvexError("A transfer needs two different accounts.");
      }
      break;
    case "school_withdrawal":
      if (!e.account.isSchool) throw new ConvexError("A school withdrawal comes from the School receivable.");
      if (e.toAccount?.isSchool) throw new ConvexError("A school withdrawal goes to a cash account.");
      break;
  }
}

/** Fields that differ between two snapshots, for the audit log (ADR 0014). */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[k] !== after[k]) {
      if (before[k] !== undefined) b[k] = before[k];
      if (after[k] !== undefined) a[k] = after[k];
    }
  }
  return { before: b, after: a };
}
