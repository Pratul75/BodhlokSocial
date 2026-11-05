import { fetchMetaLead, metaLeadRefs, storeLead, verifyMetaSignature } from "@bodh/integrations/leads";
import { log } from "@bodh/shared/log";

export const dynamic = "force-dynamic";

/**
 * Meta Lead Ads webhook. Subscribe the Page's "leadgen" field in the Meta app with this URL and
 * META_LEADS_VERIFY_TOKEN; Meta signs each delivery with the app secret (META_APP_SECRET).
 */
export async function GET(req: Request) {
  const token = process.env.META_LEADS_VERIFY_TOKEN;
  const q = new URL(req.url).searchParams;
  if (!token) return new Response("Lead intake from Meta is not configured.", { status: 503 });
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === token) return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  return new Response("Verification failed.", { status: 403 });
}

export async function POST(req: Request) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return Response.json({ error: "Lead intake from Meta is not configured." }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 1_000_000) return Response.json({ error: "Body too large." }, { status: 413 });
  if (!verifyMetaSignature(secret, raw, req.headers.get("x-hub-signature-256"))) return Response.json({ error: "Bad signature." }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  }
  const refs = metaLeadRefs(body);
  let created = 0;
  const failed: string[] = [];
  for (const r of refs) {
    try {
      const lead = await fetchMetaLead(r.leadgenId);
      if (!lead.formId && r.formId) lead.formId = r.formId;
      if ((await storeLead(lead)).created) created++;
    } catch (e) {
      failed.push(r.leadgenId);
      log.error("meta lead intake failed", { leadgenId: r.leadgenId, error: e });
    }
  }
  // A non-2xx makes Meta deliver again later; stored leads are skipped as duplicates then.
  if (failed.length) return Response.json({ received: refs.length, created, failed: failed.length }, { status: 500 });
  return Response.json({ received: refs.length, created });
}
