import { crmCredentials, handleLeadWebhook, verifyCrmSignature, type CrmWebhook } from "@bodh/integrations/crm";

export const dynamic = "force-dynamic";

const MAX_BYTES = 256_000;

/**
 * Lead webhooks from the Agentic CRM (Settings → Webhooks): lead.created, lead.updated,
 * lead.stage_changed and lead.converted. Signed with the webhook's secret
 * (X-Webhook-Signature). See docs/crm.md.
 */
export async function POST(req: Request) {
  const creds = await crmCredentials("crm_leads");
  if (!creds) return Response.json({ error: "CRM lead intake is not configured." }, { status: 503 });

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return Response.json({ error: "Body too large." }, { status: 413 });
  if (!verifyCrmSignature(creds.webhook_secret, raw, req.headers.get("x-webhook-signature"))) {
    return Response.json({ error: "Signature does not match." }, { status: 401 });
  }

  let body: CrmWebhook;
  try {
    body = JSON.parse(raw) as CrmWebhook;
  } catch {
    return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  }
  if (typeof body.event !== "string") return Response.json({ error: "Missing event." }, { status: 400 });

  try {
    return Response.json(await handleLeadWebhook(body, raw));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
