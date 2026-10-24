import { bodhBatchSchema, normalizeEvent, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@bodh/integrations/bodh-events";
import { ingestEvents } from "@bodh/integrations/pipeline";

export const dynamic = "force-dynamic";

const MAX_BYTES = 1_000_000;

/**
 * Registration, activation and paid events from the BODH backend.
 * Signed with BODH_EVENTS_SECRET; see docs/bodh-events.md for the contract.
 */
export async function POST(req: Request) {
  const secret = process.env.BODH_EVENTS_SECRET;
  if (!secret) return Response.json({ error: "Event intake is not configured." }, { status: 503 });

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return Response.json({ error: "Body over 1 MB. Send at most 100 events per request." }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return Response.json({ error: "Body over 1 MB. Send at most 100 events per request." }, { status: 413 });

  const sig = verifySignature(secret, raw, req.headers.get(TIMESTAMP_HEADER), req.headers.get(SIGNATURE_HEADER));
  if (!sig.ok) {
    const error = { missing: "Missing signature headers.", stale: "Timestamp is more than 5 minutes off.", mismatch: "Signature does not match." }[sig.reason];
    return Response.json({ error }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Body is not valid JSON." }, { status: 400 });
  }
  const parsed = bodhBatchSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid event.", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }

  const result = await ingestEvents(parsed.data.map(normalizeEvent));
  return Response.json(result);
}
