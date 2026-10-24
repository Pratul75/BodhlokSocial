import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { and, eq, gt, inArray } from "drizzle-orm";
import { agentRuns, auditLog, db } from "@bodh/db";
import { anthropicClient, FALLBACK_BETA, MODEL } from "./client";
import { addUsage, costUsd, emptyTotals, MONTHLY_BUDGET_USD, spentThisMonthUsd, type RunTotals } from "./cost";
import { defaultTask, systemPrompt, userMessage, type AgentName } from "./prompts";
import { contentTools, readTools, seoTools, strategyTools, type ToolContext } from "./tools";

export const AGENT_NAMES: AgentName[] = ["strategy", "content", "seo"];
export const isAgentName = (a: string): a is AgentName => (AGENT_NAMES as string[]).includes(a);

/** One run may not spend more than this, whatever the monthly budget says. */
export const RUN_CAP_USD = Number(process.env.AI_RUN_CAP_USD ?? 6);
const EFFORT = { strategy: "high", content: "medium", seo: "medium" } as const;
const WEB_SEARCHES = { strategy: 8, content: 4, seo: 6 } as const;
const TOOLS = { strategy: strategyTools, content: contentTools, seo: seoTools } as const;

export interface RunOptions {
  trigger: "manual" | "schedule";
  task?: string;
  requestedBy?: string | null;
  client?: Anthropic; // tests pass a client with a mocked fetch
}

export interface RunResult {
  runId: string;
  status: "succeeded" | "failed";
  summary: string;
  costUsd: number;
}

/** Creates the run row so callers can return its id before the run finishes. */
export async function queueRun(agent: AgentName, trigger: RunOptions["trigger"]): Promise<string> {
  const [row] = await db.insert(agentRuns).values({ agent, trigger, status: "queued" }).returning({ id: agentRuns.id });
  return row!.id;
}

async function finish(runId: string, status: RunResult["status"], summary: string, totals: RunTotals): Promise<RunResult> {
  const usd = costUsd(totals);
  await db
    .update(agentRuns)
    .set({
      status,
      summary: summary.slice(0, 4000),
      tokensIn: totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens,
      tokensOut: totals.outputTokens,
      costUsd: usd.toFixed(4),
      finishedAt: new Date(),
    })
    .where(eq(agentRuns.id, runId));
  return { runId, status, summary, costUsd: usd };
}

const textOf = (m: BetaMessage | null) =>
  (m?.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n")
    .trim();

function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. An admin can replace it in Connections.";
  if (e instanceof Anthropic.RateLimitError) return "Claude is rate-limited right now. Try again in a few minutes.";
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status ?? ""}: ${e.message}`.slice(0, 500);
  return e instanceof Error ? e.message.slice(0, 500) : String(e);
}

/** Runs the Strategy or Content agent to completion and records the result on the run row. */
export async function runAgent(agent: AgentName, opts: RunOptions, existingRunId?: string): Promise<RunResult> {
  const runId = existingRunId ?? (await queueRun(agent, opts.trigger));
  let totals = emptyTotals();

  const client = opts.client ?? (await anthropicClient());
  if (!client) return finish(runId, "failed", "No Anthropic API key. An admin can add one in Connections → Claude.", totals);

  const spent = await spentThisMonthUsd();
  if (spent >= MONTHLY_BUDGET_USD) {
    return finish(runId, "failed", `This month's AI budget ($${MONTHLY_BUDGET_USD}) is used up ($${spent.toFixed(2)} spent). Raise AI_MONTHLY_BUDGET_USD to run more.`, totals);
  }

  await db.update(agentRuns).set({ status: "running", startedAt: new Date() }).where(eq(agentRuns.id, runId));
  await db.insert(auditLog).values({ actor: `${agent} agent`, actorType: "agent", action: "run", target: agent, reason: opts.requestedBy ? `requested by ${opts.requestedBy}` : opts.trigger, result: "started" });

  const ctx: ToolContext = { agent, runId, drafts: 0 };
  const tools = [...readTools(ctx), ...TOOLS[agent](ctx)];

  try {
    const runner = client.beta.messages.toolRunner({
      model: MODEL,
      // Non-streaming requests must stay under ~21k max_tokens; one page fits easily.
      max_tokens: 16000,
      system: await systemPrompt(agent),
      tools: [...tools, { type: "web_search_20260209", name: "web_search", max_uses: WEB_SEARCHES[agent] }],
      messages: [{ role: "user", content: userMessage(opts.task?.trim() || defaultTask(agent), opts.requestedBy ?? null) }],
      output_config: { effort: EFFORT[agent] },
      max_iterations: 40,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    });

    let last: BetaMessage | null = null;
    let stopped: string | null = null;
    for await (const message of runner) {
      totals = addUsage(totals, message.usage);
      last = message;
      if (message.stop_reason === "refusal") {
        stopped = "Claude declined to continue this run.";
        break;
      }
      if (message.stop_reason === "max_tokens" && message.content.some((b) => b.type === "tool_use")) {
        stopped = "The run hit its output limit mid-step and stopped.";
        break;
      }
      if (costUsd(totals) > RUN_CAP_USD) {
        stopped = `Stopped at the per-run cost cap of $${RUN_CAP_USD}.`;
        break;
      }
      if (message.stop_reason === "pause_turn") runner.pushMessages({ role: "assistant", content: message.content });
    }

    const text = textOf(last);
    const unit = { content: "post", seo: "page", strategy: "calendar idea" }[agent];
    const done = agent === "strategy" && ctx.drafts === 0 ? "" : `${ctx.drafts} ${unit}${ctx.drafts === 1 ? "" : "s"} ${agent === "strategy" ? "added" : "drafted"}. `;
    if (stopped) return finish(runId, ctx.drafts > 0 ? "succeeded" : "failed", `${stopped} ${done}${text}`.trim(), totals);
    return finish(runId, "succeeded", `${done}${text}`.trim() || "Finished without a summary.", totals);
  } catch (e) {
    return finish(runId, "failed", describeError(e), totals);
  }
}

/** A run of this agent that is still going, if any. Runs older than an hour count as dead. */
export async function activeRun(agent: AgentName): Promise<string | null> {
  const [row] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.agent, agent), inArray(agentRuns.status, ["queued", "running"]), gt(agentRuns.startedAt, new Date(Date.now() - 3_600_000))))
    .limit(1);
  return row?.id ?? null;
}

/** Marks Strategy and Content runs left queued or running by a restart as failed. The worker calls this on start. */
export async function failStaleRuns(): Promise<number> {
  const rows = await db
    .update(agentRuns)
    .set({ status: "failed", summary: "Stopped: the service restarted during the run.", finishedAt: new Date() })
    .where(and(inArray(agentRuns.agent, AGENT_NAMES), inArray(agentRuns.status, ["queued", "running"])))
    .returning({ id: agentRuns.id });
  return rows.length;
}
