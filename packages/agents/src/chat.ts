import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { eq } from "drizzle-orm";
import { agentRuns, db } from "@bodh/db";
import { anthropicClient, FALLBACK_BETA, MODEL } from "./client";
import { addUsage, costUsd, emptyTotals, MONTHLY_BUDGET_USD, spentThisMonthUsd } from "./cost";
import { systemPrompt, userMessage } from "./prompts";
import { readTools } from "./tools";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | { type: "done"; runId: string; costUsd: number }
  | { type: "error"; message: string };

const TOOL_LABELS: Record<string, string> = {
  get_funnel: "Reading the funnel",
  get_top_ads: "Reading ad results",
  get_calendar: "Reading the calendar",
  get_recent_posts: "Reading recent posts",
  get_brand_kit: "Reading the brand kit",
  get_strategy_plan: "Reading the strategy plan",
  get_keywords: "Reading keywords",
  web_search: "Searching the web",
};
export const toolLabel = (name: string) => TOOL_LABELS[name] ?? name;

const MAX_TURNS = 20;

/** Answers one chat message, streaming text and tool activity as it happens. Read-only tools. */
export async function* chat(history: ChatTurn[], userEmail: string, client?: Anthropic): AsyncGenerator<ChatEvent> {
  const turns = history.filter((t) => t.text.trim()).slice(-MAX_TURNS);
  if (turns.at(-1)?.role !== "user") return yield { type: "error", message: "Nothing to answer." };

  const anthropic = client ?? (await anthropicClient());
  if (!anthropic) return yield { type: "error", message: "No Anthropic API key yet. An admin can add one in Connections → Claude." };
  if ((await spentThisMonthUsd()) >= MONTHLY_BUDGET_USD) return yield { type: "error", message: `This month's AI budget ($${MONTHLY_BUDGET_USD}) is used up.` };

  const [run] = await db.insert(agentRuns).values({ agent: "chat", trigger: "chat", status: "running", summary: turns.at(-1)!.text.slice(0, 300) }).returning({ id: agentRuns.id });
  const runId = run!.id;
  const tools = readTools({ agent: "chat", runId, drafts: 0 }).map((t) => ({ ...t, eager_input_streaming: true }));
  const messages: BetaMessageParam[] = turns.map((t, i) => ({
    role: t.role,
    content: i === turns.length - 1 ? userMessage(t.text, userEmail) : t.text,
  }));

  let totals = emptyTotals();
  let status: "succeeded" | "failed" = "succeeded";
  try {
    const runner = anthropic.beta.messages.toolRunner({
      model: MODEL,
      max_tokens: 8000,
      system: await systemPrompt("chat"),
      tools: [...tools, { type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      messages,
      output_config: { effort: "low" },
      max_iterations: 12,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      stream: true,
    });
    for await (const stream of runner) {
      for await (const event of stream) {
        if (event.type === "content_block_start" && (event.content_block.type === "tool_use" || event.content_block.type === "server_tool_use")) {
          yield { type: "tool", name: toolLabel(event.content_block.name) };
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        }
      }
      const message: BetaMessage = await stream.finalMessage();
      totals = addUsage(totals, message.usage);
      if (message.stop_reason === "refusal") {
        yield { type: "text", text: "\n\nI can't help with that one." };
        break;
      }
      if (message.stop_reason === "max_tokens" && message.content.some((b) => b.type === "tool_use")) break;
      if (message.stop_reason === "pause_turn") runner.pushMessages({ role: "assistant", content: message.content });
    }
  } catch (e) {
    status = "failed";
    yield { type: "error", message: e instanceof Anthropic.APIError ? `Claude API error ${e.status ?? ""}: ${e.message}`.slice(0, 300) : "Something went wrong answering that." };
  }
  const usd = costUsd(totals);
  await db
    .update(agentRuns)
    .set({ status, tokensIn: totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens, tokensOut: totals.outputTokens, costUsd: usd.toFixed(4), finishedAt: new Date() })
    .where(eq(agentRuns.id, runId));
  yield { type: "done", runId, costUsd: usd };
}
