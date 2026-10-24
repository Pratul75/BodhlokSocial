# BODH Growth OS

Internal app for the Recharge Studio marketing team to run BODH (Asttrolok) growth
marketing with Claude agents. Agents plan, draft, publish, run ads and report. People
approve everything before it goes public. See [PLAN.md](PLAN.md) for the full build plan.

## Run it locally

You need Node 24, Docker, and pnpm (`corepack enable` installs it).

```bash
cp .env.example .env
pnpm install
pnpm db:up        # Postgres 16 on localhost:5433
pnpm db:push      # create tables
pnpm db:seed      # load sample data
pnpm dev          # web on :3000, worker on :8787
```

Open http://localhost:3000. Until Google sign-in is set up, every request runs as
`DEV_USER_EMAIL`. Use **Preview as** in the top bar to see the app as each role.

## Layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js app with all modules: Today, Strategy, Calendar, Creative, Approvals, Publishing, Ads, SEO & GEO, Community, Leads, Analytics, Ask the agents, Connections, Admin |
| `apps/worker` | Hono service. Cloud Scheduler calls `POST /jobs/:agent`. Agents call `POST /guardrails/ad-change` before any ad change |
| `packages/db` | Drizzle schema, Postgres client, sample-data seed |
| `packages/shared` | Roles, module access rules, integrations catalog, channels |
| `packages/guardrails` | Spend caps, auto-allow rules, ad copy checks, publish-approval rule, with tests |

## What works today

- Approvals queue: approve, edit and approve, or reject with a note. Role checks, ad-rule warnings, audit log.
- Content calendar with month and week views. Adding ideas works.
- Connections: API keys and service accounts are saved to the secrets store, never the database.
- Uploads in Creative studio, lead assignment, strategy plan approval, publish retry, spend caps, roles.
- Funnel analytics from the `funnel_daily` table, which BigQuery will feed in production.

## Not built yet

- Google sign-in (dev user only for now).
- OAuth connect flows, Secret Manager backend, and real platform API calls.
- The agent runtime. Job runs are recorded as queued until Phase 4.
- Infrastructure as code for GCP.
