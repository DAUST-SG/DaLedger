import { Link, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import PageHeader from "../components/PageHeader";
import Loading from "../components/Loading";
import { formatFCFA } from "../lib/fcfa";

/** An event's lifetime P&L, labelled "all time" (ADR 0022). */
export default function EventView() {
  const { id } = useParams();
  const view = useQuery(api.reports.event, { eventId: id as Id<"events"> });

  return (
    <div className="min-h-full pb-10">
      <PageHeader title={view ? `${view.name}: all time` : "Event"} back="/events" />
      <main className="px-4 py-5 flex flex-col gap-5 max-w-2xl mx-auto">
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
