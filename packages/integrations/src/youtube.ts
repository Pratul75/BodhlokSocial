/**
 * YouTube comments for the Community agent: read recent comment threads on BODH's channel and
 * post approved replies from the channel. Uses the youtube Google OAuth connection (scope
 * youtube.force-ssl). Uploads are not done here; videos go out through Postiz.
 * Quota: listing threads costs 1 unit a page, a reply costs 50 units, of the default 10,000 a day.
 */
import { googleAccessToken } from "./google-oauth";

const API = "https://www.googleapis.com/youtube/v3";

export class YouTubeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => null)) as T & { error?: { message?: string } };
  if (!res.ok) throw new YouTubeError(`YouTube ${res.status}: ${json?.error?.message ?? ""}`.trim(), res.status);
  return json;
}

export async function youtubeToken(): Promise<string | null> {
  return googleAccessToken("youtube");
}

export async function myChannel(token: string): Promise<{ id: string; title: string } | null> {
  const r = await call<{ items?: { id: string; snippet?: { title?: string } }[] }>(token, "/channels?part=snippet&mine=true");
  const c = r.items?.[0];
  return c ? { id: c.id, title: c.snippet?.title ?? c.id } : null;
}

export interface YouTubeQuestion {
  threadId: string; // the top-level comment id, which a reply's parentId names
  videoId: string;
  videoTitle: string | null;
  author: string;
  text: string;
  url: string;
  publishedAt: Date;
  replies: number;
  answeredByChannel: boolean;
}

/** Recent top-level comments on the channel's videos, newest first, with whether the channel already replied. */
export async function recentComments(token: string, channelId: string, max = 50): Promise<YouTubeQuestion[]> {
  const q = new URLSearchParams({ part: "snippet,replies", allThreadsRelatedToChannelId: channelId, order: "time", maxResults: String(Math.min(max, 100)), textFormat: "plainText" });
  const r = await call<{
    items?: {
      id: string;
      snippet: {
        videoId: string;
        totalReplyCount?: number;
        topLevelComment: { snippet: { authorDisplayName?: string; textDisplay?: string; publishedAt?: string; authorChannelId?: { value?: string } } };
      };
      replies?: { comments?: { snippet?: { authorChannelId?: { value?: string } } }[] };
    }[];
  }>(token, `/commentThreads?${q}`);
  return (r.items ?? []).map((t) => {
    const top = t.snippet.topLevelComment.snippet;
    return {
      threadId: t.id,
      videoId: t.snippet.videoId,
      videoTitle: null,
      author: top.authorDisplayName ?? "Someone",
      text: (top.textDisplay ?? "").slice(0, 2000),
      url: `https://www.youtube.com/watch?v=${t.snippet.videoId}&lc=${t.id}`,
      publishedAt: new Date(top.publishedAt ?? 0),
      replies: t.snippet.totalReplyCount ?? 0,
      answeredByChannel: (t.replies?.comments ?? []).some((c) => c.snippet?.authorChannelId?.value === channelId),
    };
  });
}

/** Replies to a top-level comment as the channel. Returns a link to the reply. */
export async function replyToComment(token: string, parentId: string, text: string): Promise<string> {
  const r = await call<{ id?: string; snippet?: { videoId?: string } }>(token, "/comments?part=snippet", {
    method: "POST",
    body: JSON.stringify({ snippet: { parentId, textOriginal: text } }),
  });
  if (!r.id) throw new YouTubeError("YouTube accepted the reply but returned no id.", 500);
  return `https://www.youtube.com/watch?v=${r.snippet?.videoId ?? ""}&lc=${r.id}`;
}
