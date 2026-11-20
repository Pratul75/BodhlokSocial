import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, enterTenant, resolveTenant, tenantById, users } from "@bodh/db";
import { appUrl } from "@/lib/google";
import { requestOrigin, sameOrigin, SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { audit } from "@/lib/audit";

/**
 * Signs the person out everywhere: the cookie is deleted here, and their session version goes up,
 * so a copied or stolen session cookie stops working too.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req, appUrl(req))) return NextResponse.json({ error: "Sign out from the app itself." }, { status: 403 });
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  const claims = await verifySessionToken(cookie ? decodeURIComponent(cookie) : undefined);
  // Signing out touches the person's OWN tenant, named by their session, not whichever tenant
  // the address happens to be: the cookie is the only thing we can trust at this point.
  // A cookie issued before tenants existed carries no tid; those sessions are tenant #1's.
  const tenant = claims ? ((claims.tid ? await tenantById(claims.tid) : null) ?? (await resolveTenant(null))) : null;
  if (claims && tenant) {
    enterTenant(tenant);
    await db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, claims.sub));
    await audit({ actor: claims.email, actorType: "user", action: "sign_out", target: "app", result: "signed out everywhere" });
  }
  // Back to the sign-in page of the host they were on, not whatever APP_URL happens to name:
  // signing out of a workspace's own address should not move them to another one.
  const res = NextResponse.redirect(new URL("/signin?signed_out=1", requestOrigin(req) ?? appUrl(req)), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
