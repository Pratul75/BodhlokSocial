import "server-only";
import { createRemoteJWKSet, jwtVerify, base64url } from "jose";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export function randomToken(bytes = 32): string {
  return base64url.encode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url.encode(new Uint8Array(digest));
}

/** Public URL of the app, used to build OAuth redirect URIs. */
export function appUrl(req: Request): string {
  return (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
}

export function allowedDomains(): string[] {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS ?? process.env.ALLOWED_EMAIL_DOMAIN ?? "rechargestudio.com";
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export async function buildAuthUrl(opts: {
  redirectUri: string;
  scopes: string[];
  state: string;
  verifier: string;
  nonce?: string;
  offline?: boolean;
  loginHint?: string;
}): Promise<string> {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scopes.join(" "),
    state: opts.state,
    code_challenge: await pkceChallenge(opts.verifier),
    code_challenge_method: "S256",
  });
  if (opts.nonce) p.set("nonce", opts.nonce);
  if (opts.offline) {
    p.set("access_type", "offline");
    p.set("prompt", "consent"); // always return a refresh token
    p.set("include_granted_scopes", "true");
  } else {
    p.set("prompt", "select_account");
  }
  const domains = allowedDomains();
  if (!opts.offline && domains.length === 1) p.set("hd", domains[0]!); // hint only; enforced on the ID token
  if (opts.loginHint) p.set("login_hint", opts.loginHint);
  return `${AUTH_URL}?${p.toString()}`;
}

export interface GoogleTokens {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
  token_type: string;
}

export async function exchangeCode(code: string, redirectUri: string, verifier: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  return (await res.json()) as GoogleTokens;
}

export async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed (${res.status})`);
  return (await res.json()) as { access_token: string; expires_in: number };
}

export interface GoogleIdentity {
  email: string;
  name: string;
  hd?: string;
}

export type IdentityCheck = { ok: true; identity: GoogleIdentity } | { ok: false; reason: "unverified" | "domain" };

/** Pure check on verified ID token claims, kept separate so it can be unit tested. */
export function checkIdentityClaims(claims: Record<string, unknown>, domains: string[]): IdentityCheck {
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
  if (!email || claims.email_verified !== true) return { ok: false, reason: "unverified" };
  const emailDomain = email.split("@")[1] ?? "";
  const hd = typeof claims.hd === "string" ? claims.hd.toLowerCase() : undefined;
  // Workspace accounts carry `hd`; require it to match so personal Gmail accounts can't pass.
  if (!domains.includes(emailDomain) || hd !== emailDomain) return { ok: false, reason: "domain" };
  return { ok: true, identity: { email, name: typeof claims.name === "string" ? claims.name : email, hd } };
}

export async function verifyIdToken(idToken: string, nonce: string): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: process.env.GOOGLE_CLIENT_ID!,
  });
  if (payload.nonce !== nonce) throw new Error("ID token nonce mismatch");
  return payload as Record<string, unknown>;
}
