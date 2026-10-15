import type { Doc } from "../../convex/_generated/dataModel";

export type AccountKey = Doc<"accounts">["key"];
export type Direction = "in" | "out" | "move" | "pending";

/** Colour + short label per account (the design's one bold element). */
export const ACCOUNT_STYLE: Record<AccountKey, { color: string; soft: string; initials: string }> = {
  naboopay: { color: "var(--color-acc-naboopay)", soft: "color-mix(in oklab, var(--color-acc-naboopay) 12%, white)", initials: "N" },
  wave: { color: "var(--color-acc-wave)", soft: "color-mix(in oklab, var(--color-acc-wave) 12%, white)", initials: "W" },
  om: { color: "var(--color-acc-om)", soft: "color-mix(in oklab, var(--color-acc-om) 12%, white)", initials: "OM" },
  cash: { color: "var(--color-acc-cash)", soft: "color-mix(in oklab, var(--color-acc-cash) 12%, white)", initials: "C" },
  school: { color: "var(--color-acc-school)", soft: "color-mix(in oklab, var(--color-acc-school) 12%, white)", initials: "S" },
};

type RowLike = Pick<Doc<"transactions">, "type" | "status"> & { flip?: 1 | -1; reversalOf?: unknown };

/**
 * How an entry reads to an officer: money in (green, +), out (red, −), a move
 * between accounts (neutral, ⇄), or not real yet (draft, committed, skipped…).
 * A reversal reads the opposite way of what it cancels.
 */
export function direction(row: RowLike): Direction {
  if (!["confirmed", "paid", "needs_review"].includes(row.status)) return "pending";
  const base: Direction =
    row.type === "income" || row.type === "adjustment_up" || row.type === "allocation"
      ? "in"
      : row.type === "expense" || row.type === "adjustment_down"
        ? "out"
        : "move"; // transfer, paid school withdrawal
  const flip = row.flip ?? (row.reversalOf ? -1 : 1);
  if (flip === 1 || base === "move") return base;
  return base === "in" ? "out" : "in";
}

export const DIRECTION_STYLE: Record<Direction, { sign: string; text: string; bg: string; label: string }> = {
  in: { sign: "+", text: "text-gain", bg: "bg-gain-soft", label: "Money in" },
  out: { sign: "−", text: "text-loss", bg: "bg-loss-soft", label: "Money out" },
  move: { sign: "", text: "text-move", bg: "bg-move-soft", label: "Moved between accounts" },
  pending: { sign: "", text: "text-muted", bg: "bg-move-soft", label: "Not counted yet" },
};

/** "Today", "Yesterday", or "Mon 14 Oct" (adds the year when it isn't this year). */
export function dayLabel(ms: number | undefined, now = Date.now()): string {
  if (ms === undefined) return "Not paid yet";
  const d = new Date(ms);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date(now)) - day(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  });
}
