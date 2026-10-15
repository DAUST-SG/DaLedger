import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import PageHeader from "../components/PageHeader";
import TransactionRow from "../components/TransactionRow";
import { useNames } from "../hooks/useNames";

/** The Needs-review inbox (ADR 0006): labelling an item confirms it and clears it. */
export default function Review() {
  const rows = useQuery(api.review.list);
  const names = useNames();

  return (
    <div className="min-h-full pb-10">
      <PageHeader title="Needs review" />
      <main className="px-4 py-5 flex flex-col gap-4 max-w-2xl mx-auto">
        <p className="text-sm text-muted">
          Money that arrived without a label. It already counts in the balances. Tap an item, pick its category, and save
          to confirm it.
        </p>
        {rows?.length === 0 && (
          <p className="rounded-xl border border-line bg-white p-4 text-center">Nothing to review. All entries are labelled.</p>
        )}
        {rows && rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white">
            {rows.map((r) => <TransactionRow key={r._id} row={r} names={names} />)}
          </ul>
        )}
      </main>
    </div>
  );
}
