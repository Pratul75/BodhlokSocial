import { Hono, type MiddlewareHandler } from "hono";
import { createHash, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { agentRuns, db } from "@bodh/db";
import {
  forwardToGoogle,
  forwardToMeta,
  istDate,
  loadGa4Sessions,
  loadGoogleSpend,
  loadMetaSpend,
  rebuild,
  runJob,
  scrubClientData,
} from "@bodh/integrations/pipeline";
import { runPublisher } from "@bodh/integrations/publisher";
import { pollVideoJobs } from "@bodh/integrations/creative";
import { AGENT_NAMES, activeRun, anthropicClient, checkAnthropicKey, isAgentName, queueRun, runAgent, startVisibilityChecks } from "@bodh/agents";
import { verifyConnections } from "@bodh/integrations/verify-connections";
import { buildDigest, sendDigest } from "@bodh/integrations/ops";
import { syncAdStructure } from "@bodh/integrations/ads";
import { publishQueued, removeQueued, syncSite } from "@bodh/integrations/site-publisher";
import { pollSiteAudits, startSiteAudit, syncKeywords, ensurePageCatalog } from "@bodh/integrations/seo";
import { log } from "./log";

/** The placeholder from .env.example; the worker refuses it in production. */
export const PLACEHOLDER_TOKEN = "change-me-dev-token";

/** Returns why the worker must not start with this token, or null when it is fine. */
export function tokenProblem(token: string | undefined, nodeEnv: string | undefined): string | null {
  if (!token) return "WORKER_TOKEN is not set";
  if (nodeEnv === "production" && (token === PLACEHOLDER_TOKEN || token.length < 24)) {
    return "WORKER_TOKEN is the example placeholder or shorter than 24 characters. Generate one with `openssl rand -hex 32`.";
  }
  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return nodeTimingSafeEqual(ha, hb);
}

/** Everything the routes call, so tests can swap in fakes. */
export interface WorkerDeps {
  runJob: typeof runJob;
  agents: {
    names: readonly string[];
    hasKey: () => Promise<boolean>;
    activeRun: typeof activeRun;
    queueRun: typeof queueRun;
    runAgent: typeof runAgent;
  };
  jobs: {
    forwardToMeta: typeof forwardToMeta;
    forwardToGoogle: typeof forwardToGoogle;
    loadMetaSpend: typeof loadMetaSpend;
    loadGoogleSpend: typeof loadGoogleSpend;
    loadGa4Sessions: typeof loadGa4Sessions;
    rebuild: typeof rebuild;
    scrubClientData: typeof scrubClientData;
    runPublisher: typeof runPublisher;
    pollVideoJobs: typeof pollVideoJobs;
    ensurePageCatalog: typeof ensurePageCatalog;
    syncKeywords: typeof syncKeywords;
    startSiteAudit: typeof startSiteAudit;
    pollSiteAudits: typeof pollSiteAudits;
    startVisibilityChecks: typeof startVisibilityChecks;
    publishQueued: typeof publishQueued;
    removeQueued: typeof removeQueued;
    syncSite: typeof syncSite;
    syncAdStructure: typeof syncAdStructure;
    verifyConnections: typeof verifyConnections;
    checkAnthropicKey: typeof checkAnthropicKey;
    buildDigest: typeof buildDigest;
    sendDigest: typeof sendDigest;
  };
  dbUp: () => Promise<boolean>;
}

export const defaultDeps: WorkerDeps = {
  runJob,
  agents: {
    names: AGENT_NAMES,
    hasKey: async () => Boolean(await anthropicClient()),
    activeRun,
    queueRun,
    runAgent,
  },
  jobs: {
    forwardToMeta,
    forwardToGoogle,
    loadMetaSpend,
    loadGoogleSpend,
    loadGa4Sessions,
    rebuild,
    scrubClientData,
    runPublisher,
    pollVideoJobs,
    ensurePageCatalog,
    syncKeywords,
    startSiteAudit,
    pollSiteAudits,
    startVisibilityChecks,
    publishQueued,
    removeQueued,
    syncSite,
    syncAdStructure,
    verifyConnections,
    checkAnthropicKey,
    buildDigest,
    sendDigest,
  },
  dbUp: async () => {
    try {
      await db.select({ one: agentRuns.id }).from(agentRuns).limit(1);
      return true;
    } catch {
      return false;
    }
  },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateParam = (v: string | undefined, fallback: string) => (v && DATE_RE.test(v) ? v : fallback);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createApp(token: string, deps: WorkerDeps = defaultDeps): Hono {
  const app = new Hono();
  const { runJob: run, jobs, agents } = deps;

  app.get("/health", async (c) => ((await deps.dbUp()) ? c.json({ ok: true, db: "up" }) : c.json({ ok: false, db: "down" }, 503)));

  /**
   * Callers send the shared token as X-Worker-Token (Cloud Scheduler, whose Authorization
   * header carries its own OIDC token for Cloud Run IAM) or as a Bearer token (local tools).
   */
  const requireToken: MiddlewareHandler = async (c, next) => {
    const header = c.req.header("x-worker-token") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!header || !timingSafeEqual(header, token)) return c.json({ error: "Unauthorized" }, 401);
    await next();
  };
  app.use("/jobs", requireToken);
  app.use("/jobs/*", requireToken);

  app.get("/jobs", (c) => c.json({ agents: agents.names }));

  /**
   * Tracking jobs, called by the scheduler. Dates are India time and default to
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
          results.push(await run("forward_meta", jobs.forwardToMeta));
          results.push(await run("forward_google", jobs.forwardToGoogle));
          break;
        case "load-spend":
          results.push(await run("load_meta_spend", () => jobs.loadMetaSpend(since, until)));
          results.push(await run("load_google_spend", () => jobs.loadGoogleSpend(since, until)));
          break;
        case "load-ga4":
          results.push(await run("load_ga4_sessions", () => jobs.loadGa4Sessions(dateParam(c.req.query("day"), istDate(new Date(), -1)))));
          break;
        case "rebuild-funnel":
          results.push(await run("rebuild_funnel", () => jobs.rebuild(dateParam(c.req.query("from"), istDate(new Date(), -7)), until)));
          break;
        case "hourly":
          results.push(await run("load_meta_spend", () => jobs.loadMetaSpend(since, until)));
          results.push(await run("load_google_spend", () => jobs.loadGoogleSpend(since, until)));
          results.push(await run("rebuild_funnel", () => jobs.rebuild(istDate(new Date(), -7), until)));
          break;
        case "daily":
          results.push(await run("load_ga4_sessions", () => jobs.loadGa4Sessions(istDate(new Date(), -1))));
          results.push(await run("rebuild_funnel", () => jobs.rebuild(istDate(new Date(), -35), istDate())));
          results.push(await run("scrub_client_data", () => jobs.scrubClientData()));
          break;
        default:
          return c.json({ error: `Unknown tracking job "${job}"` }, 404);
      }
    } catch (e) {
      // The failed step is in pipeline_runs; a 500 makes the scheduler retry.
      return c.json({ results, error: message(e) }, 500);
    }
    return c.json({ results });
  });

  /** Publisher: every 5 minutes. Hands approved posts to Postiz and reads back results. */
  app.post("/jobs/publishing/run", async (c) => {
    try {
      return c.json(await run("publisher", () => jobs.runPublisher()));
    } catch (e) {
      return c.json({ error: message(e) }, 500);
    }
  });

  /** Video generation: every minute while any Veo job is running. */
  app.post("/jobs/creative/poll", async (c) => {
    try {
      // Not logged to pipeline_runs: it runs every minute and is a no-op most of the time.
      return c.json(await jobs.pollVideoJobs());
    } catch (e) {
      return c.json({ error: message(e) }, 500);
    }
  });

  /**
   * SEO and GEO jobs:
   *   catalog      add missing programmatic pages as planned (also runs on start)
   *   keywords     weekly DataForSEO ranking sync
   *   audit-start  weekly site crawl;  audit-poll  hourly, stores finished crawls
   *   geo          weekly AI-visibility checks (runs in the background, takes minutes)
   */
  app.post("/jobs/seo/:job", async (c) => {
    const job = c.req.param("job");
    try {
      switch (job) {
        case "catalog":
          return c.json({ message: `Added ${await jobs.ensurePageCatalog()} planned pages.` });
        case "keywords":
          return c.json(await run("seo_keywords", async () => ({ detail: await jobs.syncKeywords(), rows: 0, status: "succeeded" as const })));
        case "audit-start":
          return c.json(await run("seo_audit_start", async () => ({ detail: await jobs.startSiteAudit(), rows: 0, status: "succeeded" as const })));
        case "audit-poll":
          return c.json(await run("seo_audit_poll", async () => ({ detail: await jobs.pollSiteAudits(), rows: 0, status: "succeeded" as const })));
        case "geo": {
          const started = await jobs.startVisibilityChecks(c.req.query("trigger") === "manual" ? "manual" : "schedule");
          return c.json({ message: started }, started.startsWith("Already") ? 409 : 202);
        }
        default:
          return c.json({ error: `Unknown SEO job "${job}"` }, 404);
      }
    } catch (e) {
      return c.json({ error: message(e) }, 500);
    }
  });

  /**
   * Publishing approved pages to bodhlok.com through pull requests:
   *   publish  opens one pull request with every approved page waiting (daily 10:00 IST, or on demand)
   *   sync     follows pull requests to merge and merged pages to the live URL (every 10 minutes)
   */
  app.post("/jobs/site/:job", async (c) => {
    const job = c.req.param("job");
    try {
      if (job === "publish") {
        return c.json(await run("site_publish", async () => ({ detail: [await jobs.publishQueued(), await jobs.removeQueued()].join(" "), rows: 0, status: "succeeded" as const })));
      }
      if (job === "sync") return c.json(await run("site_sync", async () => ({ detail: await jobs.syncSite(), rows: 0, status: "succeeded" as const })));
      return c.json({ error: `Unknown site job "${job}"` }, 404);
    } catch (e) {
      return c.json({ error: message(e) }, 500);
    }
  });

  /**
   * Daily at 09:00: the failures digest (to ALERT_WEBHOOK_URL when set), after re-checking every
   * stored credential with its provider so a revoked key shows up before a job trips over it.
   */
  app.post("/jobs/ops/alerts", async (c) => {
    try {
      return c.json(
        await run("ops_alerts", async () => {
          const checks = await jobs.verifyConnections({ anthropic: jobs.checkAnthropicKey });
          const digest = await jobs.buildDigest();
          const sent = await jobs.sendDigest(digest);
          const bad = checks.filter((x) => !x.ok).length;
          return { status: "succeeded", detail: `${digest.problems} problems; ${bad} of ${checks.length} connections failing; digest ${sent.replace("_", " ")}. ${digest.text.slice(0, 600)}`, rows: digest.problems };
        }),
      );
    } catch (e) {
      return c.json({ error: message(e) }, 500);
    }
  });

  /** Hourly: campaigns, ad sets and ads from Meta and Google Ads, so guardrails see current budgets. */
  app.post("/jobs/ads/sync", async (c) => {
    try {
      return c.json(await run("ads_sync", async () => ({ detail: await jobs.syncAdStructure(), rows: 0, status: "succeeded" as const })));
    } catch (e) {
      return c.json({ error: message(e) }, 500);
    }
  });

  /**
   * Starts an agent run and returns its id at once; the run carries on in the background
   * and records its result on the run row. Body (optional JSON): { task, requestedBy }.
   * Registered last so the fixed /jobs/<area>/... routes above win.
   */
  app.post("/jobs/:agent", async (c) => {
    const agent = c.req.param("agent");
    if (!agents.names.includes(agent) || !isAgentName(agent)) return c.json({ error: `Unknown agent "${agent}"` }, 404);
    const trigger = c.req.query("trigger") === "manual" ? "manual" : "schedule";
    const body = (await c.req.json().catch(() => ({}))) as { task?: unknown; requestedBy?: unknown };
    const task = typeof body.task === "string" ? body.task.slice(0, 2000) : undefined;
    const requestedBy = typeof body.requestedBy === "string" ? body.requestedBy.slice(0, 200) : null;

    if (!(await agents.hasKey())) return c.json({ error: "No Anthropic API key. An admin can add one in Connections." }, 409);
    const running = await agents.activeRun(agent);
    if (running) return c.json({ error: `The ${agent} agent is already running.`, runId: running }, 409);
    const queued = await agents.queueRun(agent, trigger);
    if (!queued.created) return c.json({ error: `The ${agent} agent is already running.`, runId: queued.id }, 409);
    void agents.runAgent(agent, { trigger, task, requestedBy }, queued.id).catch((e) => log.error("agent run failed", { agent, runId: queued.id, error: e }));
    return c.json({ runId: queued.id, status: "queued" }, 202);
  });

  return app;
}
