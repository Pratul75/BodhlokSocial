import { z } from "zod";
import { log } from "@bodh/shared/log";
import { chat } from "@bodh/agents";
import { AGENT_MODULE, canAccess, type StartableAgent } from "@bodh/shared";
import { getCurrentUser } from "@/lib/auth";
import { startAgentRun } from "@/lib/agents";


export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) })).min(1).max(40),
});

/** Streams the answer as JSON lines: {type: "text" | "tool" | "done" | "error", ...}. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!canAccess(user.role, "chat")) return Response.json({ error: "No access" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });

  const encoder = new TextEncoder();
  // Chat can start the agents this person could start from their pages.
  const start = async (agent: StartableAgent, task: string | undefined) =>
    canAccess(user.role, AGENT_MODULE[agent]) ? startAgentRun(agent, user.email, task) : { error: "Your role can't run that agent." };
  const events = chat(parsed.data.messages, user.email, undefined, start);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) return controller.close();
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      } catch (e) {
        log.error("chat failed", e);
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message: "Something went wrong answering that." })}\n`));
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
