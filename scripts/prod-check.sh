#!/usr/bin/env bash
# Read-only checks of the production database around a deploy, run from a Mac with gcloud.
#   scripts/prod-check.sh pre    before deploying: blocking problems for migration 0012 + row-count baseline
#   scripts/prod-check.sh post   after deploying: state, and row counts compared with the last baseline
# The database session is forced read-only (default_transaction_read_only=on), so these can't
# change anything. Results (counts only, no customer data) go to $OUT_DIR.
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:?pre or post}"
PROJECT="${PROJECT:-absolute-water-387410}"; ZONE="${ZONE:-asia-south1-c}"; VM="${VM:-rapido-demo}"
OUT_DIR="${OUT_DIR:-$HOME/Downloads/bodhlok-live-47ff99c/deploy-checks}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_DIR/$MODE-$STAMP.txt"
case "$MODE" in pre) SQL=scripts/vm/predeploy-check.sql ;; post) SQL=scripts/vm/postdeploy-check.sql ;; *) echo "pre or post" >&2; exit 2 ;; esac

remote() { gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet --command "$1" 2>/dev/null; }

{
  echo "# $MODE-deploy check, $(date -u +'%Y-%m-%d %H:%M UTC')"
  remote 'echo "release: $(readlink /opt/bodh/current)"; echo "services: $(systemctl is-active bodh-web bodh-worker caddy postgresql | tr "\n" " ")"; echo "web: $(curl -sS -m5 http://127.0.0.1:3100/api/health)  worker: $(curl -sS -m5 http://127.0.0.1:8787/health)"; echo "disk: $(df -h / | tail -1 | awk "{print \$4\" free\"}")"; echo "timers: $(systemctl list-timers "bodh-*" --no-pager --no-legend | wc -l) active"'
  remote "sudo -u postgres env PGOPTIONS='-c default_transaction_read_only=on' psql -d bodh_growth -At -v ON_ERROR_STOP=1 -f -" < "$SQL"
} > "$OUT"
cat "$OUT"

if [ "$MODE" = pre ]; then
  blocking="$(sed -n '/== blocking/,/== row counts/p' "$OUT" | grep -E ': [1-9][0-9]*$' || true)"
  active="$(grep -E '^agent runs queued or running' "$OUT" | grep -Eo '[0-9]+$')"
  if [ -n "$blocking" ] || [ "$active" != 0 ]; then echo; echo "NOT READY: fix the lines above before deploying."; exit 1; fi
  echo; echo "READY: nothing would block migration 0012. Baseline saved: $OUT"
else
  base="$(ls -1t "$OUT_DIR"/pre-*.txt 2>/dev/null | head -1)"
  [ -n "$base" ] || { echo "No pre-deploy baseline in $OUT_DIR"; exit 1; }
  echo; echo "== compared with $(basename "$base")"
  join -t, <(grep '^count,' "$base" | cut -d, -f2,3 | sort) <(grep '^count,' "$OUT" | cut -d, -f2,3 | sort) \
    | awk -F, '{ if ($3 < $2) { bad++; print "  FEWER ROWS: " $1 " " $2 " -> " $3 } else if ($3 > $2) print "  more rows (new activity): " $1 " " $2 " -> " $3 }
              END { if (bad) { print "  " bad " tables lost rows"; exit 1 } else print "  no existing table lost rows" }'
fi
