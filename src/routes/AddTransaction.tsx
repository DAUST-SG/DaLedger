import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import AmountInput from "../components/AmountInput";
import AccountBadge from "../components/AccountBadge";
import PageHeader from "../components/PageHeader";
import { formatFCFA, parseFCFA } from "../lib/fcfa";
import { errorMessage } from "../lib/errors";

type TxType = Doc<"transactions">["type"];

const TYPES: { value: TxType; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
  { value: "allocation", label: "School allocation" },
  { value: "school_withdrawal", label: "School withdrawal" },
  { value: "adjustment_up", label: "Adjustment ↑" },
  { value: "adjustment_down", label: "Adjustment ↓" },
];

const field = "h-12 rounded-xl border border-line bg-white px-3 text-base w-full";

export default function AddTransaction() {
  const catalog = useQuery(api.catalog.forEntry);
  const create = useMutation(api.transactions.create);
  const recent = useQuery(api.transactions.recentReasons);
  const balances = useQuery(api.balances.list);
  const [warned, setWarned] = useState(false);
  const [moreTypes, setMoreTypes] = useState(false);
  const navigate = useNavigate();

  const [type, setType] = useState<TxType>("expense");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [eventId, setEventId] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const accounts = catalog?.accounts ?? [];
  const cash = accounts.filter((a) => !a.isSchool);
  const school = accounts.find((a) => a.isSchool);
  const fromSchool = type === "allocation" || type === "school_withdrawal";
  const fromOptions = fromSchool ? (school ? [school] : []) : type.startsWith("adjustment") ? accounts : cash;
  const needsCategory = type === "income" || type === "expense";
  const needsTo = type === "transfer" || type === "school_withdrawal";
  const effectiveFrom = fromSchool ? (school?._id ?? "") : accountId;

  function pickType(t: TxType) {
    setType(t);
    setCategoryId("");
    setToAccountId("");
    if (t === "allocation" || t === "school_withdrawal" || !cash.some((a) => a._id === accountId)) setAccountId("");
  }

  // Picking a recent reason also fills its category, if none is chosen yet (PRD §5.2).
  function onReason(value: string) {
    setReason(value);
    const match = recent?.find((r) => r.type === type && r.reason === value);
    if (match?.categoryId && !categoryId && catalog?.categories.some((c) => c._id === match.categoryId)) {
      setCategoryId(match.categoryId);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = parseFCFA(amount);
    if (parsed === null) return setError("Enter a whole, positive amount in FCFA.");
    if (!reason.trim()) return setError("A reason is required.");
    if (!effectiveFrom) return setError("Choose an account.");
    if (needsCategory && !categoryId) return setError("Choose a category.");
    if (type === "transfer" && !toAccountId) return setError("Choose where the money goes.");

    // ADR 0017: warn, never block, when an entry would take School below 0.
    const schoolBalance = balances?.school?.balance;
    const lowersSchool = type === "adjustment_down" && effectiveFrom === school?._id;
    if (lowersSchool && schoolBalance !== undefined && parsed > schoolBalance && !warned) {
      setWarned(true);
      return setError(
        `This exceeds the remaining School receivable (${formatFCFA(schoolBalance)}). A university allocation may be missing. Tap Save again to continue.`,
      );
    }

    setPending(true);
    try {
      await create({
        type,
        amount: parsed,
        accountId: effectiveFrom as Id<"accounts">,
        toAccountId: needsTo && toAccountId ? (toAccountId as Id<"accounts">) : undefined,
        categoryId: needsCategory ? (categoryId as Id<"categories">) : undefined,
        eventId: eventId ? (eventId as Id<"events">) : undefined,
        reason,
        occurredAt: date ? new Date(date).getTime() : undefined,
      });
      navigate("/");
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  const main: TxType[] = ["expense", "income", "transfer"];
  const showMoreTypes = moreTypes || !main.includes(type);
  const categories = catalog?.categories.filter((c) => c.direction === type) ?? [];
  // Recently used categories first, as one-tap buttons (PRD §5.2); the rest in a list.
  const recentCats = [...new Set(recent?.filter((r) => r.type === type && r.categoryId).map((r) => r.categoryId as string))]
    .map((id) => categories.find((c) => c._id === id))
    .filter((c): c is (typeof categories)[number] => Boolean(c))
    .slice(0, 6);
  const otherCats = categories.filter((c) => !recentCats.some((r) => r._id === c._id));
  const chip = (on: boolean) =>
    `h-10 px-3.5 rounded-xl text-sm font-medium flex items-center gap-2 border ${on ? "bg-brand text-white border-brand" : "bg-white border-line"}`;

  return (
    <div className="min-h-full pb-10">
      <PageHeader title="Add transaction" />

      <form onSubmit={onSubmit} className="px-4 py-5 flex flex-col gap-6 max-w-md mx-auto">
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Type</legend>
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-brand-soft p-1">
            {main.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => pickType(t)}
                className={`h-11 rounded-xl text-sm font-semibold ${type === t ? "bg-white text-brand shadow-sm" : "text-muted"}`}
              >
                {TYPES.find((x) => x.value === t)!.label}
              </button>
            ))}
          </div>
          {showMoreTypes ? (
            <div className="flex flex-wrap gap-2">
              {TYPES.filter((t) => !main.includes(t.value)).map((t) => (
                <button key={t.value} type="button" aria-pressed={type === t.value} onClick={() => pickType(t.value)} className={chip(type === t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
          ) : (
            <button type="button" onClick={() => setMoreTypes(true)} className="self-start text-sm text-brand font-medium">
              School allocation, withdrawal or adjustment…
            </button>
          )}
        </fieldset>

        <label className="flex flex-col gap-1.5" htmlFor="amount">
          <span className="text-sm font-medium">Amount</span>
          <AmountInput id="amount" value={amount} onChange={setAmount} autoFocus />
        </label>

        {fromSchool ? (
          <p className="rounded-xl bg-brand-soft p-3 text-sm text-muted">
            {type === "allocation"
              ? "Raises what the university owes the SG. No cash account changes."
              : "Saved as approved, not yet paid. Mark it paid on Home when the money lands."}
          </p>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium mb-1.5">{type === "transfer" ? "From" : type === "income" ? "Into" : "Paid from"}</legend>
            <div className="flex flex-wrap gap-2">
              {fromOptions.map((a) => (
                <button key={a._id} type="button" aria-pressed={accountId === a._id} onClick={() => setAccountId(a._id)} className={chip(accountId === a._id)}>
                  <AccountBadge accountKey={a.key} size="sm" /> {a.name}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {needsTo && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium mb-1.5">{type === "transfer" ? "To" : "Will be paid into (optional)"}</legend>
            <div className="flex flex-wrap gap-2">
              {cash.filter((a) => a._id !== accountId).map((a) => (
                <button
                  key={a._id} type="button" aria-pressed={toAccountId === a._id}
                  onClick={() => setToAccountId(toAccountId === a._id && type !== "transfer" ? "" : a._id)}
                  className={chip(toAccountId === a._id)}
                >
                  <AccountBadge accountKey={a.key} size="sm" /> {a.name}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {needsCategory && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium mb-1.5">Category</legend>
            {recentCats.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {recentCats.map((c) => (
                  <button key={c._id} type="button" aria-pressed={categoryId === c._id} onClick={() => setCategoryId(c._id)} className={chip(categoryId === c._id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            <select
              id="category" name="category" aria-label={recentCats.length ? "Other categories" : "Category"}
              value={otherCats.some((c) => c._id === categoryId) ? categoryId : ""}
              onChange={(e) => setCategoryId(e.target.value)} className={field}
            >
              <option value="">{recentCats.length ? "Other category…" : "Choose…"}</option>
              {otherCats.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </fieldset>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Reason</span>
          <input
            id="reason" name="reason" value={reason} onChange={(e) => onReason(e.target.value)} list="reason-suggestions" autoComplete="off"
            placeholder={type === "expense" ? "e.g. Catering for the Gala…" : "What is this for?"}
            className={field}
          />
        </label>
        <datalist id="reason-suggestions">
          {recent?.filter((r) => r.type === type).map((r) => <option key={r.reason} value={r.reason} />)}
        </datalist>

        <details className="rounded-xl bg-white border border-line px-4 py-3 group" open={Boolean(eventId || date)}>
          <summary className="cursor-pointer text-sm font-medium list-none flex justify-between">
            More details <span className="text-muted font-normal">{eventId || date ? "set" : "event, date"}</span>
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {(catalog?.events.length ?? 0) > 0 && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm">Event</span>
                <select id="event" name="event" value={eventId} onChange={(e) => setEventId(e.target.value)} className={field}>
                  <option value="">None</option>
                  {catalog?.events.map((ev) => <option key={ev._id} value={ev._id}>{ev.name}</option>)}
                </select>
              </label>
            )}
            {type !== "school_withdrawal" && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm">Date (leave empty for now)</span>
                <input id="date" name="date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
              </label>
            )}
          </div>
        </details>

        {error && <p role="alert" className="text-sm text-loss">{error}</p>}

        <button type="submit" disabled={pending || !catalog} className="h-14 rounded-2xl bg-brand-deep text-white text-lg font-semibold disabled:opacity-60">
          {pending ? "Saving…" : `Save ${TYPES.find((t) => t.value === type)!.label.toLowerCase()}`}
        </button>
      </form>
    </div>
  );
}
