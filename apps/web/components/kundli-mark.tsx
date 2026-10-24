/** North Indian chart diamond: the 12-house square used in every Kundli. */
export function KundliMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2" y="2" width="28" height="28" rx="1.5" />
      <path d="M2 2 30 30M30 2 2 30" />
      <path d="M16 2 30 16 16 30 2 16Z" />
    </svg>
  );
}
