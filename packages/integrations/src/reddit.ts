/**
 * Reddit for the Community agent: search subreddits for questions, and post an approved answer
 * from the team's named account. Two connections:
 *   reddit_app  { client_id, client_secret }  a "web app" at reddit.com/prefs/apps with the redirect URL shown on the card
 *   reddit      { refresh_token, username, scope }  from signing in with that account (OAuth, duration=permanent)
 * Every request carries a descriptive User-Agent, as Reddit's API rules require.
 */
import { eq } from "drizzle-orm";
import { connections, db } from "@bodh/db";
import { readJsonSecret } from "./secrets";

export const REDDIT_SCOPES = ["identity", "read", "submit"];
const AUTH = "https://www.reddit.com/api/v1";
const API = "https://oauth.reddit.com";

export interface RedditApp {
  client_id: string;
  client_secret: string;
}

export interface RedditGrant {
  refresh_token: string;
  username: string;
  scope: string;
  connected_by: string;
  connected_at: string;
}

export class RedditError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const userAgent = (username?: string) => `web:bodh-growth-os:1.0 (by /u/${username || "bodhlok"})`;
const basic = (app: RedditApp) => `Basic ${Buffer.from(`${app.client_id}:${app.client_secret}`).toString("base64")}`;

export function authorizeUrl(app: RedditApp, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: app.client_id, response_type: "code", state, redirect_uri: redirectUri, duration: "permanent", scope: REDDIT_SCOPES.join(" ") });
  return `${AUTH}/authorize?${q}`;
}

async function tokenRequest(app: RedditApp, body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; scope?: string; expires_in?: number }> {
  const res = await fetch(`${AUTH}/access_token`, {
    method: "POST",
    headers: { Authorization: basic(app), "Content-Type": "application/x-www-form-urlencoded", "User-Agent": userAgent() },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => null)) as { access_token?: string; refresh_token?: string; scope?: string; expires_in?: number; error?: string } | null;
  if (!res.ok || !json?.access_token) throw new RedditError(`Reddit token request failed: ${json?.error ?? `HTTP ${res.status}`}`, res.status);
  return json as { access_token: string; refresh_token?: string; scope?: string; expires_in?: number };
}

export const exchangeRedditCode = (app: RedditApp, code: string, redirectUri: string) => tokenRequest(app, { grant_type: "authorization_code", code, redirect_uri: redirectUri });

let cached: { token: string; refresh: string; expiresAt: number } | null = null;

/** Access token for the connected account, refreshed when needed. Null when Reddit isn't connected. */
export async function redditAccess(): Promise<{ token: string; username: string } | null> {
  const [app, grant] = await Promise.all([readJsonSecret<RedditApp>("reddit_app"), readJsonSecret<RedditGrant>("reddit")]);
  if (!app || !grant?.refresh_token) return null;
  if (cached && cached.refresh === grant.refresh_token && cached.expiresAt > Date.now() + 60_000) return { token: cached.token, username: grant.username };
  try {
    const t = await tokenRequest(app, { grant_type: "refresh_token", refresh_token: grant.refresh_token });
    cached = { token: t.access_token, refresh: grant.refresh_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 };
    return { token: t.access_token, username: grant.username };
  } catch (e) {
    if (e instanceof RedditError && (e.status === 400 || e.status === 401)) {
      await db.update(connections).set({ status: "error", error: "Reddit refused the stored sign-in. Connect Reddit again.", updatedAt: new Date() }).where(eq(connections.key, "reddit"));
    }
    throw e;
  }
}

async function call<T>(access: { token: string; username: string }, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${access.token}`, "User-Agent": userAgent(access.username), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => null)) as T & { message?: string; error?: string | number };
  if (!res.ok) throw new RedditError(`Reddit ${res.status}: ${json?.message ?? json?.error ?? ""}`.trim(), res.status);
  return json;
}

export async function redditMe(access: { token: string; username: string }): Promise<string> {
  const me = await call<{ name?: string }>(access, "/api/v1/me");
  return me.name ?? access.username;
}

export interface RedditPost {
  id: string; // fullname, t3_...
  subreddit: string;
  title: string;
  text: string;
  url: string;
  createdAt: Date;
  comments: number;
  score: number;
  locked: boolean;
}

/** Recent posts matching a query in one subreddit. */
export async function searchSubreddit(access: { token: string; username: string }, subreddit: string, query: string, limit = 15): Promise<RedditPost[]> {
  if (!/^[A-Za-z0-9_]{2,21}$/.test(subreddit)) throw new RedditError(`"${subreddit}" isn't a subreddit name.`, 400);
  const q = new URLSearchParams({ q: query, restrict_sr: "1", sort: "new", t: "month", limit: String(Math.min(limit, 25)), raw_json: "1" });
  const body = await call<{ data?: { children?: { data: Record<string, unknown> }[] } }>(access, `/r/${subreddit}/search?${q}`);
  return (body.data?.children ?? []).map(({ data: d }) => ({
    id: String(d.name),
    subreddit: String(d.subreddit),
    title: String(d.title ?? ""),
    text: String(d.selftext ?? "").slice(0, 2000),
    url: `https://www.reddit.com${String(d.permalink ?? "")}`,
    createdAt: new Date(Number(d.created_utc ?? 0) * 1000),
    comments: Number(d.num_comments ?? 0),
    score: Number(d.score ?? 0),
    locked: Boolean(d.locked) || Boolean(d.archived),
  }));
}

/** Posts a top-level comment on a post (thing id t3_...). Returns the comment's URL. */
export async function postRedditComment(access: { token: string; username: string }, thingId: string, text: string): Promise<string> {
  if (!/^t[13]_[a-z0-9]+$/i.test(thingId)) throw new RedditError(`"${thingId}" isn't a Reddit post or comment id.`, 400);
  const body = await call<{ json?: { errors?: unknown[][]; data?: { things?: { data?: { permalink?: string } }[] } } }>(access, "/api/comment", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_type: "json", thing_id: thingId, text }),
  });
  const errors = body.json?.errors ?? [];
  if (errors.length) throw new RedditError(`Reddit refused the comment: ${errors.map((e) => e.join(" ")).join("; ")}`, 400);
  const permalink = body.json?.data?.things?.[0]?.data?.permalink;
  return permalink ? `https://www.reddit.com${permalink}` : `https://www.reddit.com/comments/${thingId.slice(3)}`;
}

/** Revokes the stored grant at Reddit (best effort) before the secret is deleted on disconnect. */
export async function revokeRedditGrant(): Promise<void> {
  cached = null;
  const [app, grant] = await Promise.all([readJsonSecret<RedditApp>("reddit_app"), readJsonSecret<RedditGrant>("reddit")]);
  if (!app || !grant?.refresh_token) return;
  try {
    await fetch(`${AUTH}/revoke_token`, {
      method: "POST",
      headers: { Authorization: basic(app), "Content-Type": "application/x-www-form-urlencoded", "User-Agent": userAgent(grant.username) },
      body: new URLSearchParams({ token: grant.refresh_token, token_type_hint: "refresh_token" }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // The stored grant is deleted either way.
  }
}
