# Operations runbook

How to keep BODH Growth OS healthy, for the admin on call. Commands below are for the VM
(`gcloud compute ssh rapido-demo --zone asia-south1-c --project absolute-water-387410`); Cloud Run
equivalents are noted where they differ.

## Every morning: the digest

At 09:00 IST the worker re-checks every stored credential with its provider, then sends a digest of
what failed in the last 24 hours (jobs, agent runs, posts, community answers, connections in error,
and jobs that didn't run at all) to `ALERT_WEBHOOK_URL`. Nothing is sent on a clean day unless
`ALERT_ALWAYS=true`. The same text is in the job log (Tracking page, job `ops_alerts`).

| Digest says | Do this |
|---|---|
| Connection X is in error | Open Connections; the card has the provider's reason. Fix the account, reconnect, press **Check all connections**. |
| Google access was revoked or has expired | Disconnect and connect again with Google (the refresh token is gone). |
| Job forward_meta / publisher / rebuild_funnel didn't run at all | `systemctl list-timers 'bodh-*'` (VM) or Cloud Scheduler (Cloud Run); `journalctl -u bodh-job@tracking-forward -n 50`. |
| Post failed to publish | Publishing page: fix the cause (Postiz message is on the row), then **Retry**. |
| Agent run failed | The run row on the module page has the reason; budget, key and rate-limit messages say what to change. |

## Logs

Web and worker write one JSON object per line. On the VM:

```bash
sudo journalctl -u bodh-web -u bodh-worker -n 200 --no-pager -o cat | jq -c 'select(.level=="error")'
```

On Cloud Run, Cloud Logging reads `severity`, and errors with a stack appear in **Error Reporting**
without any setup. Secret-looking fields (token, secret, password, key, authorization, cookie) are
written as `[redacted]`.

## Rotating secrets

| Secret | VM | Cloud Run | Effect |
|---|---|---|---|
| `WORKER_TOKEN` | edit `bodh.env`, `systemctl restart bodh-web bodh-worker` | add a version of `app-worker-token`, `terraform apply` (Scheduler headers), redeploy | Timers and the web app use the new value at once |
| `AUTH_SECRET` | edit `bodh.env`, restart `bodh-web` | add a version of `app-auth-secret`, redeploy web | Everyone is signed out |
| `BODH_EVENTS_SECRET` | edit `bodh.env` with the new value **and** the old one in the BODH backend's signature list, restart web | same with `app-bodh-events-secret` | The intake accepts either signature during the switch (see `docs/bodh-events.md`) |
| `SEO_FEED_TOKEN` | edit `bodh.env`, restart web; give the web team the new one | `app-seo-feed-token` | Old token stops working |
| An integration key | paste the new one in Connections | same | Checked with the provider before it replaces the old one |

## Signing someone out

Removing access in **Admin** signs the person out everywhere at once. Signing out from the app also
ends that person's sessions on every device. To sign everyone out, rotate `AUTH_SECRET`.

## Backups and restore (VM)

Nightly at 02:30 IST, `/opt/bodh/bin/backup` writes `/opt/bodh/backups/bodh-<time>.sql.gz` (14 kept,
copied to `BACKUP_BUCKET` when set). Run one now with `sudo systemctl start bodh-db-backup`.

To restore into a fresh database and switch to it:

```bash
sudo systemctl stop bodh-web bodh-worker
sudo -u postgres createdb -O bodh_growth bodh_growth_restore
gunzip -c /opt/bodh/backups/bodh-<time>.sql.gz | sudo -u postgres psql -v ON_ERROR_STOP=1 -d bodh_growth_restore
# Point DATABASE_URL in /opt/bodh/shared/bodh.env at bodh_growth_restore (or rename the databases), then:
sudo systemctl start bodh-web bodh-worker
```

Practise this once a quarter on a copy and note the date here. Cloud SQL (Cloud Run path) keeps 14
automated backups with point-in-time recovery; restore from the console into a new instance.

Last restore drill: _not yet done_.

## Sample data

The first VM install can load sample data (`SEED=1`). The "Sample data" badge shows while the seed's
marker row is in the database. Remove it before the team starts real work (it empties the content
tables):

```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 -v admin=<admin email> -d bodh_growth -f /opt/bodh/current/worker/scripts/vm/remove-sample-data.sql
```

It refuses to run twice. It keeps the admin, people added in Admin, real sign-ins, connections,
Postiz channel mappings, creative jobs and the brand kit, and resets spend caps to ₹0.

## Rollback

Point `/opt/bodh/current` at the previous release and restart (`docs/deploy-vm.md`). Migrations
never drop data an older release reads, so it runs on the newer database.

## Before raising ad spend caps

Keep both caps at ₹0 until the Meta and Google Ads rows in `docs/integration-smoke-tests.md` pass. At
₹0 the guardrails block every ad change except pausing.
