import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { connections, db } from "@bodh/db";
import { listIntegrations } from "@bodh/integrations/postiz";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { appUrl } from "@/lib/google";
import { postizApp, postizUrls } from "@/lib/integrations/postiz-oauth";
import { secretName, secretStore } from "@/lib/secrets";
import { OAUTH_COOKIE, openOAuthState } from "@/lib/session";

/** Postiz redirects here with a one-time code; swap it for a token and store it as the Postiz key. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const jar = await cookies();
  const saved = await openOAuthState(jar.get(OAUTH_COOKIE)?.value);
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/connections?${q}`, appUrl(req)));
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  };
  const user = await getCurrentUser();
  if (user.role !== "admin") return back("error=admin_only");
  if (params.get("error")) return back("error=cancelled");
  const code = params.get("code");
  if (!saved || saved.integration !== "postiz" || !code || params.get("state") !== saved.state) return back("error=expired");
  const app = await postizApp();
  if (!app) return back("error=not_enabled&key=postiz");
  const { backend } = postizUrls(app);

  try {
    const res = await fetch(`${backend}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code, client_id: app.client_id, client_secret: app.client_secret }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; message?: string; error?: string };
    if (!res.ok || !body.access_token) throw new Error(`Postiz token exchange failed (${res.status})${body.message || body.error ? `: ${body.message ?? body.error}` : ""}`);
    const creds = { api_url: `${backend}/public/v1`, api_key: body.access_token };
    const channels = await listIntegrations(creds).catch(() => null);
    const label = channels ? `${channels.length} channel${channels.length === 1 ? "" : "s"} in Postiz` : "Signed in with Postiz";
    const ref = await (await secretStore()).put(secretName("postiz"), JSON.stringify(creds));
    await db.update(connections).set({ status: "connected", secretRef: ref, accountLabel: label, error: null, updatedAt: new Date() }).where(eq(connections.key, "postiz"));
    await audit({ actor: user.email, actorType: "user", action: "connect", target: "Postiz", result: `connected by sign-in: ${label}` });
    return back("connected=postiz");
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await db.update(connections).set({ status: "error", error: message, updatedAt: new Date() }).where(eq(connections.key, "postiz"));
    return back("error=failed&key=postiz");
  }
}
