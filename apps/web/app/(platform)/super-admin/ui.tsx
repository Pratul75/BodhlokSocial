import type { ReactNode } from "react";

/**
 * The console's own small pieces. They deliberately mirror the tenant app's `components/ui.tsx`
 * — same radii, same rule colour, same card header — so the two halves of the product look like
 * one. They live here rather than there because nothing in the tenant app should import from
 * the console, and these carry console-only ideas (a workspace's status, an operator's role).
 */

type Tone = "neutral" | "dusk" | "turmeric" | "leaf" | "sindoor";

const toneClass: Record<Tone, string> = {
  neutral: "bg-paper text-muted ring-rule",
  dusk: "bg-dusk-soft text-dusk ring-dusk/15",
  turmeric: "bg-turmeric-soft text-turmeric-ink ring-turmeric/25",
  leaf: "bg-leaf-soft text-leaf ring-leaf/20",
  sindoor: "bg-sindoor-soft text-sindoor ring-sindoor/20",
};

export function ConsolePill({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}

export function WorkspacePill({ status, error }: { status: string; error?: boolean }) {
  if (error) return <ConsolePill tone="sindoor">unreachable</ConsolePill>;
  if (status === "active") return <ConsolePill tone="leaf">active</ConsolePill>;
  if (status === "suspended") return <ConsolePill tone="turmeric">suspended</ConsolePill>;
  return <ConsolePill>{status}</ConsolePill>;
}

export function ConsoleCard({
  title,
  sub,
  aside,
  children,
  className = "",
}: {
  title?: string;
  sub?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-rule bg-card ${className}`}>
      {title && (
        <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-3.5">
          <div>
            <h2 className="font-display text-[16px] font-semibold tracking-tight">{title}</h2>
            {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border border-rule bg-card px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium tracking-wide text-muted uppercase">{label}</div>
        {tone !== "neutral" && <span className={`h-2 w-2 rotate-45 ${tone === "turmeric" ? "bg-turmeric" : "bg-dusk"}`} />}
      </div>
      <div className="mt-1.5 font-display text-[26px] leading-none font-semibold tabular">{value}</div>
      {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Money({ usd }: { usd: number }) {
  return <>${usd.toFixed(2)}</>;
}

/** Dates in the console are India time, like everywhere else in this product. */
export function WhenText({ at }: { at: Date | string | null }) {
  if (!at) return <span className="text-xs text-muted">never</span>;
  const d = new Date(at);
  return (
    <time dateTime={d.toISOString()} className="text-xs whitespace-nowrap text-muted">
      {d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })}
    </time>
  );
}

export function FieldRow({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-rule/60 px-5 py-3 last:border-0 sm:grid-cols-[260px_1fr] sm:items-center">
      <div className="text-sm font-medium">
        {label}
        {hint && <p className="mt-0.5 text-xs font-normal text-muted">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-6 text-sm text-muted">{children}</p>;
}
