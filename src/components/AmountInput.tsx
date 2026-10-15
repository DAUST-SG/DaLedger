import { groupDigits } from "../lib/fcfa";

/** Whole-FCFA input with a numeric keypad and live digit grouping. */
export default function AmountInput(props: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-line bg-white focus-within:outline-2 focus-within:outline-brand">
      <input
        id={props.id}
        inputMode="numeric"
        autoComplete="off"
        placeholder="0"
        value={props.value}
        onChange={(e) => props.onChange(groupDigits(e.target.value))}
        className="num h-14 flex-1 min-w-0 bg-transparent px-3 text-2xl outline-none"
      />
      <span className="px-3 text-muted font-medium">FCFA</span>
    </div>
  );
}
