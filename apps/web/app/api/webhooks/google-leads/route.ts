import { parseGoogleLead, storeLead, verifyGoogleKey, type GoogleLeadPayload } from "@bodh/integrations/leads";
import { log } from "@bodh/shared/log";

export const dynamic = "force-dynamic";

/**
 * Google Ads lead form webhook. In the lead form's "Lead delivery" settings, set this URL and the
 * key in GOOGLE_LEADS_WEBHOOK_KEY. Google sends the key in the body and expects a 200.
 */
export async function POST(req: Request) {
  const key = process.env.GOOGLE_LEADS_WEBHOOK_KEY;
  if (!key) return Response.json({ error: "Lead intake from Google is not configured." }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 200_000) return Response.json({ error: "Body too large." }, { status: 413 });
  let payload: GoogleLeadPayload;
  try {
    payload = JSON.parse(raw) as GoogleLeadPayload;
  } catch {
    return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  }
  if (!verifyGoogleKey(key, payload)) return Response.json({ error: "Wrong key." }, { status: 401 });
  try {
    const r = await storeLead(parseGoogleLead(payload));
    return Response.json({ created: r.created });
  } catch (e) {
    log.error("google lead intake failed", { leadId: payload.lead_id, error: e });
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't store the lead." }, { status: e instanceof Error && /lead_id/.test(e.message) ? 400 : 500 });
  }
}
