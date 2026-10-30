import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import PageHeader from "../components/PageHeader";
import Loading from "../components/Loading";
import AmountInput from "../components/AmountInput";
import { formatFCFA, parseFCFA } from "../lib/fcfa";
import { errorMessage } from "../lib/errors";

/** An event's lifetime P&L, labelled "all time" (ADR 0022). */
export default function EventView() {
  const { id } = useParams();
  const view = useQuery(api.reports.event, { eventId: id as Id<"events"> });

  return (
    <div className="min-h-full pb-10">
      <PageHeader title={view ? `${view.name}: all time` : "Event"} back="/events" />
      <main className="px-4 py-5 flex flex-col gap-5 max-w-2xl mx-auto lg:mx-0 lg:px-8 lg:max-w-5xl">
        {view === undefined && <Loading />}
        {view && (
          <>
            <p className="text-sm text-muted">
              Every entry ever tagged to this event, whatever term it fell in{view.active ? "" : ". The event is closed; its totals are kept"}.
              The term report shows the same event limited to its period.
            </p>
            <section aria-label="Totals" className="grid grid-cols-3 gap-2">
              <Stat label="Income" value={view.income} />
              <Stat label="Expenses" value={view.expense} />
              <Stat label="Net" value={view.net} strong />
            </section>

            {(["income", "expense"] as const).map((dir) => {
              const cats = view.categories.filter((c) => c.direction === dir);
              if (cats.length === 0) return null;
              return (
                <section key={dir} className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">{dir === "income" ? "Income" : "Expenses"} by category</h2>
                  <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white">
                    {cats.map((c) => (
                      <li key={`${dir}-${c.categoryId}`} className="px-4 py-3 flex justify-between gap-3">
                        <span className="truncate">{c.name}</span>
                        <span className="num shrink-0">{formatFCFA(c.total)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {view.entries === 0 && <p className="text-muted text-sm">No income or expenses tagged to this event yet.</p>}

            <Link to={`/transactions?event=${id}`} className="text-brand underline underline-offset-2">
              See these transactions
            </Link>

            {view.active && <MemoForm eventId={id as Id<"events">} />}
          </>
        )}
      </main>
    </div>
  );
}

function Stat(props: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-3 min-w-0">
      <p className="text-xs text-muted">{props.label}</p>
      <p className={`num mt-1 text-sm sm:text-base truncate ${props.strong && props.value < 0 ? "text-loss" : ""} ${props.strong ? "font-semibold" : ""}`}>
        {formatFCFA(props.value)}
      </p>
    </div>
  );
}

const field = "h-12 rounded-xl border border-line bg-white px-3 text-base w-full";
const DAY = 24 * 3600 * 1000;

/**
 * A pre-cutover summary for this event (ADR 0011): report-only, so it never
 * changes a balance. Kept behind a button: it is a cutover task, not daily entry.
 */
function MemoForm(props: { eventId: Id<"events"> }) {
  const catalog = useQuery(api.catalog.forEntry);
  const cutover = useQuery(api.reports.cutover);
  const createMemo = useMutation(api.transactions.createMemo);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"income" | "expense">("income");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  // The last day before cutover, as yyyy-mm-dd (dates are UTC: Dakar is UTC+0).
  const maxDate = cutover ? new Date(cutover - DAY).toISOString().slice(0, 10) : undefined;
  const categories = catalog?.categories.filter((c) => c.direction === type) ?? [];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = parseFCFA(amount);
    if (parsed === null) return setError("Enter a whole, positive amount in FCFA.");
    if (!categoryId) return setError("Choose a category.");
    if (!reason.trim()) return setError("Say where the figure comes from.");
    if (!date) return setError("Choose the date of the event.");
    setPending(true);
    try {
      await createMemo({
        type, amount: parsed, reason, categoryId: categoryId as Id<"categories">, eventId: props.eventId,
        occurredAt: Date.parse(`${date}T12:00:00Z`),
      });
      setAmount("");
      setReason("");
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-sm text-brand font-medium">
        Add a pre-cutover summary…
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border border-line bg-white p-4 max-w-md">
      <div>
        <h2 className="font-semibold">Pre-cutover summary</h2>
        <p className="text-sm text-muted mt-1">
          A total from before DaLedger started, shown in this event and in reports. It never changes a balance:
          the opening balances already hold that money.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-brand-soft p-1" role="group" aria-label="Direction">
        {(["income", "expense"] as const).map((t) => (
          <button
            key={t} type="button" aria-pressed={type === t}
            onClick={() => { setType(t); setCategoryId(""); }}
            className={`h-11 rounded-xl text-sm font-semibold ${type === t ? "bg-white text-brand shadow-sm" : "text-muted"}`}
          >
            {t === "income" ? "Income" : "Expense"}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1.5" htmlFor="memo-amount">
        <span className="text-sm font-medium">Total</span>
        <AmountInput id="memo-amount" value={amount} onChange={setAmount} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Category</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={field}>
          <option value="">Choose…</option>
          {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Source of the figure</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Ticket sales, from the 2025 Excel" className={field} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Date of the event (before cutover)</span>
        <input type="date" value={date} max={maxDate} onChange={(e) => setDate(e.target.value)} className={field} />
      </label>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      {saved && <p role="status" className="text-sm text-muted">Saved. Add another, or close.</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className="h-12 px-5 rounded-xl bg-brand text-white font-semibold disabled:opacity-60">
          {pending ? "Saving…" : "Save summary"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-12 px-4 rounded-xl border border-line font-medium">
          Close
        </button>
      </div>
    </form>
  );
}
