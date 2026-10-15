import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import PageHeader from "../components/PageHeader";
import { formatDate } from "../components/TransactionRow";
import { formatFCFA, groupDigits, parseBalance } from "../lib/fcfa";
import { errorMessage } from "../lib/errors";

const field = "h-12 rounded-lg border border-line bg-white px-3 w-full";

/** Keep an optional leading minus while grouping digits (School only). */
const groupSigned = (text: string, allowNegative: boolean) =>
  (allowNegative && /^\s*[-−–]/.test(text) ? "-" : "") + groupDigits(text);

/** Compare an account with reality and close the gap (ADR 0001, 0004, 0018). */
export default function Reconcile() {
  const [params, setParams] = useSearchParams();
  const catalog = useQuery(api.catalog.forEntry);
  const accountId = (params.get("account") ?? "") as Id<"accounts"> | "";
  const account = catalog?.accounts.find((a) => a._id === accountId);

  return (
    <div className="min-h-full pb-10">
      <PageHeader title="Reconcile" />
      <main className="px-4 py-5 flex flex-col gap-6 max-w-xl mx-auto">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Account</span>
          <select
            id="r-account" name="r-account" value={accountId}
            onChange={(e) => setParams(e.target.value ? { account: e.target.value } : {}, { replace: true })}
            className={field}
          >
            <option value="">Choose…</option>
            {catalog?.accounts.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
          </select>
        </label>
        {account && <Check key={account._id} accountId={account._id} name={account.name} isSchool={account.isSchool} />}
        {account && <History accountId={account._id} />}
        {account && <OpeningCorrection key={`o-${account._id}`} accountId={account._id} isSchool={account.isSchool} />}
      </main>
    </div>
  );
}

function Check(props: { accountId: Id<"accounts">; name: string; isSchool: boolean }) {
  const computed = useQuery(api.reconciliations.preview, { accountId: props.accountId });
  const create = useMutation(api.reconciliations.create);
  const [real, setReal] = useState("");
  const [adjust, setAdjust] = useState(true);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const realValue = parseBalance(real, props.isSchool);
  const difference = realValue !== null && computed !== undefined ? realValue - computed : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (realValue === null) return setError(props.isSchool ? "Enter the statement figure in whole FCFA." : "Enter the real balance in whole FCFA (0 or more).");
    if (adjust && difference !== 0 && !reason.trim()) return setError("Say why the balances differ.");
    setPending(true);
    try {
      const r = await create({ accountId: props.accountId, realBalance: realValue, adjust, reason: reason || undefined });
      setResult(
        r.difference === 0
          ? "Recorded: the books match."
          : r.adjustmentId
            ? `Recorded, with ${r.adjustmentType === "adjustment_up" ? "an upward" : "a downward"} adjustment of ${formatFCFA(Math.abs(r.difference))}.`
            : `Recorded, with ${formatFCFA(r.difference)} left open to investigate.`,
      );
      setReal("");
      setReason("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-line bg-white p-4 flex flex-col gap-4">
      <div>
        <p className="text-sm text-muted">Computed by DaLedger now</p>
        <p className="num text-xl">{computed === undefined ? "…" : formatFCFA(computed)}</p>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">
          {props.isSchool ? "What the university statement says is owed" : props.name === "Cash" ? "Counted cash" : `Balance shown in the ${props.name} app or dashboard`}
        </span>
        <div className="flex items-center rounded-lg border border-line bg-white focus-within:outline-2 focus-within:outline-brand">
          <input
            id="r-real" name="r-real" inputMode={props.isSchool ? "text" : "numeric"} autoComplete="off" placeholder="0"
            value={real} onChange={(e) => setReal(groupSigned(e.target.value, props.isSchool))}
            className="num h-14 flex-1 min-w-0 bg-transparent px-3 text-2xl outline-none"
          />
          <span className="px-3 text-muted font-medium">FCFA</span>
        </div>
      </label>

      {difference !== null && (
        <p className={`text-sm ${difference === 0 ? "text-gain" : "text-warn"}`}>
          {difference === 0 ? "The books match." : `Difference (real − computed): ${difference > 0 ? "+" : ""}${formatFCFA(difference)}`}
        </p>
      )}
      {difference !== null && difference !== 0 && (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input id="r-adjust" name="r-adjust" type="checkbox" checked={adjust} onChange={(e) => setAdjust(e.target.checked)} className="mt-1 size-4" />
            <span>Record an adjustment so DaLedger matches. Leave unticked to keep the gap open while you look for a missing entry.</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Why do they differ?{adjust ? "" : " (optional)"}</span>
            <input id="r-reason" name="r-reason" autoComplete="off" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Snacks paid from the till, no receipt…" className={field} />
          </label>
        </>
      )}
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      {result && <p role="status" className="text-sm text-gain">{result}</p>}
      <button type="submit" disabled={pending || computed === undefined} className="h-12 rounded-xl bg-brand text-white font-semibold disabled:opacity-60">
        {pending ? "Recording…" : "Record check"}
      </button>
    </form>
  );
}

function History(props: { accountId: Id<"accounts"> }) {
  const rows = useQuery(api.reconciliations.history, { accountId: props.accountId });
  if (!rows || rows.length === 0) return <p className="text-sm text-muted">No checks recorded for this account yet.</p>;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">Past checks</h2>
      <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white">
        {rows.map((r) => (
          <li key={r._id} className="px-4 py-3 flex justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="block">{formatDate(r.checkedAt)} · {r.checkedBy}</span>
              <span className="block text-xs text-muted">
                Real <span className="num">{formatFCFA(r.realBalance)}</span>, computed <span className="num">{formatFCFA(r.computedBalance)}</span>
              </span>
            </span>
            <span className={`shrink-0 ${r.difference === 0 ? "text-gain" : r.adjusted ? "text-muted" : "text-warn"}`}>
              {r.difference === 0 ? "Matched" : r.adjusted ? "Adjusted" : "Gap left open"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OpeningCorrection(props: { accountId: Id<"accounts">; isSchool: boolean }) {
  const correct = useMutation(api.reconciliations.correctOpening);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = parseBalance(value, props.isSchool);
    if (n === null) return setMessage({ ok: false, text: "Enter the correct opening balance in whole FCFA." });
    try {
      const r = await correct({ accountId: props.accountId, correctOpeningBalance: n, reason });
      setMessage({ ok: true, text: r.difference === 0 ? "That is already the opening balance." : `Corrected by ${formatFCFA(r.difference)}, dated at cutover.` });
      setValue("");
      setReason("");
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    }
  }

  return (
    <details className="rounded-xl border border-line bg-white p-4">
      <summary className="cursor-pointer font-medium">The opening balance was wrong</summary>
      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3">
        <p className="text-sm text-muted">
          The opening balance is never edited. DaLedger adds an adjustment for the difference, dated at cutover, so every
          later balance moves with it and the change is audited.
        </p>
        <input
          id="o-value" name="o-value" inputMode={props.isSchool ? "text" : "numeric"} autoComplete="off"
          aria-label="Correct opening balance (FCFA)" placeholder="Correct opening balance…"
          value={value} onChange={(e) => setValue(groupSigned(e.target.value, props.isSchool))} className={`num ${field}`}
        />
        <input
          id="o-reason" name="o-reason" autoComplete="off" aria-label="Why was it wrong?" placeholder="e.g. Recount found a missed envelope…"
          value={reason} onChange={(e) => setReason(e.target.value)} className={field}
        />
        {message && <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-gain" : "text-loss"}`}>{message.text}</p>}
        <button type="submit" disabled={!value || !reason.trim()} className="h-11 rounded-lg border border-brand text-brand font-medium disabled:opacity-50">
          Correct opening balance
        </button>
      </form>
    </details>
  );
}
