import "server-only";
import { and, gte, lte, sql } from "drizzle-orm";
import { db, funnelDaily } from "@bodh/db";
import { daysAgo, toIsoDate } from "./format";

export interface FunnelTotals {
  spend: number;
  clicks: number;
  registrations: number;
  activations: number;
  paid: number;
}

const sums = {
  spend: sql<number>`coalesce(sum(${funnelDaily.spend}), 0)::int`,
  clicks: sql<number>`coalesce(sum(${funnelDaily.clicks}), 0)::int`,
  registrations: sql<number>`coalesce(sum(${funnelDaily.registrations}), 0)::int`,
  activations: sql<number>`coalesce(sum(${funnelDaily.activations}), 0)::int`,
  paid: sql<number>`coalesce(sum(${funnelDaily.paid}), 0)::int`,
};

/** Totals for the `days` days ending yesterday, offset by `offsetDays` further back. */
export async function funnelTotals(days: number, offsetDays = 0): Promise<FunnelTotals> {
  const from = toIsoDate(daysAgo(days + offsetDays));
  const to = toIsoDate(daysAgo(1 + offsetDays));
  const [row] = await db
    .select(sums)
    .from(funnelDaily)
    .where(and(gte(funnelDaily.day, from), lte(funnelDaily.day, to)));
  return row ?? { spend: 0, clicks: 0, registrations: 0, activations: 0, paid: 0 };
}

export async function funnelByChannel(days: number) {
  const from = toIsoDate(daysAgo(days));
  const to = toIsoDate(daysAgo(1));
  return db
    .select({ channel: funnelDaily.channel, ...sums })
    .from(funnelDaily)
    .where(and(gte(funnelDaily.day, from), lte(funnelDaily.day, to)))
    .groupBy(funnelDaily.channel)
    .orderBy(sql`sum(${funnelDaily.activations}) desc`);
}

/** Activated registrations per 7-day block, oldest first, ending yesterday. */
export async function weeklyActivations(weeks: number) {
  const out: { label: string; activations: number; registrations: number; spend: number }[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const t = await funnelTotals(7, w * 7);
    const end = daysAgo(1 + w * 7);
    out.push({
      label: end.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      activations: t.activations,
      registrations: t.registrations,
      spend: t.spend,
    });
  }
  return out;
}

export const costPerActivated = (t: Pick<FunnelTotals, "spend" | "activations">) =>
  t.activations ? Math.round(t.spend / t.activations) : null;
