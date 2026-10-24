/**
 * Postiz public API (self-hosted): https://docs.postiz.com/public-api
 * Credentials (postiz connection): { api_url: "https://<host>/api/public/v1", api_key }.
 * The key goes in the Authorization header as is, with no "Bearer" prefix.
 * Creating posts is rate limited per instance (API_LIMIT, 30 an hour by default).
 */
export interface PostizCredentials {
  api_url: string;
  api_key: string;
}

export interface PostizIntegration {
  id: string;
  name: string;
  identifier: string; // instagram | instagram-standalone | facebook | linkedin | linkedin-page | youtube | ...
  picture?: string | null;
  disabled?: boolean;
  profile?: string | null;
}

export interface PostizMedia {
  id: string;
  path: string;
}

export interface PostizPost {
  id: string;
  publishDate: string;
  releaseURL?: string | null;
  state: "QUEUE" | "PUBLISHED" | "ERROR" | "DRAFT" | string;
  error?: string | null;
  integration?: { id: string };
}

export class PostizError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
  get retryable() {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}

export function normalizeApiUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(u)) throw new Error("The Postiz API URL must start with https://");
  return u.endsWith("/public/v1") ? u : `${u}/public/v1`;
}

async function call<T>(creds: PostizCredentials, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${normalizeApiUrl(creds.api_url)}${path}`, {
      ...init,
      headers: { Authorization: creds.api_key, ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
  } catch (e) {
    throw new PostizError(`Couldn't reach Postiz: ${e instanceof Error ? e.message : e}`, 0);
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string | string[]; error?: string; msg?: string };
      detail = Array.isArray(body.message) ? body.message.join("; ") : (body.message ?? body.msg ?? body.error ?? "");
    } catch {}
    // Postiz Cloud only opens the public API to accounts with an active plan or trial.
    if (/no subscription/i.test(detail)) detail = `${detail}. The Postiz account needs an active plan or trial for the API to work (Postiz: Settings > Billing).`;
    throw new PostizError(`Postiz ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
  }
  return (await res.json()) as T;
}

export const listIntegrations = (c: PostizCredentials) => call<PostizIntegration[]>(c, "/integrations");

export async function uploadFile(c: PostizCredentials, bytes: Buffer, filename: string, contentType: string): Promise<PostizMedia> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
  const r = await call<{ id: string; path: string }>(c, "/upload", { method: "POST", body: form });
  return { id: r.id, path: r.path };
}

export const createPost = (c: PostizCredentials, payload: unknown) =>
  call<{ postId: string; integration: string }[]>(c, "/posts", { method: "POST", body: JSON.stringify(payload) });

export const deleteGroup = (c: PostizCredentials, group: string) =>
  call<{ id: string }>(c, `/posts/group/${encodeURIComponent(group)}`, { method: "DELETE" });

export async function listPosts(c: PostizCredentials, start: Date, end: Date): Promise<PostizPost[]> {
  const q = new URLSearchParams({ startDate: start.toISOString(), endDate: end.toISOString() });
  const r = await call<{ posts?: PostizPost[] } | PostizPost[]>(c, `/posts?${q}`);
  return Array.isArray(r) ? r : (r.posts ?? []);
}

/* ---------- payloads ---------- */

export interface ItemForPostiz {
  id: string;
  channel: string;
  format: string;
  caption: string | null;
  title: string | null;
  scheduledAt: Date;
  settings: Record<string, unknown>;
}

export interface MediaForPostiz extends PostizMedia {
  type: "image" | "video";
}

/** Postiz's provider settings for one channel. Field names follow docs.postiz.com/public-api/providers. */
export function providerSettings(identifier: string, item: ItemForPostiz, media: MediaForPostiz[]): Record<string, unknown> {
  const s = item.settings;
  switch (identifier) {
    case "instagram":
    case "instagram-standalone":
      return { __type: identifier, post_type: s.post_type === "story" ? "story" : "post", collaborators: [] };
    case "facebook":
      return { __type: "facebook", post_type: s.post_type === "story" ? "story" : "post" };
    case "linkedin":
    case "linkedin-page":
      return { __type: identifier, post_as_images_carousel: item.format === "carousel" && media.filter((m) => m.type === "image").length > 1 };
    case "youtube": {
      const thumb = media.find((m) => m.type === "image");
      return {
        __type: "youtube",
        title: (item.title ?? "").trim(),
        type: ["public", "unlisted", "private"].includes(String(s.visibility)) ? s.visibility : "public",
        selfDeclaredMadeForKids: s.made_for_kids === "yes" ? "yes" : "no",
        thumbnail: thumb ? { id: thumb.id, path: thumb.path } : null,
        tags: [],
      };
    }
    default:
      return { __type: identifier };
  }
}

/**
 * The create-post body for one calendar item. The group is the calendar item's ID, so the
 * post can always be found and replaced. Times in the past within the grace window post now.
 */
export function buildPostPayload(item: ItemForPostiz, integration: { id: string; identifier: string }, media: MediaForPostiz[], now = new Date()) {
  const postNow = item.scheduledAt.getTime() <= now.getTime() + 60_000;
  const attached = integration.identifier === "youtube" ? media.filter((m) => m.type === "video").slice(0, 1) : media;
  return {
    type: postNow ? "now" : "schedule",
    date: (postNow ? now : item.scheduledAt).toISOString(),
    shortLink: false,
    tags: [],
    posts: [
      {
        integration: { id: integration.id },
        group: item.id,
        value: [{ content: item.caption ?? "", image: attached.map((m) => ({ id: m.id, path: m.path })) }],
        settings: providerSettings(integration.identifier, item, media),
      },
    ],
  };
}

/** Which of our channels a Postiz integration can publish. */
export function channelFor(identifier: string): string | null {
  if (identifier.startsWith("instagram")) return "instagram";
  if (identifier === "facebook") return "facebook";
  if (identifier.startsWith("linkedin")) return "linkedin";
  if (identifier === "youtube") return "youtube";
  return null;
}
