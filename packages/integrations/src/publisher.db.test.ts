/**
 * The publishing flow against a real Postgres database, with Postiz mocked at fetch.
 * Creates and drops its own database; skipped when Postgres isn't reachable.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
const dbName = `bodh_pubtest_${Date.now()}`;
const admin = postgres(base, { max: 1, onnotice: () => {} });
const reachable = await admin`select 1`.then(() => true).catch(() => false);

describe.skipIf(!reachable)("publisher with a database", () => {
  let dir: string;
  let m: {
    db: typeof import("@bodh/db");
    pub: typeof import("./publisher");
    storage: typeof import("./storage");
    secrets: typeof import("./secrets");
  };
  let postizPosts: { id: string; publishDate: string; state: string; releaseURL?: string; error?: string | null }[] = [];
  const calls: { method: string; url: string; body?: unknown }[] = [];

  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const url = base.replace(/\/[^/]+$/, `/${dbName}`);
    process.env.DATABASE_URL = url;
    dir = await mkdtemp(join(tmpdir(), "bodh-pub-"));
    process.env.SECRETS_DIR = join(dir, "secrets");
    process.env.UPLOADS_DIR = join(dir, "uploads");
    delete process.env.SECRETS_BACKEND;
    delete process.env.STORAGE_BACKEND;

    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const mc = postgres(url, { max: 1, onnotice: () => {} });
    await migrate(drizzle(mc), { migrationsFolder: fileURLToPath(new URL("../../db/migrations", import.meta.url)) });
    await mc.end();

    m = {
      db: await import("@bodh/db"),
      pub: await import("./publisher"),
      storage: await import("./storage"),
      secrets: await import("./secrets"),
    };
    await (await m.secrets.secretStore()).put("integration-postiz", JSON.stringify({ api_url: "https://postiz.test/api", api_key: "k" }));

    vi.stubGlobal("fetch", async (u: string | URL, init?: RequestInit) => {
      const url = String(u);
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (url.endsWith("/upload")) return Response.json({ id: `up-${calls.length}`, path: `https://postiz.test/uploads/${calls.length}`, status: "ready" });
      if (url.endsWith("/posts") && method === "POST") return Response.json([{ postId: "pz-1", integration: "ig-1" }]);
      if (url.includes("/posts/group/") && method === "DELETE") return Response.json({ id: url.split("/").pop() });
      if (url.includes("/posts?")) return Response.json({ posts: postizPosts });
      return new Response("not mocked", { status: 500 });
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (m) await m.db.sql.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function approvedReel(opts: { approval?: boolean; caption?: string; at?: Date } = {}) {
    const { db, calendarItems, approvals, assets, publishingChannels } = m.db;
    const path = m.storage.storagePathFor("uploads", "reel.mp4");
    await m.storage.saveFile(path, Buffer.from("fake-mp4"), "video/mp4");
    const [a] = await db.insert(assets).values({ name: "reel.mp4", type: "video", source: "upload", storagePath: path, contentType: "video/mp4" }).returning();
    await db
      .insert(publishingChannels)
      .values({ channel: "instagram", postizIntegrationId: "ig-1", postizIdentifier: "instagram", name: "BODH" })
      .onConflictDoNothing();
    const [item] = await db
      .insert(calendarItems)
      .values({
        channel: "instagram",
        format: "reel",
        idea: "First chart in 4 seconds",
        caption: opts.caption ?? "Your first chart in 4 seconds. #kundli",
        assetIds: [a!.id],
        scheduledAt: opts.at ?? new Date(Date.now() + 3_600_000),
        status: "approved",
      })
      .returning();
    if (opts.approval !== false) {
      await db.insert(approvals).values({ kind: "post", channel: "instagram", agent: "content", calendarItemId: item!.id, title: "t", body: item!.caption!, reason: "r", status: "approved", decidedAt: new Date() });
    }
    return item!;
  }

  const get = async (id: string) => (await m.db.db.select().from(m.db.calendarItems).where((await import("drizzle-orm")).eq(m.db.calendarItems.id, id)))[0]!;

  it("uploads media, schedules the post, then records it as published", async () => {
    const item = await approvedReel();
    const r = await m.pub.runPublisher();
    expect(r.detail).toMatch(/Scheduled 1/);

    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/posts"))!;
    expect(create.body).toMatchObject({
      type: "schedule",
      posts: [{ integration: { id: "ig-1" }, group: item.id, value: [{ content: item.caption, image: [{ id: expect.stringMatching(/^up-/) }] }], settings: { __type: "instagram", post_type: "post" } }],
    });
    expect(await get(item.id)).toMatchObject({ status: "scheduled", postizId: "pz-1" });

    // Its time passes and Postiz reports it live.
    await m.db.db.update(m.db.calendarItems).set({ scheduledAt: new Date(Date.now() - 60_000) }).where((await import("drizzle-orm")).eq(m.db.calendarItems.id, item.id));
    postizPosts = [{ id: "pz-1", publishDate: new Date().toISOString(), state: "PUBLISHED", releaseURL: "https://instagram.com/p/abc" }];
    await m.pub.runPublisher();
    expect(await get(item.id)).toMatchObject({ status: "published", publishedUrl: "https://instagram.com/p/abc" });
  });

  it("removes a scheduled post from Postiz when it is edited back to draft", async () => {
    const item = await approvedReel();
    await m.db.db.update(m.db.calendarItems).set({ status: "drafted", postizId: "pz-old" }).where((await import("drizzle-orm")).eq(m.db.calendarItems.id, item.id));
    const before = calls.length;
    const r = await m.pub.runPublisher();
    expect(r.detail).toMatch(/removed 1 from Postiz/i);
    expect(calls.slice(before).some((c) => c.method === "DELETE" && c.url.endsWith(`/posts/group/${item.id}`))).toBe(true);
    expect((await get(item.id)).postizId).toBeNull();
  });

  it("refuses posts with no approval on record", async () => {
    const item = await approvedReel({ approval: false });
    await m.pub.runPublisher();
    expect(await get(item.id)).toMatchObject({ status: "failed", error: expect.stringContaining("No approval on record") });
  });

  it("refuses posts that break the rules, even when approved", async () => {
    const item = await approvedReel({ caption: "Guaranteed marriage within a year" });
    await m.pub.runPublisher();
    expect(await get(item.id)).toMatchObject({ status: "failed", error: expect.stringContaining("Blocked by post checks") });
  });

  it("does not post something that missed its time by hours", async () => {
    const item = await approvedReel({ at: new Date(Date.now() - 8 * 3_600_000) });
    await m.pub.runPublisher();
    expect(await get(item.id)).toMatchObject({ status: "failed", error: expect.stringContaining("Missed its time") });
  });
});
