/**
 * The daily operations digest (POST /jobs/ops/alerts, 09:00 IST): what failed in the last 24 hours
 * and which connections are broken. Posted to ALERT_WEBHOOK_URL (Slack-compatible incoming webhook,
 * body { text }) when one is set; always returned and logged, so it shows in the job log too.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { agentRuns, calendarItems, communityItems, connections, db, pipelineRuns } from "@bodh/db";
import { getIntegration } from "@bodh/shared";

export interface Digest {
  problems: number;
  lines: string[];
  text: string;
}

const short = (s: string | null | undefined, n = 140) => (s ?? "").replace(/\s+/g, " ").slice(0, n);

export async function buildDigest(hours = 24, now = new Date()): Promise<Digest> {
  const since = new Date(now.getTime() - hours * 3_600_000);
  const [jobs, runs, posts, answers, conns, lastRuns] = await Promise.all([
    db.select().from(pipelineRuns).where(and(eq(pipelineRuns.status, "failed"), gte(pipelineRuns.startedAt, since))).orderBy(desc(pipelineRuns.startedAt)).limit(50),
    db.select().from(agentRuns).where(and(eq(agentRuns.status, "failed"), gte(agentRuns.startedAt, since))).orderBy(desc(agentRuns.startedAt)).limit(30),
    db.select().from(calendarItems).where(and(eq(calendarItems.status, "failed"), gte(calendarItems.updatedAt, since))).limit(30),
    db.select().from(communityItems).where(and(eq(communityItems.status, "failed"), gte(communityItems.updatedAt, since))).limit(30),
    db.select().from(connections).where(eq(connections.status, "error")),
    // A timer that stopped firing shows up as a job with no run at all in the window.
    db.select({ job: pipelineRuns.job }).from(pipelineRuns).where(and(inArray(pipelineRuns.job, ["forward_meta", "publisher", "rebuild_funnel"]), gte(pipelineRuns.startedAt, since))).limit(500),
  ]);

  const lines: string[] = [];
  const byJob = new Map<string, { n: number; last: string }>();
  for (const j of jobs) {
    const e = byJob.get(j.job) ?? { n: 0, last: short(j.detail) };
    e.n++;
    byJob.set(j.job, e);
  }
  for (const [job, e] of byJob) lines.push(`Job ${job} failed ${e.n}× (last: ${e.last})`);
  for (const r of runs) lines.push(`${r.agent} agent run failed: ${short(r.summary)}`);
  for (const p of posts) lines.push(`Post failed to publish (${p.channel}, "${short(p.idea, 60)}"): ${short(p.error)}`);
  for (const a of answers) lines.push(`Community answer failed to post (${a.platform}): ${short(a.error)}`);
  for (const c of conns) lines.push(`Connection ${getIntegration(c.key)?.name ?? c.key} is in error: ${short(c.error)}`);
  const seen = new Set(lastRuns.map((r) => r.job));
  for (const job of ["forward_meta", "publisher", "rebuild_funnel"]) if (!seen.has(job)) lines.push(`Job ${job} didn't run at all in the last ${hours} hours. Check the timers or Cloud Scheduler.`);

  const text = lines.length
    ? `BODH Growth OS: ${lines.length} problem${lines.length === 1 ? "" : "s"} in the last ${hours} hours\n• ${lines.join("\n• ")}`
    : `BODH Growth OS: nothing failed in the last ${hours} hours.`;
  return { problems: lines.length, lines, text };
}

/** Sends the digest when there is something to say (or always, with ALERT_ALWAYS=true). */
export async function sendDigest(digest: Digest, webhook = process.env.ALERT_WEBHOOK_URL): Promise<"sent" | "skipped" | "no_webhook"> {
  if (!webhook) return "no_webhook";
  if (digest.problems === 0 && process.env.ALERT_ALWAYS !== "true") return "skipped";
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: digest.text.slice(0, 3500) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`The alert webhook answered HTTP ${res.status}.`);
  return "sent";
}
