# Agents

The Strategy and Content agents and the "Ask the agents" chat live in `packages/agents`. They call the Claude API directly (TypeScript SDK, tool runner) with `claude-opus-5-5`; set `AGENT_MODEL` to change it.

## What each one does

| | Runs | Can read | Can write |
|---|---|---|---|
| Strategy | 25th of each month, 09:00 IST, or **Plan next month** / **Save and re-plan this month** on the Strategy page's brief card | funnel, ads, calendar, recent posts, brand kit, plans, keywords, web search | a **draft** plan for this month or next. An approved plan is replaced only by a re-plan from the brief (it becomes `superseded`). |
| Content | daily 06:00 IST, or **Draft next week** on Calendar | the same | **drafted** calendar posts, 12 hours to 21 days out, up to 21 per run; fills the Strategy agent's ideas in place |
| SEO | Monday 07:00 IST, or **Run SEO agent** on SEO & GEO | the same, plus the page catalog | page and blog drafts, sent to Approvals (up to 25 per run); tracked keywords |
| Chat | on each question | the same | nothing itself; it can start a Strategy, Content or SEO run for someone whose role can |

The Strategy agent also lays the month out as **idea** items on the calendar (date, channel, format, pillar). Every agent can read Google Trends and keyword ideas from DataForSEO when it's connected, the latest site audit and AI-visibility results.

Nothing an agent writes goes out by itself. Drafted posts still need media, a person to send them for approval, and an approver. Captions go through the same checks as approvals (ad-claim rules, the brand kit's banned phrases), and a blocked caption goes back to Claude to rewrite. Posts the agent flags, and posts a person ticks, show "Needs Jyotish review" in Approvals.

## The positioning brief, and re-planning a month

Where the positioning is decided: the **Positioning brief** on the Strategy page (brand kit, `positioning` and `positioningSources`). The launch film's positioning is built in as the `bodh-positioning` skill; the brief is the team's own words on top of it and wins where they differ. It goes into every agent's system prompt as a `<team_brief>` block, and `get_brand_kit` returns it. The listed source pages (bodhlok.com, a launch page) are the only pages the new `read_website` tool reads, so the agents can quote the live site's wording.

**Save and re-plan this month** (admins and social media managers) saves the brief and starts the Strategy agent with `replan` on: it may replace the month's approved plan (the old one becomes `superseded`) and, with `outline_calendar`'s `replace_remaining`, clears the rest of the month's ideas and agent drafts before putting new ones down. Posts a person edited, sent for approval, approved, scheduled or published are never touched. When the Strategy run succeeds, the worker runs the Content agent on the first week (`POST /jobs/replan`). The new plan comes back as a draft to approve.

Instruction boxes (the Run buttons, chat) take up to 6,000 characters; longer documents go in the brief.

## Agent runs: what each one did

Every run keeps a step log on its row (`agent_runs.steps`): each tool it called with the few inputs that matter, each web search, each page it read, what it wrote (post, page, plan), and what it said between steps. The **Agent runs** page lists runs; a run's page shows the steps in order with their time, the summary, the cost, and links to every post or page it produced. Each Run button links to its last run ("See what it did"), and a calendar item drafted or planned by an agent links to the run that made it.

## Skills

`packages/agents/skills/*.md` hold BODH's house rules: brand voice, Jyotish accuracy, formats and timing, funnel metrics. They go in the system prompt in full (cached). After editing one, run

```bash
pnpm --filter @bodh/agents skills
```

to refresh `src/skills.generated.ts` (a test fails if you forget).

The other skills from the build plan (section 7) are installed on the server, not committed: `scripts/skills.txt` lists them (the local humanizer, brand and LinkedIn skills, the SEO, blog, GEO, marketing and social-media skills from GitHub, seven Instagram writing skills from `Jakeschincariol/instagram-agent-skill` and the paid-media conductor `ads` from `AgriciDaniel/claude-ads`). `scripts/sync-skills.sh` copies only their markdown and JSON data (such as the 26 Reel hook formulas in `ig-reel/hooks.json`) into `.skills/`, never scripts or eval files, and `deploy-vm.sh` uploads that to `SKILLS_DIR` on the VM. Agents see each one's name and description and read the full text with the `read_skill` tool when a task calls for it, so they don't inflate every request. Review what changed after a sync: these files become part of the agents' instructions.

Left out on purpose: the Instagram pack's ig-viral (it browses Instagram), ig-comment, ig-dm and ig-reply (engaging as the account; Phase 8), ig-human and ig-profile; last30days and scrapling (they run local scripts and browsers the server agents don't have; web search and DataForSEO Trends cover the research), and hallmark, banner-design, slides and diagram-design (visual tools for the Creative studio, not text agents).

## Key, costs and limits

- The Anthropic API key goes in **Connections → Anthropic API** (or `ANTHROPIC_API_KEY` in the environment).
- `AI_MONTHLY_BUDGET_USD` (default 150): once agent and chat runs this month (India time) have cost this much, new runs refuse to start.
- `AI_RUN_CAP_USD` (default 6): a single run stops when it passes this.
- Every run is an `agent_runs` row with tokens and cost; the last run shows under each Run button.
- Requests opt into server-side fallbacks (`fallbacks: "default"`), so Anthropic can retry on another model if Opus 5.5 is overloaded.

## Where runs happen

On the VM, the web app asks the worker (`WORKER_URL`) to start a run and the worker runs it in the background, so a page reload doesn't stop it. A worker restart (such as a deploy) marks unfinished runs as failed. Without `WORKER_URL` (local development) the web app runs it in its own process.
