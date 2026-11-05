# BODH Growth OS

Internal app for the Recharge Studio marketing team to run BODH (Asttrolok) growth
marketing with Claude agents. Agents plan, draft, publish, run ads and report. People
approve everything before it goes public. See [PLAN.md](PLAN.md) for the full build plan
[docs/deploy-vm.md](docs/deploy-vm.md) for the live deployment on the rapido-demo VM, and
[infra/README.md](infra/README.md) for a full Cloud Run setup.

## Run it locally

You need Node 24, Docker, and pnpm (`corepack enable` installs it).

```bash
cp .env.example .env
pnpm install
pnpm db:up        # Postgres 16 on localhost:5433
pnpm db:migrate   # create tables
SEED_CONFIRM=yes pnpm db:seed   # load sample data (wipes users, connections and content)
pnpm dev          # web on :3000, worker on :8787
```

Open http://localhost:3000. `pnpm dev` needs ports 3000 and 8787 free.

### Sign-in

- **Dev mode** (default): with `GOOGLE_CLIENT_ID` empty, every request runs as `DEV_USER_EMAIL`, and **Preview as** in the top bar switches roles. This only works outside production: with `NODE_ENV=production` the app shows a "sign-in isn't set up" notice instead, and no setting overrides that.
- **Google sign-in**: set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `AUTH_SECRET` in `.env`. Only people an admin has added in Admin can sign in. An address on `ALLOWED_EMAIL_DOMAINS` must come from that Workspace (a personal Google account made with a company address is refused); any other address, such as Gmail or a partner's company, signs in with the verified Google account for exactly that address.

### Tracking

The funnel is built from events the BODH backend posts to `/api/events/bodh`, ad spend from Meta and Google Ads, and GA4 sessions. `pnpm db:seed` generates sample events and spend and runs them through the same pipeline. See [docs/tracking.md](docs/tracking.md).

### Publishing

Calendar items are written, given media and sent for approval in the calendar. Approved posts go to Postiz through the publisher job, which re-checks the approval and the post rules first. Creative studio generates images, carousels and YouTube thumbnails with Gemini and video with Veo, with the brand kit applied.

### Changing the database schema

Edit `packages/db/src/schema.ts`, then run `pnpm db:generate` to write a migration and `pnpm db:migrate` to apply it. Commit the migration; CI fails if the schema and migrations disagree.

## Layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js app: sign-in and all modules (Today, Strategy, Calendar, Creative, Approvals, Publishing, Ads, SEO & GEO, Directory listings, Community, Leads, Analytics, Ask the agents, Connections, Admin) |
| `apps/worker` | Hono service (`src/app.ts` routes, `src/index.ts` start-up). The scheduler (VM timers or Cloud Scheduler) calls `/jobs/tracking/:job`, `/jobs/publishing/run`, `/jobs/creative/poll`, `/jobs/seo/:job`, `/jobs/site/:job`, `/jobs/ads/sync` and `/jobs/:agent`, all with `X-Worker-Token`. Ad changes go through the guardrails inside `packages/integrations/src/ads.ts`, not a worker route. Also holds the sample-data seed |
| `packages/db` | Drizzle schema, migrations, migrate and seed scripts |
| `packages/shared` | Roles, module access rules, integrations catalog, channels |
| `packages/guardrails` | Spend caps, auto-allow rules, losing-ad rule, ad copy and positioning checks, post checks |
| `packages/integrations` | Secrets store, attribution, BODH event contract, Meta, Google Ads and GA4 clients, and the tracking pipeline |
| `docs` | [Operations runbook](docs/operations.md), [agents](docs/agents.md), [BODH event integration guide](docs/bodh-events.md), [how tracking works](docs/tracking.md), [VM deploy](docs/deploy-vm.md), [live integration checks](docs/integration-smoke-tests.md) |
| `Dockerfile` | `web` and `worker` images for Cloud Run |
| `infra` | Terraform for Cloud Run, Cloud SQL, Secret Manager, Storage, Scheduler, GitHub deploys |

## Tests

```bash
pnpm test             # unit tests; database tests run when DATABASE_URL points at a test Postgres
pnpm typecheck
pnpm lint
pnpm check:schedules  # VM timers and infra/scheduler.tf list the same jobs at the same times
pnpm --filter @bodh/web e2e   # Playwright smoke test (needs a migrated, seeded database)
```
