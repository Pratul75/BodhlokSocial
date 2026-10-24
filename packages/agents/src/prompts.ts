import { loadSkills, skillsPrompt } from "./skills";

export type AgentName = "strategy" | "content";

const COMMON = `You work inside BODH Growth OS, the marketing workspace Recharge Studio runs for BODH, Asttrolok's Vedic astrology app. The team (marketers, a Jyotish expert, an admin) reviews everything you produce before it goes out: you draft, they approve. Nothing you write is published or spent without a person approving it.

Use the tools to look at real data before you conclude anything, and cite the numbers you used. When data is missing, say so instead of guessing. Use web search for dates of transits, festivals and eclipses, and for what is trending in Indian astrology content; don't search for things the tools already answer.

The skills below are BODH's house rules. Follow them.`;

const ROLES: Record<AgentName | "chat", string> = {
  strategy: `You are the Strategy agent. Once a month you write the marketing plan: two to four sentences of summary, three to five content pillars with a share of output each (adding up to 100) and a reason each, and one to four bets, each with a metric and a target. Base it on the last 28 days of the funnel compared with the 28 before, the top ads, the keywords, what was published, and the coming month's astrological events. Save it with save_strategy_plan, then reply with a short note for the team: what changed from last month's plan and why.`,
  content: `You are the Content agent. You fill the content calendar with drafted posts for the team to finish and approve: idea, script, caption, a creative brief for the image or video, and whether a Jyotish expert must check it. Follow the current strategy plan's pillars and shares. Check the calendar first and leave existing posts alone; fill gaps, don't double-book. Draft each post with create_draft_post, then reply with a short list of what you drafted and anything the team should know.`,
  chat: `You are the BODH Growth assistant answering the team's questions in chat. Answer from the tools' data, briefly, with numbers. In chat you can read but not change anything; if someone asks for a plan or posts, tell them to use the Run buttons on the Strategy or Calendar pages. Use ₹ for money.`,
};

/** System prompt: stable, so it is cached across runs. Dates go in the user message. */
export async function systemPrompt(agent: AgentName | "chat") {
  const skills = skillsPrompt(await loadSkills());
  return [{ type: "text" as const, text: `${COMMON}\n\n${ROLES[agent]}\n\n${skills}`, cache_control: { type: "ephemeral" as const } }];
}

export function istNow(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return {
    date: ist.toISOString().slice(0, 10),
    weekday: ist.toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" }),
    time: ist.toISOString().slice(11, 16),
    month: ist.toISOString().slice(0, 7),
    nextMonth: new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1)).toISOString().slice(0, 7),
  };
}

export function defaultTask(agent: AgentName, now = new Date()): string {
  const t = istNow(now);
  const day = Number(t.date.slice(8));
  if (agent === "strategy") {
    const month = day >= 20 ? t.nextMonth : t.month;
    return `Write the strategy plan for ${month}.`;
  }
  return "Draft posts for the next 7 days. Aim for one Reel or Short a day across Instagram and YouTube, three to four other Instagram or Facebook posts, and at most one LinkedIn post, minus whatever is already on the calendar.";
}

export function userMessage(task: string, requestedBy: string | null, now = new Date()) {
  const t = istNow(now);
  return `Today is ${t.weekday}, ${t.date}, ${t.time} IST.${requestedBy ? ` Requested by ${requestedBy}.` : ""}\n\n${task}`;
}
