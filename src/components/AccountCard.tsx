import { Link } from "react-router-dom";
import { formatFCFA } from "../lib/fcfa";
import type { AccountKey } from "../lib/money";
import AccountBadge from "./AccountBadge";

export type CheckStatus = { lastCheckedAt?: number; stale: boolean; openDifference: number };

const OVERDUE_DAYS = 7; // USER_BLUEPRINT: highlight a check older than a week

/** "Checked 3 days ago", "Needs re-checking", … for one account (ADR 0010). */
export function CheckLine(props: { check?: CheckStatus; accountId: string }) {
  const c = props.check;
  if (!c) return null;
  const days = c.lastCheckedAt === undefined ? null : Math.floor((Date.now() - c.lastCheckedAt) / 86_400_000);
  const [text, tone] = c.stale
    ? ["Needs re-checking", "text-loss font-medium"]
    : days === null
      ? ["Never checked", "text-warn"]
      : c.openDifference !== 0
        ? [`Gap of ${formatFCFA(c.openDifference)} open`, "text-warn"]
        : days > OVERDUE_DAYS
          ? [`Checked ${days} days ago`, "text-warn"]
          : [days === 0 ? "Checked today" : `Checked ${days} day${days === 1 ? "" : "s"} ago`, "text-muted"];
  return (
    <Link to={`/reconcile?account=${props.accountId}`} className={`text-xs underline-offset-2 hover:underline ${tone}`}>
      {text}
    </Link>
  );
}

export default function AccountCard(props: { accountId: string; accountKey?: AccountKey; name: string; balance: number; check?: CheckStatus }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-3.5 min-w-0 flex flex-col gap-2 shadow-[0_1px_0_var(--color-line)]">
      <div className="flex items-center gap-2 min-w-0">
        <AccountBadge accountKey={props.accountKey} size="sm" />
        <p className="text-sm font-medium truncate">{props.name}</p>
      </div>
      <p className={`figure text-[1.35rem] leading-none font-semibold truncate ${props.balance < 0 ? "text-loss" : ""}`}>
        {formatFCFA(props.balance)}
      </p>
      <CheckLine check={props.check} accountId={props.accountId} />
    </div>
  );
}
