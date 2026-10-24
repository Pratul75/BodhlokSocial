import { serve } from "@hono/node-server";
import { Hono, type MiddlewareHandler } from "hono";
import { createHash, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { agentRuns, auditLog, budgets, db } from "@bodh/db";
import { checkAdChange, type AdChange } from "@bodh/guardrails";
import {
  forwardToGoogle,
  forwardToMeta,
  istDate,
  loadGa4Sessions,
  loadGoogleSpend,
  loadMetaSpend,
  rebuild,
  runJob,
} from "@bodh/integrations/pipeline";
import { runPublisher } from "@bodh/integrations/publisher";
import { pollVideoJobs } from "@bodh/integrations/creative";
import { activeRun, anthropicClient, failStaleRuns, isAgentName, queueRun, runAgent, runVisibilityChecks } from "@bodh/agents";
import { syncAdStructure } from "@bodh/integrations/ads";
import { checkDataForSeoConnection, ensurePageCatalog, pollSiteAudits, startSiteAudit, syncKeywords } from "@bodh/integrations/seo";

/** Agents and their schedules, from the build plan. Cloud Scheduler calls POST /jobs/:agent. */
export const AGENTS = {
  strategy: "Monthly + on demand",
  content: "Daily",
  creative: "On request",
  publisher: "On schedule",
  ads: "Daily check, weekly tests",
  seo: "Weekly",
  geo: "Weekly",
  mentions: "Weekly",
  community: "Daily",
  analyst: "Weekly + monthly",
} as const;
type AgentName = keyof typeof AGENTS;

const app = new Hono();

function timingSafeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return nodeTimingSafeEqual(ha, hb);
}

app.get("/health", async (c) => {
  try {
    await db.select({ one: agentRuns.id }).from(agentRuns).limit(1);
    return c.json({ ok: true, db: "up" });
  } catch {
    return c.json({ ok: false, db: "down" }, 503);
  }
});

const token = process.env.WORKER_TOKEN;
if (!token) throw new Error("WORKER_TOKEN is not set");

/**
 * Callers send the shared token as X-Worker-Token (Cloud Scheduler, whose Authorization
 * header carries its own OIDC token for Cloud Run IAM) or as a Bearer token (local tools).
 */
const requireToken: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("x-worker-token") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!header || !timingSafeEqual(header, token)) return c.json({ error: "Unauthorized" }, 401);
  await next();
};
app.use("/jobs/*", requireToken);
app.use("/guardrails/*", requireToken);

app.get("/jobs", (c) => c.json(AGENTS));

/**
 * Starts an agent run and returns its id at once; the run carries on in the background
 * and records its result on the run row. Body (optional JSON): { task, requestedBy }.
 * Agents not built yet are recorded as queued.
 */
app.post("/jobs/:agent", async (c) => {
  const agent = c.req.param("agent");
  if (!(agent in AGENTS)) return c.json({ error: `Unknown agent "${agent}"` }, 404);
  const trigger = c.req.query("trigger") === "manual" ? "manual" : "schedule";
  const body = (await c.req.json().catch(() => ({}))) as { task?: unknown; requestedBy?: unknown };
  const task = typeof body.task === "string" ? body.task.slice(0, 2000) : undefined;
  const requestedBy = typeof body.requestedBy === "string" ? body.requestedBy.slice(0, 200) : null;

  if (isAgentName(agent)) {
    if (!(await anthropicClient())) return c.json({ error: "No Anthropic API key. An admin can add one in Connections." }, 409);
    const running = await activeRun(agent);
    if (running) return c.json({ error: `The ${agent} agent is already running.`, runId: running }, 409);
    const runId = await queueRun(agent, trigger);
    void runAgent(agent, { trigger, task, requestedBy }, runId).catch((e) => console.error(`${agent} run ${runId} failed`, e));
    return c.json({ runId, status: "queued" }, 202);
  }

  const [run] = await db
    .insert(agentRuns)
    .values({ agent, trigger, status: "queued", summary: "Queued. This agent isn't built yet." })
    .returning();
  await db.insert(auditLog).values({
    actor: `${agent} agent`,
    actorType: "agent",
    action: "run_queued",
    target: (agent as AgentName),
    reason: `${trigger} trigger`,
    result: "queued",
  });
  return c.json({ runId: run!.id, status: run!.status }, 202);
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateParam = (v: string | undefined, fallback: string) => (v && DATE_RE.test(v) ? v : fallback);

/**
 * Tracking jobs, called by Cloud Scheduler. Dates are India time and default to
 * yesterday through today, which covers late-arriving spend and events.
 *   forward-conversions  every 5 minutes
 *   hourly               spend for yesterday and today, then rebuild the last 7 days
 *   daily                GA4 sessions for yesterday, then rebuild the last 35 days
 */
app.post("/jobs/tracking/:job", async (c) => {
  const job = c.req.param("job");
  const since = dateParam(c.req.query("since"), istDate(new Date(), -1));
  const until = dateParam(c.req.query("until"), istDate());
  const results = [];
  try {
    switch (job) {
      case "forward-conversions":
        results.push(await runJob("forward_meta", forwardToMeta));
        results.push(await runJob("forward_google", forwardToGoogle));
        break;
      case "load-spend":
        results.push(await runJob("load_meta_spend", () => loadMetaSpend(since, until)));
        results.push(await runJob("load_google_spend", () => loadGoogleSpend(since, until)));
        break;
      case "load-ga4":
        results.push(await runJob("load_ga4_sessions", () => loadGa4Sessions(dateParam(c.req.query("day"), istDate(new Date(), -1)))));
        break;
      case "rebuild-funnel":
        results.push(await runJob("rebuild_funnel", () => rebuild(dateParam(c.req.query("from"), istDate(new Date(), -7)), until)));
        break;
      case "hourly":
        results.push(await runJob("load_meta_spend", () => loadMetaSpend(since, until)));
        results.push(await runJob("load_google_spend", () => loadGoogleSpend(since, until)));
        results.push(await runJob("rebuild_funnel", () => rebuild(istDate(new Date(), -7), until)));
        break;
      case "daily":
        results.push(await runJob("load_ga4_sessions", () => loadGa4Sessions(istDate(new Date(), -1))));
        results.push(await runJob("rebuild_funnel", () => rebuild(istDate(new Date(), -35), istDate())));
        break;
      default:
        return c.json({ error: `Unknown tracking job "${job}"` }, 404);
    }
  } catch (e) {
    // The failed step is in pipeline_runs; a 500 makes Cloud Scheduler retry.
    return c.json({ results, error: e instanceof Error ? e.message : String(e) }, 500);
  }
  return c.json({ results });
});

/** Publisher: every 5 minutes. Hands approved posts to Postiz and reads back results. */
app.post("/jobs/publishing/run", async (c) => {
  try {
    return c.json(await runJob("publisher", () => runPublisher()));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/** Video generation: every minute while any Veo job is running. */
app.post("/jobs/creative/poll", async (c) => {
  try {
    return c.json(await pollVideoJobs());
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/**
 * SEO and GEO jobs, called by the VM timers:
 *   catalog      add missing programmatic pages as planned (also runs on start)
 *   keywords     weekly DataForSEO ranking sync
 *   audit-start  weekly site crawl;  audit-poll  hourly, stores finished crawls
 *   geo          weekly AI-visibility checks (runs in the background, takes minutes)
 */
let geoRunning = false;
app.post("/jobs/seo/:job", async (c) => {
  const job = c.req.param("job");
  try {
    switch (job) {
      case "catalog":
        return c.json({ message: `Added ${await ensurePageCatalog()} planned pages.` });
      case "keywords":
        return c.json({ message: await syncKeywords() });
      case "audit-start":
        return c.json({ message: await startSiteAudit() });
      case "audit-poll":
        return c.json({ message: await pollSiteAudits() });
      case "geo":
        if (geoRunning) return c.json({ message: "AI-visibility checks are already running." }, 409);
        geoRunning = true;
        void runVisibilityChecks()
          .then((m) => console.log(`geo: ${m}`))
          .catch((e) => console.error("geo failed", e))
          .finally(() => (geoRunning = false));
        return c.json({ message: "Started the AI-visibility checks. They take a few minutes." }, 202);
      default:
        return c.json({ error: `Unknown SEO job "${job}"` }, 404);
    }
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/** Hourly: campaigns, ad sets and ads from Meta and Google Ads, so guardrails see current budgets. */
app.post("/jobs/ads/sync", async (c) => {
  try {
    return c.json({ message: await syncAdStructure() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

/** Agents call this before any ad change. The caps come from the database, never from the agent. */
app.post("/guardrails/ad-change", async (c) => {
  const body = await c.req.json<{ platform: string; change: AdChange }>();
  const [caps] = await db.select().from(budgets).where(eq(budgets.platform, body.platform));
  if (!caps) return c.json({ outcome: "block", reason: `No spend caps set for ${body.platform}.` });
  const decision = checkAdChange(
    body.change,
    { dailyCap: caps.dailyCap, monthlyCap: caps.monthlyCap },
    { spentToday: caps.spentToday, spentThisMonth: caps.spentThisMonth },
  );
  return c.json(decision);
});

const port = Number(process.env.PORT ?? process.env.WORKER_PORT ?? 8787);
// Cloud Run needs 0.0.0.0; on a shared VM set WORKER_HOST=127.0.0.1 so only local jobs can reach it.
const hostname = process.env.WORKER_HOST ?? "0.0.0.0";
serve({ fetch: app.fetch, port, hostname }, (info) => console.log(`worker listening on http://${hostname}:${info.port}`));
failStaleRuns()
  .then((n) => n && console.log(`marked ${n} interrupted agent run(s) as failed`))
  .catch((e) => console.error("failStaleRuns", e));
ensurePageCatalog()
  .then((n) => n && console.log(`added ${n} planned SEO pages`))
  .then(checkDataForSeoConnection)
  .catch((e) => console.error("SEO start-up", e));
