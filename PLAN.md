# BODH Growth OS — Engineering Plan

Source: the "BODH Growth OS — Fable Build Plan" doc (Claude Docs). This file turns that
product plan into a build plan for this repository. Repo: github.com/Pratul75/BodhlokSocial
(empty at the time of writing, 2026-10-24).

## 1. What we are building

An internal web app for the Recharge Studio marketing team that runs BODH (Asttrolok)
growth marketing through Claude agents. Agents plan, draft, publish, run ads and report;
humans approve everything in an approval queue. Hosted on GCP.

North Star: weekly activated registrations (registered + first chart generated).
Every channel is judged on cost per activated user.

## 2. Stack decisions

| Area | Decision | Why |
|---|---|---|
| Language | TypeScript end to end | Next.js frontend is already TS; one language, shared types, one toolchain |
| Monorepo | pnpm workspaces + Turborepo | Web, worker and shared packages in one repo |
| Frontend | Next.js (App Router) on Cloud Run | Per the doc |
| Auth | Auth.js with Google provider, `hd` restricted to the company domain, roles in DB | Per the doc; roles table drives the five roles in section 10 |
| Backend | Node service (Hono) on Cloud Run, `apps/worker` | Hosts the agent runtime and job endpoints; separate from web so long runs don't block UI |
| Agent runtime | Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) with a skills folder and MCP servers | Per the doc |
| Models | `claude-opus-5-5` default; `claude-haiku-5-5` for cheap classification/triage subtasks | Current generation; cost split |
| Jobs | Cloud Scheduler → Cloud Tasks → worker HTTP endpoints | Per the doc; Tasks gives retries and dedup |
| Database | Cloud SQL Postgres 16, Drizzle ORM + migrations | Per the doc |
| Files | Cloud Storage, signed URLs | Per the doc |
| Secrets | GCP Secret Manager, read at runtime, never in DB or client | Per the doc |
| Scheduler | Postiz self-hosted on Cloud Run (needs Postgres + Redis/Memorystore) | Per the doc |
| Warehouse | BigQuery (GA4 export + daily ad-spend loads) | Per the doc |
| Infra | Terraform under `infra/`, one GCP project, dev + prod environments | Reproducible, reviewable |
| CI | GitHub Actions: lint, typecheck, test, build images, deploy to Cloud Run on main | Standard |

Open decision to confirm with the team: the doc picks the Claude Agent SDK on our own
Cloud Run. Anthropic Managed Agents (hosted loop, scheduled deployments, vault
credentials) would remove the scheduler and sandbox work. The plan below assumes the
doc's choice; switching later changes only `apps/worker/agents`.

## 3. Repository layout

```
apps/
  web/            Next.js app: all 13 modules from doc section 4
  worker/         Hono service: /jobs/* endpoints, agent runtime, webhooks
packages/
  db/             Drizzle schema, migrations, seed
  shared/         zod schemas, types, constants (channels, roles, statuses)
  integrations/   typed clients: google-ads, meta, youtube, gbp, search-console,
                  ga4, bigquery, dataforseo, postiz, reddit, whatsapp, email, bodh
  guardrails/     spend caps, approval rules, rate limits (enforced in code, not prompts)
skills/           Claude skills copied in (section 7) + custom bodh-* skills
mcp/              MCP servers wrapping packages/integrations for the agents
infra/            Terraform: Cloud Run, Cloud SQL, Memorystore, Scheduler, Tasks,
                  Secret Manager, BigQuery, Storage, IAM
.github/workflows CI and deploy
```

## 4. Core data model (Postgres)

- `users`, `roles` (admin, ads_manager, seo_manager, social_manager, sales)
- `connections` — one row per integration: provider, status, secret_ref (Secret Manager
  name, never the secret), scopes, last_sync_at, error
- `agent_runs` — agent, trigger (schedule/manual/chat), status, started/finished,
  tokens_in/out, cost, summary, log_ref
- `approvals` — kind (post, ad_change, reply, listing, blog), payload, preview, reason,
  status (pending/approved/edited/rejected), decided_by, decided_at, source_run_id
- `calendar_items` — channel, format, idea, script, caption, asset_ids, scheduled_at,
  status, postiz_id
- `assets` — storage path, type, source (upload/imagen/veo), brand_kit_version
- `campaigns`, `ad_sets`, `ad_changes` (change log with who/what/why/result)
- `experiments` — A/B tests: hypothesis, variants, start/end, winner
- `seo_pages`, `keywords`, `page_briefs`, `ai_visibility_checks`
- `community_items` — platform, url, question, draft, status
- `leads` — source, form, fields, assigned_to, status
- `funnel_events` — spend/clicks/registrations/activations/paid by day × channel × creative
  (materialised from BigQuery)
- `budgets` — daily/monthly caps per platform, set by admin only
- `audit_log` — actor (user/agent), action, target, reason, result, at

## 5. Agent design

Each agent is a Claude Agent SDK workflow: system prompt + skills + a scoped set of MCP
tools + a schedule. Agents never call platform APIs directly; they call MCP tools backed
by `packages/integrations`, and every write tool goes through `packages/guardrails`:

- Write tools create an `approvals` row instead of acting, unless the action is on the
  auto-allow list (pause a losing ad, bid change within ±20%).
- Spend caps are checked in code before any ad mutation. Agents cannot read or change caps.
- Every tool call is written to `audit_log` with the agent's stated reason.
- Per-run token and cost budgets; monthly per-user limits for image/video generation.

Agents and schedules (doc section 5): Strategy (monthly), Content (daily), Creative
(on request), Publisher (on schedule), Ads (daily check, weekly tests), SEO (weekly),
GEO (weekly), Mentions (weekly), Community (daily), Analyst (weekly + monthly).

## 6. Phases

Order follows doc section 11. Durations assume one to two engineers.

### Phase 0 — Foundations (week 1)
- Scaffold the monorepo, CI, Terraform for the GCP project, dev environment.
- Start every external application in section 9 below (they gate later phases).
- Done when: `pnpm dev` runs web + worker locally against a local Postgres; CI green;
  Cloud Run dev deploy works.

### Phase 1 — Auth, roles, Connections, secrets (weeks 2–3)
- Google sign-in restricted to the company domain; roles table and route guards.
- Connections page: a card per integration with Connect (OAuth) or paste key, status,
  last sync, disconnect. OAuth callbacks store tokens in Secret Manager.
- Admin module: users and roles, budgets and limits, audit log viewer.
- Done when: an admin can connect GA4 (service account), Search Console (OAuth) and
  the Anthropic key, and a non-admin cannot see Connections.

### Phase 2 — Tracking and Analytics dashboard (weeks 3–5)
- BigQuery: GA4 export, daily loaders for Google Ads and Meta spend, funnel views.
- Confirm BODH sends `registration` and `first_chart` events to GA4/Firebase.
- Meta Conversions API and Google enhanced conversions wired from the BODH backend
  event stream (via `integrations/bodh`).
- Analytics module: spend → clicks → registrations → activated → paid, per channel and
  per creative; cost per activated user is the headline number.
- Done when: yesterday's funnel for each connected channel shows in the app from
  BigQuery, and a test registration appears as an activation within a day.

### Phase 3 — Calendar, Creative studio, Approval queue, Publishing (weeks 5–8)
- Deploy Postiz on Cloud Run; connect Instagram, Facebook, LinkedIn, YouTube via it.
- Content calendar (month/week views) with the item fields from doc section 4.
- Creative studio: upload JPG/MP4; generate image (Imagen), video (Veo), thumbnail,
  carousel via Vertex AI; brand kit applied automatically.
- Approval queue: card per item with preview, reason, Approve / Edit / Reject.
- Publisher agent: pushes approved items to Postiz at scheduled time, shows status and
  errors, retries failures.
- Done when: a team member drafts a reel caption, attaches a generated image, approves
  it, and it posts to a test Instagram account at the scheduled time.

### Phase 4 — Strategy and Content agents (weeks 8–10)
- Skills folder: copy the local skills listed in doc section 7, install the GitHub ones,
  write `bodh-brand-voice`, `jyotish-accuracy`, `bodh-reel-formats`, `bodh-funnel-metrics`.
- Strategy agent (monthly + on demand): trends (last30days, DataForSEO), competitors,
  last month's funnel → monthly plan + calendar draft; team edits and approves.
- Content agent (daily): scripts, captions, carousels, hooks, video briefs → approval queue.
- Chat with agent module: ask questions, run any skill on demand, streamed answers.
- Done when: the Strategy agent produces a plan for next month from real data, and the
  Content agent fills a week of calendar slots that pass human review.

### Phase 5 — SEO and GEO module (weeks 10–12)
- DataForSEO connection; weekly site crawl and audit; keyword list; page briefs; blog
  drafts to approval.
- Programmatic page generator from BODH's engine (planets in houses, Nakshatras, yogas,
  Lagnas, daily Panchang per city) with a direct answer block at the top of each page.
- GEO: AI-visibility tracker (does ChatGPT/Gemini/Perplexity mention Asttrolok for the
  target questions), FAQ schema, llms.txt.
- Done when: first 100 programmatic pages are generated and reviewed, and the weekly
  visibility check runs and charts over time.

### Phase 6 — Ads module with guardrails (weeks 12–15)
- Guardrails first: spend caps, auto-allow list, approval for new campaigns and budget
  increases, change log.
- Google Ads and Meta Marketing API clients (requires developer token and app review
  from Phase 0).
- Ads agent: daily performance read, proposals, A/B test launches within limits.
- Ads manager module: campaigns, tests, spend vs budget, recommendations, change log.
- Done when: the agent pauses a losing test ad automatically, and a budget increase it
  proposes waits in the approval queue with its reason.

### Phase 7 — Leads (week 15–16)
- Meta and Google lead-form webhooks → `leads`; assignment to sales users; status.
- Done when: a test lead-form submission appears, assigned, within a minute.

### Phase 8 — Community and Mentions agents (weeks 16–18)
- Reddit OAuth app; Quora is draft-only (no public API); YouTube comments via Data API.
- Community agent finds real questions daily and drafts answers for human approval.
- Mentions agent finds directories weekly and prepares listings.
- Done when: a drafted Reddit answer is approved and posted from a named team account.

### Phase 9 — Lifecycle WhatsApp/email (weeks 18–20)
- WhatsApp Business API provider and email provider connections.
- Sequence: day 0 welcome + first chart, day 1 tip, day 3 yoga explained, day 7 upgrade.
- Triggered by BODH registration events; activation stops the "generate your first chart"
  branch.
- Done when: a test registration receives the day 0 message and the sequence shows in
  the funnel as a channel.

## 7. Guardrails checklist (doc section 8, enforced in code)

- [ ] Hard daily and monthly spend caps, admin-only, agents cannot raise them
- [ ] Auto-allow list limited to pause-losing-ad and ±20% bid changes
- [ ] Nothing public without approval for the first 60 days; per-channel auto-approve flag later
- [ ] No fake accounts, reviews or undisclosed promotion; disclosure template for influencers
- [ ] Platform rate limits respected in `packages/integrations`; community replies human-approved
- [ ] Ad copy linter rejects guaranteed predictions and health/financial promises
- [ ] Audit log on every agent action with who, what, why, result
- [ ] Per-user and per-month token and video-generation limits

## 8. Roles (doc section 10)

| Role | Access |
|---|---|
| Admin | Everything, budgets, connections |
| Ads manager | Ads module, approve ad changes |
| SEO manager | SEO, GEO, blogs, directories |
| Social media manager | Calendar, creative, approve posts, community |
| Sales | Leads module only |

## 9. Start this week, outside the code (these gate later phases)

- [ ] Apply for Google Ads API developer token (gates Phase 6)
- [ ] Create Meta developer app, start app review for Marketing API and lead forms (Phase 6, 7)
- [ ] Request Google Business Profile API access (Phase 3)
- [ ] Apply for YouTube Data API upload quota increase (Phase 3)
- [ ] Confirm BODH backend sends registration and first-chart events to GA4/Firebase (Phase 2)
- [ ] Create the GCP project, billing, and a DataForSEO account (Phase 0, 5)

## 10. Open questions

1. Company domain for Google sign-in: rechargestudio.com only, or also an Asttrolok domain?
2. Does the BODH backend already expose a registration/activation event API, or do we add one?
3. Postiz self-hosted vs a hosted scheduler: who maintains Postiz upgrades?
4. Agent SDK on Cloud Run (doc) vs Anthropic Managed Agents: decide before Phase 4.
5. Who reviews Jyotish accuracy in the approval flow, and is that a required step for all content or only astrology claims?
6. Starting ad test budget and the two admins allowed to set caps.
