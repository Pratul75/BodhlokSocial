/**
 * Session and OAuth-state cookies. Kept free of Node-only imports so proxy.ts can use it.
 */
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "bodh_session";
export const OAUTH_COOKIE = "bodh_oauth";
export const SESSION_DAYS = 7;
/** Platform operators sign in separately: their own cookie and their own token audience. */
export const PLATFORM_COOKIE = "bodh_platform";
export const PLATFORM_AUDIENCE = "bodh-platform";

/** Google sign-in is on when an OAuth client is configured. */
export function authEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Dev sign-in (no Google client, everyone is DEV_USER_EMAIL) is only ever allowed outside
 * production. There is deliberately no environment flag that re-enables it in production.
 */
export function devAuthAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

function secretKey(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set to at least 32 characters.");
  return new TextEncoder().encode(s);
}

export interface SessionClaims {
  sub: string; // user id
  email: string;
  /** users.session_version when the session was issued; a higher number in the database revokes it. */
  sv: number;
  /**
   * The tenant this session belongs to. Absent in cookies issued before multi-tenancy, which
   * keep working: a missing claim falls back to the default tenant while that is configured.
   */
  tid?: string;
}

export async function createSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email, sv: claims.sv, ...(claims.tid ? { tid: claims.tid } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .setAudience("bodh-session")
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { audience: "bodh-session", algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    return {
      sub: payload.sub,
      email: payload.email,
      sv: typeof payload.sv === "number" ? payload.sv : 0,
      tid: typeof payload.tid === "string" ? payload.tid : undefined,
    };
  } catch {
    return null;
  }
}

/** A platform operator's session. A different audience, so one token can never pass as the other. */
export interface PlatformClaims {
  sub: string; // platform_operators.id
  email: string;
  sv: number;
  role: string;
}

export async function createPlatformToken(claims: PlatformClaims): Promise<string> {
  return new SignJWT({ email: claims.email, sv: claims.sv, role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("1d")
    .setAudience(PLATFORM_AUDIENCE)
    .sign(secretKey());
}

export async function verifyPlatformToken(token: string | undefined): Promise<PlatformClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { audience: PLATFORM_AUDIENCE, algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    return {
      sub: payload.sub,
      email: payload.email,
      sv: typeof payload.sv === "number" ? payload.sv : 0,
      role: typeof payload.role === "string" ? payload.role : "support",
    };
  } catch {
    return null;
  }
}

/** Short-lived state for one OAuth round trip: CSRF state, PKCE verifier, nonce, where to go after. */
export interface OAuthState {
  state: string;
  verifier: string;
  nonce: string;
  purpose: "signin" | "connect";
  integration?: string;
  /** For connect: the Google app the grant was started with, so the code is exchanged with the same one. */
  clientId?: string;
  returnTo: string;
}

export async function sealOAuthState(s: OAuthState): Promise<string> {
  return new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .setAudience("bodh-oauth")
    .sign(secretKey());
}

export async function openOAuthState(token: string | undefined): Promise<OAuthState | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { audience: "bodh-oauth", algorithms: ["HS256"] });
    return payload as unknown as OAuthState;
  } catch {
    return null;
  }
}

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/**
 * For state-changing requests that don't carry a form token (sign-out): the browser's Origin
 * header must be this app. A missing Origin (old clients, some privacy tools) is allowed through,
 * since the session cookie is SameSite=Lax and isn't sent on cross-site POSTs anyway.
 */
/**
 * The address the browser actually asked for, from the request's own headers.
 *
 * `req.url` cannot be used for this: Next rewrites it to localhost before a route handler sees
 * it, so it says nothing about where the request came in. That matters more than it sounds —
 * the app already answers on localhost and 127.0.0.1 in development, and will answer on a
 * workspace's own hostname once workspaces have one.
 */
export function requestOrigin(req: Request): string | null {
  const first = (v: string | null) => v?.split(",")[0]?.trim();
  const host = first(req.headers.get("x-forwarded-host")) ?? first(req.headers.get("host"));
  if (!host) return null;
  let proto = first(req.headers.get("x-forwarded-proto"));
  if (!proto) {
    try {
      proto = new URL(req.url).protocol.replace(":", "");
    } catch {
      proto = "https";
    }
  }
  return `${proto}://${host}`;
}

export function sameOrigin(req: Request, ...also: string[]): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;

  // The host the browser actually reached is the one that matters. One configured address
  // cannot be the answer here: the app already answers on localhost and 127.0.0.1 in
  // development, and will answer on a workspace's own hostname once workspaces have one.
  // APP_URL stays what it is — OAuth redirect URIs have to match what is registered — so it is
  // accepted as well rather than instead.
  const allowed = new Set<string>();
  const add = (u: string | undefined | null) => {
    if (!u) return;
    try {
      allowed.add(new URL(u).origin);
    } catch {
      /* not a URL; nothing to allow */
    }
  };

  add(requestOrigin(req));
  for (const a of also) add(a);

  try {
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

/** Only allow same-site relative paths after sign-in, never another origin. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

export const IMPERSONATION_COOKIE = "bodh_impersonation";
export const CHOICE_AUDIENCE = "bodh-workspace-choice";

/** Which door a half-finished sign-in came through. Each one proves itself differently. */
export type SignInDoor = "password" | "google";

/** What a half-finished sign-in remembers while somebody picks which workspace they meant. */
export interface ChoiceClaims {
  /** Every workspace this sign-in opened, as `tenantId:userId`. */
  opened: string[];
  email: string;
  /**
   * How they got this far. A password opened these workspaces; a Google identity was verified
   * for them. It matters afterwards: a temporary password has to be replaced before anyone is
   * let in, and somebody who came through Google never typed one.
   */
  door: SignInDoor;
}

/**
 * A few minutes' proof that a password was checked and really did open these workspaces.
 *
 * It exists so the choice does not mean typing the password again, and so the page never has to
 * hold it. It names only workspaces the password already opened, it is signed, and it dies in
 * five minutes — a copied one buys nothing a correct password did not already buy.
 */
export async function createChoiceToken(claims: ChoiceClaims): Promise<string> {
  return new SignJWT({ opened: claims.opened, email: claims.email, door: claims.door })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .setAudience(CHOICE_AUDIENCE)
    .sign(secretKey());
}

export async function verifyChoiceToken(token: string | undefined): Promise<ChoiceClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { audience: CHOICE_AUDIENCE, algorithms: ["HS256"] });
    const opened = payload.opened;
    if (!Array.isArray(opened) || opened.some((o) => typeof o !== "string")) return null;
    if (typeof payload.email !== "string") return null;
    // An unrecognised door is refused rather than read as the gentler one: a token that does not
    // say how it was earned is a token this build did not mint.
    if (payload.door !== "password" && payload.door !== "google") return null;
    return { opened: opened as string[], email: payload.email, door: payload.door };
  } catch {
    return null;
  }
}

export const IMPERSONATION_AUDIENCE = "bodh-impersonation";

/**
 * An operator looking inside one workspace, for a while.
 *
 * It is its own principal, with its own cookie and audience: never a tenant session and never a
 * platform session. The row id lets the control plane end it early, and the token's own
 * expiry makes it stop on its own even if nothing else does.
 */
export interface ImpersonationClaims {
  /** platform.impersonations.id */
  sub: string;
  operatorEmail: string;
  tenantId: string;
  /** The tenant user being looked at, in that workspace's own users table. */
  userId: string;
  userEmail: string;
}

export async function createImpersonationToken(claims: ImpersonationClaims, seconds: number): Promise<string> {
  return new SignJWT({
    operatorEmail: claims.operatorEmail,
    tenantId: claims.tenantId,
    userId: claims.userId,
    userEmail: claims.userEmail,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${Math.max(60, Math.min(seconds, 4 * 3600))}s`)
    .setAudience(IMPERSONATION_AUDIENCE)
    .sign(secretKey());
}

export async function verifyImpersonationToken(token: string | undefined): Promise<ImpersonationClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { audience: IMPERSONATION_AUDIENCE, algorithms: ["HS256"] });
    if (
      typeof payload.sub !== "string" ||
      typeof payload.operatorEmail !== "string" ||
      typeof payload.tenantId !== "string" ||
      typeof payload.userId !== "string" ||
      typeof payload.userEmail !== "string"
    ) {
      return null;
    }
    return {
      sub: payload.sub,
      operatorEmail: payload.operatorEmail,
      tenantId: payload.tenantId,
      userId: payload.userId,
      userEmail: payload.userEmail,
    };
  } catch {
    return null;
  }
}
