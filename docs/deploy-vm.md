# Deploying to the rapido-demo VM

BODH Growth OS runs on the `rapido-demo` VM (project `absolute-water-387410`, zone
`asia-south1-c`) beside the other apps there, at **https://growth.rechargestudio.com**.
There is no CI/CD: you deploy from a laptop.

| Piece | Where |
|---|---|
| Web app | systemd `bodh-web`, Node 24, on 127.0.0.1:3100 behind Caddy |
| Worker | systemd `bodh-worker`, on 127.0.0.1:8787, not reachable from outside |
| Scheduled jobs | 22 systemd timers `bodh-*.timer` calling the worker through `bodh-job@` (tracking, ad sync, publisher, video checks, SEO, CMS publishing to bodhlok.com every 30 minutes and an hourly CMS sync, the CRM sync nightly at 02:30, the daily ops digest at 09:00, and the agents), the same jobs and times as `infra/scheduler.tf`; plus `bodh-db-backup.timer` (02:00 IST). The Community, Mentions and Analyst agent timers are installed but off until `ENABLE_NEW_AGENT_TIMERS` lists them. |
| Release uploads | private bucket `gs://bodh-growth-releases` (asia-south1, public access blocked, objects deleted after 14 days); the VM's service account reads it |
| Database | `bodh_growth` on the VM's Postgres 15 |
| Settings and secrets | `/opt/bodh/shared/bodh.env`, readable by root and the `bodh` user only |
| Integration keys, uploads | `/opt/bodh/shared/secrets`, `/opt/bodh/shared/uploads` |
| Releases | `/opt/bodh/releases/<commit>`, with `/opt/bodh/current` pointing at the live one |

The app uses its own Node install in `/opt/bodh/node`; the other apps' Node 20 is untouched.

## Deploy

Needs Docker and `gcloud` signed in with access to the project.

```bash
scripts/deploy-vm.sh
```

The release goes up through the releases bucket over HTTPS, because some networks reset long
uploads over SSH; the VM downloads it and checks its checksum. `BUCKET= scripts/deploy-vm.sh`
copies straight over scp instead, and `IAP=1` runs ssh through Google's IAP tunnel.

It builds Linux images, uploads only the runnable files, migrates the database, switches
releases and restarts. It takes about ten minutes on a Mac, mostly the Linux build.

## Address

DNS for rechargestudio.com is at GoDaddy, with an A record `growth` pointing to `8.231.76.36`.
To move to another name, add its record, then run `HOST=<name> scripts/deploy-vm.sh`: the installer
swaps the Caddy site and the app's address. Add the new redirect URIs to the Google client too.
A name under `*.sites.rechargestudio.com` doesn't work: that wildcard issues certificates only for
sites the sites API approves.

## Sign-in

Sign-in uses the OAuth client **BODH Growth web** in project `absolute-water-387410`. That project's
consent screen (branding "Bodhlok", External, In production) is shared with other apps, so leave its
audience and branding alone. To recreate the client in a project of its own:

1. **Google Auth Platform > Branding**: app name "BODH Growth", your support email, and
   `rechargestudio.com` under authorised domains.
2. **Audience**: **Internal** if the project belongs to the rechargestudio.com organisation.
   Otherwise **External**, leave it in Testing, and add each teammate's email as a test user.
3. **Data access**: add `openid`, `email`, `profile`,
   `https://www.googleapis.com/auth/webmasters.readonly`, `https://www.googleapis.com/auth/adwords`
   and `https://www.googleapis.com/auth/youtube.force-ssl` (YouTube comments).
4. **Clients > Create client > Web application**, with these authorised redirect URIs, using the
   app's current address:
   - `https://growth.rechargestudio.com/api/auth/callback/google`
   - `https://growth.rechargestudio.com/api/connect/google/callback`

Then, on your Mac:

```bash
scripts/set-google-client.sh
```

It asks for the client ID and secret, writes them on the VM and restarts the web app. Sign in as
kshitij@rechargestudio.com, the first admin, and add the team in **Admin**.

## Logs, restarts, rollback

```bash
gcloud compute ssh rapido-demo --zone asia-south1-c --project absolute-water-387410
```

Then on the VM:

```bash
sudo journalctl -u bodh-web -u bodh-worker -n 100 --no-pager
sudo systemctl restart bodh-web bodh-worker
systemctl list-timers 'bodh-*'
ls /opt/bodh/releases
```

To roll back, point `current` at the previous release and restart:

```bash
sudo ln -sfn /opt/bodh/releases/<previous> /opt/bodh/current && sudo systemctl restart bodh-web bodh-worker
```

Database migrations add tables, columns, indexes and constraints; they never drop data a release
reads, so an older release still runs on a newer database. Migration 0008 also normalises values the
new constraints don't allow (for example an unknown role becomes social_manager, as the app already
treated it) and keeps one strategy plan per month.

## Backups

`bodh-db-backup.timer` runs `/opt/bodh/bin/backup` nightly: a compressed `pg_dump` in
`/opt/bodh/backups`, newest 14 kept. Set `BACKUP_BUCKET=gs://<bucket>` in `bodh.env` (with `gsutil` on
the VM) to copy each dump off the machine. Restoring is in `docs/operations.md`.

## Notes

- The first deploy loaded sample data. It was removed on 24 Oct 2026 with
  `scripts/vm/remove-sample-data.sql`, which keeps the admin, real sign-ins, connections and the
  brand kit. Spend caps were reset to ₹0; set real ones in **Admin** before connecting ad accounts.
- Keys pasted in Connections are stored as files in `/opt/bodh/shared/secrets`, not in GCP Secret
  Manager, since this VM setup doesn't use Cloud Run. The folder is readable only by the `bodh` user.
- The "Sample data" badge follows the seed's marker row in the database, not an environment flag.
  A `DEMO_DATA` line left in `bodh.env` from the first install does nothing and can be deleted.
- `pnpm db:seed` (or `src/seed.ts`) wipes users, connections and content, so it refuses to run
  unless `SEED_CONFIRM=yes`, and on this VM (production) also `SEED_ALLOW_PRODUCTION=yes`. Only the
  first install with `SEED=1` sets both.
- Lead forms: set `META_APP_SECRET`, `META_LEADS_VERIFY_TOKEN` and `GOOGLE_LEADS_WEBHOOK_KEY` in
  `bodh.env`; the URLs to give Meta and Google are on the Leads page (admins).
- New agents: the Community, Mentions and Analyst timers are installed but off. Turn them on with
  `ENABLE_NEW_AGENT_TIMERS="community mentions analyst"` (or `all`) in `bodh.env` and re-run the
  installer, or `sudo systemctl enable --now bodh-agent-<name>.timer`. They share the monthly AI budget.
- Alerts: set `ALERT_WEBHOOK_URL` to a Slack-compatible incoming webhook for the 09:00 digest.
- Postiz: write here whether the team uses Postiz Cloud or a self-hosted Postiz, and who upgrades it.
