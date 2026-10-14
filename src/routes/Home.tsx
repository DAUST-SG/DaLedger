import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import AccountCard from "../components/AccountCard";
import { formatFCFA } from "../lib/fcfa";
import { errorMessage } from "../lib/errors";

const TYPE_LABEL: Record<string, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
  allocation: "Allocation",
  school_withdrawal: "School withdrawal",
  adjustment_up: "Adjustment ↑",
  adjustment_down: "Adjustment ↓",
};

export default function Home() {
  const balances = useQuery(api.balances.list);
  const me = useQuery(api.catalog.me);
  const { signOut } = useAuthActions();

  return (
    <div className="min-h-full pb-28">
      <header className="bg-brand text-white px-5 pt-6 pb-7">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">DaLedger</p>
          <div className="flex items-center gap-3 text-sm text-white/80 min-w-0">
            <span className="truncate">{me?.name ?? me?.email}</span>
            <button onClick={() => void signOut()} className="underline underline-offset-2">Sign out</button>
          </div>
        </div>
        <p className="mt-6 text-sm text-white/75">Held by the SG</p>
        <p className="num mt-1 text-3xl font-medium">{balances ? formatFCFA(balances.totalHeld) : "…"}</p>
      </header>

      <main className="px-4 -mt-3 flex flex-col gap-6 max-w-2xl mx-auto">
        <section aria-label="Accounts" className="grid grid-cols-2 gap-3">
          {balances?.accounts.map((a) => <AccountCard key={a.accountId} name={a.name} balance={a.balance} />)}
        </section>

        {balances?.school && <SchoolCard balance={balances.school.balance} committed={balances.school.committed} />}

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

function SchoolCard(props: { balance: number; committed: number }) {
  const withdrawals = useQuery(api.transactions.committedWithdrawals);
  const catalog = useQuery(api.catalog.forEntry);
  const cashAccounts = catalog?.accounts.filter((a) => !a.isSchool) ?? [];

  return (
    <section className="rounded-xl border border-line bg-white p-4 flex flex-col gap-3">
      <div>
        <p className="text-sm text-muted">Owed by the university (School)</p>
        <p className={`num mt-1 text-xl ${props.balance < 0 ? "text-loss" : ""}`}>{formatFCFA(props.balance)}</p>
        <p className="text-sm text-muted mt-1">Not counted in the total held.</p>
      </div>
      {props.committed > 0 && (
        <div className="border-t border-line pt-3 flex flex-col gap-3">
          <p className="text-sm">
            Approved, not yet paid: <span className="num">{formatFCFA(props.committed)}</span>
          </p>
          {withdrawals?.map((w) => (
            <MarkPaid key={w._id} id={w._id} amount={w.amount} reason={w.reason} defaultTo={w.toAccountId} accounts={cashAccounts} />
          ))}
        </div>
      )}
    </section>
  );
}

function MarkPaid(props: {
  id: Id<"transactions">;
  amount: number;
  reason: string;
  defaultTo?: Id<"accounts">;
  accounts: { _id: Id<"accounts">; name: string }[];
}) {
  const markPaid = useMutation(api.transactions.markWithdrawalPaid);
  const [to, setTo] = useState<string>(props.defaultTo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    setError(null);
    try {
      await markPaid({ transactionId: props.id, toAccountId: to as Id<"accounts"> });
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
      <div className="flex gap-2">
        <select
          id={`paid-to-${props.id}`}
          aria-label="Paid into"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-11 flex-1 min-w-0 rounded-lg border border-line bg-white px-2"
        >
          <option value="" disabled>Paid into…</option>
          {props.accounts.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
        </select>
        <button
          onClick={onClick}
          disabled={!to || pending}
          className="h-11 px-4 rounded-lg bg-brand text-white font-medium disabled:opacity-50"
        >
          Mark paid
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}

function Recent() {
  const rows = useQuery(api.transactions.recent);
  const catalog = useQuery(api.catalog.forEntry);
  const names = new Map(catalog?.accounts.map((a) => [a._id as string, a.name]));

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">Latest transactions</h2>
      {rows?.length === 0 && (
        <p className="text-muted text-sm">Nothing recorded yet. Use “Add transaction” below.</p>
      )}
      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white">
        {rows?.map((r) => (
          <Row
            key={r._id}
            row={r}
            account={[names.get(r.accountId), r.toAccountId && names.get(r.toAccountId)].filter(Boolean).join(" → ")}
          />
        ))}
      </ul>
    </section>
  );
}

function Row(props: {
  account: string;
  row: {
    _id: Id<"transactions">; type: string; amount: number; reason: string; status: string;
    occurredAt?: number; isReversal: boolean; reversed: boolean;
  };
}) {
  const { row } = props;
  const reverse = useMutation(api.transactions.reverse);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canReverse = !row.reversed && row.status !== "committed";

  async function onReverse() {
    setError(null);
    try {
      await reverse({ transactionId: row._id, reason });
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <li className="px-4 py-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate">{row.reason}</p>
          <p className="text-xs text-muted">
            {row.isReversal ? "Reversal of " : ""}{TYPE_LABEL[row.type]} · {props.account}
            {row.status === "committed" && " · not paid yet"}
            {row.reversed && " · reversed"}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={`num ${row.reversed ? "line-through text-muted" : ""}`}>{formatFCFA(row.amount)}</p>
          {canReverse && !open && (
            <button onClick={() => setOpen(true)} className="text-xs text-brand underline underline-offset-2">
              Reverse
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="flex flex-col gap-2">
          <input
            id={`reverse-reason-${row._id}`}
            aria-label="Why is this being reversed?"
            placeholder="Why is this being reversed?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-11 rounded-lg border border-line px-3"
          />
          <div className="flex gap-2">
            <button onClick={onReverse} disabled={!reason.trim()} className="h-10 px-4 rounded-lg bg-loss text-white font-medium disabled:opacity-50">
              Reverse it
            </button>
            <button onClick={() => setOpen(false)} className="h-10 px-4 rounded-lg border border-line">Cancel</button>
          </div>
          {error && <p role="alert" className="text-sm text-loss">{error}</p>}
        </div>
      )}
    </li>
  );
}
