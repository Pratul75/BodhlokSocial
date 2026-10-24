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
  *) echo "unknown job $1" >&2; exit 2 ;;
esac
curl -fsS -m 600 -X POST -H "X-Worker-Token: $TOKEN" "http://127.0.0.1:8787$path"
echo
