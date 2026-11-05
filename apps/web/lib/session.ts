/**
 * Session and OAuth-state cookies. Kept free of Node-only imports so proxy.ts can use it.
 */
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "bodh_session";
export const OAUTH_COOKIE = "bodh_oauth";
export const SESSION_DAYS = 7;

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
}

export async function createSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ email: claims.email, sv: claims.sv })
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
    return { sub: payload.sub, email: payload.email, sv: typeof payload.sv === "number" ? payload.sv : 0 };
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
export function sameOrigin(req: Request, appOrigin: string): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

/** Only allow same-site relative paths after sign-in, never another origin. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
