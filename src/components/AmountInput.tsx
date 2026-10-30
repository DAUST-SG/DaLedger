import { groupDigits } from "../lib/fcfa";

/** Whole-FCFA input with a numeric keypad and live digit grouping. */
export default function AmountInput(props: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="flex items-center rounded-2xl border border-line bg-white focus-within:outline-2 focus-within:outline-brand">
      <input
        id={props.id}
        name={props.id}
        autoFocus={props.autoFocus}
        inputMode="numeric"
        autoComplete="off"
        placeholder="0"
        value={props.value}
        onChange={(e) => props.onChange(groupDigits(e.target.value))}
        className="figure h-16 flex-1 min-w-0 bg-transparent px-4 text-3xl font-semibold outline-none focus-visible:outline-none"
      />
      <span className="px-3 text-muted font-medium">FCFA</span>
    </div>
  );
}
