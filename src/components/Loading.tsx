/** One consistent loading state: a short label over pulsing placeholder rows. */
export default function Loading(props: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <p className="text-sm text-muted">{props.label ?? "Loading…"}</p>
      {Array.from({ length: props.rows ?? 3 }, (_, i) => (
        <div key={i} className="h-12 rounded-xl bg-line/60 motion-safe:animate-pulse" />
      ))}
    </div>
  );
}
