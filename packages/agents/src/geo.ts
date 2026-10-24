/**
 * AI visibility: each week, ask ChatGPT, Gemini, Perplexity and Claude the questions BODH's
 * customers ask, with web search on, and record whether the answer mentions Bodhlok (or Asttrolok)
 * and which other astrology brands it names. Engines without a key are skipped.
 */
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { aiVisibilityChecks, db, geoQuestions } from "@bodh/db";
import { readJsonSecret, secretName, secretStore } from "@bodh/integrations/secrets";
import { vertexAuth, type ServiceAccountKey } from "@bodh/integrations/vertex";
import { anthropicClient, MODEL } from "./client";

export const DEFAULT_QUESTIONS = [
  "What is the best Vedic astrology software for professional astrologers?",
  "Which online kundli software supports KP astrology?",
  "Is there browser-based Jyotish software with Hindi support?",
  "What software do astrologers use for dasha and transit analysis?",
  "What is the best astrology software for students learning Vedic astrology?",
  "Which Vedic astrology software has an AI assistant?",
  "What are good online alternatives to Jagannatha Hora?",
  "Which software helps an astrologer keep client charts and consultation notes?",
];

export const ENGINES = ["chatgpt", "gemini", "perplexity", "claude"] as const;
export type Engine = (typeof ENGINES)[number];
export const ENGINE_LABELS: Record<Engine, string> = { chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity", claude: "Claude" };

const BRAND = /\basttrolok\b|\bbodhlok\b|\bbodh\s+(app|astrology|by\s+asttrolok)\b/i;
export const COMPETITORS = ["Jagannatha Hora", "Parashara's Light", "LeoStar", "Astro-Vision", "Kala", "Junior Jyotish", "Shri Jyoti Star", "AstroSage", "Kundli Pro", "Astrotalk", "Clickastro", "Drik Panchang", "Vedic Rishi", "Kundli GPT"];

export function analyse(answer: string): { mentioned: boolean; competitors: string[] } {
  const squash = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "");
  const flat = squash(answer);
  return { mentioned: BRAND.test(answer), competitors: COMPETITORS.filter((c) => flat.includes(squash(c))) };
}

export interface EngineAnswer {
  answer: string;
  citations: string[];
}

const PROMPT = (q: string) => `${q}\n\nAnswer as you would for someone in India, naming specific software, apps or sites where relevant.`;

async function apiKey(key: string): Promise<string | null> {
  return ((await (await secretStore()).get(secretName(key))) ?? "").trim() || null;
}

async function askOpenAi(q: string): Promise<EngineAnswer | null> {
  const key = (await apiKey("openai")) ?? process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL ?? "gpt-5.5", tools: [{ type: "web_search" }], input: PROMPT(q) }),
    signal: AbortSignal.timeout(120_000),
  });
  const json = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    output?: { type: string; content?: { type: string; text?: string; annotations?: { url?: string }[] }[] }[];
  } | null;
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${json?.error?.message ?? ""}`.trim());
  const parts = (json?.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []);
  return {
    answer: parts.map((p) => p.text ?? "").join("\n").trim(),
    citations: [...new Set(parts.flatMap((p) => p.annotations ?? []).map((a) => a.url).filter((u): u is string => !!u))],
  };
}

async function askPerplexity(q: string): Promise<EngineAnswer | null> {
  const key = (await apiKey("perplexity")) ?? process.env.PERPLEXITY_API_KEY;
  if (!key) return null;
  const res = await fetch("https://api.perplexity.ai/v1/sonar", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.PERPLEXITY_MODEL ?? "sonar", messages: [{ role: "user", content: PROMPT(q) }] }),
    signal: AbortSignal.timeout(120_000),
  });
  const json = (await res.json().catch(() => null)) as { error?: { message?: string }; choices?: { message?: { content?: string } }[]; citations?: string[] } | null;
  if (!res.ok) throw new Error(`Perplexity ${res.status}: ${json?.error?.message ?? ""}`.trim());
  return { answer: json?.choices?.[0]?.message?.content?.trim() ?? "", citations: json?.citations ?? [] };
}

async function askGemini(q: string): Promise<EngineAnswer | null> {
  const sa = await readJsonSecret<ServiceAccountKey>("vertex");
  if (!sa && process.env.VERTEX_USE_ADC !== "true") return null;
  const auth = await vertexAuth(sa);
  const model = process.env.GEO_GEMINI_MODEL ?? "gemini-3.8-flash";
  const url = `https://aiplatform.googleapis.com/v1/projects/${auth.projectId}/locations/global/publishers/google/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: PROMPT(q) }] }], tools: [{ googleSearch: {} }] }),
    signal: AbortSignal.timeout(120_000),
  });
  const json = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string } }[] } }[];
  } | null;
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${json?.error?.message ?? ""}`.trim());
  const c = json?.candidates?.[0];
  return {
    answer: (c?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim(),
    citations: (c?.groundingMetadata?.groundingChunks ?? []).map((g) => g.web?.uri).filter((u): u is string => !!u),
  };
}

async function askClaude(q: string, client?: Anthropic): Promise<EngineAnswer | null> {
  const anthropic = client ?? (await anthropicClient());
  if (!anthropic) return null;
  const msg = await anthropic.messages.create({
    model: process.env.GEO_CLAUDE_MODEL ?? MODEL,
    max_tokens: 2000,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
    messages: [{ role: "user", content: PROMPT(q) }],
    output_config: { effort: "low" },
  });
  const text = msg.content.filter((b) => b.type === "text");
  return {
    answer: text.map((b) => b.text).join("").trim(),
    citations: [...new Set(text.flatMap((b) => b.citations ?? []).map((c) => ("url" in c ? c.url : null)).filter((u): u is string => !!u))],
  };
}

const ASK: Record<Engine, (q: string) => Promise<EngineAnswer | null>> = { chatgpt: askOpenAi, gemini: askGemini, perplexity: askPerplexity, claude: (q) => askClaude(q) };

export async function ensureGeoQuestions(): Promise<void> {
  const [any] = await db.select({ id: geoQuestions.id }).from(geoQuestions).limit(1);
  if (!any) await db.insert(geoQuestions).values(DEFAULT_QUESTIONS.map((question) => ({ question }))).onConflictDoNothing();
}

/** Runs this week's checks. One row per question and engine; a failed call is stored with its error. */
export async function runVisibilityChecks(engines: readonly Engine[] = ENGINES, ask = ASK): Promise<string> {
  await ensureGeoQuestions();
  const questions = await db.select().from(geoQuestions).where(eq(geoQuestions.active, true));
  const day = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  await db.delete(aiVisibilityChecks).where(eq(aiVisibilityChecks.checkedAt, day)); // a rerun replaces today's
  const used = new Set<Engine>();
  const skipped = new Set<Engine>();
  let mentions = 0;
  let total = 0;
  for (const engine of engines) {
    for (const q of questions) {
      try {
        const res = await ask[engine](q.question);
        if (!res) {
          skipped.add(engine);
          break;
        }
        const a = analyse(res.answer);
        used.add(engine);
        total++;
        if (a.mentioned) mentions++;
        await db.insert(aiVisibilityChecks).values({ question: q.question, engine, checkedAt: day, mentioned: a.mentioned, competitors: a.competitors, citations: res.citations.slice(0, 20), answer: res.answer.slice(0, 8000) });
      } catch (e) {
        await db.insert(aiVisibilityChecks).values({ question: q.question, engine, checkedAt: day, mentioned: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
      }
    }
  }
  const skip = skipped.size ? ` Skipped (no key): ${[...skipped].map((e) => ENGINE_LABELS[e]).join(", ")}.` : "";
  return `Asked ${questions.length} questions on ${[...used].map((e) => ENGINE_LABELS[e]).join(", ") || "no engines"}: Bodhlok mentioned in ${mentions} of ${total} answers.${skip}`;
}
