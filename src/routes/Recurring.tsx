import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import PageHeader from "../components/PageHeader";
import Loading from "../components/Loading";
import AmountInput from "../components/AmountInput";
import { formatDate } from "../components/TransactionRow";
import { useNames } from "../hooks/useNames";
import { formatFCFA, groupDigits, parseFCFA } from "../lib/fcfa";
import { errorMessage } from "../lib/errors";

const field = "h-11 rounded-lg border border-line bg-white px-3 w-full min-w-0";

type Template = {
  _id: Id<"recurringTemplates">;
  reason: string;
  amount: number;
  accountId: Id<"accounts">;
  categoryId: Id<"categories">;
  dayOfMonth: number;
  active: boolean;
  nextDraft?: number;
};

/** Regular bills set up once; each month a draft waits in the inbox (ADR 0012). */
export default function Recurring() {
  const templates = useQuery(api.recurring.list);
  const setActive = useMutation(api.recurring.setActive);
  const names = useNames();
  const [editing, setEditing] = useState<Template | "new" | null>(null);

  return (
    <div className="min-h-full pb-10">
      <PageHeader title="Recurring bills" />
      <main className="px-4 py-5 flex flex-col gap-5 max-w-2xl mx-auto">
        <p className="text-sm text-muted">
          Each bill prepares one draft a month on its due day. A draft moves no money until an officer confirms it in
          Needs review, or skips the month.
        </p>
        {editing ? (
          <TemplateForm key={editing === "new" ? "new" : editing._id} template={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
        ) : (
          <button type="button" onClick={() => setEditing("new")} className="self-start h-11 px-4 rounded-lg bg-brand text-white font-medium">
            Add a recurring bill
          </button>
        )}

        {templates === undefined && <Loading />}
        {templates?.length === 0 && !editing && <p className="text-muted text-sm">No recurring bills yet.</p>}
        {templates && templates.length > 0 && (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white">
            {templates.map((t) => (
              <li key={t._id} className="px-4 py-3 flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate">{t.reason}</span>
                  <span className="block text-xs text-muted">
                    <span className="num">{formatFCFA(t.amount)}</span> · {names.account.get(t.accountId)} · {names.category.get(t.categoryId)} · day {t.dayOfMonth}
                  </span>
                  <span className="block text-xs text-muted">{t.active && t.nextDraft ? `Next draft ${formatDate(t.nextDraft)}` : "Inactive: no new drafts"}</span>
                </span>
                <span className="flex gap-2 shrink-0">
                  <button type="button" onClick={() => setEditing(t)} className="h-9 px-3 rounded-lg border border-line text-sm">Edit</button>
                  <button type="button" onClick={() => void setActive({ templateId: t._id, active: !t.active })} className="h-9 px-3 rounded-lg border border-line text-sm">
                    {t.active ? "Deactivate" : "Reactivate"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function TemplateForm(props: { template: Template | null; onDone: () => void }) {
  const catalog = useQuery(api.catalog.forEntry);
  const create = useMutation(api.recurring.create);
  const update = useMutation(api.recurring.update);
  const t = props.template;
  const [reason, setReason] = useState(t?.reason ?? "");
  const [amount, setAmount] = useState(t ? groupDigits(String(t.amount)) : "");
  const [accountId, setAccountId] = useState<string>(t?.accountId ?? "");
  const [categoryId, setCategoryId] = useState<string>(t?.categoryId ?? "");
  const [day, setDay] = useState(String(t?.dayOfMonth ?? ""));
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = parseFCFA(amount);
    if (parsed === null) return setError("Enter a whole, positive amount in FCFA.");
    if (!reason.trim() || !accountId || !categoryId || !day) return setError("Fill in every field.");
    const args = {
      reason,
      amount: parsed,
      accountId: accountId as Id<"accounts">,
      categoryId: categoryId as Id<"categories">,
      dayOfMonth: Number(day),
    };
    try {
      if (t) await update({ templateId: t._id, ...args });
      else await create(args);
      props.onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-line bg-white p-4 flex flex-col gap-3">
      <h2 className="font-semibold">{t ? "Edit recurring bill" : "New recurring bill"}</h2>
      {t && <p className="text-xs text-muted">Changes apply to future drafts only.</p>}
      <label className="flex flex-col gap-1 text-sm">What is it?
        <input id="rec-reason" name="rec-reason" autoComplete="off" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Domain renewal…" className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor="rec-amount">Usual amount
        <AmountInput id="rec-amount" value={amount} onChange={setAmount} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm">Paid from
          <select id="rec-account" name="rec-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={field}>
            <option value="" disabled>Choose…</option>
            {catalog?.accounts.filter((a) => !a.isSchool).map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Due day (1–28)
          <input id="rec-day" name="rec-day" type="number" min={1} max={28} inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} className={field} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">Category
        <select id="rec-category" name="rec-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={field}>
          <option value="" disabled>Choose…</option>
          {catalog?.categories.filter((c) => c.direction === "expense").map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
      </label>
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="h-11 px-4 rounded-lg bg-brand text-white font-medium">{t ? "Save changes" : "Add bill"}</button>
        <button type="button" onClick={props.onDone} className="h-11 px-4 rounded-lg border border-line">Cancel</button>
      </div>
    </form>
  );
}
