import "server-only";
import { activeRun, anthropicClient, queueRun, replanTask, runAgent, type AgentName } from "@bodh/agents";
import { log } from "@bodh/shared/log";
import { workerHeaders } from "@bodh/integrations/worker-auth";

function worker(): { url: string; token: string } | null {
  const url = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

/**
 * Long work belongs on the worker, where a web restart (or Cloud Run throttling the web
 * service's CPU after a response) cannot cut it off. Only local development runs it in the
 * web process, and only when no worker is configured.
 */
const inProcessAllowed = () => process.env.NODE_ENV !== "production";
const NO_WORKER = "The agent service isn't configured. Set WORKER_URL and WORKER_TOKEN on the web service.";

/** Starts an agent run on the worker (or in this process during local development). */
export async function startAgentRun(agent: AgentName, requestedBy: string, task?: string): Promise<{ runId?: string; error?: string }> {
  const w = worker();
  if (w) {
    try {
      const res = await fetch(`${w.url}/jobs/${agent}?trigger=manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await workerHeaders(w.url, w.token)) },
        body: JSON.stringify({ task, requestedBy }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      return res.ok ? { runId: body.runId } : { error: body.error ?? `The worker answered ${res.status}.` };
    } catch (e) {
      log.warn("worker unreachable", { agent, error: e });
      return { error: "The agent service isn't answering. Try again in a minute." };
    }
  }
  if (!inProcessAllowed()) return { error: NO_WORKER };
  if (!(await anthropicClient())) return { error: "No Anthropic API key. An admin can add one in Connections." };
  const queued = await queueRun(agent, "manual");
  if (!queued.created) return { error: `The ${agent} agent is already running.` };
  void runAgent(agent, { trigger: "manual", task, requestedBy }, queued.id).catch((e) => log.error(`${agent} run failed`, e));
  return { runId: queued.id };
}

/**
 * Re-plans the current month from the positioning brief: the Strategy agent rewrites the plan
 * and the rest of the calendar, then the Content agent drafts the first week. On the worker
 * (production); in this process only during local development.
 */
export async function startReplan(requestedBy: string): Promise<{ runId?: string; error?: string }> {
  const w = worker();
  if (w) {
    try {
      const res = await fetch(`${w.url}/jobs/replan?trigger=manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await workerHeaders(w.url, w.token)) },
        body: JSON.stringify({ requestedBy }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      return res.ok ? { runId: body.runId } : { error: body.error ?? `The worker answered ${res.status}.` };
    } catch (e) {
      log.warn("worker unreachable", { job: "replan", error: e });
      return { error: "The agent service isn't answering. Try again in a minute." };
    }
  }
  if (!inProcessAllowed()) return { error: NO_WORKER };
  if (!(await anthropicClient())) return { error: "No Anthropic API key. An admin can add one in Connections." };
  if ((await activeRun("strategy")) || (await activeRun("content"))) return { error: "An agent is already running; try again in a few minutes." };
  const queued = await queueRun("strategy", "manual");
  if (!queued.created) return { error: "An agent is already running; try again in a few minutes." };
  void (async () => {
    const r = await runAgent("strategy", { trigger: "manual", task: replanTask(), requestedBy, replan: true }, queued.id);
    if (r.status !== "succeeded") return;
    const content = await queueRun("content", "manual");
    if (!content.created) return;
    await runAgent(
      "content",
      { trigger: "manual", task: "The month was just re-planned from a new positioning brief. Draft the next 7 days from the new plan and the ideas now on the calendar. Leave posts a person edited, sent for approval or approved as they are.", requestedBy },
      content.id,
    );
  })().catch((e) => log.error("replan failed", { runId: queued.id, error: e }));
  return { runId: queued.id };
}

export type SeoJob = "keywords" | "audit-start" | "audit-poll" | "geo" | "catalog" | "site-publish" | "site-sync";

/** Runs an SEO job on the worker (or in this process during local development). The geo job starts in the background. */
export async function runSeoJob(job: SeoJob): Promise<{ message?: string; error?: string }> {
  const w = worker();
  if (w) {
    try {
      const path = job.startsWith("site-") ? `/jobs/site/${job.slice(5)}` : `/jobs/seo/${job}${job === "geo" ? "?trigger=manual" : ""}`;
      const res = await fetch(`${w.url}${path}`, { method: "POST", headers: await workerHeaders(w.url, w.token), signal: AbortSignal.timeout(180_000) });
      const body = (await res.json().catch(() => ({}))) as { message?: string; detail?: string; error?: string };
      const text = body.message ?? body.detail;
      return res.ok || res.status === 202 ? { message: text } : { error: body.error ?? text ?? `The worker answered ${res.status}.` };
    } catch (e) {
      log.warn("worker unreachable", { job, error: e });
      return { error: "The worker isn't answering. Try again in a minute." };
    }
  }
  if (!inProcessAllowed()) return { error: NO_WORKER };
  const seo = await import("@bodh/integrations/seo");
  try {
    if (job === "keywords") return { message: await seo.syncKeywords() };
    if (job === "audit-start") return { message: await seo.startSiteAudit() };
    if (job === "audit-poll") return { message: await seo.pollSiteAudits() };
    if (job === "catalog") return { message: `Added ${await seo.ensurePageCatalog()} planned pages.` };
    if (job === "site-publish" || job === "site-sync") {
      const site = await import("@bodh/integrations/site-publisher");
      return { message: job === "site-sync" ? await site.syncSite() : [await site.publishQueued(), await site.removeQueued()].join(" ") };
    }
    const { startVisibilityChecks } = await import("@bodh/agents");
    return { message: await startVisibilityChecks("manual") };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
