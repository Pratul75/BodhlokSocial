import { attribute } from "./attribution";
import type { AttributionChannel } from "@bodh/shared";

/**
 * Web sessions per channel for one day, from the GA4 BigQuery export
 * (dataset analytics_<property id>, tables events_YYYYMMDD).
 * Credentials: the ga4 connection's service account JSON, or the runtime identity.
 */
export interface Ga4Config {
  projectId: string;
  dataset: string;
  credentials?: { client_email: string; private_key: string };
}

export const sessionsQuery = (projectId: string, dataset: string) => `
SELECT
  collected_traffic_source.manual_source AS source,
  collected_traffic_source.manual_medium AS medium,
  collected_traffic_source.gclid IS NOT NULL AS has_gclid,
  NET.HOST((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_referrer')) AS referrer_host,
  COUNT(*) AS sessions
FROM \`${projectId}.${dataset}.events_*\`
WHERE _TABLE_SUFFIX = @suffix AND event_name = 'session_start'
GROUP BY 1, 2, 3, 4`;

export interface SessionGroup {
  source: string | null;
  medium: string | null;
  has_gclid: boolean;
  referrer_host: string | null;
  sessions: number;
}

/** Collapse GA4's source/medium groups into our channels with the same rules as registrations. */
// GA4's placeholders for "no value", which must not count as a real source or medium.
const PLACEHOLDERS = new Set(["(direct)", "(none)", "(not set)", "(not provided)", "(data deleted)"]);
const clean = (v: string | null) => (v && !PLACEHOLDERS.has(v.trim().toLowerCase()) ? v : null);

export function sessionsByChannel(groups: SessionGroup[]): Partial<Record<AttributionChannel, number>> {
  const out: Partial<Record<AttributionChannel, number>> = {};
  for (const g of groups) {
    const ch = attribute({ utmSource: clean(g.source), utmMedium: clean(g.medium), gclid: g.has_gclid ? "1" : null, referrer: g.referrer_host });
    out[ch] = (out[ch] ?? 0) + Number(g.sessions);
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function fetchGa4Sessions(cfg: Ga4Config, day: string) {
  if (!DATE_RE.test(day)) throw new Error("day must be YYYY-MM-DD");
  if (!/^[a-zA-Z0-9_-]+$/.test(cfg.projectId) || !/^[a-zA-Z0-9_]+$/.test(cfg.dataset)) throw new Error("Invalid BigQuery project or dataset.");
  const { BigQuery } = await import("@google-cloud/bigquery");
  const bq = new BigQuery({ projectId: cfg.projectId, ...(cfg.credentials ? { credentials: cfg.credentials } : {}) });
  const [rows] = await bq.query({ query: sessionsQuery(cfg.projectId, cfg.dataset), params: { suffix: day.replace(/-/g, "") } });
  return sessionsByChannel(rows as SessionGroup[]);
}

/** The GA4 export dataset (analytics_<property id>) in a project, if the export has started. */
export async function findGa4Dataset(projectId: string, credentials?: Ga4Config["credentials"]): Promise<string | null> {
  const { BigQuery } = await import("@google-cloud/bigquery");
  const bq = new BigQuery({ projectId, ...(credentials ? { credentials } : {}) });
  const [datasets] = await bq.getDatasets();
  return datasets.map((d) => d.id ?? "").find((id) => /^analytics_\d+$/.test(id)) ?? null;
}
