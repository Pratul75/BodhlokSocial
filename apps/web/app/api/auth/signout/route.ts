import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, users } from "@bodh/db";
import { appUrl } from "@/lib/google";
import { sameOrigin, SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { audit } from "@/lib/audit";

/**
 * Signs the person out everywhere: the cookie is deleted here, and their session version goes up,
 * so a copied or stolen session cookie stops working too.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req, appUrl(req))) return NextResponse.json({ error: "Sign out from the app itself." }, { status: 403 });
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  const claims = await verifySessionToken(cookie ? decodeURIComponent(cookie) : undefined);
  if (claims) {
    await db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, claims.sub));
    await audit({ actor: claims.email, actorType: "user", action: "sign_out", target: "app", result: "signed out everywhere" });
  }
  const res = NextResponse.redirect(new URL("/signin?signed_out=1", appUrl(req)), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
