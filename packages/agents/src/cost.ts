import { sql } from "drizzle-orm";
import { db } from "@bodh/db";

/** USD per million tokens. Cache writes are the 5-minute TTL (1.25x input). */
export interface Price {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/**
 * Anthropic list prices (first-party API). A run's messages can come from more than one
 * model (server-side fallbacks, AGENT_MODEL overrides), so each message is priced by the
 * model that produced it.
 */
export const MODEL_PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  "claude-fable-5-1": { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 },
};

/** Web search, USD per 1,000 searches. */
export const WEB_SEARCH_PER_1K = 10;

/** Unknown models are priced as the most expensive known model, so the budget never under-counts. */
const FALLBACK_PRICE = MODEL_PRICES["claude-fable-5-1"]!;

/** Kept for callers that only need the default model's prices. */
export const PRICES = { ...MODEL_PRICES["claude-opus-5-5"]!, webSearchPer1k: WEB_SEARCH_PER_1K };

export function priceFor(model: string | null | undefined): Price {
  if (!model) return MODEL_PRICES["claude-opus-5-5"]!;
  if (MODEL_PRICES[model]) return MODEL_PRICES[model]!;
  // Longest known id the model string starts with, e.g. a dated or region-prefixed id.
  const key = Object.keys(MODEL_PRICES)
    .filter((k) => model.includes(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? MODEL_PRICES[key]! : FALLBACK_PRICE;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

export interface RunTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  /** Running cost, each message priced at its own model's rates. */
  usd: number;
}

export const emptyTotals = (): RunTotals => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, usd: 0 });

export function usageCost(u: Usage, model?: string | null): number {
  const p = priceFor(model);
  const m = 1_000_000;
  return (
    ((u.input_tokens ?? 0) * p.input) / m +
    ((u.output_tokens ?? 0) * p.output) / m +
    ((u.cache_creation_input_tokens ?? 0) * p.cacheWrite) / m +
    ((u.cache_read_input_tokens ?? 0) * p.cacheRead) / m +
    ((u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_PER_1K) / 1000
  );
}

export function addUsage(t: RunTotals, u: Usage, model?: string | null): RunTotals {
  return {
    inputTokens: t.inputTokens + (u.input_tokens ?? 0),
    outputTokens: t.outputTokens + (u.output_tokens ?? 0),
    cacheReadTokens: t.cacheReadTokens + (u.cache_read_input_tokens ?? 0),
    cacheWriteTokens: t.cacheWriteTokens + (u.cache_creation_input_tokens ?? 0),
    webSearches: t.webSearches + (u.server_tool_use?.web_search_requests ?? 0),
    usd: t.usd + usageCost(u, model),
  };
}

export function costUsd(t: RunTotals): number {
  return t.usd;
}

/** Team-wide monthly AI budget for agents, chat and AI-visibility checks, in USD. */
export const MONTHLY_BUDGET_USD = Number(process.env.AI_MONTHLY_BUDGET_USD ?? 150);

const MONTH_START = sql`date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`;

/**
 * Spend this IST month. Runs still going count at their reserved amount (cost_usd is set to
 * the reservation when they start and replaced by the real cost when they finish).
 */
export async function spentThisMonthUsd(): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT coalesce(sum(cost_usd), 0)::float AS usd FROM agent_runs WHERE started_at >= ${MONTH_START}`)) as unknown as { usd: number }[];
  return rows[0]?.usd ?? 0;
}

/**
 * Reserves `reserveUsd` of this month's budget for a run, atomically: an advisory lock makes
 * concurrent starts check one after another, so parallel runs cannot overshoot the budget.
 * The run's cap is the smaller of `reserveUsd` and what is left of the budget.
 */
export async function reserveBudget(
  runId: string,
  reserveUsd: number,
): Promise<{ ok: true; capUsd: number } | { ok: false; reason: string }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bodh_ai_budget'))`);
    const rows = (await tx.execute(sql`
      SELECT coalesce(sum(cost_usd), 0)::float AS usd FROM agent_runs
      WHERE started_at >= ${MONTH_START} AND id <> ${runId}`)) as unknown as { usd: number }[];
    const spent = rows[0]?.usd ?? 0;
    if (spent >= MONTHLY_BUDGET_USD) {
      return { ok: false as const, reason: `This month's AI budget ($${MONTHLY_BUDGET_USD}) is used up ($${spent.toFixed(2)} spent or reserved). Raise AI_MONTHLY_BUDGET_USD to run more.` };
    }
    const capUsd = Math.min(reserveUsd, MONTHLY_BUDGET_USD - spent);
    await tx.execute(sql`UPDATE agent_runs SET cost_usd = ${capUsd.toFixed(4)}, started_at = now() WHERE id = ${runId}`);
    return { ok: true as const, capUsd };
  });
}
