# Agents

The Strategy and Content agents and the "Ask the agents" chat live in `packages/agents`. They call the Claude API directly (TypeScript SDK, tool runner) with `claude-opus-5-5`; set `AGENT_MODEL` to change it.

## What each one does

| | Runs | Can read | Can write |
|---|---|---|---|
| Strategy | 25th of each month, 09:00 IST, or **Run Strategy agent** on Strategy | funnel, ads, calendar, recent posts, brand kit, plans, keywords, web search | a **draft** plan for this month or next. An approved plan is never replaced. |
| Content | daily 06:00 IST, or **Draft next week** on Calendar | the same | **drafted** calendar posts, 12 hours to 21 days out, up to 21 per run |
| Chat | on each question | the same | nothing |

Nothing an agent writes goes out by itself. Drafted posts still need media, a person to send them for approval, and an approver. Captions go through the same checks as approvals (ad-claim rules, the brand kit's banned phrases), and a blocked caption goes back to Claude to rewrite. Posts the agent flags, and posts a person ticks, show "Needs Jyotish review" in Approvals.

## Skills

`packages/agents/skills/*.md` hold BODH's house rules: brand voice, Jyotish accuracy, formats and timing, funnel metrics. They go in the system prompt (cached). After editing one, run

```bash
pnpm --filter @bodh/agents skills
```

to refresh `src/skills.generated.ts` (a test fails if you forget). Extra skills can be dropped on the server as `*.md` files in a folder named by `SKILLS_DIR`; one with the same `name` replaces the bundled one.

## Key, costs and limits

- The Anthropic API key goes in **Connections → Anthropic API** (or `ANTHROPIC_API_KEY` in the environment).
- `AI_MONTHLY_BUDGET_USD` (default 150): once agent and chat runs this month (India time) have cost this much, new runs refuse to start.
- `AI_RUN_CAP_USD` (default 6): a single run stops when it passes this.
- Every run is an `agent_runs` row with tokens and cost; the last run shows under each Run button.
- Requests opt into server-side fallbacks (`fallbacks: "default"`), so Anthropic can retry on another model if Opus 5.5 is overloaded.

## Where runs happen

On the VM, the web app asks the worker (`WORKER_URL`) to start a run and the worker runs it in the background, so a page reload doesn't stop it. A worker restart (such as a deploy) marks unfinished runs as failed. Without `WORKER_URL` (local development) the web app runs it in its own process.
