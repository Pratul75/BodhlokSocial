/**
 * The ads guardrail pipeline against a real Postgres database, with the Meta Graph API mocked
 * at fetch. This is Phase 6's "done when": a losing ad is paused automatically, and a budget
 * increase waits in Approvals with its reason. Skipped when Postgres isn't reachable.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
const dbName = `bodh_adstest_${Date.now()}`;
const admin = postgres(base, { max: 1, onnotice: () => {} });
const reachable = await admin`select 1`.then(() => true).catch(() => false);

describe.skipIf(!reachable)("ad changes through the guardrails", () => {
  let dir: string;
  let m: { db: typeof import("@bodh/db"); ads: typeof import("./ads"); secrets: typeof import("./secrets"); drizzle: typeof import("drizzle-orm") };
  const posts: { path: string; body: Record<string, string> }[] = [];
  const agent = { name: "ads agent", kind: "agent" as const };

  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const url = base.replace(/\/[^/]+$/, `/${dbName}`);
    process.env.DATABASE_URL = url;
    dir = await mkdtemp(join(tmpdir(), "bodh-ads-"));
    process.env.SECRETS_DIR = join(dir, "secrets");
    delete process.env.SECRETS_BACKEND;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const mc = postgres(url, { max: 1, onnotice: () => {} });
    await migrate(drizzle(mc), { migrationsFolder: fileURLToPath(new URL("../../db/migrations", import.meta.url)) });
    await mc.end();
    m = { db: await import("@bodh/db"), ads: await import("./ads"), secrets: await import("./secrets"), drizzle: await import("drizzle-orm") };
    await (await m.secrets.secretStore()).put("integration-meta_marketing", JSON.stringify({ ad_account_id: "act_1", access_token: "t" }));
    await m.db.db.insert(m.db.budgets).values({ platform: "meta_ads", dailyCap: 10000, monthlyCap: 200000 }).onConflictDoUpdate({ target: m.db.budgets.platform, set: { dailyCap: 10000, monthlyCap: 200000 } });

    const graph: Record<string, unknown[]> = {
      "act_1/campaigns": [{ id: "c1", name: "Kundli installs", status: "ACTIVE", objective: "OUTCOME_APP_PROMOTION" }],
      "act_1/adsets": [{ id: "s1", name: "India 25-44", campaign_id: "c1", status: "ACTIVE", daily_budget: "300000" }],
      "act_1/ads": [
        { id: "a1", name: "Moon sign hook", adset_id: "s1", campaign_id: "c1", status: "ACTIVE", creative: { id: "cr1", title: "Your Moon sign", body: "Free kundli" } },
        { id: "a2", name: "Generic hook", adset_id: "s1", campaign_id: "c1", status: "ACTIVE", creative: { id: "cr2", title: "Astrology app", body: "Try it" } },
      ],
    };
    vi.stubGlobal("fetch", async (u: string | URL, init?: RequestInit) => {
      const url = new URL(String(u));
      const path = url.pathname.replace(/^\/v[\d.]+\//, "");
      if ((init?.method ?? "GET") === "POST") {
        const body = Object.fromEntries(new URLSearchParams(String(init?.body)));
        posts.push({ path, body });
        if (path === "act_1/adcreatives") return Response.json({ id: "cr9" });
        if (path === "act_1/ads") return Response.json({ id: "a9" });
        return Response.json({ success: true });
      }
      if (path === "cr1") return Response.json({ object_story_spec: { page_id: "p1", link_data: { link: "https://bodh.app", message: "Free kundli", name: "Your Moon sign", image_hash: "h" } } });
      if (graph[path]) return Response.json({ data: graph[path] });
      return new Response("not mocked", { status: 500 });
    });

    // Last 7 days: a1 spent ₹3,000 for 10 activations (₹300 each); a2 spent ₹4,000 for 2 (₹2,000 each).
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    for (const [ad, spend] of [["a1", 3000], ["a2", 4000]] as const) {
      await m.db.db.insert(m.db.adSpendDaily).values({ day: today, platform: "meta_ads", campaignId: "c1", campaignName: "Kundli installs", adId: ad, adName: ad, spend: String(spend), impressions: 1000, clicks: 100 });
    }
    const events = [...Array(10).fill("a1"), ...Array(2).fill("a2")].map((ad, i) => ({ eventId: `e${i}`, type: "activation", occurredAt: new Date(), userRef: `u${i}`, platform: "android", channel: "meta_ads", utmContent: ad }));
    await m.db.db.insert(m.db.conversionEvents).values(events);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (m) await m.db.sql.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("syncs the account and counts committed budgets against the cap", async () => {
    expect(await m.ads.syncAdStructure()).toBe("Meta: 2 ads");
    const s = await m.ads.spendNow("meta_ads");
    expect(s).toMatchObject({ dailyCap: 10000, spentToday: 7000, committedDaily: 3000 });
  });

  it("pauses the losing ad on its own, and sends a pause of the winner to Approvals", async () => {
    const r = await m.ads.requestChange({ type: "pause_ad", platform: "meta_ads", adId: "a2" }, "a2 costs ₹2,000 per activation against ₹300 for a1 in the same ad set.", agent);
    expect(r.outcome).toBe("applied");
    expect(posts.at(-1)).toEqual({ path: "a2", body: { status: "PAUSED" } });
    const [a2] = await m.db.db.select().from(m.db.adEntities).where(m.drizzle.eq(m.db.adEntities.platformId, "a2"));
    expect(a2!.status).toBe("paused");

    const before = posts.length;
    const w = await m.ads.requestChange({ type: "pause_ad", platform: "meta_ads", adId: "a1" }, "Trying to pause the best ad to test the guardrail.", agent);
    expect(w.outcome).toBe("sent_to_approval");
    expect(w.message).toContain("last active ad");
    expect(posts.length).toBe(before);
  });

  it("puts a budget increase in Approvals with its reason, blocks one over the cap, and applies it when approved", async () => {
    const reason = "a1 earns activations at ₹300, well under target; more budget should scale it.";
    const r = await m.ads.requestChange({ type: "budget_change", platform: "meta_ads", entityId: "s1", newDaily: 4500 }, reason, agent);
    expect(r.outcome).toBe("sent_to_approval");
    const [appr] = await m.db.db.select().from(m.db.approvals).where(m.drizzle.eq(m.db.approvals.kind, "ad_change")).orderBy(m.drizzle.desc(m.db.approvals.createdAt)).limit(1);
    expect(appr).toMatchObject({ status: "pending", title: 'Daily budget on "India 25-44": ₹3,000 → ₹4,500', body: reason, reason: "Guardrail: Budget increases always need approval." });

    const big = await m.ads.requestChange({ type: "budget_change", platform: "meta_ads", entityId: "s1", newDaily: 12000 }, "Scale hard on the winning ad set right away.", agent);
    expect(big).toMatchObject({ outcome: "blocked" });

    expect(await m.ads.applyChange(r.changeId)).toEqual({ ok: true });
    expect(posts.at(-1)).toEqual({ path: "s1", body: { daily_budget: "450000" } });
    const [log] = await m.db.db.select().from(m.db.adChanges).where(m.drizzle.eq(m.db.adChanges.id, r.changeId));
    expect(log).toMatchObject({ outcome: "applied", type: "budget_change", before: { dailyBudget: 3000 }, after: { dailyBudget: 4500 } });
  });

  it("checks test copy, then launches an approved test as a new ad in the ad set", async () => {
    const bad = await m.ads.requestChange(
      { type: "ab_test", platform: "meta_ads", baseAdId: "a1", hypothesis: "A promise-led hook will lift activations", variants: [{ name: "Promise", headline: "Guaranteed love", text: "100% accurate predictions" }] },
      "Testing a bolder hook against the Moon sign one.",
      agent,
    );
    expect(bad.outcome).toBe("blocked");
    expect(bad.message).toContain("Copy problems");

    const ok = await m.ads.requestChange(
      { type: "ab_test", platform: "meta_ads", baseAdId: "a1", hypothesis: "Naming the nakshatra lifts activations over the Moon sign hook", variants: [{ name: "Nakshatra hook", headline: "Every nakshatra, one desk", text: "Nakshatra, pada and lord for all nine grahas on one screen. Start free at bodhlok.com." }] },
      "a1 is our best ad; test whether a nakshatra angle beats it.",
      agent,
    );
    expect(ok.outcome).toBe("sent_to_approval");
    const [proposed] = await m.db.db.select().from(m.db.experiments);
    expect(proposed!.status).toBe("proposed");

    expect(await m.ads.applyChange(ok.changeId)).toEqual({ ok: true });
    const creative = posts.find((p) => p.path === "act_1/adcreatives")!;
    expect(JSON.parse(creative.body.object_story_spec!).link_data).toMatchObject({ message: "Nakshatra, pada and lord for all nine grahas on one screen. Start free at bodhlok.com.", name: "Every nakshatra, one desk", image_hash: "h" });
    expect(posts.find((p) => p.path === "act_1/ads")!.body).toMatchObject({ adset_id: "s1", status: "ACTIVE", creative: '{"creative_id":"cr9"}' });
    const [running] = await m.db.db.select().from(m.db.experiments);
    expect(running).toMatchObject({ status: "running", variants: [{ adId: "a1" }, { adId: "a9", name: "Nakshatra hook" }] });
  });

  it("blocks everything but pausing when caps are zero", async () => {
    await m.db.db.update(m.db.budgets).set({ dailyCap: 0, monthlyCap: 0 }).where(m.drizzle.eq(m.db.budgets.platform, "meta_ads"));
    const r = await m.ads.requestChange({ type: "budget_change", platform: "meta_ads", entityId: "s1", newDaily: 4000 }, "Cutting the budget a little to save money.", agent);
    expect(r.outcome).toBe("blocked");
  });
});
