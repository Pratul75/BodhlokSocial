/**
 * Checks a pasted credential against its provider before it is saved, so "Connected" on the
 * Connections page means the provider accepted it. Each check is the cheapest read the provider
 * offers; none of them changes anything at the provider.
 */
import { GRAPH_VERSION } from "./meta";
import { listIntegrations, type PostizCredentials } from "./postiz";
import { vertexAuth, type ServiceAccountKey } from "./vertex";
import { findGa4Dataset } from "./ga4";
import { ga4Client, ga4PropertyId } from "./ga4-data";

export type Validation = { ok: true; label?: string; warning?: string } | { ok: false; error: string };
export type Validator = (value: string) => Promise<Validation>;

const TIMEOUT = 20_000;
const fail = (error: string): Validation => ({ ok: false, error });

async function getJson(url: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

const graphError = (body: Record<string, unknown> | null) => ((body?.error as { message?: string } | undefined)?.message ?? "").slice(0, 300);

const parse = <T>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

export const VALIDATORS: Record<string, Validator> = {
  async google_app(value) {
    const c = parse<{ client_id?: string; client_secret?: string }>(value);
    if (!c?.client_id || !c.client_secret) return fail("Fill in the client ID and the client secret.");
    if (!c.client_id.endsWith(".apps.googleusercontent.com")) return fail("The client ID ends with .apps.googleusercontent.com. Copy it from the OAuth client in Google Cloud.");
    // A made-up code: Google answers invalid_client when the ID or secret is wrong, and only
    // invalid_grant (the code) once both are right. Nothing is created at Google.
    const r = await getJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.client_id,
        client_secret: c.client_secret,
        code: "growth-os-credential-check",
        grant_type: "authorization_code",
        redirect_uri: `${(process.env.APP_URL ?? "https://growth.rechargestudio.com").replace(/\/$/, "")}/api/connect/google/callback`,
      }),
    });
    const error = typeof r.body?.error === "string" ? r.body.error : "";
    const detail = typeof r.body?.error_description === "string" ? r.body.error_description : "";
    // The client ID starts with the Google Cloud project number.
    if (error === "invalid_grant") return { ok: true, label: `Google Cloud project ${c.client_id.split("-")[0]}` };
    if (error === "invalid_client") return fail(`Google refused the app: ${detail || "the client ID or secret is wrong"}.`);
    return fail(`Google answered ${error || `HTTP ${r.status}`}${detail ? `: ${detail}` : ""}.`);
  },

  async meta_marketing(value) {
    const c = parse<{ ad_account_id?: string; access_token?: string }>(value);
    if (!c?.ad_account_id || !c.access_token) return fail("Fill in the ad account ID and the access token.");
    const id = c.ad_account_id.startsWith("act_") ? c.ad_account_id : `act_${c.ad_account_id}`;
    const r = await getJson(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(id)}?fields=name,account_status,currency`, {
      headers: { Authorization: `Bearer ${c.access_token}` },
    });
    if (r.status !== 200) return fail(`Meta refused the token for ${id}: ${graphError(r.body) || `HTTP ${r.status}`}`);
    const status = Number(r.body?.account_status);
    return {
      ok: true,
      label: `${String(r.body?.name ?? id)} (${String(r.body?.currency ?? "")})`.replace(" ()", ""),
      warning: status && status !== 1 ? `Meta reports this ad account as not active (status ${status}).` : undefined,
    };
  },

  async meta_capi(value) {
    const c = parse<{ pixel_id?: string; access_token?: string; test_event_code?: string }>(value);
    if (!c?.pixel_id || !c.access_token) return fail("Fill in the dataset (pixel) ID and the access token.");
    const r = await getJson(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(c.pixel_id)}?fields=name`, {
      headers: { Authorization: `Bearer ${c.access_token}` },
    });
    if (r.status !== 200) return fail(`Meta refused the token for dataset ${c.pixel_id}: ${graphError(r.body) || `HTTP ${r.status}`}`);
    return {
      ok: true,
      label: String(r.body?.name ?? c.pixel_id),
      warning: c.test_event_code ? "A test event code is set: events go to Meta's Test Events view, not your real dataset. Remove it once testing is done." : undefined,
    };
  },

  async postiz(value) {
    const c = parse<PostizCredentials>(value);
    if (!c?.api_url || !c.api_key) return fail("Fill in the Postiz API URL and API key.");
    try {
      const channels = await listIntegrations(c);
      return { ok: true, label: `${channels.length} channel${channels.length === 1 ? "" : "s"} in Postiz` };
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },

  async dataforseo(value) {
    const c = parse<{ login?: string; password?: string; target?: string }>(value);
    if (!c?.login || !c.password || !c.target) return fail("Fill in the login, password and website.");
    const r = await getJson("https://api.dataforseo.com/v3/appendix/user_data", {
      headers: { Authorization: `Basic ${Buffer.from(`${c.login}:${c.password}`).toString("base64")}` },
    });
    if (r.status !== 200 || r.body?.status_code !== 20000) {
      return fail(`DataForSEO refused the login: ${String(r.body?.status_message ?? `HTTP ${r.status}`)}`);
    }
    const money = ((r.body?.tasks as { result?: { money?: { balance?: number } }[] }[] | undefined)?.[0]?.result?.[0]?.money?.balance) ?? null;
    return { ok: true, label: c.target, warning: money !== null && money < 1 ? `The DataForSEO balance is $${money.toFixed(2)}.` : undefined };
  },

  // bodhlok_cms has no check here on purpose: the CMS rotates the sign-in key on every sign-in,
  // so checking a pasted key before saving would leave the saved one dead. The live code checks
  // it right after saving (checkCmsConnection), which stores the rotated key.

  async vertex(value) {
    const key = parse<ServiceAccountKey>(value);
    if (!key?.client_email || !key.private_key) return fail("Paste the full service account JSON.");
    try {
      const auth = await vertexAuth(key);
      return { ok: true, label: `${key.client_email} (${auth.projectId})` };
    } catch (e) {
      return fail(`Google refused the service account: ${e instanceof Error ? e.message : String(e)}`);
    }
  },

  async ga4(value) {
    const key = parse<ServiceAccountKey & { project_id?: string }>(value);
    if (!key?.client_email || !key.private_key) return fail("Paste the full service account JSON.");
    // With a GA4 property configured, the Data API is the source: check this key can read it.
    let propertyId: string | null;
    try {
      propertyId = ga4PropertyId();
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    if (propertyId) {
      try {
        await ga4Client(propertyId, key).checkAccess();
        return { ok: true, label: `GA4 property ${propertyId} via ${key.client_email}` };
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    }
    const projectId = process.env.GA4_BQ_PROJECT || key.project_id || process.env.GCP_PROJECT_ID;
    if (!projectId) return fail("The service account JSON has no project_id; set GA4_BQ_PROJECT on the server.");
    try {
      const dataset = process.env.GA4_BQ_DATASET || (await findGa4Dataset(projectId, { client_email: key.client_email, private_key: key.private_key }));
      if (!dataset) return { ok: true, label: projectId, warning: `No analytics_ dataset in ${projectId} yet. Link GA4 to BigQuery, or set GA4_BQ_DATASET.` };
      return { ok: true, label: `${projectId}.${dataset}` };
    } catch (e) {
      return fail(`BigQuery refused the service account: ${e instanceof Error ? e.message : String(e)}`);
    }
  },

  async openai(value) {
    const r = await getJson("https://api.openai.com/v1/models?limit=1", { headers: { Authorization: `Bearer ${value}` } });
    if (r.status !== 200) return fail(`OpenAI refused the key: ${graphError(r.body) || `HTTP ${r.status}`}`);
    return { ok: true, label: "OpenAI key accepted" };
  },

  async perplexity(value) {
    // Perplexity has no free read endpoint; this is a one-token request (a fraction of a cent).
    const r = await getJson("https://api.perplexity.ai/v1/sonar", {
      method: "POST",
      headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.PERPLEXITY_MODEL ?? "sonar", max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
    });
    if (r.status === 401 || r.status === 403) return fail(`Perplexity refused the key (HTTP ${r.status}).`);
    if (r.status >= 400 && r.status !== 429) return fail(`Perplexity answered HTTP ${r.status}: ${graphError(r.body)}`);
    return { ok: true, label: "Perplexity key accepted" };
  },
};

/**
 * Runs the provider check for an integration. Integrations without a check (the Postiz OAuth
 * app, which is checked when someone signs in with it) pass. Network errors fail the save, so a
 * key is never marked connected without the provider having seen it.
 */
/** Whether a pasted value for `key` can be checked with its provider (or by `extra`). */
export function hasValidator(key: string, extra: Record<string, Validator> = {}): boolean {
  return Boolean(extra[key] ?? VALIDATORS[key]);
}

export async function validateCredential(key: string, value: string, extra: Record<string, Validator> = {}): Promise<Validation> {
  const check = extra[key] ?? VALIDATORS[key];
  if (!check) return { ok: true };
  try {
    return await check(value);
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "the provider didn't answer within 20 seconds" : e.message) : String(e);
    return fail(`Couldn't check the credential: ${msg}`);
  }
}
