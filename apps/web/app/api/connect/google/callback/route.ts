import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { connections, db } from "@bodh/db";
import { getIntegration } from "@bodh/shared";
import { googleConnectClient, staffGoogleClient } from "@bodh/integrations/google-oauth";
import { audit } from "@/lib/audit";
import { enterTenantScope, getCurrentUser, allowed } from "@/lib/auth";
import { integrationAllowed } from "@bodh/shared";
import { appUrl, exchangeCode } from "@/lib/google";
import { describeAccount, type StoredGoogleGrant } from "@/lib/integrations/google-connection";
import { secretName, secretStore } from "@/lib/secrets";
import { OAUTH_COOKIE, openOAuthState } from "@/lib/session";

/** Google redirects here after an admin grants access for an integration. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const jar = await cookies();
  const saved = await openOAuthState(jar.get(OAUTH_COOKIE)?.value);
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/connections?${q}`, appUrl(req)));
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  };

  const user = enterTenantScope(await getCurrentUser());
  if (!allowed(user, "connections") || user.role !== "admin") return back("error=admin_only");
  if (params.get("error")) return back("error=cancelled");
  const code = params.get("code");
  if (!saved || saved.purpose !== "connect" || !saved.integration || !code || params.get("state") !== saved.state) {
    return back("error=expired");
  }
  const key = saved.integration;
  // Checked again on the way back in: the grant may have been started before the account was
  // taken away from this workspace, and a token must not land for one it no longer has.
  if (!integrationAllowed(user.ent, key)) return back(`error=not_enabled&key=${key}`);
  const def = getIntegration(key);
  if (!def?.googleOAuth?.enabled) return back("error=not_enabled");

  // The same app that started the grant; it can have been saved or removed in between.
  const client = [await googleConnectClient(), staffGoogleClient()].find((c) => c && c.client_id === (saved.clientId ?? staffGoogleClient()?.client_id));
  if (!client) return back("error=expired");

  try {
    const tokens = await exchangeCode(code, `${appUrl(req)}/api/connect/google/callback`, saved.verifier, client);
    if (!tokens.refresh_token) return back(`error=no_refresh_token&key=${key}`);
    const missing = def.googleOAuth.scopes.filter((s) => !tokens.scope.split(" ").includes(s));
    if (missing.length) return back(`error=scopes&key=${key}`);

    const label = await describeAccount(key, tokens.access_token);
    const grant: StoredGoogleGrant = {
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      connected_by: user.email,
      connected_at: new Date().toISOString(),
      client_id: client.client_id,
    };
    const ref = await (await secretStore()).put(secretName(key), JSON.stringify(grant));
    await db
      .update(connections)
      .set({ status: "connected", secretRef: ref, accountLabel: label, error: null, updatedAt: new Date() })
      .where(eq(connections.key, key));
    await audit({ actor: user.email, actorType: "user", action: "connect", target: def.name, result: `connected: ${label}` });
    return back(`connected=${key}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await db.update(connections).set({ status: "error", error: message, updatedAt: new Date() }).where(eq(connections.key, key));
    return back(`error=failed&key=${key}`);
  }
}
