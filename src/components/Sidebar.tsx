import { NavLink, Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";

/** Laptop and wider: fixed navigation on the left. Phones keep Home's tiles and the floating Add button. */
export default function Sidebar() {
  const me = useQuery(api.catalog.me);
  const inbox = useQuery(api.review.count);
  const checks = useQuery(api.reconciliations.status);
  const overdue = useQuery(api.recurring.overdue);
  const stale = checks?.filter((c) => c.stale).length ?? 0;
  const { signOut } = useAuthActions();

  const items: { to: string; label: string; count?: number; tone?: string }[] = [
    { to: "/", label: "Home" },
    { to: "/review", label: "Needs review", count: inbox, tone: "bg-warn" },
    { to: "/transactions", label: "Transactions" },
    { to: "/reconcile", label: "Reconcile", count: stale, tone: "bg-loss" },
    { to: "/report", label: "Term review" },
    { to: "/events", label: "Events" },
    { to: "/recurring", label: "Recurring bills", count: overdue, tone: "bg-warn" },
  ];

  return (
    <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col bg-brand-deep text-white print:hidden">
      <div className="px-6 pt-7 pb-6">
        <p className="text-lg font-semibold tracking-tight">DaLedger</p>
        <p className="text-sm text-white/55">DAUST Student Government</p>
      </div>
      <div className="px-4">
        <Link to="/add" className="h-11 rounded-xl bg-white text-brand-deep font-semibold flex items-center justify-center gap-2">
          <span aria-hidden="true" className="text-xl leading-none">+</span> Add transaction
        </Link>
      </div>
      <nav aria-label="Sections" className="mt-6 px-3 flex flex-col gap-0.5">
        {items.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.to === "/"}
            className={({ isActive }) =>
              `h-10 px-3 rounded-lg flex items-center justify-between text-sm font-medium ${
                isActive ? "bg-white/12 text-white" : "text-white/70 hover:text-white hover:bg-white/6"
              }`
            }
          >
            {i.label}
            {i.count ? <span className={`num min-w-5 h-5 px-1.5 rounded-full text-[0.7rem] font-semibold flex items-center justify-center text-white ${i.tone}`}>{i.count}</span> : null}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto px-6 py-5 border-t border-white/10 text-sm">
        <p className="truncate text-white/85">{me?.name ?? me?.email}</p>
        <button type="button" onClick={() => void signOut()} className="text-white/55 hover:text-white underline underline-offset-2">Sign out</button>
      </div>
    </aside>
  );
}
