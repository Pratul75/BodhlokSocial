import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPostPayload, channelFor, createPost, deleteGroup, listIntegrations, listPosts, normalizeApiUrl, PostizError, uploadFile, type ItemForPostiz, type MediaForPostiz } from "./postiz";

afterEach(() => vi.unstubAllGlobals());
const creds = { api_url: "https://postiz.example.com/api", api_key: "key123" };
const item: ItemForPostiz = {
  id: "8c1f-item",
  channel: "instagram",
  format: "reel",
  caption: "Your first chart in 4 seconds. #kundli",
  title: null,
  scheduledAt: new Date("2026-10-30T13:00:00Z"),
  settings: {},
};
const video: MediaForPostiz = { id: "m1", path: "https://postiz.example.com/uploads/v.mp4", type: "video" };
const image: MediaForPostiz = { id: "m2", path: "https://postiz.example.com/uploads/t.png", type: "image" };
const now = new Date("2026-10-24T10:00:00Z");

describe("payloads", () => {
  it("schedules an Instagram reel with the calendar item as the group", () => {
    expect(buildPostPayload(item, { id: "ig-1", identifier: "instagram" }, [video], now)).toEqual({
      type: "schedule",
      date: "2026-10-30T13:00:00.000Z",
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: "ig-1" },
          group: "8c1f-item",
          value: [{ content: item.caption, image: [{ id: "m1", path: video.path }] }],
          settings: { __type: "instagram", post_type: "post", collaborators: [] },
        },
      ],
    });
  });

  it("posts now when the time has passed", () => {
    const p = buildPostPayload({ ...item, scheduledAt: new Date("2026-10-24T09:30:00Z") }, { id: "ig-1", identifier: "instagram" }, [video], now);
    expect(p.type).toBe("now");
    expect(p.date).toBe(now.toISOString());
  });

  it("sends stories as stories", () => {
    const p = buildPostPayload({ ...item, settings: { post_type: "story" } }, { id: "ig-1", identifier: "instagram-standalone" }, [image], now);
    expect(p.posts[0]!.settings).toEqual({ __type: "instagram-standalone", post_type: "story", collaborators: [] });
  });

  it("uses the video as the upload and an image as the YouTube thumbnail", () => {
    const p = buildPostPayload(
      { ...item, channel: "youtube", format: "short", title: "Moon in Rohini", settings: { visibility: "unlisted" } },
      { id: "yt-1", identifier: "youtube" },
      [video, image],
      now,
    );
    expect(p.posts[0]!.value[0]!.image).toEqual([{ id: "m1", path: video.path }]);
    expect(p.posts[0]!.settings).toEqual({ __type: "youtube", title: "Moon in Rohini", type: "unlisted", selfDeclaredMadeForKids: "no", thumbnail: { id: "m2", path: image.path }, tags: [] });
  });

  it("turns LinkedIn carousels into image carousels", () => {
    const p = buildPostPayload({ ...item, channel: "linkedin", format: "carousel" }, { id: "li-1", identifier: "linkedin-page" }, [image, { ...image, id: "m3" }], now);
    expect(p.posts[0]!.settings).toEqual({ __type: "linkedin-page", post_as_images_carousel: true });
  });

  it("maps Postiz channel types to ours", () => {
    expect(["instagram-standalone", "facebook", "linkedin-page", "youtube", "x"].map(channelFor)).toEqual(["instagram", "facebook", "linkedin", "youtube", null]);
  });
});

describe("client", () => {
  it("adds /public/v1 to a host URL and keeps a full one", () => {
    expect(normalizeApiUrl("https://p.example.com/api/")).toBe("https://p.example.com/api/public/v1");
    expect(normalizeApiUrl("https://p.example.com/api/public/v1")).toBe("https://p.example.com/api/public/v1");
    expect(() => normalizeApiUrl("p.example.com")).toThrow("https://");
  });

  it("sends the key without a Bearer prefix", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => Response.json([{ id: "i1", name: "BODH", identifier: "instagram" }]));
    vi.stubGlobal("fetch", f);
    expect(await listIntegrations(creds)).toHaveLength(1);
    expect(f.mock.calls[0]![0]).toBe("https://postiz.example.com/api/public/v1/integrations");
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe("key123");
  });

  it("uploads as multipart with a file field", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => Response.json({ id: "up1", path: "https://x/u.png", status: "ready" }));
    vi.stubGlobal("fetch", f);
    expect(await uploadFile(creds, Buffer.from("png"), "u.png", "image/png")).toEqual({ id: "up1", path: "https://x/u.png" });
    const body = f.mock.calls[0]![1]!.body as FormData;
    expect((body.get("file") as File).name).toBe("u.png");
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("creates, lists and deletes by group", async () => {
    const f = vi.fn(async (u: string, i?: RequestInit) => {
      if (i?.method === "POST") return Response.json([{ postId: "p1", integration: "ig-1" }]);
      if (i?.method === "DELETE") return Response.json({ id: "8c1f-item" });
      return Response.json({ posts: [{ id: "p1", publishDate: "2026-10-30T13:00:00Z", state: "PUBLISHED", releaseURL: "https://instagram.com/p/x" }] });
    });
    vi.stubGlobal("fetch", f);
    expect(await createPost(creds, { type: "now" })).toEqual([{ postId: "p1", integration: "ig-1" }]);
    expect((await listPosts(creds, now, now))[0]!.state).toBe("PUBLISHED");
    expect(String(f.mock.calls[1]![0])).toContain("startDate=2026-10-24T10%3A00%3A00.000Z");
    await deleteGroup(creds, "8c1f-item");
    expect(f.mock.calls[2]![0]).toBe("https://postiz.example.com/api/public/v1/posts/group/8c1f-item");
  });

  it("marks rate limits and outages retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "Too many" }, { status: 429 })));
    await expect(createPost(creds, {})).rejects.toSatisfy((e: unknown) => e instanceof PostizError && e.retryable && e.message === "Postiz 429: Too many");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: ["settings.title must be longer"] }, { status: 400 })));
    await expect(createPost(creds, {})).rejects.toSatisfy((e: unknown) => e instanceof PostizError && !e.retryable);
  });
});
