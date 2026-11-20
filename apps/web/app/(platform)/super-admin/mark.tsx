/** The console's own mark: the product's diamond, drawn once and used across the shell. */
export function ConsoleMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2" y="2" width="28" height="28" rx="1.5" />
      <path d="M2 2 30 30M30 2 2 30" />
      <path d="M16 2 30 16 16 30 2 16Z" />
    </svg>
  );
}
