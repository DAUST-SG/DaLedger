import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import AccountCard, { CheckLine } from "../components/AccountCard";
import { DayGroupedRows } from "../components/TransactionRow";
import AccountBadge from "../components/AccountBadge";
import type { AccountKey } from "../lib/money";
import Loading from "../components/Loading";
import { useNames } from "../hooks/useNames";
import { formatFCFA } from "../lib/fcfa";
import { errorMessage } from "../lib/errors";

export default function Home() {
  const balances = useQuery(api.balances.list);
  const me = useQuery(api.catalog.me);
  const inbox = useQuery(api.review.count);
  const checks = useQuery(api.reconciliations.status);
  const overdue = useQuery(api.recurring.overdue);
  const checkOf = (id: string) => checks?.find((c) => c.accountId === id);
  const stale = checks?.filter((c) => c.stale).length ?? 0;
  const { signOut } = useAuthActions();

  const accountsReady = balances !== undefined;
  const section = "relative flex flex-col justify-between gap-1 rounded-2xl bg-white px-3.5 py-3 min-h-[4.25rem] shadow-[0_1px_0_var(--color-line)]";
  const badge = "absolute top-2.5 right-2.5 min-w-5 h-5 px-1.5 rounded-full text-white text-[0.7rem] font-semibold flex items-center justify-center num";

  return (
    <div className="min-h-full pb-28 lg:pb-10">
      <header className="bg-brand text-white">
        <div className="max-w-2xl mx-auto px-5 pt-5 pb-8 lg:max-w-6xl lg:mx-0 lg:px-8 lg:pt-8 lg:pb-12">
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-semibold tracking-tight">DaLedger <span className="font-normal text-white/60">· DAUST SG</span></h1>
            <div className="flex items-center gap-3 text-sm text-white/75 min-w-0 lg:hidden">
              <span className="truncate">{me?.name ?? me?.email}</span>
              <button onClick={() => void signOut()} className="underline underline-offset-2">Sign out</button>
            </div>
          </div>
          <p className="mt-7 text-sm text-white/70">Held by the SG</p>
          <p className="figure mt-1 text-[2.75rem] leading-none font-semibold">
            {balances ? formatFCFA(balances.totalHeld).replace(" FCFA", "") : "…"}
            <span className="ml-2 text-lg font-medium text-white/60">FCFA</span>
          </p>
        </div>
      </header>

      <main className="px-4 -mt-4 max-w-2xl mx-auto grid gap-5 lg:max-w-6xl lg:mx-0 lg:px-8 lg:-mt-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-8">
        <div className="flex flex-col gap-5 min-w-0">
        <section aria-label="Accounts" className="grid grid-cols-2 gap-2.5">
          {accountsReady
            ? balances.accounts.map((a) => (
                <AccountCard key={a.accountId} accountId={a.accountId} accountKey={a.key as AccountKey} name={a.name} balance={a.balance} check={checkOf(a.accountId)} />
              ))
            : <div className="col-span-2"><Loading rows={2} /></div>}
        </section>

        {overdue !== undefined && overdue > 0 && (
          <Link to="/review" role="status" className="rounded-2xl bg-white p-3.5 text-sm text-warn font-medium shadow-[0_1px_0_var(--color-line)]">
            {overdue === 1 ? "1 recurring bill is" : `${overdue} recurring bills are`} past due. Confirm or skip in Needs review.
          </Link>
        )}
        {stale > 0 && (
          <Link to="/reconcile" role="status" className="rounded-2xl bg-loss-soft p-3.5 text-sm text-loss font-medium">
            {stale === 1 ? "One account needs" : `${stale} accounts need`} re-checking: an entry changed its history since the last check.
          </Link>
        )}

        {balances?.school && (
          <SchoolCard
            accountId={balances.school.accountId}
            balance={balances.school.balance}
            committed={balances.school.committed}
            check={<CheckLine check={checkOf(balances.school.accountId)} accountId={balances.school.accountId} />}
          />
        )}

        <nav aria-label="Sections" className="grid grid-cols-3 gap-2.5 lg:hidden">
          <Link to="/review" className={section}>
            <span className="font-medium leading-tight">Needs review</span>
            <span className="text-xs text-muted">{inbox ? `${inbox} waiting` : "All clear"}</span>
            {inbox !== undefined && inbox > 0 && <span className={`${badge} bg-warn`}>{inbox}</span>}
          </Link>
          <Link to="/transactions" className={section}>
            <span className="font-medium leading-tight">Transactions</span>
            <span className="text-xs text-muted">Search & export</span>
          </Link>
          <Link to="/reconcile" className={section}>
            <span className="font-medium leading-tight">Reconcile</span>
            <span className="text-xs text-muted">{stale ? "Re-check needed" : "Check balances"}</span>
            {stale > 0 && <span className={`${badge} bg-loss`}>{stale}</span>}
          </Link>
          <Link to="/report" className={section}>
            <span className="font-medium leading-tight">Term review</span>
            <span className="text-xs text-muted">Report & PDF</span>
          </Link>
          <Link to="/events" className={section}>
            <span className="font-medium leading-tight">Events</span>
            <span className="text-xs text-muted">Gala, fairs…</span>
          </Link>
          <Link to="/recurring" className={section}>
            <span className="font-medium leading-tight">Recurring</span>
            <span className="text-xs text-muted">{overdue ? `${overdue} overdue` : "Monthly bills"}</span>
          </Link>
        </nav>
        </div>

        <div className="min-w-0 lg:pt-6">
          <Recent />
        </div>
      </main>

      <Link
        to="/add"
        className="lg:hidden fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] left-4 right-4 mx-auto max-w-md h-14 rounded-2xl bg-brand-deep text-white text-lg font-semibold flex items-center justify-center gap-2 shadow-[0_8px_24px_-8px_rgb(42_25_83/0.6)]"
      >
        <span aria-hidden="true" className="text-2xl leading-none">+</span> Add transaction
      </Link>
    </div>
  );
}

function SchoolCard(props: { accountId: string; balance: number; committed: number; check: ReactNode }) {
  const withdrawals = useQuery(api.transactions.committedWithdrawals);
  const catalog = useQuery(api.catalog.forEntry);
  const cashAccounts = catalog?.accounts.filter((a) => !a.isSchool) ?? [];

  return (
    <section className="rounded-2xl bg-white p-4 flex flex-col gap-3 shadow-[0_1px_0_var(--color-line)]">
      <div className="flex items-start gap-3">
        <AccountBadge accountKey="school" />
        <div className="min-w-0 flex flex-col gap-1">
          <p className="text-sm font-medium">Owed by the university</p>
          <p className={`figure text-[1.35rem] leading-none font-semibold ${props.balance < 0 ? "text-loss" : ""}`}>{formatFCFA(props.balance)}</p>
          <p className="text-xs text-muted">School receivable. Not part of the money held.</p>
          {props.check}
        </div>
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
      <div className="flex items-baseline justify-between px-1">
        <h2 className="font-semibold">Latest</h2>
        <Link to="/transactions" className="text-sm text-brand font-medium">See all</Link>
      </div>
      {status === "LoadingFirstPage" && <Loading rows={2} />}
      {status !== "LoadingFirstPage" && results.length === 0 && (
        <p className="rounded-2xl bg-white p-4 text-sm text-muted">Nothing recorded yet. Tap “Add transaction” to record the first entry.</p>
      )}
      {results.length > 0 && <DayGroupedRows rows={results} names={names} />}
    </section>
  );
}
