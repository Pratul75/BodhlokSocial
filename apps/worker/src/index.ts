import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { eq } from "drizzle-orm";
import { agentRuns, auditLog, budgets, db } from "@bodh/db";
import { checkAdChange, type AdChange } from "@bodh/guardrails";

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
app.use("/jobs/*", bearerAuth({ token }));
app.use("/guardrails/*", bearerAuth({ token }));

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

const port = Number(process.env.WORKER_PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => console.log(`worker listening on http://localhost:${info.port}`));
