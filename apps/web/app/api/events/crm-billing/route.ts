import { crmCredentials, handleBillingWebhook, verifyCrmSignature, type MpWebhook } from "@bodh/integrations/crm";

export const dynamic = "force-dynamic";

const MAX_BYTES = 256_000;

/**
 * Billing webhooks from the Agentic CRM's Monetization API (project "bodhlok"): subscription
 * changes and paid invoices. Signed with the endpoint's secret (X-Mp-Signature); X-Mp-Id is
 * the event ID, so retried deliveries are acknowledged once. See docs/crm.md.
 */
export async function POST(req: Request) {
  const creds = await crmCredentials("crm_billing");
  if (!creds) return Response.json({ error: "CRM billing intake is not configured." }, { status: 503 });

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return Response.json({ error: "Body too large." }, { status: 413 });
  if (!verifyCrmSignature(creds.webhook_secret, raw, req.headers.get("x-mp-signature"))) {
    return Response.json({ error: "Signature does not match." }, { status: 401 });
  }

  let body: MpWebhook;
  try {
    body = JSON.parse(raw) as MpWebhook;
  } catch {
    return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  }
  const key = req.headers.get("x-mp-id") ?? body.id;
  if (!key || typeof body.event !== "string") return Response.json({ error: "Missing event or id." }, { status: 400 });

  try {
    return Response.json(await handleBillingWebhook(body, key));
  } catch (e) {
    // A 5xx makes the CRM retry with the same id.
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
