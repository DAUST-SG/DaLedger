import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { formatFCFA } from "../lib/fcfa";
import { errorMessage } from "../lib/errors";
import type { useNames } from "../hooks/useNames";

export const TYPE_LABEL: Record<Doc<"transactions">["type"], string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
  allocation: "Allocation",
  school_withdrawal: "School withdrawal",
  adjustment_up: "Adjustment ↑",
  adjustment_down: "Adjustment ↓",
};

export type Row = {
  _id: Id<"transactions">;
  type: Doc<"transactions">["type"];
  amount: number;
  reason: string;
  status: Doc<"transactions">["status"];
  accountId: Id<"accounts">;
  toAccountId?: Id<"accounts">;
  categoryId?: Id<"categories">;
  eventId?: Id<"events">;
  source: string;
  occurredAt?: number;
  createdAt: number;
  reversalOf?: Id<"transactions">;
  reversed: boolean;
};

export function formatDate(ms?: number): string {
  return ms === undefined ? "not paid yet" : new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const input = "h-11 rounded-lg border border-line bg-white px-3 w-full";

/** One ledger row: tap to open label edits (ADR 0030) and Reverse (ADR 0002). */
export default function TransactionRow(props: { row: Row; names: ReturnType<typeof useNames> }) {
  const { row, names } = props;
  const [open, setOpen] = useState(false);
  const accounts = [names.account.get(row.accountId), row.toAccountId && names.account.get(row.toAccountId)].filter(Boolean).join(" → ");
  const meta = [
    formatDate(row.occurredAt),
    `${row.reversalOf ? "Reversal of " : ""}${TYPE_LABEL[row.type]}`,
    accounts,
    row.categoryId && names.category.get(row.categoryId),
    row.eventId && names.event.get(row.eventId),
    row.source !== "manual" && row.source,
    row.status === "needs_review" && "needs a label",
    row.status === "cancelled" && "cancelled",
    row.reversed && "reversed",
  ].filter(Boolean);

  return (
    <li className="px-4 py-3 flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-start justify-between gap-3 text-left w-full"
      >
        <span className="min-w-0">
          <span className="block truncate">{row.reason}</span>
          <span className="block text-xs text-muted">{meta.join(" · ")}</span>
        </span>
        <span className={`num shrink-0 ${row.reversed || row.status === "cancelled" ? "line-through text-muted" : ""}`}>
          {formatFCFA(row.amount)}
        </span>
      </button>
      {open && <RowActions row={row} onDone={() => setOpen(false)} />}
    </li>
  );
}

function RowActions(props: { row: Row; onDone: () => void }) {
  const { row } = props;
  const catalog = useQuery(api.catalog.forEntry);
  const editLabels = useMutation(api.transactions.editLabels);
  const reverse = useMutation(api.transactions.reverse);
  const [categoryId, setCategoryId] = useState<string>(row.categoryId ?? "");
  const [eventId, setEventId] = useState<string>(row.eventId ?? "");
  const [reason, setReason] = useState(row.reason);
  const [reverseReason, setReverseReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const hasCategory = (row.type === "income" || row.type === "expense") && !row.reversalOf;
  const canRetag = !row.reversalOf;
  const canReverse = !row.reversed && row.status !== "committed" && row.status !== "cancelled";
  const categories = catalog?.categories.filter((c) => c.direction === row.type) ?? [];
  // A closed event stays selectable only if it is already the row's tag (ADR 0022).
  const events = catalog?.events ?? [];

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setPending(true);
    try {
      await action();
      props.onDone();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  function save() {
    const changes: { categoryId?: Id<"categories">; eventId?: Id<"events"> | null; reason?: string } = {};
    if (hasCategory && categoryId && categoryId !== row.categoryId) changes.categoryId = categoryId as Id<"categories">;
    if (canRetag && eventId !== (row.eventId ?? "")) changes.eventId = eventId ? (eventId as Id<"events">) : null;
    if (reason.trim() !== row.reason) changes.reason = reason;
    return run(() => editLabels({ transactionId: row._id, ...changes }));
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-brand-soft p-3">
      {hasCategory && (
        <label className="flex flex-col gap-1 text-sm">
          Category
          <select
            id={`cat-${row._id}`} name={`cat-${row._id}`}
            // Unlabeled is never an option, so an unlabelled row starts on "Choose…".
            value={categories.some((c) => c._id === categoryId) ? categoryId : ""}
            onChange={(e) => setCategoryId(e.target.value)}
            className={input}
          >
            <option value="" disabled>Choose…</option>
            {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </label>
      )}
      {canRetag && (
        <label className="flex flex-col gap-1 text-sm">
          Event
          <select id={`event-${row._id}`} name={`event-${row._id}`} value={eventId} onChange={(e) => setEventId(e.target.value)} className={input}>
            <option value="">None</option>
            {row.eventId && !events.some((e) => e._id === row.eventId) && <option value={row.eventId}>(closed event)</option>}
            {events.map((e) => <option key={e._id} value={e._id}>{e.name}</option>)}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        Reason
        <input id={`reason-${row._id}`} name={`reason-${row._id}`} value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" className={input} />
      </label>
      <button
        type="button"
        onClick={save}
        disabled={pending || (row.status === "needs_review" && !categories.some((c) => c._id === categoryId))}
        className="h-11 rounded-lg bg-brand text-white font-medium disabled:opacity-50"
      >
        {row.status === "needs_review" ? "Save and confirm" : "Save labels"}
      </button>
      <p className="text-xs text-muted">Amount, account and date can't be edited. To fix one, reverse the entry and add it again.</p>

      {canReverse && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <input
            id={`reverse-${row._id}`} name={`reverse-${row._id}`}
            aria-label="Why is this being reversed?"
            placeholder="Why is this being reversed?"
            autoComplete="off"
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            className={input}
          />
          <button
            type="button"
            disabled={pending || !reverseReason.trim()}
            onClick={() => run(() => reverse({ transactionId: row._id, reason: reverseReason }))}
            className="h-11 rounded-lg bg-loss text-white font-medium disabled:opacity-50"
          >
            Reverse this entry
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}
