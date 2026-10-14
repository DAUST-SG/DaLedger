import { formatFCFA } from "../lib/fcfa";

export default function AccountCard(props: { name: string; balance: number }) {
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3 min-w-0">
      <p className="text-sm text-muted">{props.name}</p>
      <p className={`num mt-1 text-lg truncate ${props.balance < 0 ? "text-loss" : ""}`}>{formatFCFA(props.balance)}</p>
    </div>
  );
}
