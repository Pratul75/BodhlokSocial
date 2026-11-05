#!/usr/bin/env bash
# Calls a worker job on localhost. Used by the bodh-job@ timers in place of Cloud Scheduler.
# Job names match the keys in infra/scheduler.tf (scripts/check-schedules.mjs keeps them in step).
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
  site-publish)     path=/jobs/site/publish ;;
  site-sync)        path=/jobs/site/sync ;;
  ops-alerts)       path=/jobs/ops/alerts ;;
  crm-sync)         path=/jobs/crm/sync ;;
  agent-analyst-monthly) path=/jobs/analyst?trigger=schedule ;;
  agent-strategy|agent-content|agent-seo|agent-ads|agent-community|agent-mentions|agent-analyst)
    path="/jobs/${1#agent-}?trigger=schedule" ;;
  *) echo "unknown job $1" >&2; exit 2 ;;
esac

code="$(curl -sS -m 600 -o /tmp/bodh-job-$$.out -w '%{http_code}' -X POST -H "X-Worker-Token: $TOKEN" "http://127.0.0.1:8787$path" || echo 000)"
cat /tmp/bodh-job-$$.out 2>/dev/null && echo
rm -f /tmp/bodh-job-$$.out
case "$code" in
  2??) exit 0 ;;
  # An agent or the AI-visibility checks already running, or no Anthropic key yet: not a failure.
  409) exit 0 ;;
  *) echo "job $1 failed: HTTP $code" >&2; exit 1 ;;
esac
