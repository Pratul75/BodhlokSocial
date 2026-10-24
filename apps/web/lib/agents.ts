import "server-only";
import { activeRun, anthropicClient, queueRun, runAgent, type AgentName } from "@bodh/agents";

/**
 * Starts a Strategy or Content run. With WORKER_URL set (the VM), the worker runs it, so a
 * web restart doesn't cut it off; without it (local development), it runs in this process.
 */
export async function startAgentRun(agent: AgentName, requestedBy: string, task?: string): Promise<{ runId?: string; error?: string }> {
  const url = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (url && token) {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/jobs/${agent}?trigger=manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Worker-Token": token },
        body: JSON.stringify({ task, requestedBy }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      return res.ok ? { runId: body.runId } : { error: body.error ?? `The worker answered ${res.status}.` };
    } catch {
      return { error: "The agent service isn't answering. Try again in a minute." };
    }
  }
  if (!(await anthropicClient())) return { error: "No Anthropic API key. An admin can add one in Connections." };
  if (await activeRun(agent)) return { error: `The ${agent} agent is already running.` };
  const runId = await queueRun(agent, "manual");
  void runAgent(agent, { trigger: "manual", task, requestedBy }, runId).catch((e) => console.error(`${agent} run failed`, e));
  return { runId };
}

/**
 * Runs an SEO job on the worker (WORKER_URL), or in this process without one.
 * Long jobs (geo) start in the background either way.
 */
export async function runSeoJob(job: "keywords" | "audit-start" | "audit-poll" | "geo" | "catalog"): Promise<{ message?: string; error?: string }> {
  const url = process.env.WORKER_URL;
  const token = process.env.WORKER_TOKEN;
  if (url && token) {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/jobs/seo/${job}`, { method: "POST", headers: { "X-Worker-Token": token }, signal: AbortSignal.timeout(180_000) });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      return res.ok || res.status === 202 ? { message: body.message } : { error: body.error ?? body.message ?? `The worker answered ${res.status}.` };
    } catch {
      return { error: "The worker isn't answering. Try again in a minute." };
    }
  }
  const seo = await import("@bodh/integrations/seo");
  try {
    if (job === "keywords") return { message: await seo.syncKeywords() };
    if (job === "audit-start") return { message: await seo.startSiteAudit() };
    if (job === "audit-poll") return { message: await seo.pollSiteAudits() };
    if (job === "catalog") return { message: `Added ${await seo.ensurePageCatalog()} planned pages.` };
    const { runVisibilityChecks } = await import("@bodh/agents");
    void runVisibilityChecks().catch((e) => console.error("geo failed", e));
    return { message: "Started the AI-visibility checks. They take a few minutes." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
