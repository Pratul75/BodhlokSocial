import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="mb-1 text-sm text-muted">{eyebrow}</div>}
        <h1 className="font-display text-[28px] leading-tight font-semibold tracking-tight sm:text-[32px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-[15px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-rule bg-card ${className}`}>{children}</section>;
}

export function CardHeader({ title, aside, sub }: { title: string; aside?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-3.5">
      <div>
        <h2 className="font-display text-[16px] font-semibold tracking-tight">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

type Tone = "neutral" | "dusk" | "turmeric" | "leaf" | "sindoor" | "ink";

const toneClass: Record<Tone, string> = {
  neutral: "bg-paper text-muted ring-rule",
  dusk: "bg-dusk-soft text-dusk ring-dusk/15",
  turmeric: "bg-turmeric-soft text-turmeric-ink ring-turmeric/25",
  leaf: "bg-leaf-soft text-leaf ring-leaf/20",
  sindoor: "bg-sindoor-soft text-sindoor ring-sindoor/20",
  ink: "bg-ink text-white ring-ink",
};

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${toneClass[tone]}`}>
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  idea: "neutral",
  drafted: "dusk",
  in_review: "turmeric",
  pending: "turmeric",
  approved: "leaf",
  scheduled: "leaf",
  published: "ink",
  posted: "ink",
  live: "leaf",
  planned: "neutral",
  failed: "sindoor",
  rejected: "sindoor",
  blocked: "sindoor",
  error: "sindoor",
  succeeded: "leaf",
  running: "dusk",
  queued: "neutral",
  active: "leaf",
  learning: "dusk",
  paused: "neutral",
  connected: "leaf",
  not_connected: "neutral",
  pending_review: "turmeric",
  applied: "leaf",
  sent_to_approval: "turmeric",
  found: "neutral",
  skipped: "neutral",
  new: "turmeric",
  contacted: "dusk",
  qualified: "leaf",
  won: "ink",
  lost: "neutral",
  draft: "turmeric",
  withdrawn: "neutral",
};

export const statusLabel = (s: string) => {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={STATUS_TONES[status] ?? "neutral"}>{statusLabel(status)}</Pill>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="font-display text-[15px] font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const btn = {
  primary: `${btnBase} bg-night text-white hover:bg-night-2`,
  secondary: `${btnBase} border border-rule bg-card text-ink hover:bg-paper`,
  approve: `${btnBase} bg-leaf text-white hover:bg-leaf/90`,
  danger: `${btnBase} border border-sindoor/30 bg-card text-sindoor hover:bg-sindoor-soft`,
  ghost: `${btnBase} text-muted hover:bg-paper hover:text-ink`,
};

export const inputClass =
  "w-full rounded-lg border border-rule bg-card px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-dusk focus:outline-none";

export function LinkButton({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: keyof typeof btn }) {
  return (
    <Link href={href} className={btn[variant]}>
      {children}
    </Link>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-mono text-[22px] font-medium tracking-tight tabular">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm [&_td]:px-5 [&_td]:py-2.5 [&_th]:px-5 [&_th]:py-2 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted [&_thead]:border-b [&_thead]:border-rule [&_tbody_tr]:border-b [&_tbody_tr]:border-rule/70 [&_tbody_tr:last-child]:border-0">
        {children}
      </table>
    </div>
  );
}
