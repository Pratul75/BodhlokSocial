import Anthropic from "@anthropic-ai/sdk";
import { secretName, secretStore } from "@bodh/integrations/secrets";

export const MODEL = process.env.AGENT_MODEL ?? "claude-opus-5-5";

/** Server-side refusal fallback: Claude retries a declined request on its recommended fallback model. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * The Anthropic key comes from Connections (the secrets store), or ANTHROPIC_API_KEY
 * for local development. Returns null when neither is set.
 */
/** Checks a pasted Anthropic key with the cheapest read there is (list one model). */
export async function checkAnthropicKey(apiKey: string): Promise<{ ok: true; label: string } | { ok: false; error: string }> {
  try {
    const page = await new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 }).models.list({ limit: 1 });
    return { ok: true, label: `Key accepted (${page.data[0]?.id ?? "models listed"})` };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: "Anthropic rejected this key." };
    if (e instanceof Anthropic.PermissionDeniedError) return { ok: false, error: "This key isn't allowed to call the API." };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `Anthropic API error ${e.status ?? ""}: ${e.message}`.slice(0, 300) };
    return { ok: false, error: `Couldn't reach Anthropic: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * The Claude client for the workspace this is running for.
 *
 * A workspace that has connected its own key is billed for its own usage. Otherwise the
 * platform's key is used, deliberately: this is the platform paying, and what stops one
 * workspace spending another's share is that the monthly budget and the per-run cap are both
 * that workspace's own (see `monthlyBudgetUsd`). Set ANTHROPIC_KEY_PER_TENANT=true to refuse
 * the platform key instead, so every workspace must bring its own.
 */
export async function anthropicClient(): Promise<Anthropic | null> {
  const stored = (await (await secretStore()).get(secretName("anthropic")))?.trim();
  const platformKey = process.env.ANTHROPIC_KEY_PER_TENANT === "true" ? undefined : process.env.ANTHROPIC_API_KEY;
  const apiKey = stored || platformKey;
  if (!apiKey) return null;
  return new Anthropic({ apiKey, maxRetries: 3 });
}
