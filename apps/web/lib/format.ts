const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat("en-IN");

export const inr = (n: number) => inrFmt.format(n);
export const num = (n: number) => numFmt.format(n);
export const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

export function change(current: number, previous: number): { text: string; up: boolean } | null {
  if (!previous) return null;
  const d = (current - previous) / previous;
  return { text: `${d >= 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(1)}%`, up: d >= 0 };
}

export function dayLabel(d: Date) {
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export function timeLabel(d: Date) {
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export function ago(d: Date, now = new Date()) {
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return `${days} d ago`;
}

export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function daysAgo(n: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}
