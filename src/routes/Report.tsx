import { useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import PageHeader from "../components/PageHeader";
import Loading from "../components/Loading";
import { formatDate } from "../components/TransactionRow";
import { formatFCFA } from "../lib/fcfa";
import { download, toCSV } from "../lib/csv";

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const startOf = (d: string) => new Date(`${d}T00:00:00`).getTime();
const endOf = (d: string) => new Date(`${d}T23:59:59.999`).getTime();
const control = "h-11 rounded-lg border border-line bg-white px-2 w-full min-w-0";

type Lines = { income: number; expense: number; withdrawalsIn: number; adjustments: number; transfersIn: number; transfersOut: number };
const LINE_LABELS: [keyof Lines | "transfers", string][] = [
  ["income", "Income"],
  ["expense", "Expenses"],
  ["withdrawalsIn", "Drawn from the university (paid withdrawals)"],
  ["adjustments", "Reconciliation adjustments"],
  ["transfers", "Transfers between accounts (always 0 in total)"],
];
const lineValue = (l: Lines, k: keyof Lines | "transfers") =>
  k === "transfers" ? l.transfersIn - l.transfersOut : k === "expense" ? -l.expense : l[k];

/** The end-of-term review (ADR 0016, 0021, 0022). */
export default function Report() {
  const [params, setParams] = useSearchParams();
  const cutover = useQuery(api.reports.cutover);
  const now = new Date();
  const thisMonth = day(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const from = params.get("from") ?? thisMonth;
  const to = params.get("to") ?? day(Date.now());
  const valid = from <= to;
  const report = useQuery(api.reports.term, valid ? { from: startOf(from), to: endOf(to) } : "skip");

  const setRange = (f: string, t: string) => setParams({ from: f, to: t }, { replace: true });
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  function exportCSV() {
    if (!report) return;
    const rows: (string | number)[][] = [
      ["Held at start", "", report.total.start],
      ...LINE_LABELS.map(([k, label]) => [label, "", lineValue(report.total.lines, k)]),
      ["Held at end", "", report.total.end],
      ...report.accounts.flatMap((a) => [
        [`${a.name}: start`, "account", a.start],
        ...LINE_LABELS.map(([k, label]) => [`${a.name}: ${label}`, "account", lineValue(a.lines, k)]),
        [`${a.name}: end`, "account", a.end],
      ]),
      ["School: start", "school", report.school.start],
      ["School: allocations", "school", report.school.allocations],
      ["School: paid withdrawals", "school", -report.school.paidWithdrawals],
      ["School: adjustments", "school", report.school.adjustments],
      ["School: end", "school", report.school.end],
      ...report.byCategory.map((c) => [`${c.direction}: ${c.name}`, "category", c.total]),
      ...report.byEvent.map((e) => [`Event (this period): ${e.name}`, "event", e.net]),
      ...report.memos.map((m) => [`Pre-cutover summary: ${m.reason}`, "memo (not in balances)", m.direction === "income" ? m.amount : -m.amount]),
    ];
    download(`daledger-report-${from}-to-${to}.csv`, toCSV(["line", "section", "amount_fcfa"], rows));
  }

  return (
    <div className="min-h-full pb-10">
      <div className="print:hidden"><PageHeader title="Term review" /></div>
      <main className="px-4 py-5 flex flex-col gap-6 max-w-3xl mx-auto">
        <section aria-label="Period" className="flex flex-col gap-3 print:hidden">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted">From
              <input id="rep-from" name="rep-from" type="date" value={from} onChange={(e) => setRange(e.target.value, to)} className={control} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">To
              <input id="rep-to" name="rep-to" type="date" value={to} onChange={(e) => setRange(from, e.target.value)} className={control} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <button type="button" onClick={() => setRange(thisMonth, day(Date.now()))} className="h-9 px-3 rounded-full border border-line bg-white">This month</button>
            <button type="button" onClick={() => setRange(day(lastMonthStart.getTime() - lastMonthStart.getTimezoneOffset() * 60_000), day(lastMonthEnd.getTime() - lastMonthEnd.getTimezoneOffset() * 60_000))} className="h-9 px-3 rounded-full border border-line bg-white">Last month</button>
            {cutover != null && (
              <button type="button" onClick={() => setRange(day(cutover), day(Date.now()))} className="h-9 px-3 rounded-full border border-line bg-white">Since cutover</button>
            )}
          </div>
          {!valid && <p role="alert" className="text-sm text-loss">The start date must be before the end date.</p>}
        </section>

        {valid && report === undefined && <Loading label="Building the report…" />}

        {report && (
          <>
            <header className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold">Term review · {formatDate(report.from)} – {formatDate(report.to)}</h2>
              <p className="text-xs text-muted">
                By the date money moved. Generated {new Date(report.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })};
                a back-dated entry can still change a past period.
              </p>
            </header>

            <section className="rounded-xl border border-line bg-white p-4 flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">Money held by the SG</h3>
              <Row label={`Held on ${formatDate(report.from - 1)} (start)`} value={report.total.start} />
              {LINE_LABELS.map(([k, label]) => <Row key={k} label={label} value={lineValue(report.total.lines, k)} indent />)}
              <Row label={`Held on ${formatDate(report.to)} (end)`} value={report.total.end} strong />
              <p role="status" className={`text-sm ${report.balanced ? "text-gain" : "text-loss font-medium"}`}>
                {report.balanced
                  ? "✓ Start + every line = end. Nothing unexplained."
                  : "⚠ The lines don't add up. This should never happen; please report it."}
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">Per account</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                {report.accounts.map((a) => (
                  <div key={a.accountId} className="rounded-xl border border-line bg-white p-4 flex flex-col gap-1 min-w-0 break-inside-avoid">
                    <p className="font-medium">{a.name}</p>
                    <Row label="Start" value={a.start} small />
                    {LINE_LABELS.map(([k, label]) => lineValue(a.lines, k) !== 0 && <Row key={k} label={label} value={lineValue(a.lines, k)} indent small />)}
                    <Row label="End" value={a.end} strong small />
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-line bg-white p-4 flex flex-col gap-1 break-inside-avoid">
              <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">Owed by the university (School)</h3>
              <Row label="Start" value={report.school.start} small />
              <Row label="Allocations" value={report.school.allocations} indent small />
              <Row label="Paid withdrawals" value={-report.school.paidWithdrawals} indent small />
              <Row label="Adjustments" value={report.school.adjustments} indent small />
              <Row label="End" value={report.school.end} strong small />
            </section>

            <section className="flex flex-col gap-2 break-inside-avoid">
              <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">Income and expenses by category</h3>
              {report.byCategory.length === 0 ? <p className="text-sm text-muted">No income or expenses in this period.</p> : (
                <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white">
                  {report.byCategory.map((c) => (
                    <li key={`${c.direction}-${c.name}`} className="px-4 py-2 flex justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">{c.direction === "income" ? "Income" : "Expense"} · {c.name}</span>
                      <span className="num shrink-0">{formatFCFA(c.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {report.byEvent.length > 0 && (
              <section className="flex flex-col gap-2 break-inside-avoid">
                <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">By event · this period</h3>
                <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white">
                  {report.byEvent.map((e) => (
                    <li key={e.eventId} className="px-4 py-2 flex justify-between gap-3 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate">{e.name}</span>
                        <span className="block text-xs text-muted">
                          in {formatFCFA(e.income)} · out {formatFCFA(e.expense)}
                          {e.memoNet !== 0 && ` · pre-cutover summary ${formatFCFA(e.memoNet)}`}
                        </span>
                      </span>
                      <span className={`num shrink-0 ${e.net < 0 ? "text-loss" : ""}`}>{formatFCFA(e.net)}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">This period only. Each event's page shows its all-time total.</p>
              </section>
            )}

            {report.memos.length > 0 && (
              <section className="flex flex-col gap-2 break-inside-avoid">
                <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">Pre-cutover summaries (not in balances)</h3>
                <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white text-sm">
                  {report.memos.map((m, i) => (
                    <li key={i} className="px-4 py-2 flex justify-between gap-3">
                      <span className="min-w-0 truncate">{m.reason} · {m.event}</span>
                      <span className="num shrink-0">{m.direction === "expense" ? "−" : ""}{formatFCFA(m.amount)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="flex flex-col gap-2 break-inside-avoid">
              <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">Reconciliation checks in the period</h3>
              {report.checks.length === 0 ? <p className="text-sm text-muted">No checks recorded in this period.</p> : (
                <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white text-sm">
                  {report.checks.map((c, i) => (
                    <li key={i} className="px-4 py-2 flex justify-between gap-3">
                      <span>{formatDate(c.checkedAt)} · {c.accountName}</span>
                      <span className={c.difference === 0 ? "text-gain" : c.adjusted ? "text-muted" : "text-warn"}>
                        {c.difference === 0 ? "Matched" : `${formatFCFA(c.difference)} ${c.adjusted ? "adjusted" : "left open"}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="flex flex-wrap gap-2 print:hidden">
              <button type="button" onClick={() => window.print()} className="h-11 px-4 rounded-lg bg-brand text-white font-medium">Print or save as PDF</button>
              <button type="button" onClick={exportCSV} className="h-11 px-4 rounded-lg border border-line bg-white">Export CSV</button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Row(props: { label: string; value: number; indent?: boolean; strong?: boolean; small?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${props.small ? "text-sm" : ""} ${props.indent ? "pl-3 text-muted" : ""} ${props.strong ? "font-semibold border-t border-line pt-1" : ""}`}>
      <span className="min-w-0">{props.label}</span>
      <span className={`num shrink-0 ${props.value < 0 && !props.indent ? "text-loss" : ""}`}>
        {props.indent && props.value > 0 ? "+" : ""}{formatFCFA(props.value)}
      </span>
    </div>
  );
}
