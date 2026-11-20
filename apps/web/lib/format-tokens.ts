/**
 * Token counts, written the way somebody comparing workspaces reads them.
 *
 * Exact below ten thousand, then thousands, then millions. Nobody compares workspaces digit by
 * digit — "1.4M" says more at a glance than "1,432,908" — so the long form is kept for the
 * tooltip and this is what goes in the table.
 */
export function shortTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const whole = Math.round(n);
  if (whole >= 10_000_000) return `${Math.round(whole / 1_000_000)}M`;
  if (whole >= 1_000_000) return `${(whole / 1_000_000).toFixed(1)}M`;
  if (whole >= 10_000) return `${Math.round(whole / 1000)}k`;
  return whole.toLocaleString("en-IN");
}

/** The same number in full, for a title attribute or anywhere the exact figure is wanted. */
export function exactTokens(n: number): string {
  return `${Math.round(Number.isFinite(n) ? Math.max(n, 0) : 0).toLocaleString("en-IN")} tokens`;
}
