# 18. Deployment and rollback strategy

Built on what already exists rather than replacing it. The project has a working deploy, nightly
backups, read-only pre/post-deploy checks and a documented rollback; each is extended.

## 18.1 What exists

**Live path — the VM.** `scripts/deploy-vm.sh` builds `linux/amd64` images locally, extracts the
runnable files, uploads a release through a private GCS bucket, and runs `scripts/vm/install.sh`,
which applies migrations, repoints `/opt/bodh/current` and restarts `bodh-web` and `bodh-worker`
plus 23 timers. Three releases are kept (`scripts/vm/install.sh:167-168`), which is what makes
rollback a symlink change.

Two things to note about this path: there is **no CI gate** on it, and a dirty working tree is
deployed with `-dirty` appended to the release name (`scripts/deploy-vm.sh:27`).

**Alternative path — Cloud Run.** `.github/workflows/deploy.yml` runs only after CI passes on
`main`: builds both images, runs the `bodh-migrate` Cloud Run job, deploys worker then web, then
smoke-tests `/api/health`.

**Rollback today.** Repoint `/opt/bodh/current` at the previous release and restart
(`docs/operations.md:82`). The runbook's guarantee is that *migrations never drop data an older
release reads*, so the old code runs on the newer schema.

**Backups.** Nightly `pg_dump` at 02:00 IST, 14 kept, copied to `BACKUP_BUCKET` when set
(`scripts/vm/backup.sh`). Restore is documented (`docs/operations.md:49-62`) and **has never been
drilled** — the runbook says so itself.

## 18.2 The rule that keeps rollback working

**Every migration in this project must remain backward-compatible with the previous release.** That
is already the runbook's promise, and it is what makes the recommended model safe:

| Change class | Rollback-safe? | Where it appears |
|---|---|---|
| New schema (`platform`) | **Yes** — the old release ignores it | Phase 2 |
| New tables in a new schema | **Yes** | Phases 2–4 |
| New nullable columns | **Yes** | throughout |
| New indexes | Yes (build `CONCURRENTLY` on live tables) | as needed |
| Running migrations into a *new* tenant schema | **Yes** — invisible to the old release | Phase 3 onwards |
| Changing the connection role's `search_path` | **Yes** — one connection-string change | Phase 2 step 6 |
| Dropping a constraint or primary key | **No** | only in Model A, deliberately isolated |

Because the recommended model changes **no existing table**, every migration in Phases 2–6 is in the
first five rows. **There is no irreversible database step in the entire plan** — which is the
operational payoff of the model choice in [9](09-target-architecture.md).

## 18.3 Per-deploy procedure

Unchanged in shape; three additions, marked **new**.

| Step | Detail |
|---|---|
| 1 | CI green on the commit being deployed (and on the VM path, deploy a **clean** tree — no `-dirty`) |
| 2 | **New:** a fresh backup, triggered explicitly (`sudo systemctl start bodh-db-backup`), not relying on last night's |
| 3 | Read-only pre-deploy checks, extended per [14 §14.6](14-data-migration.md#146-extending-the-existing-safety-checks) |
| 4 | Deploy: `scripts/deploy-vm.sh`, which migrates then restarts |
| 5 | **New:** confirm the migration loop reported success for **every** tenant; a partial result fails the deploy |
| 6 | Post-deploy checks, now reporting **per tenant** |
| 7 | Smoke: `/api/health`, then the e2e suite against live |
| 8 | **New:** watch the first scheduled run of a per-tenant job and confirm one `pipeline_runs` row per tenant |

## 18.4 Rollback procedure

### Application rollback (seconds)

```bash
# on the VM: point at the previous release and restart
sudo ln -sfn /opt/bodh/releases/<previous> /opt/bodh/current
sudo systemctl restart bodh-web bodh-worker
```

Safe for every phase, because no migration in the plan is destructive. Note the release retention:
three releases are kept, so rollback is only possible to the last two
(`scripts/vm/install.sh:167-168`) — enough, but worth knowing before you need it.

### The one rollback that needs its own step

Phase 2 step 6 switches `DATABASE_URL` to the fail-closed `bodh_app` role. If the application starts
failing with `relation ... does not exist`, the tenant context is not being set somewhere.
**Rollback: switch `DATABASE_URL` back to the owner role in `/opt/bodh/shared/bodh.env` and
restart.** The application then behaves exactly as it does today, because `withTenant` still works
— it simply no longer fails closed. This is why that step is deployed alone, and why it is the
easiest step in the plan to undo.

### Data rollback

| Situation | Remedy |
|---|---|
| One tenant's data damaged | `pg_restore`/`psql` of that tenant's schema dump — **the capability added in Phase 1 W1.7** ([14 §14.6](14-data-migration.md#146-extending-the-existing-safety-checks)) |
| The whole database damaged | Today's documented restore (`docs/operations.md:49-62`) — restores every tenant to the same point |
| A tenant provisioned wrongly | `DROP SCHEMA t_<slug> CASCADE` plus its `platform` rows. Clean, because nothing else references it |

**Per-tenant restore must exist before tenant #2.** Without it, recovering one client rolls back
every client ([8](08-risk-assessment.md), R21), and that is a promise you do not want to discover
you have made.

## 18.5 Deploy-time changes multi-tenancy introduces

| Change | Effect | Handling |
|---|---|---|
| Migrations run per tenant | Deploy time grows linearly | Report per tenant; fail the deploy on any failure; watch the duration as the tenant-count ceiling indicator |
| A migration can succeed for some tenants and fail for others | A half-migrated platform | Each schema has its own migration table, so re-running is safe and resumable. **Never leave a deploy half-migrated** |
| More connections in use | Pool pressure from `withTenant` | Measure in the Phase 0 spike; raise `DB_POOL_SIZE` deliberately, not reactively |
| Jobs iterate tenants | Longer job runs | Per-tenant `pipeline_runs`; alert on a tenant that is skipped repeatedly |
| Super Admin is a new entry point | New attack surface | Separate session audience, platform audit on every action ([10 §10.6](10-super-admin.md#106-security-requirements-for-the-console)) |

## 18.6 Staging

The project has no staging environment, and the VM deploy path has no CI gate. For this work that
gap matters more than it does for ordinary changes, because the phases change how *every* query
reaches the database.

Minimum viable staging: a second database on the same VM (or a scratch Cloud SQL instance) holding a
**restored copy of a recent production backup**, with the release deployed against it before the
live deploy. This also doubles as the restore drill the runbook asks for — one piece of work serving
two purposes.

If that is not possible, then at minimum: deploy Phase 2 and Phase 5 immediately after a verified
fresh backup, outside the agents' scheduled windows (the busiest are 05:00–09:30 IST), and with the
timers stopped (`sudo systemctl stop 'bodh-*.timer'`) until the post-deploy checks pass.

## 18.7 Phase-by-phase deployment notes

| Phase | Deploy note |
|---|---|
| 0 | Nothing deployed. The spike lives on a throwaway branch |
| 1 | Tests only; no runtime change. Safe any time |
| 2 | **Two deploys**: code first, then the `DATABASE_URL` role switch. Fresh backup before each. Timers stopped during the second |
| 3 | Additive (`platform` schema, console). Low risk; the console is behind a platform session that nobody has yet |
| 4 | Additive. Verify Bodhlok's sidebar and every page are unchanged — the Phase 1 matrix test is the check |
| 5 | **The riskiest deploy**: it changes the webhook and feed entry points and all 22 jobs. Deploy after a fresh backup, verify the three legacy webhook paths with a signed test payload immediately, and watch the first run of every job |
| 6 | Provision the pilot tenant out of hours; switch the fallback off as a separate, later deploy |
| 7 | Ordinary product releases |
