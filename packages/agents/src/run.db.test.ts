/**
 * Agent runs against a real Postgres database, with the Claude API mocked at fetch.
 * Creates and drops its own database; skipped when Postgres isn't reachable.
 */
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const base = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
const dbName = `bodh_agenttest_${Date.now()}`;
const admin = postgres(base, { max: 1, onnotice: () => {} });
const reachable = await admin`select 1`.then(() => true).catch(() => false);

type Block = Record<string, unknown>;
const message = (content: Block[], stop_reason: string, usage: Record<string, number> = {}) => ({
  id: `msg_${Math.random().toString(36).slice(2)}`,
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...usage },
});
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });

/** A client whose replies come from a script; records each request body and beta header. */
function scripted(replies: unknown[]) {
  const requests: { body: Record<string, unknown>; beta: string | null }[] = [];
  const client = new Anthropic({
    apiKey: "test",
    maxRetries: 0,
    fetch: async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({ body: JSON.parse(String(init?.body)), beta: headers.get("anthropic-beta") });
      const next = replies.shift();
      if (!next) return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "no more replies" } }), { status: 500 });
      return new Response(JSON.stringify(next), { headers: { "content-type": "application/json" } });
    },
  });
  return { client, requests };
}

const lastToolResults = (body: Record<string, unknown>) => {
  const msgs = body.messages as { role: string; content: unknown }[];
  const last = msgs.at(-1)!;
  return (last.content as { type: string; content?: unknown; is_error?: boolean }[]).filter((b) => b.type === "tool_result");
};
const resultText = (r: { content?: unknown }) =>
  typeof r.content === "string" ? r.content : (r.content as { text: string }[]).map((c) => c.text).join("");

describe.skipIf(!reachable)("agent runs with a database", () => {
  let m: { db: typeof import("@bodh/db"); run: typeof import("./run"); drizzle: typeof import("drizzle-orm") };
  const inDays = (d: number, hhmm = "18:30") => {
    const ist = new Date(Date.now() + d * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
    return `${ist}T${hhmm}:00+05:30`;
  };

  beforeAll(async () => {
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const url = base.replace(/\/[^/]+$/, `/${dbName}`);
    process.env.DATABASE_URL = url;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const mc = postgres(url, { max: 1, onnotice: () => {} });
    await migrate(drizzle(mc), { migrationsFolder: fileURLToPath(new URL("../../db/migrations", import.meta.url)) });
    await mc.end();
    m = { db: await import("@bodh/db"), run: await import("./run"), drizzle: await import("drizzle-orm") };
    await m.db.db.insert(m.db.brandKit).values({ id: 1, bannedPhrases: ["best astrologer in india"], voice: "Warm and specific." }).onConflictDoNothing();
  });

  afterAll(async () => {
    if (!m) return;
    await m.db.sql.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  });

  beforeEach(async () => {
    await m.db.db.delete(m.db.approvals);
    await m.db.db.delete(m.db.calendarItems);
    await m.db.db.delete(m.db.strategyPlans);
    await m.db.db.delete(m.db.seoPages);
    await m.db.db.delete(m.db.aiVisibilityChecks);
  });

  it("the Content agent drafts posts, and a blocked caption goes back to Claude to fix", async () => {
    const when = inDays(2);
    const { client, requests } = scripted([
      message([toolUse("t1", "get_calendar", { from: inDays(1).slice(0, 10), to: inDays(7).slice(0, 10) })], "tool_use"),
      message(
        [
          toolUse("t2", "create_draft_post", {
            channel: "instagram",
            format: "reel",
            scheduled_at: when,
            idea: "Your moon sign in 30 seconds",
            script: "Hook: your moon sign is probably not what you think.",
            caption: "Guaranteed results from the best astrologer in India!",
            creative_brief: "Night sky, moon over a kundli grid",
            needs_jyotish_review: false,
          }),
        ],
        "tool_use",
      ),
      message(
        [
          toolUse("t3", "create_draft_post", {
            channel: "instagram",
            format: "reel",
            scheduled_at: when,
            idea: "Your moon sign in 30 seconds",
            script: "Hook: your moon sign is probably not what you think.",
            caption: "In Jyotish your Moon sign says more about you than your Sun sign. Get your free kundli on BODH.",
            creative_brief: "Night sky, moon over a kundli grid",
            needs_jyotish_review: false,
          }),
        ],
        "tool_use",
      ),
      message([{ type: "text", text: "Drafted one Reel for the team." }], "end_turn", { cache_read_input_tokens: 5000 }),
    ]);

    const res = await m.run.runAgent("content", { trigger: "manual", requestedBy: "kshitij@rechargestudio.com", client });

    expect(res.status).toBe("succeeded");
    expect(res.summary).toBe("1 post drafted. Drafted one Reel for the team.");
    expect(requests).toHaveLength(4);

    // Request shape: model, cached system prompt with skills, fallbacks beta, web search, effort.
    const first = requests[0]!;
    expect(first.body.model).toBe("claude-opus-5-5");
    expect(first.body.fallbacks).toBe("default");
    expect(first.beta).toContain("server-side-fallback-2026-07-01");
    expect(first.body.output_config).toEqual({ effort: "medium" });
    expect(first.body.thinking).toBeUndefined();
    const system = first.body.system as { text: string; cache_control?: unknown }[];
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(system[0]!.text).toContain('<skill name="bodh-brand-voice"');
    const tools = first.body.tools as { name: string; type?: string }[];
    expect(tools.map((t) => t.name)).toContain("create_draft_post");
    expect(tools.find((t) => t.name === "web_search")?.type).toBe("web_search_20260209");
    expect(tools.map((t) => t.name)).not.toContain("save_strategy_plan");

    // The first caption broke two rules; the error went back as the tool result.
    const blocked = resultText(lastToolResults(requests[2]!.body)[0]!);
    expect(blocked).toMatch(/^Error: the caption would be blocked/);
    expect(blocked).toContain("banned list");

    const items = await m.db.db.select().from(m.db.calendarItems);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: "drafted", channel: "instagram", format: "reel", idea: "Your moon sign in 30 seconds" });
    expect(items[0]!.scheduledAt.toISOString()).toBe(new Date(when).toISOString());
    expect(items[0]!.settings).toMatchObject({ creative_brief: "Night sky, moon over a kundli grid", needs_jyotish_review: false, drafted_by: "content agent" });

    const [run] = await m.db.db.select().from(m.db.agentRuns).where(m.drizzle.eq(m.db.agentRuns.id, res.runId));
    expect(run).toMatchObject({ agent: "content", trigger: "manual", status: "succeeded", tokensIn: 9000, tokensOut: 800 });
    // 4000 input + 800 output + 5000 cache reads at Opus 5.5 prices.
    expect(Number(run!.costUsd)).toBeCloseTo((4000 * 4 + 800 * 20 + 5000 * 0.2) / 1e6, 4);
  });

  it("refuses to double-book a slot", async () => {
    const when = inDays(3, "19:00");
    await m.db.db.insert(m.db.calendarItems).values({ channel: "instagram", format: "image", idea: "Existing post", scheduledAt: new Date(inDays(3, "20:00")), status: "drafted" });
    const draft = { channel: "instagram", format: "image", scheduled_at: when, idea: "Another post", script: "-", caption: "Hello", creative_brief: "-", needs_jyotish_review: false };
    const { client, requests } = scripted([message([toolUse("t1", "create_draft_post", draft)], "tool_use"), message([{ type: "text", text: "Couldn't find a free slot." }], "end_turn")]);
    const res = await m.run.runAgent("content", { trigger: "schedule", client });
    expect(resultText(lastToolResults(requests[1]!.body)[0]!)).toContain('"Existing post" is already on instagram within two hours');
    expect(res.summary).toMatch(/^0 posts drafted/);
    expect(await m.db.db.select().from(m.db.calendarItems)).toHaveLength(1);
  });

  it("the Strategy agent saves a draft plan, after fixing shares that don't add up", async () => {
    const month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
    const plan = (share: number) => ({
      month,
      summary: "Activations come mostly from Reels; double down on moon-sign explainers and test YouTube Shorts.",
      pillars: [
        { name: "Moon sign explainers", share, why: "Best activation rate last month" },
        { name: "Transit updates", share: 40, why: "Search interest around Shani's transit" },
      ],
      bets: [{ title: "Daily Shorts for four weeks", metric: "Activations from YouTube", target: "120" }],
    });
    const { client, requests } = scripted([
      message([toolUse("t1", "get_funnel", { days: 28 })], "tool_use"),
      message([toolUse("t2", "save_strategy_plan", plan(50))], "tool_use"),
      message([toolUse("t3", "save_strategy_plan", plan(60))], "tool_use"),
      message([{ type: "text", text: "Plan saved." }], "end_turn"),
    ]);
    const res = await m.run.runAgent("strategy", { trigger: "manual", client });
    expect(res.status).toBe("succeeded");
    expect(requests[0]!.body.output_config).toEqual({ effort: "high" });
    expect(resultText(lastToolResults(requests[1]!.body)[0]!)).toContain("No funnel data yet");
    expect(resultText(lastToolResults(requests[2]!.body)[0]!)).toBe("Error: pillar shares add up to 90, not 100. Adjust and save again.");
    const plans = await m.db.db.select().from(m.db.strategyPlans);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ month: `${month}-01`, status: "draft" });
    expect(plans[0]!.pillars[0]!.share).toBe(60);
  });

  it("never replaces an approved plan", async () => {
    const month = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
    await m.db.db.insert(m.db.strategyPlans).values({ month: `${month}-01`, status: "approved", summary: "Approved plan", pillars: [], bets: [] });
    const input = { month, summary: "x".repeat(50), pillars: [{ name: "One", share: 50, why: "because it works" }, { name: "Two", share: 50, why: "because it works" }], bets: [{ title: "A bet here", metric: "Activations", target: "10" }] };
    const { client, requests } = scripted([message([toolUse("t1", "save_strategy_plan", input)], "tool_use"), message([{ type: "text", text: "Left the approved plan alone." }], "end_turn")]);
    await m.run.runAgent("strategy", { trigger: "manual", client });
    expect(resultText(lastToolResults(requests[1]!.body)[0]!)).toContain("already approved");
    const plans = await m.db.db.select().from(m.db.strategyPlans);
    expect(plans.map((p) => p.summary)).toEqual(["Approved plan"]);
  });

  it("resumes a paused server-tool turn and stops on a refusal", async () => {
    const paused = message([{ type: "text", text: "Searching…" }], "pause_turn");
    const { client, requests } = scripted([paused, message([{ type: "text", text: "" }], "refusal")]);
    const res = await m.run.runAgent("content", { trigger: "manual", client });
    expect(requests).toHaveLength(2);
    // The runner keeps the conversation in a server-side thread: resuming continues it with nothing new.
    expect(requests[0]!.body.thread).toEqual({ type: "create" });
    expect(requests[1]!.body.thread).toEqual({ type: "continue", previous_message_id: paused.id });
    expect(requests[1]!.body.messages).toEqual([]);
    expect(res.status).toBe("failed");
    expect(res.summary).toMatch(/^Claude declined/);
  });

  it("chat streams text and tool activity, and records the run", async () => {
    const sse = (events: Record<string, unknown>[]) =>
      events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
    const start = (id: string) => ({ type: "message_start", message: { ...message([], "end_turn"), id, content: [], stop_reason: null } });
    const replies = [
      sse([
        start("msg_c1"),
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "get_brand_kit", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 20 } },
        { type: "message_stop" },
      ]),
      sse([
        start("msg_c2"),
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The voice is " } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "warm and specific." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 30 } },
        { type: "message_stop" },
      ]),
    ];
    const bodies: Record<string, unknown>[] = [];
    const client = new Anthropic({
      apiKey: "test",
      maxRetries: 0,
      fetch: async (_u: string | URL | Request, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(replies.shift()!, { headers: { "content-type": "text/event-stream" } });
      },
    });
    const { chat } = await import("./chat");
    const events = [];
    for await (const e of chat([{ role: "user", text: "What's our brand voice?" }], "kshitij@rechargestudio.com", client)) events.push(e);

    expect(events.filter((e) => e.type !== "done")).toEqual([
      { type: "tool", name: "Reading the brand kit" },
      { type: "text", text: "The voice is " },
      { type: "text", text: "warm and specific." },
    ]);
    const tools = bodies[0]!.tools as { name: string; eager_input_streaming?: boolean }[];
    expect(tools.find((t) => t.name === "get_funnel")?.eager_input_streaming).toBe(true);
    expect(tools.map((t) => t.name)).not.toContain("create_draft_post");
    const done = events.at(-1) as { type: "done"; runId: string };
    const [run] = await m.db.db.select().from(m.db.agentRuns).where(m.drizzle.eq(m.db.agentRuns.id, done.runId));
    expect(run).toMatchObject({ agent: "chat", trigger: "chat", status: "succeeded", tokensOut: 50 });
  });

  it("the Strategy agent outlines the month as calendar ideas, and Content fills an idea in place", async () => {
    const day = inDays(3).slice(0, 10);
    const { client } = scripted([
      message(
        [
          toolUse("t1", "outline_calendar", {
            ideas: [
              { date: day, time: "19:00", channel: "instagram", format: "reel", idea: "Shani's transit in 60 seconds", pillar: "Transit updates" },
              { date: day, time: "19:30", channel: "instagram", format: "image", idea: "Clashing slot", pillar: "Explainers" },
              { date: "2020-01-01", time: "10:00", channel: "facebook", format: "post", idea: "In the past", pillar: "Explainers" },
            ],
          }),
        ],
        "tool_use",
      ),
      message([{ type: "text", text: "Outlined." }], "end_turn"),
    ]);
    const res = await m.run.runAgent("strategy", { trigger: "manual", client });
    expect(res.summary).toMatch(/^1 calendar idea added/);
    const [idea] = await m.db.db.select().from(m.db.calendarItems);
    expect(idea).toMatchObject({ status: "idea", idea: "Shani's transit in 60 seconds", settings: { pillar: "Transit updates", planned_by: "strategy agent" } });

    const draft = {
      idea_id: idea!.id,
      channel: "instagram",
      format: "reel",
      scheduled_at: `${day}T19:00:00+05:30`,
      idea: "Shani's transit in 60 seconds",
      script: "Hook: Shani moves signs this week.",
      caption: "Shani (Saturn) changes sign this week. See what it means for your Moon sign in the BODH app.",
      creative_brief: "Saturn rings over a kundli grid",
      needs_jyotish_review: true,
    };
    const c = scripted([message([toolUse("t2", "create_draft_post", draft)], "tool_use"), message([{ type: "text", text: "Done." }], "end_turn")]);
    const r2 = await m.run.runAgent("content", { trigger: "manual", client: c.client });
    expect(r2.summary).toMatch(/^1 post drafted/);
    const items = await m.db.db.select().from(m.db.calendarItems);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: idea!.id, status: "drafted", settings: { pillar: "Transit updates", needs_jyotish_review: true, drafted_by: "content agent" } });
  });

  it("the SEO agent writes a planned page into the approval queue, after fixing a short answer", async () => {
    const { ensurePageCatalog } = await import("@bodh/integrations/seo");
    expect(await ensurePageCatalog()).toBeGreaterThan(190);
    expect(await ensurePageCatalog()).toBe(0);
    const [page] = await m.db.db.select().from(m.db.seoPages).where(m.drizzle.eq(m.db.seoPages.slug, "saturn-in-7th-house"));
    const body = "## What it means\n\n" + "Saturn in the seventh house tends to bring a serious, slow-building approach to partnership. ".repeat(30);
    const content = (answer: string) => ({
      page_id: page!.id,
      title: "Saturn (Shani) in the 7th house: marriage and partnership",
      description: "What Saturn in the 7th house means in Vedic astrology for marriage, business partners and timing, with the dashas that matter most.",
      answer,
      body,
      faq: [
        { q: "Does Saturn in the 7th house delay marriage?", a: "It often shows as marriage after some waiting or responsibility, but the full chart decides." },
        { q: "Is Saturn in the 7th house good for business?", a: "It can favour steady, long partnerships built on clear agreements." },
        { q: "Which dasha activates it?", a: "Saturn's own dasha and antardasha, and periods of the 7th lord." },
      ],
      brief: "Intent: people with Shani in the 7th asking about marriage timing. Cover tendencies, dignity, aspects, dashas.",
      needs_jyotish_review: true,
    });
    const good = "Saturn (Shani) in the 7th house usually makes a person serious and patient about marriage and partnerships. Commitment may come later or after some responsibility, and relationships tend to grow steadier with time. The sign, Saturn's dignity and the running dasha decide how this shows up in a particular chart.";
    const { client, requests } = scripted([
      message([toolUse("t0", "list_pages_to_write", { template: "planet_house", limit: 3 })], "tool_use"),
      message([toolUse("t1", "write_page", content("Saturn in the seventh is serious. ".repeat(5)))], "tool_use"),
      message([toolUse("t2", "write_page", content(good))], "tool_use"),
      message([{ type: "text", text: "Wrote one page." }], "end_turn"),
    ]);
    const res = await m.run.runAgent("seo", { trigger: "manual", client });
    expect(res.summary).toBe("1 page drafted. Wrote one page.");
    expect(resultText(lastToolResults(requests[1]!.body)[0]!)).toContain('"id"');
    expect(resultText(lastToolResults(requests[2]!.body)[0]!)).toMatch(/^Error: The answer block is \d+ words/);
    const [saved] = await m.db.db.select().from(m.db.seoPages).where(m.drizzle.eq(m.db.seoPages.id, page!.id));
    expect(saved).toMatchObject({ status: "in_review", answer: good, needsReview: true });
    const [approval] = await m.db.db.select().from(m.db.approvals);
    expect(approval).toMatchObject({ kind: "page", status: "pending", agent: "seo", payload: { seoPageId: page!.id, needsJyotishReview: true } });
    const tools = (requests[0]!.body.tools as { name: string }[]).map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["write_page", "write_blog", "track_keywords", "read_skill", "get_search_trends"]));
  });

  it("chat can start an agent run when it's given a starter", async () => {
    const sse = (events: Record<string, unknown>[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
    const start = (id: string) => ({ type: "message_start", message: { ...message([], "end_turn"), id, content: [], stop_reason: null } });
    const replies = [
      sse([
        start("m1"),
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "start_agent_run", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"agent":"seo","task":"Write the nakshatra pages"}' } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 10 } },
        { type: "message_stop" },
      ]),
      sse([
        start("m2"),
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Started it." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
        { type: "message_stop" },
      ]),
    ];
    const client = new Anthropic({ apiKey: "test", maxRetries: 0, fetch: async () => new Response(replies.shift()!, { headers: { "content-type": "text/event-stream" } }) });
    const started: unknown[] = [];
    const { chat } = await import("./chat");
    const events = [];
    for await (const e of chat([{ role: "user", text: "Write the nakshatra pages" }], "a@b.c", client, async (agent, task) => (started.push({ agent, task }), { runId: "r1" }))) events.push(e);
    expect(started).toEqual([{ agent: "seo", task: "Write the nakshatra pages" }]);
    expect(events).toContainEqual({ type: "tool", name: "Starting an agent" });
  });

  it("AI-visibility checks record mentions, competitors and errors per engine", async () => {
    const { runVisibilityChecks, ensureGeoQuestions } = await import("./geo");
    await ensureGeoQuestions();
    const msg = await runVisibilityChecks(["chatgpt", "perplexity", "gemini"], {
      chatgpt: async (q) => ({ answer: q.includes("learn") ? "Try Asttrolok's courses or AstroSage." : "AstroTalk and Astro-Sage are popular.", citations: ["https://asttrolok.com"] }),
      perplexity: async () => {
        throw new Error("Perplexity 401: bad key");
      },
      gemini: async () => null,
      claude: async () => null,
    });
    expect(msg).toMatch(/^Asked 8 questions on ChatGPT: Bodhlok mentioned in 1 of 8 answers\. Skipped \(no key\): Gemini\.$/);
    const rows = await m.db.db.select().from(m.db.aiVisibilityChecks);
    expect(rows.filter((r) => r.engine === "chatgpt")).toHaveLength(8);
    expect(rows.find((r) => r.engine === "chatgpt" && r.mentioned)?.competitors).toEqual(["AstroSage"]);
    expect(rows.find((r) => r.engine === "chatgpt" && !r.mentioned)?.competitors).toEqual(["AstroSage", "Astrotalk"]);
    expect(rows.filter((r) => r.engine === "perplexity").every((r) => r.error === "Perplexity 401: bad key")).toBe(true);
  });

  it("records API failures and the budget stop on the run", async () => {
    const { client } = scripted([]);
    const failed = await m.run.runAgent("content", { trigger: "manual", client });
    expect(failed.status).toBe("failed");
    expect(failed.summary).toMatch(/^Claude API error 500/);

    await m.db.db.insert(m.db.agentRuns).values({ agent: "chat", trigger: "chat", status: "succeeded", costUsd: "1000" });
    const stopped = await m.run.runAgent("content", { trigger: "manual", client: scripted([]).client });
    expect(stopped.summary).toMatch(/AI budget .* is used up/);
  });
});
