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
  /** The OAuth app; the staff sign-in app when left out. */
  clientId?: string;
}): Promise<string> {
  const p = new URLSearchParams({
    client_id: opts.clientId ?? process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scopes.join(" "),
    state: opts.state,
    code_challenge: await pkceChallenge(opts.verifier),
    code_challenge_method: "S256",
  });
  if (opts.nonce) p.set("nonce", opts.nonce);
  if (opts.offline) {
    // Connecting an integration: the account that owns the channel, ads or profile is often not the one
    // the person signed into Growth OS with, so Google always asks which account, then asks for consent
    // (consent always returns a refresh token). No login hint, which would skip the chooser.
    p.set("access_type", "offline");
    p.set("prompt", "select_account consent");
    p.set("include_granted_scopes", "true");
  } else {
    p.set("prompt", "select_account");
  }
  // No `hd` hint: people added from outside the company domains must be able to pick their own account.
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

/** Trades an authorization code for tokens, with the app that started the grant (the staff sign-in app by default). */
export async function exchangeCode(
  code: string,
  redirectUri: string,
  verifier: string,
  client: { client_id: string; client_secret: string } = { client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET! },
): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  return (await res.json()) as GoogleTokens;
}

// Access-token refresh for connected integrations lives in @bodh/integrations/google-oauth.

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
  // A company address (ALLOWED_EMAIL_DOMAINS) must come from that Workspace, which carries `hd`, so a
  // personal Google account registered with a company address can't pass for it.
  if (domains.includes(emailDomain) && hd !== emailDomain) return { ok: false, reason: "domain" };
  // Any other address (Gmail, a partner's company) is let through here only as Google verified it;
  // the sign-in callback still lets in only an address an admin added in Admin.
  if (hd !== undefined && hd !== emailDomain) return { ok: false, reason: "domain" };
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
