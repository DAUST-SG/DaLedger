import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useConvex, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import PageHeader from "../components/PageHeader";
import Loading from "../components/Loading";
import { DayGroupedRows, TYPE_LABEL } from "../components/TransactionRow";
import { useNames } from "../hooks/useNames";
import { download, toCSV } from "../lib/csv";
import { errorMessage } from "../lib/errors";

type Filter = {
  from?: number;
  to?: number;
  accountId?: Id<"accounts">;
  categoryId?: Id<"categories">;
  eventId?: Id<"events">;
  source?: string;
  type?: Doc<"transactions">["type"];
};

// Dates in the URL are YYYY-MM-DD and cover the whole day, inclusive.
const dayStart = (d: string) => new Date(`${d}T00:00:00`).getTime();
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999`).getTime();

function filterFrom(params: URLSearchParams): Filter {
  const f: Filter = {};
  const from = params.get("from"), to = params.get("to");
  if (from) f.from = dayStart(from);
  if (to) f.to = dayEnd(to);
  if (params.get("account")) f.accountId = params.get("account") as Id<"accounts">;
  if (params.get("category")) f.categoryId = params.get("category") as Id<"categories">;
  if (params.get("event")) f.eventId = params.get("event") as Id<"events">;
  if (params.get("source")) f.source = params.get("source")!;
  if (params.get("type")) f.type = params.get("type") as Filter["type"];
  return f;
}

const control = "h-11 rounded-lg border border-line bg-white px-2 w-full min-w-0";
const SOURCES = ["manual", "shop", "dabus", "naboopay"];

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const filter = filterFrom(params);
  const names = useNames();
  const all = useQuery(api.catalog.names);
  const convex = useConvex();
  const { results, status, loadMore } = usePaginatedQuery(api.transactions.list, { filter }, { initialNumItems: 25 });
  const [exportError, setExportError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const chips = [
    (params.get("from") || params.get("to")) && { key: "dates", label: `${params.get("from") ?? "…"} → ${params.get("to") ?? "…"}` },
    params.get("account") && { key: "account", label: names.account.get(params.get("account")!) ?? "Account" },
    params.get("type") && { key: "type", label: TYPE_LABEL[params.get("type") as keyof typeof TYPE_LABEL] ?? "Type" },
    params.get("category") && { key: "category", label: names.category.get(params.get("category")!) ?? "Category" },
    params.get("event") && { key: "event", label: names.event.get(params.get("event")!) ?? "Event" },
    params.get("source") && { key: "source", label: `From ${params.get("source")}` },
  ].filter(Boolean) as { key: string; label: string }[];
  const [exporting, setExporting] = useState(false);

  function clear(keys: string[]) {
    const next = new URLSearchParams(params);
    for (const k of keys) next.delete(k);
    setParams(next, { replace: true });
  }

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  async function exportCSV() {
    setExportError(null);
    setExporting(true);
    try {
      const rows = await convex.query(api.transactions.exportRows, { filter });
      const iso = (ms?: number) => (ms === undefined ? "" : new Date(ms).toISOString());
      const csv = toCSV(
        ["id", "occurred_at", "type", "status", "amount_fcfa", "reversal_of", "account", "to_account", "category", "event", "source", "reason", "created_at"],
        rows.map((r) => [
          r._id, iso(r.occurredAt), r.type, r.status, r.amount, r.reversalOf ?? "",
          names.account.get(r.accountId), r.toAccountId && names.account.get(r.toAccountId),
          r.categoryId && names.category.get(r.categoryId), r.eventId && names.event.get(r.eventId),
          r.source, r.reason, iso(r.createdAt),
        ]),
      );
      download(`daledger-transactions-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    } catch (err) {
      setExportError(errorMessage(err, "The export failed. Try again."));
    } finally {
      setExporting(false);
    }
  }

  const filtered = [...params.keys()].length > 0;

  return (
    <div className="min-h-full pb-10">
      <PageHeader title="Transactions" />
      <main className="px-4 py-5 flex flex-col gap-4 max-w-3xl mx-auto lg:mx-0 lg:px-8 lg:max-w-5xl">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-expanded={showFilters}
            aria-controls="filter-panel"
            onClick={() => setShowFilters(!showFilters)}
            className={`h-10 px-4 rounded-xl text-sm font-medium border ${chips.length ? "bg-brand text-white border-brand" : "bg-white border-line"}`}
          >
            Filter{chips.length ? ` (${chips.length})` : ""}
          </button>
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => clear(c.key === "dates" ? ["from", "to"] : [c.key])}
              aria-label={`Remove filter ${c.label}`}
              className="h-10 pl-3 pr-2.5 rounded-xl bg-brand-soft text-sm text-brand flex items-center gap-1.5"
            >
              {c.label} <span aria-hidden="true" className="text-base leading-none">×</span>
            </button>
          ))}
          {chips.length > 1 && (
            <button type="button" onClick={() => setParams({}, { replace: true })} className="h-10 px-2 text-sm text-muted underline underline-offset-2">Clear all</button>
          )}
        </div>
        {showFilters && (
        <section id="filter-panel" aria-label="Filters" className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-2xl bg-white p-3 shadow-[0_1px_0_var(--color-line)]">
          <label className="flex flex-col gap-1 text-xs text-muted">From
            <input id="f-from" name="f-from" type="date" value={params.get("from") ?? ""} onChange={(e) => set("from", e.target.value)} className={control} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">To
            <input id="f-to" name="f-to" type="date" value={params.get("to") ?? ""} onChange={(e) => set("to", e.target.value)} className={control} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Account
            <select id="f-account" name="f-account" value={params.get("account") ?? ""} onChange={(e) => set("account", e.target.value)} className={control}>
              <option value="">All</option>
              {all?.accounts.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Type
            <select id="f-type" name="f-type" value={params.get("type") ?? ""} onChange={(e) => set("type", e.target.value)} className={control}>
              <option value="">All</option>
              {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Category
            <select id="f-category" name="f-category" value={params.get("category") ?? ""} onChange={(e) => set("category", e.target.value)} className={control}>
              <option value="">All</option>
              {all?.categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Event
            <select id="f-event" name="f-event" value={params.get("event") ?? ""} onChange={(e) => set("event", e.target.value)} className={control}>
              <option value="">All</option>
              {all?.events.map((e) => <option key={e._id} value={e._id}>{e.name}{e.active ? "" : " (closed)"}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Source
            <select id="f-source" name="f-source" value={params.get("source") ?? ""} onChange={(e) => set("source", e.target.value)} className={control}>
              <option value="">All</option>
              {[...new Set([...SOURCES, ...(filter.source ? [filter.source] : [])])].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <button type="button" onClick={() => setShowFilters(false)} className="h-11 w-full rounded-lg bg-brand text-white text-sm font-medium">Done</button>
          </div>
        </section>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">Newest first, by the date the money moved.</p>
          <button type="button" onClick={exportCSV} disabled={exporting} className="h-10 px-4 rounded-lg bg-brand text-white text-sm font-medium shrink-0 disabled:opacity-60">
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
        {exportError && <p role="alert" className="text-sm text-loss">{exportError}</p>}

        {status === "LoadingFirstPage" && <Loading />}
        {status !== "LoadingFirstPage" && results.length === 0 && (
          <p className="rounded-xl border border-line bg-white p-4 text-center">{filtered ? "No transactions match these filters." : "Nothing recorded yet."}</p>
        )}
        {results.length > 0 && (
          <DayGroupedRows rows={results} names={names} />
        )}
        {status === "CanLoadMore" && (
          <button type="button" onClick={() => loadMore(25)} className="h-11 rounded-lg border border-line bg-white">Load more</button>
        )}
        {status === "LoadingMore" && <p className="text-center text-sm text-muted">Loading…</p>}
      </main>
    </div>
  );
}
