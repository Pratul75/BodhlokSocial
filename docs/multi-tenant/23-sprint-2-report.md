# Multi-tenant sprint 2 — what is done, what is not

Branch `multi-tenant`. **Nothing is committed, pushed or deployed.** No production database, DNS,
integration or configuration was touched. Everything ran against the isolated development
database on host port 5434, confirmed by `current_database()` before each destructive step.

Four workspaces now exist there: **bodhlok** (`public`), **acme** (`t_acme`), **zenith**
(`t_zenith`) and **aceme** (`t_aceme`), each with its own application role and, new this sprint,
its own read-only role.

**Gate: 361 unit tests across 7 packages, none skipped. 30 end-to-end tests pass, 1 skipped.
Lint clean, typecheck clean, schedules match 22 jobs.**

---

## 1. Per-tenant migration runner — DONE

`packages/db/src/migrate-tenants.ts`. One set of SQL files, applied to every workspace's schema,
tenant #1's `public` included. Each schema keeps its own `__tenant_migrations` record **inside
itself**, so the record travels with the data.

- A migration runs in one transaction: a failure leaves nothing recorded and the next run tries
  it again from the same place.
- A tenant that fails does not stop the others; the run names each one and ends non-zero.
- A session advisory lock per schema, so two deploys cannot apply the same file twice.
- A file whose text changed after it was applied is refused.
- After every run, the "no foreign key leaves this schema" assertion runs again, and both of the
  workspace's roles are re-granted so tables a migration added are not owner-only.
- First run on an existing schema *adopts* it: `public` exactly, from Drizzle's own
  `__drizzle_migrations`; other schemas from what is on disk, and the run says what it adopted.

**Proof it reaches every workspace.** A real migration file was added, `pnpm db:migrate` run, and
the column checked in all three schemas that existed then:

```
Migrations:
  ✓ bodhlok (public) — applied 1: 0014_probe_tmp
  ✓ acme (t_acme)    — applied 1: 0014_probe_tmp
  ✓ zenith (t_zenith)— applied 1: 0014_probe_tmp
```

`information_schema.columns` then showed `probe_tmp` once in each of `public`, `t_acme` and
`t_zenith` — the `"public".` qualifier is stripped, so each landed in its own schema and nowhere
else. Re-running was a no-op (`already up to date (15)`). The probe file, its journal entry, the
column and its tracking rows were then removed; `git status` on `packages/db/migrations` is clean.

**Automated:** `packages/db/src/migrate-tenants.db.test.ts`, 9 tests in a database the suite
creates and drops — a migration reaches the workspace it was asked for and no other; it reaches
the rest when the whole set runs; it runs once however many times it is run; an edited file is
refused; a failure records nothing and the next run applies it; one workspace's failure does not
stop the others; a schema with tables but no record is adopted without re-running anything;
`migrateAllTenants` covers suspended workspaces too.

## 2. The fail-open default — DONE

Three separate fail-opens are closed:

| Was | Now |
|---|---|
| `currentTenant()` fell back to `DEFAULT_TENANT_SLUG` whenever it was set | Falls back only while the installation has exactly **one** workspace, and never again once a second has been seen (a latch, not a cached count). Fail-closed until the registry has been read at all. |
| `resolveTenant(null)` answered with tenant #1 for any address that named nobody | Answers only for a single-tenant installation. With several workspaces, an address that names none is refused. |
| A session claiming a workspace that no longer resolves fell through to tenant #1 | Refused: the person is sent to sign in again. |

Verified over HTTP with `DEFAULT_TENANT_SLUG=bodhlok` still set and four workspaces registered:

```
/                     307 → /signin?error=no_tenant
/admin                307 → /signin?error=no_tenant
/t/bodhlok/admin      200
/t/acme/admin         200
/t/not-a-tenant/admin 404
```

Workspaces addressed by host work the same way (`TENANT_HOST_SUFFIX`): `bodhlok.localhost`,
`acme.localhost` and `zenith.localhost` each showed only their own people, and `nobody.localhost`
returned 404.

**This change found three real bugs**, each of which the fallback had been hiding: the public
webhook and feed routes were not binding their workspace at all; the database-backed test suites
were relying on the fallback (21 of them had been silently skipped); and `MIGRATE_DATABASE_URL`
pointing at a different database from `DATABASE_URL` let a test register its workspace in the
development database. That last one is now refused outright — the two may name different roles,
never different databases.

**Automated:** 3 tests in `tenancy.db.test.ts` — the fallback stops answering once a second
workspace exists, does not answer before the registry has been read, and never re-enables.

## 3. The two shared-secret endpoints — DONE

`BODH_EVENTS_SECRET` and `SEO_FEED_TOKEN` were one value for the whole server. They are now
ordinary per-workspace secrets, stored under the workspace's own name beside its Google and Meta
credentials, created and replaced from the Super Admin console (shown once). Tenant #1 keeps the
environment variable as a fallback — and only tenant #1, so no other workspace can be opened with
a value it was never given.

Proven over HTTP with real signatures and tokens:

| Address | Credential used | Result |
|---|---|---|
| `/api/feed/pages` | tenant #1's token | 200 |
| `/api/feed/pages` | acme's token | **401** |
| `/t/acme/api/feed/pages` | acme's token | 200 |
| `/t/acme/api/feed/pages` | tenant #1's token | **401** |
| `/t/zenith/api/feed/pages` | acme's token | **503** (zenith has no token: fail-closed) |
| `/api/events/bodh` | tenant #1's signature | 200 |
| `/api/events/bodh` | acme's signature | **401** |
| `/t/acme/api/events/bodh` | acme's signature | 200 |
| `/t/acme/api/events/bodh` | tenant #1's signature | **401** |

And the events landed where they were addressed: `evt_first_only` in `public.conversion_events`,
`evt_acme_only` in `t_acme.conversion_events`, neither anywhere else.

**Automated:** `apps/web/lib/tenant-secrets.test.ts`, 5 tests — each workspace's value is stored
under its own name, only tenant #1 may fall back to the environment variable, a workspace's own
value wins over it, replacing a value does not leave the old one, and generated values are long.

## 4. Integrations, caches, keys and configuration — DONE (audit) / see PARTIAL

Everything that is per workspace now:

| What | Where it lives |
|---|---|
| Every integration credential (Google, Meta, Postiz, Reddit, CRM, Vertex, DataForSEO, Anthropic) | `integration-<workspace>-<key>` in the secret store |
| Google and Reddit OAuth access-token caches | keyed by workspace id |
| Event webhook secret, page feed token | per workspace, console-generated |
| GA4 property, GA4 BigQuery project and dataset, Search Console site, Google Ads customer / manager / conversion actions, website address, sign-in email domains, SEO page catalogue | `platform.tenant_settings`, edited on the workspace's own Admin page |
| Monthly AI budget, per-run AI cap, monthly images, monthly videos, Postiz hourly budget, SEO audit page cap | entitlement capacities, set per workspace in the console |
| Uploaded and generated files | `<workspace>/uploads/…` and `<workspace>/generated/…`, local and GCS alike |

The **monthly AI budget was a server-wide constant**: one workspace could have used up the month
for every other one. It is now that workspace's own capacity, as is the per-run cap.

Deliberately still server-wide, because they belong to the platform rather than to a customer:
database and secret-store configuration, storage backend and bucket, `AUTH_SECRET`, `APP_URL`,
worker URL and token, the Google OAuth client, the Google Ads developer token and API version,
the Meta graph version, Vertex project and model names, the OpenAI and Perplexity keys used for
AI-visibility checks, `GCP_PROJECT_ID`, log and runtime settings, and the bootstrap variables
(`FIRST_TENANT_*`, `PLATFORM_OWNER_*`, `DEFAULT_TENANT_SLUG`, `DEV_USER_EMAIL`).

`ANTHROPIC_API_KEY` is the one judgement call: a workspace with its own key is billed for its own
usage, and otherwise the platform's key is used on purpose, with that workspace's own monthly
budget and per-run cap as the limit. `ANTHROPIC_KEY_PER_TENANT=true` refuses the platform key, so
every workspace must bring its own.

Proven: acme was given its own GA4 property through the Admin page; acme's page showed it,
bodhlok's did not (it inherits the server's), and zenith's showed none at all.

## 5. Background jobs and webhooks — DONE

The worker was run for real against the four-workspace database — previously NOT TESTED.

```
POST /jobs/publishing/run            → ran once per workspace, four separate results
POST /jobs/tracking/rebuild-funnel   → succeeded in all four
no token / wrong token               → 401
?tenant=nobody                       → 404
?trigger=manual with no workspace    → 400
?tenant=acme                         → that workspace only
```

Each workspace recorded its own row in its own `pipeline_runs` table — one each in `t_acme`,
`t_zenith` and `t_aceme`, and tenant #1's in `public`.

**Automated:** 6 worker tests — the fan-out, naming one workspace, refusing an unknown one,
refusing a suspended one, refusing an unaddressed manual run, refusing an agent a workspace does
not have (409, not a 500 the scheduler would retry), and one workspace's failure not stopping the
others (the run returns 500 and names which one failed, and the third workspace still ran).

Retry behaviour is honest but partly inferred: a failed workspace makes the whole call 500, which
is what makes Cloud Scheduler retry, and migrations, job records and event ingestion are all
idempotent. The retry itself was not exercised against a real scheduler.

## 6. Tenant Admin — DONE

Verified per workspace over HTTP: people and roles (each Admin lists only its own), spend caps
(each workspace's own `budgets` rows), connections, approvals and agent runs. The new **Workspace
settings** card on the Admin page is where the ten settings above are edited, with an inherited
value shown as "from the server" rather than as an empty field.

The 27 environment-based values are accounted for: 10 became workspace settings, 6 were already
capacities, 2 became per-workspace credentials, and the rest are platform infrastructure, listed
above.

## 7. Super Admin — DONE

- **Initial owner**: only from `PLATFORM_OWNER_EMAIL`. Nothing is hardcoded and a missing value
  creates no operator and says so.
- **Operator management**: `/platform/operators` — add an owner, support or billing operator;
  remove access, which also raises their session version and ends any look they have open.
  Removing the last owner is refused, as is removing yourself.
- **Audit**: the last 100 platform actions on the same page, with who, what, to what and which
  workspace. Opening a workspace's settings is itself recorded.
- **Read-only inspection and time-limited impersonation**: from a workspace's page, with a reason
  and a duration (15, 30 or 60 minutes). It opens that workspace as one of its own admins.

**Impersonation cannot approve or spend, and that is not a flag the code remembers to check.**
Each workspace now has a second database role, `<role>_ro`, granted `SELECT` and nothing else,
now and for every table a later migration adds. An impersonated session binds the workspace
through that role, so Postgres refuses the write:

```
workspace   as            read       write
bodhlok     read-write    5 rows     WROTE (rolled back)
bodhlok     read-only     5 rows     REFUSED (42501)
acme        read-write    2 rows     WROTE (rolled back)
acme        read-only     2 rows     REFUSED (42501)
zenith      read-write    2 rows     REFUSED → ... same shape
aceme       read-write    1 rows     REFUSED → ... same shape
```

Exercised in the browser end to end: started with a reason, the app showed acme's data under a
red banner naming the operator, "Stop looking" ended it, and both the start and the end are in
the audit log with the reason.

**Automated:** 2 tests in `tenancy.db.test.ts` — a read-only binding reads but is refused
`INSERT`, `UPDATE` and `DELETE` with Postgres code 42501 while the workspace's own binding still
writes; and a workspace with no role of its own cannot be opened read-only at all, rather than
quietly falling back to the owner connection.

## 8. Any-business readiness — reviewed, documented, not built

Nothing industry-specific is in the schema. `strategy_plans`, `calendar_items`, `seo_pages`,
`brand_kit`, `approvals` and the entitlement keys are all generic, and `brand_kit.positioning` is
already per workspace. What assumes one industry is **prompt text, rule lists and catalogue
data**, in six places:

| Where | What assumes astrology | What Phase 7 needs |
|---|---|---|
| `packages/agents/src/prompts.ts` | Every agent prompt names Bodhlok, Jyotish, the desk | Prompts as per-workspace rows, with these as tenant #1's |
| `packages/guardrails/src/index.ts` | Rules rejecting consumer-horoscope phrasing | A per-workspace rule set; the generic ad-platform rules stay shared |
| `packages/integrations/src/seo-catalog.ts` | Nakshatra, yoga, lagna page templates | Per-workspace templates |
| `packages/agents/src/skills*` | Bundled Bodhlok skills | Per-workspace skills |
| `packages/integrations/src/panchang.ts` and its feed | An astrology-only feature | An optional module |
| `apps/worker/src/seed.ts` | Sample data | Per-industry seed sets |

One of these was actively harmful and is fixed now: `ensurePageCatalog` would have filled every
workspace's SEO plan with nakshatra pages through the job fan-out. It is now opt-in — a workspace
gets the built-in catalogue only by setting `seo.page_catalog` to `on`, and tenant #1 keeps it.

The rest change nothing that works; they produce astrology-flavoured suggestions a non-astrology
customer would reject. No rewrite is needed to fix them: each is a list or a string that becomes
a per-workspace row.

## 9. Regression — DONE

```
lint        clean
typecheck   7 packages, clean
schedules   22 jobs match
unit        361 tests, 7 packages, 0 skipped
e2e         30 passed, 1 skipped (production-shaped: workspace-addressed hosts)
```

The end-to-end suite now runs the way production is addressed — `TENANT_HOST_SUFFIX` with
`bodhlok.localhost` as the base — rather than relying on a default workspace. The five
two-workspace isolation tests ran: each Admin lists only its own people, the sidebar names the
right workspace, content written in one never appears in the other, an unknown slug is a 404, and
one workspace's row id is not readable from another's address.

The unit count rose from 341 to 361, and more importantly **0 are skipped**: 21 database-backed
tests had been skipping silently whenever `DATABASE_URL` was not reaching them, which is how the
unbound paths in §2 survived.

---

## PARTIAL

| Item | State |
|---|---|
| Workspace settings | The ten values that matter are editable per workspace. There is no validation against the provider (a wrong GA4 property id is only found when GA4 is next read) and no bulk import. |
| Anthropic key | Shared by default, capped per workspace, with a switch to require per-workspace keys. Whether the platform or the customer pays is a business decision that is now configurable rather than assumed. |
| Retry behaviour | Idempotent everywhere that matters and a 500 is returned so a scheduler retries; not exercised against a real scheduler. |
| Impersonation | Read-only, time-limited, audited and enforced by the database. It acts as a workspace admin, so it sees what an admin sees; there is no narrower "support can see billing only" view. |

## NOT DONE

1. **Billing and plans.** Nothing charges money.
2. **Per-workspace prompts, skills, SEO templates and branding** — Phase 7, as agreed.
3. **Per-workspace Google OAuth client.** Every workspace connects through the platform's app.
4. **A cap on connection pools.** Each active workspace holds up to `DB_TENANT_POOL_SIZE`
   connections, and now up to a second pool while an operator is looking inside it. Nothing
   evicts idle pools.
5. **Role password rotation.** `platform.tenants.db_role_secret` is readable by the owner
   connection and there is no rotation; the read-only role shares it.

## NOT TESTED

- **Real Google sign-in.** No Google client is configured locally. The callback's workspace
  resolution, the `tid` claim and the per-workspace sign-in domains are written, typechecked and
  unit-tested, but never executed against Google.
- **GCP Secret Manager.** Only the local file store was exercised; the per-workspace secret names
  were not created in Secret Manager.
- **Deployment.** Nothing was built for or pushed to any environment.
- **Scale.** Four workspaces. Nothing was measured with many.
- **A real scheduler retrying a failed workspace.**

## Remaining risks

1. **One pool per workspace, now up to two.** No cap, no eviction.
2. **Role passwords in plain text** in the control plane, shared between a workspace's two roles.
3. **Entitlements are cached for 30 seconds and settings for 15**, so a change takes that long to
   take effect. Capacities that gate spending read live.
4. **The registry is cached for 30 seconds**, so a suspended workspace keeps working that long.
5. **An impersonated session is an admin's view.** Read-only, but not narrowed by subject.
6. **`DEFAULT_TENANT_SLUG` is inert with more than one workspace but still present.** It should be
   removed from the deployment configuration rather than left to be ignored.

## Exact next steps, in order

1. **Exercise Google sign-in** against a real client in a staging project: two workspaces, one
   address in both, and confirm the tenant claim and the per-workspace sign-in domains.
2. **Create the per-workspace secret names in Secret Manager** and run one workspace end to end
   against it.
3. **Cap the pool count**, evicting idle workspace pools, read-only ones first.
4. **Rotate role passwords**, and give the read-only role its own.
5. **Remove `DEFAULT_TENANT_SLUG`** from the deployment configuration, then from the code.
6. **Phase 7**, as its own milestone, starting with agent prompts and guardrail rules — the two
   that most visibly make the product look like somebody else's.
7. **Billing and plans.**

## The change itself

Still on branch `multi-tenant`, still no commits. New since the last report:
`packages/db/src/migrate-tenants.ts`, `tenant-settings.ts`, `test-tenant.ts`,
`migrate-tenants.db.test.ts`; `apps/web/lib/tenant-secrets.ts` and its test;
`apps/web/app/(platform)/platform/operators/page.tsx`. Changed: the migration entry point, the
tenant context and pooling, provisioning and role management, the worker's fan-out, the agent
cost gate, storage paths, the Google and Search Console integrations, the Admin page and the
Super Admin console.
