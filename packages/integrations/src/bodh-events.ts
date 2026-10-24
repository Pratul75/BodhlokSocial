import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * The contract between the BODH backend and this app: how events are signed, what they
 * contain, and how personal data is normalised and hashed. docs/bodh-events.md is the
 * human-readable version for the BODH team.
 */

export const SIGNATURE_HEADER = "x-bodh-signature";
export const TIMESTAMP_HEADER = "x-bodh-timestamp";
export const MAX_SKEW_SECONDS = 300;
export const MAX_BATCH = 100;

export function signBody(secret: string, timestamp: number, rawBody: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" };

export function verifySignature(
  secret: string,
  rawBody: string,
  timestampHeader: string | undefined | null,
  signatureHeader: string | undefined | null,
  nowSeconds = Math.floor(Date.now() / 1000),
): SignatureCheck {
  if (!timestampHeader || !signatureHeader) return { ok: false, reason: "missing" };
  const ts = Number(timestampHeader);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale" };
  const expected = Buffer.from(signBody(secret, ts, rawBody));
  // A header may carry several signatures during secret rotation: "v1=…,v1=…".
  const ok = signatureHeader
    .split(",")
    .map((s) => Buffer.from(s.trim()))
    .some((given) => given.length === expected.length && timingSafeEqual(given, expected));
  return ok ? { ok: true } : { ok: false, reason: "mismatch" };
}

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export function normalizeEmail(email: string): string | null {
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Digits only with country code; a bare 10-digit number is taken as Indian (+91). */
export function normalizePhone(phone: string): string | null {
  let d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

const hex64 = z.string().regex(/^[a-f0-9]{64}$/, "must be a lowercase SHA-256 hex digest");
const opt = z.string().trim().max(500).optional().nullable();

const attributionSchema = z
  .object({
    utm_source: opt,
    utm_medium: opt,
    utm_campaign: opt,
    utm_content: opt,
    utm_term: opt,
    gclid: opt,
    gbraid: opt,
    wbraid: opt,
    fbclid: opt,
    fbp: opt,
    fbc: opt,
    referral_code: opt,
    referrer: z.string().trim().max(2000).optional().nullable(),
    landing_page: z.string().trim().max(2000).optional().nullable(),
  })
  .partial();

export const bodhEventSchema = z
  .object({
    event_id: z.string().trim().min(8).max(100),
    type: z.enum(["registration", "activation", "paid"]),
    occurred_at: z.iso.datetime({ offset: true }),
    user_id: z.string().trim().min(1).max(100),
    email: z.string().max(320).optional().nullable(),
    email_sha256: hex64.optional().nullable(),
    phone: z.string().max(40).optional().nullable(),
    phone_sha256: hex64.optional().nullable(),
    platform: z.enum(["web", "android", "ios"]).default("web"),
    plan: z.enum(["chaatra", "jyotish", "guru"]).optional().nullable(),
    value: z.number().nonnegative().max(10_000_000).optional().nullable(),
    currency: z.string().length(3).toUpperCase().default("INR"),
    attribution: attributionSchema.optional().nullable(),
    client: z
      .object({ ip: z.string().max(64).optional().nullable(), user_agent: z.string().max(1000).optional().nullable() })
      .optional()
      .nullable(),
  })
  .refine((e) => e.type !== "paid" || (e.value != null && e.plan != null), {
    message: "paid events need value and plan",
    path: ["value"],
  });

export type BodhEvent = z.infer<typeof bodhEventSchema>;

const batchObject = z.object({ events: z.array(bodhEventSchema).min(1).max(MAX_BATCH) });

/** One event, or { events: [...] } with up to 100. Picks the shape first so errors name the real field. */
export const bodhBatchSchema = z.custom<unknown>().transform((v, ctx): BodhEvent[] => {
  const isBatch = typeof v === "object" && v !== null && "events" in v;
  const r = isBatch ? batchObject.safeParse(v) : bodhEventSchema.safeParse(v);
  if (!r.success) {
    for (const issue of r.error.issues) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
    return z.NEVER;
  }
  return isBatch ? (r.data as z.infer<typeof batchObject>).events : [r.data as BodhEvent];
});

/** What gets stored: hashes instead of raw contact details. */
export interface NormalizedEvent {
  eventId: string;
  type: "registration" | "activation" | "paid";
  occurredAt: Date;
  userRef: string;
  emailSha256: string | null;
  phoneSha256: string | null;
  platform: "web" | "android" | "ios";
  plan: string | null;
  value: number | null;
  currency: string;
  attribution: NonNullable<BodhEvent["attribution"]> | null;
  clientIp: string | null;
  userAgent: string | null;
}

export function normalizeEvent(e: BodhEvent): NormalizedEvent {
  const email = e.email ? normalizeEmail(e.email) : null;
  const phone = e.phone ? normalizePhone(e.phone) : null;
  return {
    eventId: e.event_id,
    type: e.type,
    occurredAt: new Date(e.occurred_at),
    userRef: e.user_id,
    emailSha256: e.email_sha256 ?? (email ? sha256(email) : null),
    phoneSha256: e.phone_sha256 ?? (phone ? sha256(phone) : null),
    platform: e.platform,
    plan: e.plan ?? null,
    value: e.value ?? null,
    currency: e.currency,
    attribution: e.type === "registration" ? (e.attribution ?? null) : null,
    clientIp: e.client?.ip ?? null,
    userAgent: e.client?.user_agent ?? null,
  };
}
