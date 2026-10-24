import Link from "next/link";
import { eq } from "drizzle-orm";
import { connections, db } from "@bodh/db";
import { requireModule } from "@/lib/auth";
import { ChatPanel } from "@/components/chat-panel";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask the agents" };

const EXAMPLES = [
  "How did cost per activated user change this week?",
  "Which ads brought the most activations in the last 28 days?",
  "What's on the calendar for the next 7 days?",
  "Which keywords are we close to page one for?",
];

export default async function ChatPage() {
  await requireModule("chat");
  const [anthropic] = await db.select().from(connections).where(eq(connections.key, "anthropic"));
  const ready = anthropic?.status === "connected" || Boolean(process.env.ANTHROPIC_API_KEY);

  return (
    <>
      <PageHeader title="Ask the agents" description="Ask about results, ads, the calendar, SEO or the plan, have it draft hooks and captions, or ask it to run an agent. Answers use the same data as the scheduled agents." />
      <Card>
        {ready ? (
          <ChatPanel examples={EXAMPLES} />
        ) : (
          <EmptyState title="Chat needs the Anthropic API key">
            An admin adds it in <Link href="/connections" className="underline">Connections</Link> under Anthropic API.
          </EmptyState>
        )}
      </Card>
    </>
  );
}
