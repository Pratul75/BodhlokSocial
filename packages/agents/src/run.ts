import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { and, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { agentRuns, auditLog, db, type RunStep } from "@bodh/db";
import { anthropicClient, FALLBACK_BETA, MODEL } from "./client";
import { addUsage, costUsd, emptyTotals, reserveBudget, type RunTotals } from "./cost";
import { defaultTask, systemPrompt, userMessage, type AgentName } from "./prompts";
import { adsTools, contentTools, readTools, seoTools, strategyTools, type ToolContext } from "./tools";
import { analystTools, communityTools, mentionsTools } from "./tools-growth";

export const AGENT_NAMES: AgentName[] = ["strategy", "content", "seo", "ads", "community", "mentions", "analyst"];
export const isAgentName = (a: string): a is AgentName => (AGENT_NAMES as string[]).includes(a);

/** One run may not spend more than this, whatever the monthly budget says. */
export const RUN_CAP_USD = Number(process.env.AI_RUN_CAP_USD ?? 6);
const EFFORT = { strategy: "high", content: "medium", seo: "medium", ads: "high", community: "medium", mentions: "medium", analyst: "high" } as const;
const WEB_SEARCHES = { strategy: 8, content: 4, seo: 6, ads: 2, community: 6, mentions: 10, analyst: 2 } as const;
const TOOLS = { strategy: strategyTools, content: contentTools, seo: seoTools, ads: adsTools, community: communityTools, mentions: mentionsTools, analyst: analystTools } as const;

export interface RunOptions {
  trigger: "manual" | "schedule";
  task?: string;
  requestedBy?: string | null;
  /** A re-plan a person asked for: the month's approved plan and upcoming agent work may be replaced. */
  replan?: boolean;
  client?: Anthropic; // tests pass a client with a mocked fetch
}

const MAX_STEPS = 200;
const STEP_CHARS = 400;

/** Short labels for the step log; tools not listed show their name. */
const STEP_LABELS: Record<string, string> = {
  get_funnel: "Read the funnel",
  get_top_ads: "Read ad results",
  get_calendar: "Read the calendar",
  get_recent_posts: "Read recent posts",
  get_brand_kit: "Read the brand kit and positioning brief",
  get_strategy_plan: "Read the strategy plan",
  get_keywords: "Read the tracked keywords",
  read_skill: "Read a skill",
  get_search_trends: "Checked Google Trends",
  get_keyword_ideas: "Looked up keyword ideas",
  get_site_audit: "Read the site audit",
  get_ai_visibility: "Read the AI-visibility results",
  list_pages_to_write: "Listed pages to write",
  track_keywords: "Added keywords to tracking",
  get_ads_overview: "Read the ads overview",
  get_ab_tests: "Read the A/B tests",
};

/** One line about a tool call's input, for the step log: the few fields a person would ask about. */
function describeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ["name", "file", "days", "month", "terms", "keyword", "keywords", "search", "template", "url", "ad_id", "campaign_id", "query"]) {
    const v = o[k];
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${k}: ${Array.isArray(v) ? v.slice(0, 5).join(", ") : String(v).slice(0, 80)}`);
  }
  return parts.join("; ");
}

/** The step log of one run, appended to the run row as the agent works, so the team can read along. */
function stepLogger(runId: string) {
  const steps: RunStep[] = [];
  let writing: Promise<void> = Promise.resolve();
  return async (kind: RunStep["kind"], text: string) => {
    if (steps.length >= MAX_STEPS) return;
    steps.push({ at: new Date().toISOString(), kind, text: text.replace(/\s+/g, " ").trim().slice(0, STEP_CHARS) });
    const snapshot = [...steps];
    writing = writing.then(() => db.update(agentRuns).set({ steps: snapshot }).where(eq(agentRuns.id, runId)).then(() => undefined)).catch(() => undefined);
    await writing;
  };
}

/** Wraps every tool so each call lands in the step log: write tools log their own result, the rest log the call. */
function logged<T extends { name: string; run: (input: never) => unknown }>(tools: T[], log: (kind: RunStep["kind"], text: string) => Promise<void>): T[] {
  return tools.map((t) => ({
    ...t,
    run: async (input: never) => {
      const label = STEP_LABELS[t.name];
      if (label) {
        const detail = describeInput(input);
        await log("tool", detail ? `${label} (${detail})` : label);
      }
      const out = await t.run(input);
      if (typeof out === "string" && out.startsWith("Error:")) await log("note", `${t.name}: ${out}`);
      return out;
    },
  }));
}

export interface RunResult {
  runId: string;
  status: "succeeded" | "failed";
  summary: string;
  costUsd: number;
}

/** A run that has been queued or running for longer than this is treated as dead. */
export const STALE_AFTER_MS = 3_600_000;

/**
 * Creates the run row so callers can return its id before the run finishes. A partial unique
 * index (agent_runs_one_active_idx) allows one queued or running row per agent, so two callers
 * racing to start the same agent get one run between them: the loser receives the winner's id
 * with created=false.
 */
export async function queueRun(agent: string, trigger: RunOptions["trigger"]): Promise<{ id: string; created: boolean }> {
  // A row left behind by a crash would block the agent forever; expire it first.
  await db
    .update(agentRuns)
    .set({ status: "failed", summary: "Stopped: the run stopped responding.", finishedAt: new Date() })
    .where(
      and(eq(agentRuns.agent, agent), inArray(agentRuns.status, ["queued", "running"]), lt(agentRuns.startedAt, new Date(Date.now() - STALE_AFTER_MS))),
    );
  const [row] = await db.insert(agentRuns).values({ agent, trigger, status: "queued" }).onConflictDoNothing().returning({ id: agentRuns.id });
  if (row) return { id: row.id, created: true };
  const existing = await activeRun(agent);
  if (!existing) throw new Error(`Could not queue a ${agent} run.`);
  return { id: existing, created: false };
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

/** Runs an agent to completion and records the result on the run row. */
export async function runAgent(agent: AgentName, opts: RunOptions, existingRunId?: string): Promise<RunResult> {
  let runId = existingRunId;
  if (!runId) {
    const queued = await queueRun(agent, opts.trigger);
    if (!queued.created) return { runId: queued.id, status: "failed", summary: `The ${agent} agent is already running.`, costUsd: 0 };
    runId = queued.id;
  }
  let totals = emptyTotals();

  const client = opts.client ?? (await anthropicClient());
  if (!client) return finish(runId, "failed", "No Anthropic API key. An admin can add one in Connections → Claude.", totals);

  // Reserve this run's cap against the monthly budget before spending anything.
  const budget = await reserveBudget(runId, RUN_CAP_USD);
  if (!budget.ok) return finish(runId, "failed", budget.reason, totals);
  const capUsd = budget.capUsd;

  const task = opts.task?.trim() || defaultTask(agent);
  await db.update(agentRuns).set({ status: "running", startedAt: new Date(), task }).where(eq(agentRuns.id, runId));
  await db.insert(auditLog).values({ actor: `${agent} agent`, actorType: "agent", action: "run", target: agent, reason: opts.requestedBy ? `requested by ${opts.requestedBy}` : opts.trigger, result: "started" });

  const log = stepLogger(runId);
  const ctx: ToolContext = { agent, runId, drafts: 0, replan: opts.replan, log };
  const tools = logged([...readTools(ctx), ...TOOLS[agent](ctx)], log);

  try {
    const runner = client.beta.messages.toolRunner({
      model: MODEL,
      // Non-streaming requests must stay under ~21k max_tokens. Drafts are long, so the
      // agents are told to make one write call per turn; this leaves room for the biggest.
      max_tokens: 20000,
      system: await systemPrompt(agent),
      tools: [...tools, { type: "web_search_20260209", name: "web_search", max_uses: WEB_SEARCHES[agent] }],
      messages: [{ role: "user", content: userMessage(task, opts.requestedBy ?? null) }],
      output_config: { effort: EFFORT[agent] },
      max_iterations: 40,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    });

    let last: BetaMessage | null = null;
    let stopped: string | null = null;
    for await (const message of runner) {
      totals = addUsage(totals, message.usage, message.model);
      last = message;
      // What the agent said between tool calls, and the web searches it ran, so the team can follow its reasoning.
      for (const b of message.content) {
        if (b.type === "text" && b.text.trim()) await log("said", b.text);
        else if (b.type === "server_tool_use" && b.name === "web_search") await log("search", `Searched the web: ${String((b.input as { query?: unknown })?.query ?? "")}`);
      }
      if (message.stop_reason === "refusal") {
        stopped = "Claude declined to continue this run.";
        break;
      }
      if (message.stop_reason === "max_tokens" && message.content.some((b) => b.type === "tool_use")) {
        stopped = "The run hit its output limit mid-step and stopped.";
        break;
      }
      if (costUsd(totals) > capUsd) {
        stopped =
          capUsd < RUN_CAP_USD
            ? `Stopped: this month's AI budget ran out ($${capUsd.toFixed(2)} was left for this run).`
            : `Stopped at the per-run cost cap of $${RUN_CAP_USD}.`;
        break;
      }
      if (message.stop_reason === "pause_turn") runner.pushMessages({ role: "assistant", content: message.content });
    }

    const text = textOf(last);
    const unit = { content: "post", seo: "page", strategy: "calendar idea", ads: "change", community: "answer", mentions: "listing", analyst: "report" }[agent];
    const verb = { content: "drafted", seo: "drafted", strategy: "added", ads: "requested", community: "drafted", mentions: "drafted", analyst: "saved" }[agent];
    const done = (agent === "strategy" || agent === "ads") && ctx.drafts === 0 ? "" : `${ctx.drafts} ${unit}${ctx.drafts === 1 ? "" : "s"} ${verb}. `;
    if (stopped) return finish(runId, ctx.drafts > 0 ? "succeeded" : "failed", `${stopped} ${done}${text}`.trim(), totals);
    return finish(runId, "succeeded", `${done}${text}`.trim() || "Finished without a summary.", totals);
  } catch (e) {
    return finish(runId, "failed", describeError(e), totals);
  }
}

/** A run of this agent that is still going, if any. Runs older than an hour count as dead. */
export async function activeRun(agent: string): Promise<string | null> {
  const [row] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.agent, agent), inArray(agentRuns.status, ["queued", "running"]), gt(agentRuns.startedAt, new Date(Date.now() - STALE_AFTER_MS))))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Marks every run left queued or running by a restart as failed, whatever the agent (chat and
 * AI-visibility runs included). The worker calls this on start.
 */
export async function failStaleRuns(exceptAgent?: string): Promise<number> {
  const rows = await db
    .update(agentRuns)
    .set({ status: "failed", summary: "Stopped: the service restarted during the run.", finishedAt: new Date() })
    .where(and(inArray(agentRuns.status, ["queued", "running"]), exceptAgent ? ne(agentRuns.agent, exceptAgent) : undefined))
    .returning({ id: agentRuns.id });
  return rows.length;
}
