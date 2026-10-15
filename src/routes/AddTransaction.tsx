import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import AmountInput from "../components/AmountInput";
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

const field = "h-12 rounded-lg border border-line bg-white px-3 text-base w-full";

export default function AddTransaction() {
  const catalog = useQuery(api.catalog.forEntry);
  const create = useMutation(api.transactions.create);
  const recent = useQuery(api.transactions.recentReasons);
  const balances = useQuery(api.balances.list);
  const [warned, setWarned] = useState(false);
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

  return (
    <div className="min-h-full">
      <header className="bg-brand text-white px-5 py-4 flex items-center gap-4">
        <Link to="/" className="underline underline-offset-2 text-white/85">Back</Link>
        <h1 className="font-semibold">Add transaction</h1>
      </header>

      <form onSubmit={onSubmit} className="px-4 py-5 flex flex-col gap-5 max-w-md mx-auto">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium mb-2">Type</legend>
          <div className="flex flex-wrap gap-2">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={type === t.value}
                onClick={() => pickType(t.value)}
                className={`h-10 px-3 rounded-full border text-sm ${
                  type === t.value ? "bg-brand text-white border-brand" : "bg-white border-line"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1.5" htmlFor="amount">
          <span className="text-sm font-medium">Amount</span>
          <AmountInput id="amount" value={amount} onChange={setAmount} />
        </label>

        {fromSchool ? (
          <p className="text-sm text-muted">
            {type === "allocation"
              ? "Raises what the university owes the SG. No cash account changes."
              : "Saved as approved, not yet paid. Mark it paid on Home when the money lands."}
          </p>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{type === "transfer" ? "From" : "Account"}</span>
            <select id="account" name="account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={field}>
              <option value="" disabled>Choose…</option>
              {fromOptions.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
            </select>
          </label>
        )}

        {needsTo && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{type === "transfer" ? "To" : "Will be paid into (optional)"}</span>
            <select id="to-account" name="to-account" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} className={field}>
              <option value="">{type === "transfer" ? "Choose…" : "Decide later"}</option>
              {cash.filter((a) => a._id !== accountId).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
            </select>
          </label>
        )}

        {needsCategory && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Category</span>
            <select id="category" name="category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={field}>
              <option value="" disabled>Choose…</option>
              {catalog?.categories.filter((c) => c.direction === type).map((c) => (
                <option key={c._id} value={c._id}>{c.name}</option>
              ))}
            </select>
          </label>
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

        {(catalog?.events.length ?? 0) > 0 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Event (optional)</span>
            <select id="event" name="event" value={eventId} onChange={(e) => setEventId(e.target.value)} className={field}>
              <option value="">None</option>
              {catalog?.events.map((ev) => <option key={ev._id} value={ev._id}>{ev.name}</option>)}
            </select>
          </label>
        )}

        {type !== "school_withdrawal" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Date (optional, defaults to now)</span>
            <input id="date" name="date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
          </label>
        )}

        {error && <p role="alert" className="text-sm text-loss">{error}</p>}

        <button type="submit" disabled={pending || !catalog} className="h-14 rounded-xl bg-brand text-white text-lg font-semibold disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
