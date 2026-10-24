import { NextResponse, type NextRequest } from "next/server";
import { authEnabled, SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * Optimistic check: send anyone without a valid session cookie to /signin.
 * Pages still load the user from the database, which is the real check.
 */
export async function proxy(req: NextRequest) {
  if (!authEnabled()) {
    // In production without a Google sign-in client, show the sign-in page's setup notice
    // instead of letting every page fail.
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "true") {
      if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign-in is not set up yet." }, { status: 503 });
      return NextResponse.redirect(new URL("/signin", req.url));
    }
    return NextResponse.next();
  }
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const url = new URL("/signin", req.url);
  const next = req.nextUrl.pathname + req.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except sign-in, the auth routes, health check, signed BODH events and static files.
  matcher: ["/((?!signin|api/auth|api/health|api/events|_next/static|_next/image|favicon.ico).*)"],
};
