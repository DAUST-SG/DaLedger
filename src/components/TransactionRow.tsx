import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { formatFCFA, groupDigits, parseFCFA } from "../lib/fcfa";
import { errorMessage } from "../lib/errors";
import { useNames } from "../hooks/useNames";
import { dayLabel, DIRECTION_STYLE, direction } from "../lib/money";
import AccountBadge from "./AccountBadge";

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
  flip?: 1 | -1;
  reversed: boolean;
};

export function formatDate(ms?: number): string {
  return ms === undefined ? "not paid yet" : new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const input = "h-11 rounded-lg border border-line bg-white px-3 w-full";

/** Short label for the kind of entry, as an officer would say it. */
function kindLabel(row: Row): string {
  if (row.status === "draft") return "Recurring bill (draft)";
  if (row.status === "skipped") return "Recurring bill (skipped)";
  if (row.type === "school_withdrawal") return row.status === "committed" ? "School withdrawal, not paid yet" : "Drawn from the university";
  return `${row.reversalOf ? "Reversal of " : ""}${TYPE_LABEL[row.type].toLowerCase()}`.replace(/^./, (c) => c.toUpperCase());
}

/** One ledger row: tap to open label edits (ADR 0030), Reverse (ADR 0002), history. */
export default function TransactionRow(props: { row: Row; names: ReturnType<typeof useNames> }) {
  const { row, names } = props;
  const [open, setOpen] = useState(false);
  const dir = direction(row);
  const tone = DIRECTION_STYLE[dir];
  const from = names.account.get(row.accountId);
  const to = row.toAccountId && names.account.get(row.toAccountId);
  const overdue = row.status === "draft" && (row.occurredAt ?? 0) < new Date().setUTCHours(0, 0, 0, 0);
  const flags = [
    row.status === "needs_review" && { text: row.categoryId && names.category.get(row.categoryId) !== "Unlabeled" ? "Needs a category" : "Needs a label", tone: "text-warn" },
    overdue && { text: "Overdue", tone: "text-loss" },
    row.status === "cancelled" && { text: "Cancelled", tone: "text-muted" },
    row.status === "memo" && { text: "Pre-cutover summary, not in balances", tone: "text-muted" },
    row.reversed && { text: "Reversed", tone: "text-muted" },
    row.source !== "manual" && row.source !== "recurring" && { text: row.source === "naboopay" ? "From Naboopay" : `From ${row.source}`, tone: "text-muted" },
  ].filter(Boolean) as { text: string; tone: string }[];
  const struck = row.reversed || row.status === "cancelled" || row.status === "skipped";

  return (
    <li className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-3 text-left w-full px-4 py-3"
      >
        <span className="relative shrink-0">
          <AccountBadge accountKey={names.accountKey.get(row.accountId)} />
          <span
            aria-label={tone.label}
            className={`absolute -right-1 -bottom-1 size-4 rounded-full ring-2 ring-white text-[0.6rem] leading-none font-bold flex items-center justify-center ${tone.bg} ${tone.text}`}
          >
            {dir === "in" ? "↓" : dir === "out" ? "↑" : dir === "move" ? "⇄" : "·"}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium leading-snug line-clamp-2">{row.reason}</span>
          <span className="block text-xs text-muted truncate">
            {kindLabel(row)}
            {to ? ` · ${from} → ${to}` : ` · ${from}`}
            {row.categoryId && names.category.get(row.categoryId) !== "Unlabeled" ? ` · ${names.category.get(row.categoryId)}` : ""}
            {row.eventId ? ` · ${names.event.get(row.eventId)}` : ""}
          </span>
          {flags.length > 0 && (
            <span className="flex flex-wrap gap-x-2 text-xs font-medium">
              {flags.map((f) => <span key={f.text} className={f.tone}>{f.text}</span>)}
            </span>
          )}
        </span>
        <span className={`num shrink-0 text-right font-semibold ${struck ? "line-through text-muted" : tone.text}`}>
          {tone.sign}{formatFCFA(row.amount).replace(" FCFA", "")}
          <span className="block text-[0.7rem] font-normal text-muted no-underline">FCFA</span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          {row.status === "draft" ? <DraftActions row={row} onDone={() => setOpen(false)} /> : <RowActions row={row} onDone={() => setOpen(false)} />}
        </div>
      )}
    </li>
  );
}

/** Rows grouped under day headings (Today, Yesterday, Mon 13 Oct), newest first. */
export function DayGroupedRows(props: { rows: Row[]; names: ReturnType<typeof useNames> }) {
  const groups: { label: string; rows: Row[] }[] = [];
  for (const r of props.rows) {
    const label = dayLabel(r.occurredAt);
    if (groups.at(-1)?.label !== label) groups.push({ label, rows: [] });
    groups.at(-1)!.rows.push(r);
  }
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g, i) => (
        <section key={`${g.label}-${i}`} aria-label={g.label} className="flex flex-col gap-1.5">
          <h3 className="px-1 text-sm font-semibold text-muted">{g.label}</h3>
          <ul className="flex flex-col divide-y divide-line rounded-2xl bg-white shadow-[0_1px_0_var(--color-line)]">
            {g.rows.map((r) => <TransactionRow key={r._id} row={r} names={props.names} />)}
          </ul>
        </section>
      ))}
    </div>
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
  // Mirrors transactions.reverse: only entries that count, or a memo (ADR 0002, 0011, 0012).
  const canReverse = !row.reversed && ["confirmed", "paid", "needs_review", "memo"].includes(row.status);
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
      <AuditHistory id={row._id} />
    </div>
  );
}

/** A recurring draft: confirm it (correcting it if the bill changed) or skip the month (ADR 0012). */
function DraftActions(props: { row: Row; onDone: () => void }) {
  const { row } = props;
  const catalog = useQuery(api.catalog.forEntry);
  const confirm = useMutation(api.recurring.confirmDraft);
  const skip = useMutation(api.recurring.skipDraft);
  const [amount, setAmount] = useState(groupDigits(String(row.amount)));
  const [date, setDate] = useState(row.occurredAt ? new Date(row.occurredAt).toISOString().slice(0, 10) : "");
  const [accountId, setAccountId] = useState<string>(row.accountId);
  const [categoryId, setCategoryId] = useState<string>(row.categoryId ?? "");
  const [skipReason, setSkipReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

  function onConfirm() {
    const parsed = parseFCFA(amount);
    if (parsed === null) return setError("Enter a whole, positive amount in FCFA.");
    return run(() =>
      confirm({
        transactionId: row._id,
        amount: parsed,
        occurredAt: date ? Date.parse(`${date}T00:00:00Z`) : undefined,
        accountId: accountId as Id<"accounts">,
        categoryId: categoryId ? (categoryId as Id<"categories">) : undefined,
      }),
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-brand-soft p-3">
      <p className="text-xs text-muted">This draft moves no money yet. Correct it if the bill changed, then confirm it.</p>
      <label className="flex flex-col gap-1 text-sm">Amount paid
        <input id={`d-amount-${row._id}`} name={`d-amount-${row._id}`} inputMode="numeric" autoComplete="off" value={amount} onChange={(e) => setAmount(groupDigits(e.target.value))} className={`num ${input}`} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm">Date
          <input id={`d-date-${row._id}`} name={`d-date-${row._id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm">Paid from
          <select id={`d-account-${row._id}`} name={`d-account-${row._id}`} value={accountId} onChange={(e) => setAccountId(e.target.value)} className={input}>
            {catalog?.accounts.filter((a) => !a.isSchool).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">Category
        <select id={`d-category-${row._id}`} name={`d-category-${row._id}`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={input}>
          {catalog?.categories.filter((c) => c.direction === "expense").map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
      </label>
      <button type="button" onClick={onConfirm} disabled={pending} className="h-11 rounded-lg bg-brand text-white font-medium disabled:opacity-50">
        Confirm: it was paid
      </button>
      <div className="flex flex-col gap-2 border-t border-line pt-3">
        <input
          id={`d-skip-${row._id}`} name={`d-skip-${row._id}`} autoComplete="off"
          aria-label="Why skip this month?" placeholder="Why skip this month? e.g. Paid yearly in October…"
          value={skipReason} onChange={(e) => setSkipReason(e.target.value)} className={input}
        />
        <button type="button" onClick={() => run(() => skip({ transactionId: row._id, reason: skipReason }))} disabled={pending || !skipReason.trim()} className="h-11 rounded-lg border border-line bg-white font-medium disabled:opacity-50">
          Skip this month
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      <AuditHistory id={row._id} />
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  create: "Recorded",
  edit: "Labels edited",
  assign_category: "Category assigned, confirmed",
  reverse: "Recorded as a reversal",
  mark_paid: "Marked paid",
  cancel_withdrawal: "Withdrawal cancelled",
  adjust: "Reconciliation adjustment",
  correct_opening: "Opening balance correction",
  confirm_draft: "Recurring draft confirmed",
  skip_draft: "Month skipped",
  match: "Matched to the shop/DaBus sale",
};

// Actions whose entry created the row: show the label only, not "none → …" lines.
const CREATING = new Set(["create", "reverse", "adjust", "correct_opening"]);

// Fields worth showing in a change line; ids are turned into names.
const SHOWN = ["status", "amount", "categoryId", "eventId", "reason", "accountId", "toAccountId", "occurredAt", "skipReason"] as const;

/** Who did what and when to this transaction (ADR 0014). */
function AuditHistory(props: { id: Id<"transactions"> }) {
  const entries = useQuery(api.audit.forTransaction, { transactionId: props.id });
  const names = useNames();
  const show = (key: string, value: unknown) => {
    if (value === undefined || value === null) return "none";
    if (key === "categoryId") return names.category.get(String(value)) ?? "?";
    if (key === "eventId") return names.event.get(String(value)) ?? "?";
    if (key === "toAccountId" || key === "accountId") return names.account.get(String(value)) ?? "?";
    if (key === "amount") return formatFCFA(Number(value));
    if (key === "occurredAt") return formatDate(Number(value));
    return String(value);
  };
  if (!entries || entries.length === 0) return null;
  return (
    <section className="border-t border-line pt-3 flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">History</h3>
      <ul className="flex flex-col gap-1.5 text-xs">
        {entries.map((e) => {
          const changes =
            CREATING.has(e.action)
              ? []
              : SHOWN.filter((k) => (e.before && k in e.before) || (e.after && k in e.after)).map(
                  (k) => `${k.replace(/Id$/, "")}: ${show(k, e.before?.[k])} → ${show(k, e.after?.[k])}`,
                );
          return (
            <li key={e._id}>
              <span className="text-muted">{new Date(e.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {e.actor}</span>
              <span className="block">{ACTION_LABEL[e.action] ?? e.action}{changes.length ? `: ${changes.join("; ")}` : ""}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
