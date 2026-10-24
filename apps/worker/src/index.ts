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
 * Queues an agent run. The agent runtime (Claude Agent SDK + skills + MCP tools)
 * is built in Phase 4; until then the run is recorded and marked as queued.
 */
app.post("/jobs/:agent", async (c) => {
  const agent = c.req.param("agent");
  if (!(agent in AGENTS)) return c.json({ error: `Unknown agent "${agent}"` }, 404);
  const trigger = c.req.query("trigger") === "manual" ? "manual" : "schedule";
  const [run] = await db
    .insert(agentRuns)
    .values({ agent, trigger, status: "queued", summary: "Queued. The agent runtime ships in Phase 4." })
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
