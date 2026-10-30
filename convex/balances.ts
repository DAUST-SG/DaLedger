import { query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { currentOfficer } from "./auth";
import { effect, reversalFlip } from "./ledger";

/** A seeded account by its key; a missing one is a deployment error, not bad input. */
export async function accountByKey(ctx: QueryCtx, key: Doc<"accounts">["key"]): Promise<Doc<"accounts">> {
  const account = await ctx.db.query("accounts").withIndex("by_key", (q) => q.eq("key", key)).unique();
  if (!account) throw new Error(`The ${key} account is missing; run seed:accounts.`);
  return account;
}

/**
 * balanceAsOf(X, date) = openingBalance(X) + Σ effect(t, X) for t.occurredAt ≤ date
 * (ADR 0007, 0016). With no date, every transaction counts.
 * ponytail: sums the account's whole history on every call; add reconciliation
 * checkpoints if a term's volume ever makes this slow (ARCHITECTURE §6).
 */
export async function balanceOf(
  ctx: QueryCtx,
  account: Doc<"accounts">,
  asOf?: number,
): Promise<number> {
  const upTo = asOf ?? Number.MAX_SAFE_INTEGER;
  const [main, incoming] = await Promise.all([
    ctx.db
      .query("transactions")
      .withIndex("by_accountId_and_occurredAt", (q) =>
        q.eq("accountId", account._id).lte("occurredAt", upTo),
      )
      .collect(),
    ctx.db
      .query("transactions")
      .withIndex("by_toAccountId_and_occurredAt", (q) =>
        q.eq("toAccountId", account._id).lte("occurredAt", upTo),
      )
      .collect(),
  ]);
  const load = (id: Doc<"transactions">["_id"]) => ctx.db.get(id);
  let balance = account.openingBalance;
  // A row with accountId === toAccountId is rejected at write time, so no double count.
  for (const tx of [...main, ...incoming]) {
    balance += effect(tx, account._id, await reversalFlip(tx, load));
  }
  return balance;
}

const balancesView = v.object({
  accounts: v.array(
    v.object({
      accountId: v.id("accounts"),
      key: v.string(),
      name: v.string(),
      balance: v.number(),
    }),
  ),
  totalHeld: v.number(),
  school: v.union(
    v.object({ accountId: v.id("accounts"), balance: v.number(), committed: v.number() }),
    v.null(),
  ),
});

async function view(ctx: QueryCtx, asOf?: number) {
  const accounts = await ctx.db.query("accounts").collect();
  const cash = [];
  let school = null;
  for (const account of accounts) {
    const balance = await balanceOf(ctx, account, asOf);
    if (account.isSchool) {
      // Committed withdrawals change no balance; shown under School only (ADR 0003).
      const committed = (
        await ctx.db
          .query("transactions")
          .withIndex("by_status", (q) => q.eq("status", "committed"))
          .collect()
      )
        .filter((t) => t.type === "school_withdrawal" && t.accountId === account._id)
        .reduce((sum, t) => sum + t.amount, 0);
      school = { accountId: account._id, balance, committed };
    } else {
      cash.push({ accountId: account._id, key: account.key, name: account.name, balance });
    }
  }
  // School is owed, not held: never added to the total (ADR 0004).
  const totalHeld = cash.reduce((sum, a) => sum + a.balance, 0);
  return { accounts: cash, totalHeld, school };
}

export const list = query({
  args: {},
  returns: balancesView,
  handler: async (ctx) => {
    await currentOfficer(ctx);
    return view(ctx);
  },
});

export const asOf = query({
  args: { date: v.number() },
  returns: balancesView,
  handler: async (ctx, args) => {
    await currentOfficer(ctx);
    return view(ctx, args.date);
  },
});
