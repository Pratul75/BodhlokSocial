# Agents

Seven agents and the "Ask the agents" chat live in `packages/agents`. They call the Claude API directly (TypeScript SDK, tool runner) with `claude-opus-5-5`; set `AGENT_MODEL` to change it. Publishing and AI-visibility checks are scheduled jobs, not agents.

## What each one does

| | Runs | Can read | Can write |
|---|---|---|---|
| Strategy | 25th of each month, 09:00 IST, or **Run Strategy agent** on Strategy | funnel, ads, calendar, recent posts, brand kit, plans, keywords, web search | a **draft** plan for this month or next (one plan per month; an approved plan is never replaced) and up to 60 calendar ideas a run |
| Content | daily 06:00 IST, or **Draft next week** on Calendar | the same | **drafted** calendar posts, 12 hours to 21 days out, up to 21 per run; fills the Strategy agent's ideas in place |
| SEO | Monday 07:00 IST, or **Run SEO agent** on SEO & GEO | the same, plus the page catalog | page and blog drafts, sent to Approvals (up to 25 per run); tracked keywords |
| Ads | daily 07:30 IST, or **Run Ads agent** on Ads manager | the same, plus the ad accounts and A/B tests | changes through the guardrails only (see `docs/ads.md`), up to 20 a run; blocked requests don't count |
| Community | daily 08:00 IST, or **Run Community agent** on Community | the same, plus Reddit search and YouTube comments when connected | saved questions, and answers sent to Approvals (kind "reply", up to 8 per run) |
| Mentions | Tuesday 05:00 IST, or **Run Mentions agent** on Directory listings | the same, plus web search | tracked directories, and listings sent to Approvals (kind "listing", up to 6 per run) |
| Analyst | Monday 09:00 IST (weekly) and the 1st 09:30 IST (monthly), or **Write a report now** on Analytics | the same, plus what the team and agents did | one report per period, shown on Today and Analytics |
| Chat | on each question | the same | nothing itself; it can start any agent run for someone whose role can |

The Strategy agent also lays the month out as **idea** items on the calendar (date, channel, format, pillar). Every agent can read Google Trends and keyword ideas from DataForSEO when it's connected, the latest site audit and AI-visibility results.

Nothing an agent writes goes out by itself. Drafted posts still need media, a person to send them for approval, and an approver. Captions go through the same checks as approvals (ad-claim rules, the brand kit's banned phrases), and a blocked caption goes back to Claude to rewrite. Posts the agent flags, and posts a person ticks, show "Needs Jyotish review" in Approvals.

Community answers pass `packages/guardrails/src/community.ts` before they reach Approvals: an answer that names Bodhlok must say the writer works on it, it may never read like a customer testimonial, and the claim and positioning rules apply. Approving a Reddit or YouTube answer posts it from the connected team account; Quora answers wait for a person to post them and record the link on Community. Listings are submitted by hand after approval.

## Skills

`packages/agents/skills/*.md` hold BODH's house rules: brand voice, Jyotish accuracy, formats and timing, funnel metrics. They go in the system prompt in full (cached). After editing one, run

```bash
pnpm --filter @bodh/agents skills
```

to refresh `src/skills.generated.ts` (a test fails if you forget).

The other skills from the build plan (section 7) are installed on the server, not committed: `scripts/skills.txt` lists them. `scripts/sync-skills.sh` copies only their markdown into `.skills/`, and `deploy-vm.sh` uploads that to `SKILLS_DIR` on the VM (Cloud Run has no extra skills). Agents see each one's name and description and read the full text with the `read_skill` tool when a task calls for it. Review what changed after a sync: these files become part of the agents' instructions.

## Key, costs and limits

- The Anthropic API key goes in **Connections → Anthropic API** (or `ANTHROPIC_API_KEY` in the environment). Saving it lists one model first, so a wrong key is refused instead of shown as connected.
- `AI_MONTHLY_BUDGET_USD` (default 150) covers agents, chat and the Claude part of the AI-visibility checks, in India-time months.
- `AI_RUN_CAP_USD` (default 6): when a run starts it reserves this much of the monthly budget (or whatever is left), under a database lock, so runs started together can't overshoot the budget; the real cost replaces the reservation when it finishes. A run stops when it passes its reservation.
- Each message is priced at the rates of the model that produced it (server-side fallbacks can switch models).
- Only one run of an agent can be queued or running at a time (a database index enforces it); a second start answers "already running".
- Every run is an `agent_runs` row with tokens and cost; the last run shows under each Run button. Chat answers are rows too (agent "chat"), not shown on Today.
- Requests opt into server-side fallbacks (`fallbacks: "default"`).

## Where runs happen

The web app asks the worker (`WORKER_URL`) to start a run and the worker runs it in the background, so a page reload or a web restart doesn't stop it. On Cloud Run the web service signs those calls with its own identity token. In production there is no fallback: without `WORKER_URL` the Run buttons say the agent service isn't configured. Only local development (no `WORKER_URL`) runs agents inside the web process. A worker restart marks unfinished runs as failed.
