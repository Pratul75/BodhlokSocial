/**
 * Re-checks every stored credential with its provider and updates the Connections page:
 * "connected" only when the provider accepted it just now, "error" with the provider's reason
 * otherwise. Run from Connections ("Check all connections") and by the daily ops job, so a key
 * that was revoked or expired shows up before a job trips over it.
 */
import { eq, inArray } from "drizzle-orm";
import { connections, db } from "@bodh/db";
import { getIntegration } from "@bodh/shared";
import { googleAccessToken } from "./google-oauth";
import { googleAdsConfigFromEnv, verifyGoogleAdsAccess } from "./google-ads";
import { secretName, secretStore } from "./secrets";
import { hasValidator, validateCredential, type Validation, type Validator } from "./validate";
import { checkCmsConnection } from "./site-publisher";
import { myChannel } from "./youtube";
import { redditAccess, redditMe } from "./reddit";

export interface ConnectionCheck {
  key: string;
  name: string;
  ok: boolean;
  detail: string;
}

async function checkGoogle(key: string): Promise<Validation> {
  const token = await googleAccessToken(key);
  if (!token) return { ok: false, error: "No stored Google grant. Connect again." };
  if (key === "search_console") {
    const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { ok: false, error: `Search Console answered HTTP ${res.status}.` };
    const body = (await res.json()) as { siteEntry?: { siteUrl: string; permissionLevel: string }[] };
    const sites = (body.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser");
    return sites.length ? { ok: true, label: `${sites.length} verified propert${sites.length === 1 ? "y" : "ies"}` } : { ok: false, error: "No verified Search Console properties." };
  }
  if (key === "google_ads") {
    const cfg = googleAdsConfigFromEnv();
    if (!cfg) return { ok: true, label: "Signed in (developer token pending)" };
    return { ok: true, label: await verifyGoogleAdsAccess(cfg, token) };
  }
  if (key === "youtube") {
    const channel = await myChannel(token);
    return channel ? { ok: true, label: channel.title } : { ok: false, error: "The signed-in Google account has no YouTube channel." };
  }
  return { ok: true };
}

async function checkReddit(): Promise<Validation> {
  const access = await redditAccess();
  if (!access) return { ok: false, error: "Reddit isn't connected (save the Reddit app, then sign in)." };
  return { ok: true, label: `u/${await redditMe(access)}` };
}

/** Checks every connection that has a stored credential. `extra` adds checks that live elsewhere (Anthropic). */
export async function verifyConnections(extra: Record<string, Validator> = {}): Promise<ConnectionCheck[]> {
  const rows = await db.select().from(connections).where(inArray(connections.status, ["connected", "error"]));
  const store = await secretStore();
  const out: ConnectionCheck[] = [];
  for (const row of rows) {
    const def = getIntegration(row.key);
    if (!def || !row.secretRef) continue;
    // The CMS check signs in, which rotates the key; live's checkCmsConnection stores the new key
    // and updates the row itself, so it runs on its own here.
    if (row.key === "bodhlok_cms") {
      try {
        out.push({ key: row.key, name: def.name, ok: true, detail: await checkCmsConnection() });
      } catch (e) {
        out.push({ key: row.key, name: def.name, ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
      continue;
    }
    // No check for this kind of credential (for example the CRM feeds): leave its row as it is,
    // rather than marking it connected without asking the provider.
    if (!def.googleOAuth && def.customOAuth !== "reddit" && !hasValidator(row.key, extra)) continue;
    let v: Validation;
    try {
      if (def.googleOAuth) v = await checkGoogle(row.key);
      else if (def.customOAuth === "reddit") v = await checkReddit();
      else {
        const value = await store.get(secretName(row.key));
        v = value ? await validateCredential(row.key, value, extra) : { ok: false, error: "The stored credential is missing from the secrets store. Connect again." };
      }
    } catch (e) {
      v = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    await db
      .update(connections)
      .set(
        v.ok
          ? { status: "connected", error: v.warning ?? null, lastSyncAt: new Date(), updatedAt: new Date(), ...(v.label && !row.accountLabel ? { accountLabel: v.label } : {}) }
          : { status: "error", error: v.error.slice(0, 500), updatedAt: new Date() },
      )
      .where(eq(connections.key, row.key));
    out.push({ key: row.key, name: def.name, ok: v.ok, detail: v.ok ? (v.warning ?? v.label ?? "accepted") : v.error });
  }
  return out;
}

export function summarize(checks: ConnectionCheck[]): string {
  if (!checks.length) return "No connections have stored credentials yet.";
  const bad = checks.filter((c) => !c.ok);
  return bad.length
    ? `${checks.length - bad.length} of ${checks.length} accepted. Failing: ${bad.map((c) => `${c.name} (${c.detail})`).join("; ")}`
    : `All ${checks.length} connections accepted by their providers.`;
}
