import { eq } from "drizzle-orm";
import { connections, db } from "@bodh/db";
import { requireModule } from "@/lib/auth";
import { Card, PageHeader, btn, inputClass } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask the agents" };

const EXAMPLES = [
  "Why did cost per activated user rise this week?",
  "Which reel hooks worked best last month?",
  "Draft 5 Shorts ideas about Jupiter's aspects",
  "Run an SEO audit on the free Kundli page",
];

export default async function ChatPage() {
  await requireModule("chat");
  const [anthropic] = await db.select().from(connections).where(eq(connections.key, "anthropic"));
  const ready = anthropic?.status === "connected";

  return (
    <>
      <PageHeader
        title="Ask the agents"
        description="Ask about results, or run any agent skill on demand. Answers use the same data and guardrails as scheduled runs."
      />
      <Card className="flex min-h-[420px] flex-col">
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <p className="font-display text-lg font-semibold">
            {ready ? "Ask anything about BODH's marketing" : "Chat turns on when the agent service is live"}
          </p>
          <p className="mt-1 max-w-md text-sm text-muted">
            {ready
              ? "The agent service is built in Phase 4. Questions typed here will be answered once it is deployed."
              : "Add the Anthropic API key in Connections. The agent service that answers here ships in Phase 4."}
          </p>
          <div className="mt-6 flex max-w-xl flex-wrap justify-center gap-2">
            {EXAMPLES.map((e) => (
              <span key={e} className="rounded-full bg-paper px-3 py-1.5 text-sm text-muted ring-1 ring-rule">{e}</span>
            ))}
          </div>
        </div>
        <form className="flex gap-2 border-t border-rule p-4">
          <label htmlFor="ask" className="sr-only">Your question</label>
          <input id="ask" className={inputClass} placeholder="Ask a question or name a skill to run" disabled />
          <button className={btn.primary} disabled>Ask</button>
        </form>
      </Card>
    </>
  );
}
