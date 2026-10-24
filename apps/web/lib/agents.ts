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
