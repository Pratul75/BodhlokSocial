# Agents

The Strategy and Content agents and the "Ask the agents" chat live in `packages/agents`. They call the Claude API directly (TypeScript SDK, tool runner) with `claude-opus-5-5`; set `AGENT_MODEL` to change it.

## What each one does

| | Runs | Can read | Can write |
|---|---|---|---|
| Strategy | 25th of each month, 09:00 IST, or **Run Strategy agent** on Strategy | funnel, ads, calendar, recent posts, brand kit, plans, keywords, web search | a **draft** plan for this month or next. An approved plan is never replaced. |
| Content | daily 06:00 IST, or **Draft next week** on Calendar | the same | **drafted** calendar posts, 12 hours to 21 days out, up to 21 per run; fills the Strategy agent's ideas in place |
| SEO | Monday 07:00 IST, or **Run SEO agent** on SEO & GEO | the same, plus the page catalog | page and blog drafts, sent to Approvals (up to 25 per run); tracked keywords |
| Chat | on each question | the same | nothing itself; it can start a Strategy, Content or SEO run for someone whose role can |

The Strategy agent also lays the month out as **idea** items on the calendar (date, channel, format, pillar). Every agent can read Google Trends and keyword ideas from DataForSEO when it's connected, the latest site audit and AI-visibility results.

Nothing an agent writes goes out by itself. Drafted posts still need media, a person to send them for approval, and an approver. Captions go through the same checks as approvals (ad-claim rules, the brand kit's banned phrases), and a blocked caption goes back to Claude to rewrite. Posts the agent flags, and posts a person ticks, show "Needs Jyotish review" in Approvals.

## Skills

`packages/agents/skills/*.md` hold BODH's house rules: brand voice, Jyotish accuracy, formats and timing, funnel metrics. They go in the system prompt in full (cached). After editing one, run

```bash
pnpm --filter @bodh/agents skills
```

to refresh `src/skills.generated.ts` (a test fails if you forget).

The other skills from the build plan (section 7) are installed on the server, not committed: `scripts/skills.txt` lists them (the local humanizer, brand and LinkedIn skills, and the SEO, blog, GEO, marketing and social-media skills from GitHub). `scripts/sync-skills.sh` copies only their markdown into `.skills/`, and `deploy-vm.sh` uploads that to `SKILLS_DIR` on the VM. Agents see each one's name and description and read the full text with the `read_skill` tool when a task calls for it, so they don't inflate every request. Review what changed after a sync: these files become part of the agents' instructions.

Left out on purpose: last30days and scrapling (they run local scripts and browsers the server agents don't have; web search and DataForSEO Trends cover the research), and hallmark, banner-design, slides and diagram-design (visual tools for the Creative studio, not text agents).

## Key, costs and limits

- The Anthropic API key goes in **Connections → Anthropic API** (or `ANTHROPIC_API_KEY` in the environment).
- `AI_MONTHLY_BUDGET_USD` (default 150): once agent and chat runs this month (India time) have cost this much, new runs refuse to start.
- `AI_RUN_CAP_USD` (default 6): a single run stops when it passes this.
- Every run is an `agent_runs` row with tokens and cost; the last run shows under each Run button.
- Requests opt into server-side fallbacks (`fallbacks: "default"`), so Anthropic can retry on another model if Opus 5.5 is overloaded.

## Where runs happen

On the VM, the web app asks the worker (`WORKER_URL`) to start a run and the worker runs it in the background, so a page reload doesn't stop it. A worker restart (such as a deploy) marks unfinished runs as failed. Without `WORKER_URL` (local development) the web app runs it in its own process.
