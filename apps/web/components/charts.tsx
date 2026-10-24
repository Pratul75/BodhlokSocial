import { inr, num, pct } from "@/lib/format";
import type { FunnelTotals } from "@/lib/funnel";

/**
 * The funnel as one strip: each stage's bar is scaled to clicks on a square-root
 * scale so the taper stays readable, and the step rate sits between stages.
 */
export function FunnelStrip({ totals }: { totals: FunnelTotals }) {
  const stages = [
    { key: "clicks", label: "Clicks", value: totals.clicks },
    { key: "registrations", label: "Registered", value: totals.registrations },
    { key: "activations", label: "Activated", value: totals.activations, star: true },
    { key: "paid", label: "Paid", value: totals.paid },
  ];
  const top = Math.sqrt(Math.max(totals.clicks, 1));
  const cpa = totals.activations ? totals.spend / totals.activations : 0;

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-rule bg-rule sm:grid-cols-[1.1fr_repeat(4,1fr)]">
      <div className="col-span-2 bg-night p-5 text-white sm:col-span-1">
        <div className="text-xs text-night-3">Ad spend</div>
        <div className="mt-1 font-mono text-2xl font-medium tabular">{inr(totals.spend)}</div>
        <div className="mt-4 text-xs text-night-3">Blended cost per activated user</div>
        <div className="mt-0.5 font-mono text-lg text-turmeric tabular">{cpa ? inr(cpa) : "—"}</div>
      </div>
      {stages.map((s, i) => {
        const prev = i === 0 ? null : stages[i - 1]!.value;
        const rate = prev ? s.value / prev : null;
        const width = Math.max(4, (Math.sqrt(s.value) / top) * 100);
        return (
          <div key={s.key} className={`relative flex flex-col p-5 ${s.star ? "bg-turmeric-soft" : "bg-card"}`}>
            <div className="flex items-center justify-between gap-2 text-xs text-muted">
              <span className={s.star ? "font-semibold text-turmeric-ink" : ""}>
                {s.label}
                {s.star && <span className="ml-1 font-normal">· North Star</span>}
              </span>
              {rate !== null && <span className="font-mono tabular">{pct(rate)}</span>}
            </div>
            <div className="mt-1 font-mono text-2xl font-medium tabular">{num(s.value)}</div>
            <div className="mt-auto pt-5">
              <div className="h-2 rounded-full bg-black/5">
                <div
                  className={`h-2 rounded-full ${s.star ? "bg-turmeric" : "bg-dusk/70"}`}
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Vertical bars, one per period, the last one highlighted. */
export function PeriodBars({
  data,
  valueKey,
  format = num,
  height = 160,
}: {
  data: Record<string, number | string>[];
  valueKey: string;
  format?: (n: number) => string;
  height?: number;
}) {
  const values = data.map((d) => Number(d[valueKey]) || 0);
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-2 px-5 pt-4 pb-3" style={{ height: height + 44 }} role="img" aria-label={`Bar chart of ${valueKey}`}>
      {data.map((d, i) => {
        const v = values[i]!;
        const last = i === data.length - 1;
        return (
          <div key={String(d.label)} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className={`font-mono text-[11px] tabular ${last ? "font-medium text-ink" : "text-muted"}`}>{format(v)}</span>
            <div
              className={`w-full rounded-t-md ${last ? "bg-turmeric" : "bg-dusk/25"}`}
              style={{ height: Math.max(2, (v / max) * height) }}
            />
            <span className="truncate text-[11px] text-muted">{String(d.label)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** A thin horizontal meter, used for spend against a cap. */
export function Meter({ value, max, warnAt = 0.85 }: { value: number; max: number; warnAt?: number }) {
  const ratio = max ? Math.min(1, value / max) : 0;
  const color = ratio >= 1 ? "bg-sindoor" : ratio >= warnAt ? "bg-turmeric" : "bg-leaf";
  return (
    <div className="h-2 rounded-full bg-paper ring-1 ring-rule ring-inset" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={`h-2 rounded-full ${color}`} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}
