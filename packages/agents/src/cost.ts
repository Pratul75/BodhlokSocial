import { sql } from "drizzle-orm";
import { db } from "@bodh/db";

/** Claude Opus 5.5 list prices, USD per million tokens, and web search per 1,000 searches. */
export const PRICES = {
  input: 4,
  output: 20,
  cacheWrite: 5, // 1.25x input, 5-minute cache
  cacheRead: 0.2,
  webSearchPer1k: 10,
};

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
}

export const emptyTotals = (): RunTotals => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 });

export function addUsage(t: RunTotals, u: Usage): RunTotals {
  return {
    inputTokens: t.inputTokens + (u.input_tokens ?? 0),
    outputTokens: t.outputTokens + (u.output_tokens ?? 0),
    cacheReadTokens: t.cacheReadTokens + (u.cache_read_input_tokens ?? 0),
    cacheWriteTokens: t.cacheWriteTokens + (u.cache_creation_input_tokens ?? 0),
    webSearches: t.webSearches + (u.server_tool_use?.web_search_requests ?? 0),
  };
}

export function costUsd(t: RunTotals): number {
  const m = 1_000_000;
  return (
    (t.inputTokens * PRICES.input) / m +
    (t.outputTokens * PRICES.output) / m +
    (t.cacheWriteTokens * PRICES.cacheWrite) / m +
    (t.cacheReadTokens * PRICES.cacheRead) / m +
    (t.webSearches * PRICES.webSearchPer1k) / 1000
  );
}

/** Team-wide monthly AI budget for agents and chat, in USD. */
export const MONTHLY_BUDGET_USD = Number(process.env.AI_MONTHLY_BUDGET_USD ?? 150);

export async function spentThisMonthUsd(): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT coalesce(sum(cost_usd), 0)::float AS usd FROM agent_runs
    WHERE started_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`)) as unknown as { usd: number }[];
  return rows[0]?.usd ?? 0;
}
