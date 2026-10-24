import Anthropic from "@anthropic-ai/sdk";
import { secretName, secretStore } from "@bodh/integrations/secrets";

export const MODEL = process.env.AGENT_MODEL ?? "claude-opus-5-5";

/** Server-side refusal fallback: Claude retries a declined request on its recommended fallback model. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * The Anthropic key comes from Connections (the secrets store), or ANTHROPIC_API_KEY
 * for local development. Returns null when neither is set.
 */
export async function anthropicClient(): Promise<Anthropic | null> {
  const stored = (await (await secretStore()).get(secretName("anthropic")))?.trim();
  const apiKey = stored || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey, maxRetries: 3 });
}
