#!/usr/bin/env bash
# Nightly backup of the VM's Growth OS database: a compressed pg_dump in /opt/bodh/backups,
# keeping the newest 14. With BACKUP_BUCKET=gs://... in bodh.env and gsutil on the VM, each dump
# is also copied off the machine (a backup on the same disk doesn't survive losing the VM).
# Restore: see docs/operations.md.
set -euo pipefail
BASE=/opt/bodh
DIR="$BASE/backups"
ENVF="$BASE/shared/bodh.env"
DB_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENVF")"
BUCKET="$(sed -n 's/^BACKUP_BUCKET=//p' "$ENVF" || true)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DIR" && chmod 700 "$DIR"
OUT="$DIR/bodh-$STAMP.sql.gz"

pg_dump --no-owner --no-privileges --format=plain "$DB_URL" | gzip -9 > "$OUT.part"
mv "$OUT.part" "$OUT"
chmod 600 "$OUT"
echo "backup written: $OUT ($(du -h "$OUT" | cut -f1))"

if [ -n "${BUCKET:-}" ] && command -v gsutil >/dev/null 2>&1; then
  gsutil -q cp "$OUT" "${BUCKET%/}/$(basename "$OUT")"
  echo "copied to ${BUCKET%/}/"
fi

# Keep the newest 14 local dumps.
ls -1t "$DIR"/bodh-*.sql.gz 2>/dev/null | tail -n +15 | while read -r old; do rm -f -- "$old"; done
