import { ACCOUNT_STYLE, type AccountKey } from "../lib/money";

/** The account's colour square with its initials: how officers spot an account at a glance. */
export default function AccountBadge(props: { accountKey?: AccountKey; size?: "sm" | "md" }) {
  const style = props.accountKey ? ACCOUNT_STYLE[props.accountKey] : undefined;
  const size = props.size === "sm" ? "size-6 text-[0.6rem] rounded-md" : "size-9 text-xs rounded-lg";
  return (
    <span
      aria-hidden="true"
      className={`${size} shrink-0 inline-flex items-center justify-center font-semibold text-white`}
      style={{ background: style?.color ?? "var(--color-move)" }}
    >
      {style?.initials ?? "?"}
    </span>
  );
}
