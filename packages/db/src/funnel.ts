import { sql } from "drizzle-orm";
import { db } from "./client";

/** Days are counted in India time, matching how the team reads the funnel. */
const TZ = "Asia/Kolkata";

/**
 * Activation and paid events take the channel (and ad) of the same user's registration.
 * Run before rebuilding so an activation that arrived before its registration is fixed.
 */
export async function reconcileAttribution(): Promise<number> {
  const res = await db.execute(sql`
    UPDATE conversion_events a
    SET channel = r.channel, utm_source = r.utm_source, utm_medium = r.utm_medium,
        utm_campaign = r.utm_campaign, utm_content = r.utm_content,
        gclid = coalesce(a.gclid, r.gclid), gbraid = coalesce(a.gbraid, r.gbraid), wbraid = coalesce(a.wbraid, r.wbraid),
        fbclid = coalesce(a.fbclid, r.fbclid), fbp = coalesce(a.fbp, r.fbp), fbc = coalesce(a.fbc, r.fbc)
    FROM conversion_events r
    WHERE r.user_ref = a.user_ref AND r.type = 'registration' AND a.type <> 'registration'
      AND (a.channel IS DISTINCT FROM r.channel OR a.utm_content IS DISTINCT FROM r.utm_content)`);
  return (res as unknown as { count?: number }).count ?? 0;
}

/**
 * Rebuild funnel_daily for [from, to] from the source tables:
 *   paid channels    spend and clicks from ad_spend_daily
 *   organic channels clicks = web sessions from web_sessions_daily
 *   every channel    registrations, activations and paid from conversion_events
 * Returns the number of funnel rows written.
 */
export async function rebuildFunnel(from: string, to: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM funnel_daily WHERE day BETWEEN ${from}::date AND ${to}::date`);
    const res = await tx.execute(sql`
      WITH spend AS (
        SELECT day, platform AS channel, round(sum(spend))::int AS spend, sum(clicks)::int AS clicks
        FROM ad_spend_daily WHERE day BETWEEN ${from}::date AND ${to}::date GROUP BY 1, 2
      ),
      sessions AS (
        SELECT day, channel, sessions FROM web_sessions_daily
        WHERE day BETWEEN ${from}::date AND ${to}::date AND channel NOT IN ('google_ads', 'meta_ads')
      ),
      conv AS (
        SELECT (occurred_at AT TIME ZONE ${TZ})::date AS day, channel,
          count(*) FILTER (WHERE type = 'registration')::int AS registrations,
          count(*) FILTER (WHERE type = 'activation')::int AS activations,
          count(*) FILTER (WHERE type = 'paid')::int AS paid
        FROM conversion_events
        WHERE (occurred_at AT TIME ZONE ${TZ})::date BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1, 2
      ),
      keys AS (
        SELECT day, channel FROM spend UNION SELECT day, channel FROM sessions UNION SELECT day, channel FROM conv
      )
      INSERT INTO funnel_daily (day, channel, spend, clicks, registrations, activations, paid)
      SELECT k.day, k.channel,
        coalesce(s.spend, 0),
        coalesce(s.clicks, ws.sessions, 0),
        coalesce(c.registrations, 0), coalesce(c.activations, 0), coalesce(c.paid, 0)
      FROM keys k
      LEFT JOIN spend s ON s.day = k.day AND s.channel = k.channel
      LEFT JOIN sessions ws ON ws.day = k.day AND ws.channel = k.channel
      LEFT JOIN conv c ON c.day = k.day AND c.channel = k.channel`);
    return (res as unknown as { count?: number }).count ?? 0;
  });
}

export interface CreativeRow {
  platform: string;
  adId: string;
  adName: string;
  campaignName: string;
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number;
  activations: number;
}

/** Per-ad results for [from, to]: platform spend joined to registrations whose utm_content is the ad ID. */
export async function creativePerformance(from: string, to: string, limit = 20): Promise<CreativeRow[]> {
  const res = await db.execute(sql`
    WITH s AS (
      SELECT platform, ad_id, max(ad_name) AS ad_name, max(campaign_name) AS campaign_name,
        sum(spend)::float AS spend, sum(impressions)::int AS impressions, sum(clicks)::int AS clicks
      FROM ad_spend_daily WHERE day BETWEEN ${from}::date AND ${to}::date GROUP BY 1, 2
    ),
    c AS (
      SELECT channel AS platform, utm_content AS ad_id,
        count(*) FILTER (WHERE type = 'registration')::int AS registrations,
        count(*) FILTER (WHERE type = 'activation')::int AS activations
      FROM conversion_events
      WHERE channel IN ('google_ads', 'meta_ads') AND utm_content IS NOT NULL
        AND (occurred_at AT TIME ZONE ${TZ})::date BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1, 2
    )
    SELECT s.platform, s.ad_id AS "adId", s.ad_name AS "adName", s.campaign_name AS "campaignName",
      s.spend, s.impressions, s.clicks,
      coalesce(c.registrations, 0) AS registrations, coalesce(c.activations, 0) AS activations
    FROM s LEFT JOIN c ON c.platform = s.platform AND c.ad_id = s.ad_id
    WHERE s.spend > 0
    ORDER BY s.spend DESC
    LIMIT ${limit}`);
  return res as unknown as CreativeRow[];
}
