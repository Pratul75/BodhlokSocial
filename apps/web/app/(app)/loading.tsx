/** Shown while a module's data loads, so navigation responds at once. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <span className="sr-only">Loading…</span>
      <div className="mb-7 space-y-2">
        <div className="h-7 w-56 rounded-md bg-rule" />
        <div className="h-4 w-full max-w-xl rounded bg-rule/70" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-36 rounded-xl border border-rule bg-card" />
        ))}
      </div>
    </div>
  );
}
