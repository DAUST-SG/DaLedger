import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import PageHeader from "../components/PageHeader";
import TransactionRow from "../components/TransactionRow";
import { useNames } from "../hooks/useNames";

/** The Needs-review inbox (ADR 0006): labelling an item confirms it and clears it. */
export default function Review() {
  const rows = useQuery(api.review.list);
  const detected = useQuery(api.sweep.detected);
  const names = useNames();

  return (
    <div className="min-h-full pb-10">
      <PageHeader title="Needs review" />
      <main className="px-4 py-5 flex flex-col gap-4 max-w-2xl mx-auto">
        <p className="text-sm text-muted">
          Real money movements still missing a category, such as a sale reported without one or a Naboopay payout to an
          outside wallet. They already count in the balances. Tap an item, pick its category, and save to confirm it.
        </p>
        {rows?.length === 0 && (
          <p className="rounded-xl border border-line bg-white p-4 text-center">Nothing to review. All entries are labelled.</p>
        )}
        {rows && rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white">
            {rows.map((r) => <TransactionRow key={r._id} row={r} names={names} />)}
          </ul>
        )}

        <section className="flex flex-col gap-2 pt-2">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">Detected by Naboopay</h2>
          <p className={`text-xs ${detected?.lastRun && !detected.lastRun.ok ? "text-loss" : "text-muted"}`}>
            {detected?.lastRun
              ? `Last check ${new Date(detected.lastRun.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}: ${detected.lastRun.message}`
              : "The Naboopay check has not run yet."}
          </p>
          <p className="text-sm text-muted">
            Recorded automatically from Naboopay: payments nobody reported, refunds, payouts and fees. Each one is a real
            money movement; tap it to see why.
          </p>
          {detected && detected.rows.length > 0 && (
            <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white">
              {detected.rows.map((r) => <TransactionRow key={r._id} row={r} names={names} />)}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
