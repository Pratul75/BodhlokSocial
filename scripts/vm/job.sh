#!/usr/bin/env bash
# Calls a worker job on localhost. Used by the bodh-job@ timers in place of Cloud Scheduler.
set -euo pipefail
TOKEN="$(sed -n 's/^WORKER_TOKEN=//p' /opt/bodh/shared/bodh.env)"
case "$1" in
  tracking-forward) path=/jobs/tracking/forward-conversions ;;
  tracking-hourly)  path=/jobs/tracking/hourly ;;
  tracking-daily)   path=/jobs/tracking/daily ;;
  publisher)        path=/jobs/publishing/run ;;
  creative-poll)    path=/jobs/creative/poll ;;
  seo-keywords)     path=/jobs/seo/keywords ;;
  seo-audit-start)  path=/jobs/seo/audit-start ;;
  seo-audit-poll)   path=/jobs/seo/audit-poll ;;
  geo)              path=/jobs/seo/geo ;;
  ads-sync)         path=/jobs/ads/sync ;;
  # Agent runs start in the background; a 409 (no API key yet, or already running) is not a failure.
  agent-strategy|agent-content|agent-seo|agent-ads)
    curl -sS -m 30 -X POST -H "X-Worker-Token: $TOKEN" "http://127.0.0.1:8787/jobs/${1#agent-}"
    echo
    exit 0 ;;
  *) echo "unknown job $1" >&2; exit 2 ;;
esac
curl -fsS -m 600 -X POST -H "X-Worker-Token: $TOKEN" "http://127.0.0.1:8787$path"
echo
