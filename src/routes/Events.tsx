import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import PageHeader from "../components/PageHeader";
import { errorMessage } from "../lib/errors";

/** Add, close and reopen events. Closing only stops new tags (ADR 0022). */
export default function Events() {
  const events = useQuery(api.events.list);
  const create = useMutation(api.events.create);
  const setActive = useMutation(api.events.setActive);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await create({ name });
      setName("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="min-h-full pb-10">
      <PageHeader title="Events" />
      <main className="px-4 py-5 flex flex-col gap-5 max-w-2xl mx-auto">
        <form onSubmit={onCreate} className="flex flex-col gap-2">
          <label htmlFor="event-name" className="text-sm font-medium">New event</label>
          <div className="flex gap-2">
            <input
              id="event-name" name="event-name" autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Integration Week 2026…"
              className="h-12 flex-1 min-w-0 rounded-lg border border-line bg-white px-3"
            />
            <button type="submit" disabled={!name.trim()} className="h-12 px-4 rounded-lg bg-brand text-white font-medium disabled:opacity-50">
              Add
            </button>
          </div>
          {error && <p role="alert" className="text-sm text-loss">{error}</p>}
        </form>

        {events?.length === 0 && <p className="text-muted text-sm">No events yet.</p>}
        {events && events.length > 0 && (
          <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-white">
            {events.map((ev) => (
              <li key={ev._id} className="px-4 py-3 flex items-center justify-between gap-3">
                <Link to={`/events/${ev._id}`} className="min-w-0">
                  <span className="block truncate underline underline-offset-2">{ev.name}</span>
                  <span className="block text-xs text-muted">{ev.active ? "Open for new entries" : "Closed: totals kept"}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => void setActive({ eventId: ev._id, active: !ev.active })}
                  className="h-10 px-3 rounded-lg border border-line text-sm shrink-0"
                >
                  {ev.active ? "Close" : "Reopen"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
