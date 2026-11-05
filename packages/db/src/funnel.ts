import { sql } from "drizzle-orm";
import { db } from "./client";

/** India time, for tables without a stored India-time day (the CRM mirror and payments). */
const TZ = "Asia/Kolkata";

/*
 * Days are counted in India time, matching how the team reads the funnel. conversion_events keeps
 * the India-time day in the generated column occurred_ist (indexed), so filters here use it.
 */

/**
 * Activation and paid events take the channel (and ad) of the same user's registration.
 * Run before rebuilding so an activation that arrived before its registration is fixed.
 * With `from`, only events on or after that India-time day are looked at (the rebuild window);
 * older events were reconciled by earlier runs.
 */
export async function reconcileAttribution(from?: string): Promise<number> {
  const res = await db.execute(sql`
    UPDATE conversion_events a
    SET channel = r.channel, utm_source = r.utm_source, utm_medium = r.utm_medium,
        utm_campaign = r.utm_campaign, utm_content = r.utm_content,
        gclid = coalesce(a.gclid, r.gclid), gbraid = coalesce(a.gbraid, r.gbraid), wbraid = coalesce(a.wbraid, r.wbraid),
        fbclid = coalesce(a.fbclid, r.fbclid), fbp = coalesce(a.fbp, r.fbp), fbc = coalesce(a.fbc, r.fbc)
    FROM conversion_events r
    WHERE r.user_ref = a.user_ref AND r.type = 'registration' AND a.type <> 'registration'
      ${from ? sql`AND a.occurred_ist >= ${from}::date` : sql``}
      AND (a.channel IS DISTINCT FROM r.channel OR a.utm_content IS DISTINCT FROM r.utm_content)`);
  return (res as unknown as { count?: number }).count ?? 0;
}

/**
 * Rebuild funnel_daily for [from, to] from the source tables:
 *   paid channels    spend and clicks from ad_spend_daily
 *   organic channels clicks = web sessions from web_sessions_daily
 *   every channel    registrations, activations and paid from conversion_events
 *                    leads from the CRM mirror (enquiries, not product signups)
 *                    revenue from paid CRM invoices, net of GST, under the channel of
 *                    the payer's registration ("direct" when there is none)
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
        SELECT occurred_ist AS day, channel,
          count(*) FILTER (WHERE type = 'registration')::int AS registrations,
          count(*) FILTER (WHERE type = 'activation')::int AS activations,
          count(*) FILTER (WHERE type = 'paid')::int AS paid
        FROM conversion_events
        WHERE occurred_ist BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1, 2
      ),
      lead AS (
        SELECT (crm_created_at AT TIME ZONE ${TZ})::date AS day, channel, count(*)::int AS leads
        FROM leads
        WHERE kind = 'lead' AND status <> 'deleted'
          AND (crm_created_at AT TIME ZONE ${TZ})::date BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1, 2
      ),
      rev AS (
        SELECT (p.paid_at AT TIME ZONE ${TZ})::date AS day, coalesce(r.channel, 'direct') AS channel,
          round(sum(p.total_paise - p.gst_paise) / 100.0)::int AS revenue
        FROM payments p
        LEFT JOIN conversion_events r ON r.user_ref = p.user_ref AND r.type = 'registration'
        WHERE p.status = 'paid' AND (p.paid_at AT TIME ZONE ${TZ})::date BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1, 2
      ),
      keys AS (
        SELECT day, channel FROM spend UNION SELECT day, channel FROM sessions UNION SELECT day, channel FROM conv
        UNION SELECT day, channel FROM lead UNION SELECT day, channel FROM rev
      )
      INSERT INTO funnel_daily (day, channel, spend, clicks, registrations, activations, paid, leads, revenue)
      SELECT k.day, k.channel,
        coalesce(s.spend, 0),
        coalesce(s.clicks, ws.sessions, 0),
        coalesce(c.registrations, 0), coalesce(c.activations, 0), coalesce(c.paid, 0),
        coalesce(l.leads, 0), coalesce(rv.revenue, 0)
      FROM keys k
      LEFT JOIN spend s ON s.day = k.day AND s.channel = k.channel
      LEFT JOIN sessions ws ON ws.day = k.day AND ws.channel = k.channel
      LEFT JOIN conv c ON c.day = k.day AND c.channel = k.channel
      LEFT JOIN lead l ON l.day = k.day AND l.channel = k.channel
      LEFT JOIN rev rv ON rv.day = k.day AND rv.channel = k.channel`);
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
  /** CRM leads from this ad (Facebook Lead Ads carry the ad ID; others match on utm_content). */
  leads: number;
  /** Rupees from users who registered from this ad, net of GST. */
  revenue: number;
}

/**
 * Per-ad results for [from, to]: platform spend joined to registrations whose utm_content is
 * the ad ID, CRM leads from the ad, and revenue from the users it brought in.
 */
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
        AND occurred_ist BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1, 2
    ),
    l AS (
      SELECT channel AS platform, coalesce(fb_ad_id, utm_content) AS ad_id, count(*)::int AS leads
      FROM leads
      WHERE kind = 'lead' AND status <> 'deleted' AND coalesce(fb_ad_id, utm_content) IS NOT NULL
        AND (crm_created_at AT TIME ZONE ${TZ})::date BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1, 2
    ),
    rv AS (
      SELECT r.channel AS platform, r.utm_content AS ad_id, round(sum(p.total_paise - p.gst_paise) / 100.0)::float AS revenue
      FROM payments p JOIN conversion_events r ON r.user_ref = p.user_ref AND r.type = 'registration'
      WHERE p.status = 'paid' AND r.channel IN ('google_ads', 'meta_ads') AND r.utm_content IS NOT NULL
        AND (p.paid_at AT TIME ZONE ${TZ})::date BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1, 2
    )
    SELECT s.platform, s.ad_id AS "adId", s.ad_name AS "adName", s.campaign_name AS "campaignName",
      s.spend, s.impressions, s.clicks,
      coalesce(c.registrations, 0) AS registrations, coalesce(c.activations, 0) AS activations,
      coalesce(l.leads, 0) AS leads, coalesce(rv.revenue, 0) AS revenue
    FROM s
    LEFT JOIN c ON c.platform = s.platform AND c.ad_id = s.ad_id
    LEFT JOIN l ON l.platform = s.platform AND l.ad_id = s.ad_id
    LEFT JOIN rv ON rv.platform = s.platform AND rv.ad_id = s.ad_id
    WHERE s.spend > 0
    ORDER BY s.spend DESC
    LIMIT ${limit}`);
  return res as unknown as CreativeRow[];
}
