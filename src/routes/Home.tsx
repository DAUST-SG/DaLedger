import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import AccountCard, { CheckLine } from "../components/AccountCard";
import TransactionRow from "../components/TransactionRow";
import Loading from "../components/Loading";
import { useNames } from "../hooks/useNames";
import { formatFCFA } from "../lib/fcfa";
import { errorMessage } from "../lib/errors";

export default function Home() {
  const balances = useQuery(api.balances.list);
  const me = useQuery(api.catalog.me);
  const inbox = useQuery(api.review.count);
  const checks = useQuery(api.reconciliations.status);
  const checkOf = (id: string) => checks?.find((c) => c.accountId === id);
  const stale = checks?.filter((c) => c.stale).length ?? 0;
  const { signOut } = useAuthActions();

  return (
    <div className="min-h-full pb-28">
      <header className="bg-brand text-white px-5 pt-6 pb-7">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-semibold">DaLedger</h1>
          <div className="flex items-center gap-3 text-sm text-white/80 min-w-0">
            <span className="truncate">{me?.name ?? me?.email}</span>
            <button onClick={() => void signOut()} className="underline underline-offset-2">Sign out</button>
          </div>
        </div>
        <p className="mt-6 text-sm text-white/75">Held by the SG</p>
        <p className="num mt-1 text-3xl font-medium">{balances ? formatFCFA(balances.totalHeld) : "…"}</p>
      </header>

      <nav aria-label="Sections" className="px-4 pt-4 flex gap-2 overflow-x-auto max-w-2xl mx-auto">
        <Link to="/review" className="h-10 px-4 rounded-full border border-line bg-white flex items-center gap-2 shrink-0">
          Needs review
          {inbox !== undefined && inbox > 0 && (
            <span className="num min-w-6 h-6 px-1.5 rounded-full bg-warn text-white text-xs flex items-center justify-center">{inbox}</span>
          )}
        </Link>
        <Link to="/transactions" className="h-10 px-4 rounded-full border border-line bg-white flex items-center shrink-0">Transactions</Link>
        <Link to="/events" className="h-10 px-4 rounded-full border border-line bg-white flex items-center shrink-0">Events</Link>
        <Link to="/report" className="h-10 px-4 rounded-full border border-line bg-white flex items-center shrink-0">Term review</Link>
        <Link to="/reconcile" className="h-10 px-4 rounded-full border border-line bg-white flex items-center gap-2 shrink-0">
          Reconcile
          {stale > 0 && <span className="num min-w-6 h-6 px-1.5 rounded-full bg-loss text-white text-xs flex items-center justify-center">{stale}</span>}
        </Link>
      </nav>

      <main className="px-4 pt-4 flex flex-col gap-6 max-w-2xl mx-auto">
        <section aria-label="Accounts" className="grid grid-cols-2 gap-3">
          {balances?.accounts.map((a) => (
            <AccountCard key={a.accountId} accountId={a.accountId} name={a.name} balance={a.balance} check={checkOf(a.accountId)} />
          ))}
        </section>

        {stale > 0 && (
          <p role="status" className="rounded-xl border border-loss/30 bg-white p-3 text-sm text-loss">
            ⚠ {stale === 1 ? "One account needs" : `${stale} accounts need`} re-checking: an entry changed its history since the last check.
          </p>
        )}

        {balances?.school && (
          <SchoolCard
            accountId={balances.school.accountId}
            balance={balances.school.balance}
            committed={balances.school.committed}
            check={<CheckLine check={checkOf(balances.school.accountId)} accountId={balances.school.accountId} />}
          />
        )}

        <Recent />
      </main>

      <Link
        to="/add"
        className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] left-4 right-4 mx-auto max-w-md h-14 rounded-xl bg-brand text-white text-lg font-semibold flex items-center justify-center shadow-lg"
      >
        Add transaction
      </Link>
    </div>
  );
}

function SchoolCard(props: { accountId: string; balance: number; committed: number; check: ReactNode }) {
  const withdrawals = useQuery(api.transactions.committedWithdrawals);
  const catalog = useQuery(api.catalog.forEntry);
  const cashAccounts = catalog?.accounts.filter((a) => !a.isSchool) ?? [];

  return (
    <section className="rounded-xl border border-line bg-white p-4 flex flex-col gap-3">
      <div>
        <p className="text-sm text-muted">Owed by the university (School)</p>
        <p className={`num mt-1 text-xl ${props.balance < 0 ? "text-loss" : ""}`}>{formatFCFA(props.balance)}</p>
        <p className="text-sm text-muted mt-1">Not counted in the total held.</p>
        {props.check}
      </div>
      {props.balance < 0 && (
        <p role="status" className="text-sm text-loss">
          ⚠ School is negative: record the missing allocation or correct a withdrawal (ADR 0017).
        </p>
      )}
      {props.committed > 0 && (
        <div className="border-t border-line pt-3 flex flex-col gap-3">
          <p className="text-sm">
            Approved, not yet paid: <span className="num">{formatFCFA(props.committed)}</span>
          </p>
          {withdrawals?.map((w) => (
            <Withdrawal key={w._id} id={w._id} amount={w.amount} reason={w.reason} defaultTo={w.toAccountId} accounts={cashAccounts} schoolBalance={props.balance} />
          ))}
        </div>
      )}
    </section>
  );
}

/** An approved withdrawal: mark it paid (ADR 0003) or cancel it (ADR 0028). */
function Withdrawal(props: {
  id: Id<"transactions">;
  amount: number;
  reason: string;
  defaultTo?: Id<"accounts">;
  accounts: { _id: Id<"accounts">; name: string }[];
  schoolBalance: number;
}) {
  const [warned, setWarned] = useState(false);
  // ADR 0017: warn (never block) when paying this would take School below 0.
  const wouldGoNegative = props.amount > props.schoolBalance;
  const markPaid = useMutation(api.transactions.markWithdrawalPaid);
  const cancel = useMutation(api.transactions.cancelWithdrawal);
  const [to, setTo] = useState<string>(props.defaultTo ?? "");
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg bg-brand-soft p-3 flex flex-col gap-2">
      <p className="text-sm">
        <span className="num">{formatFCFA(props.amount)}</span> · {props.reason}
      </p>
      {!cancelling ? (
        <>
          <div className="flex gap-2">
            <select
              id={`paid-to-${props.id}`} name={`paid-to-${props.id}`}
              aria-label="Paid into"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-11 flex-1 min-w-0 rounded-lg border border-line bg-white px-2"
            >
              <option value="" disabled>Paid into…</option>
              {props.accounts.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
            </select>
            <button
              onClick={() =>
                wouldGoNegative && !warned
                  ? setWarned(true)
                  : run(() => markPaid({ transactionId: props.id, toAccountId: to as Id<"accounts"> }))
              }
              disabled={!to || pending}
              className="h-11 px-4 rounded-lg bg-brand text-white font-medium disabled:opacity-50"
            >
              Mark paid
            </button>
          </div>
          {warned && (
            <p role="alert" className="text-sm text-warn">
              This exceeds the remaining School receivable ({formatFCFA(props.schoolBalance)}). A university allocation may be
              missing. Tap Mark paid again to continue.
            </p>
          )}
          <button onClick={() => setCancelling(true)} className="self-start text-sm text-brand underline underline-offset-2">
            It won't be paid: cancel it
          </button>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <input
            id={`cancel-reason-${props.id}`} name={`cancel-reason-${props.id}`}
            aria-label="Why is it cancelled?"
            placeholder="Why is it cancelled?"
            autoComplete="off"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            className="h-11 rounded-lg border border-line bg-white px-3"
          />
          <div className="flex gap-2">
            <button
              onClick={() => run(() => cancel({ transactionId: props.id, reason: cancelReason }))}
              disabled={!cancelReason.trim() || pending}
              className="h-10 px-4 rounded-lg bg-loss text-white font-medium disabled:opacity-50"
            >
              Cancel withdrawal
            </button>
            <button onClick={() => setCancelling(false)} className="h-10 px-4 rounded-lg border border-line bg-white">Keep it</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}

function Recent() {
  const names = useNames();
  const { results, status } = usePaginatedQuery(api.transactions.list, { filter: {} }, { initialNumItems: 8 });

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">Latest transactions</h2>
        <Link to="/transactions" className="text-sm text-brand underline underline-offset-2">See all</Link>
      </div>
      {status === "LoadingFirstPage" && <Loading rows={2} />}
      {status !== "LoadingFirstPage" && results.length === 0 && (
        <p className="text-muted text-sm">Nothing recorded yet. Use “Add transaction” below.</p>
      )}
      {results.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white">
          {results.map((r) => <TransactionRow key={r._id} row={r} names={names} />)}
        </ul>
      )}
    </section>
  );
}
