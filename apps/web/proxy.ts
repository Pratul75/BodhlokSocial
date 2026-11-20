import { NextResponse, type NextRequest } from "next/server";
import { authEnabled, devAuthAllowed, PLATFORM_COOKIE, SESSION_COOKIE, verifyPlatformToken, verifySessionToken } from "@/lib/session";

/** `/t/<slug>/…` — a tenant's own address. The rest of the app keeps its existing paths. */
const TENANT_PREFIX = /^\/t\/([a-z0-9-]{2,40})(?:(\/.*))?$/;

/**
 * Optimistic checks before a page renders; the real checks are in the page itself.
 *
 * Three jobs:
 *  - send anyone without a valid session cookie to /signin
 *  - keep the Super Admin console (/super-admin) on its own session, never a tenant's
 *  - turn `/t/<slug>/rest` into `/rest` for the application, passing the slug in a header
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // The console used to live at /platform. Old links, bookmarks and anything already written
  // down keep working; nothing new is ever sent there.
  if (pathname === "/platform" || pathname.startsWith("/platform/")) {
    const moved = req.nextUrl.clone();
    moved.pathname = `/super-admin${pathname.slice("/platform".length)}`;
    // `?next=/platform/audit` has to move with it, or the page it was pointing at is lost: the
    // sign-in action only follows a `next` that is already inside the console.
    const next = moved.searchParams.get("next");
    if (next === "/platform" || next?.startsWith("/platform/")) {
      moved.searchParams.set("next", `/super-admin${next.slice("/platform".length)}`);
    }
    return NextResponse.redirect(moved, 308);
  }

  // The Super Admin console has its own principal and its own cookie.
  if (pathname === "/super-admin" || pathname.startsWith("/super-admin/")) {
    // The sign-in page and the one-time password link are the console's only open doors.
    if (pathname === "/super-admin/signin" || pathname === "/super-admin/reset") return NextResponse.next();
    const operator = await verifyPlatformToken(req.cookies.get(PLATFORM_COOKIE)?.value);
    if (operator) return NextResponse.next();
    const url = new URL("/super-admin/signin", req.url);
    if (pathname !== "/super-admin") url.searchParams.set("next", pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  const match = TENANT_PREFIX.exec(pathname);
  const tenantSlug = match?.[1] ?? null;
  const innerPath = match ? (match[2] && match[2] !== "" ? match[2] : "/") : pathname;

  const headers = new Headers(req.headers);
  // Server components read the address through these, since they cannot see the URL directly.
  headers.set("x-tenant-path", pathname);
  if (tenantSlug) headers.set("x-tenant-slug", tenantSlug);

  /**
   * Public endpoints: webhooks the outside world signs, the page feed, the health probe. They
   * carry no session. Under a `/t/<slug>/` prefix they still need the rewrite and the header,
   * which is why they reach this middleware at all.
   */
  const isPublic =
    /^\/api\/(events|feed|health)(\/|$)/.test(innerPath) ||
    // The two doors into a workspace that cannot require a session: signing in, and setting the
    // password you were invited to set. Under a `/t/<slug>/` prefix they still come through
    // here, and they need the header to know whose workspace they are.
    innerPath === "/signin" ||
    innerPath === "/set-password";

  const pass = () => {
    if (!match) return NextResponse.next({ request: { headers } });
    const url = req.nextUrl.clone();
    url.pathname = innerPath;
    return NextResponse.rewrite(url, { request: { headers } });
  };

  if (isPublic) return pass();

  // A valid session is a valid session, however it was obtained. This comes before any question
  // about Google: a workspace whose people sign in with a password has no Google client, and
  // checking for one first would turn every page into a redirect for them.
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) return pass();

  if (!authEnabled() && devAuthAllowed()) return pass();

  if (innerPath.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  // Keep the workspace's own address across the redirect: sending someone from `/t/acme/ads`
  // to a bare `/signin` would lose the workspace they were trying to reach.
  const url = new URL(tenantSlug ? `/t/${tenantSlug}/signin` : "/signin", req.url);
  const next = pathname + req.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except sign-in, the public pages (home, privacy policy, terms: Google's OAuth
  // verification reads them signed out), the auth routes, health check, signed BODH events and static files.
  matcher: [
    "/((?!signin|set-password|about|privacy|terms|api/auth|api/health|api/events|api/feed|_next/static|_next/image|favicon.ico).*)",
  ],
};
