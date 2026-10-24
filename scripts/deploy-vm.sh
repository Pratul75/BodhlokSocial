#!/usr/bin/env bash
# Deploy BODH Growth OS to a plain VM, no CI/CD: builds Linux images locally, extracts the
# runnable files, uploads them, and runs scripts/vm/install.sh on the VM.
#
#   scripts/deploy-vm.sh            # deploy
#   SEED=1 scripts/deploy-vm.sh     # first deploy: also load sample data
#
# Defaults target the rapido-demo VM; override with PROJECT, ZONE, VM, HOST.
set -euo pipefail

PROJECT="${PROJECT:-absolute-water-387410}"
ZONE="${ZONE:-asia-south1-c}"
VM="${VM:-rapido-demo}"
# Until growth.rechargestudio.com has a DNS record, sslip.io maps this name to the VM IP.
HOST="${HOST:-bodh-growth.8-231-76-36.sslip.io}"
SEED="${SEED:-0}"

cd "$(dirname "$0")/.."
SHA="$(git rev-parse --short HEAD)"
[ -n "$(git status --porcelain)" ] && SHA="${SHA}-dirty"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

echo "== building linux/amd64 images for $SHA"
docker build --platform linux/amd64 --target web -t bodh-web:vm .
docker build --platform linux/amd64 --target worker -t bodh-worker:vm .

echo "== extracting"
cid="$(docker create --platform linux/amd64 bodh-web:vm)"; docker cp "$cid:/app" "$OUT/web"; docker rm "$cid" >/dev/null
cid="$(docker create --platform linux/amd64 bodh-worker:vm)"; docker cp "$cid:/repo" "$OUT/worker"; docker rm "$cid" >/dev/null
# COPYFILE_DISABLE keeps macOS metadata out of the archives.
TAR_FLAGS=(); tar --no-xattrs --no-mac-metadata -cf /dev/null /dev/null 2>/dev/null && TAR_FLAGS=(--no-xattrs --no-mac-metadata)
COPYFILE_DISABLE=1 tar "${TAR_FLAGS[@]}" -C "$OUT" -czf "$OUT/release.tgz" web worker
COPYFILE_DISABLE=1 tar "${TAR_FLAGS[@]}" -C scripts/vm -czf "$OUT/vm.tgz" .
du -h "$OUT/release.tgz" | cut -f1 | xargs echo "   release size:"

# gcloud occasionally times out talking to the Compute API; retry those calls.
retry() { for i in 1 2 3; do "$@" && return 0; echo "   retrying ($i)…"; sleep 10; done; return 1; }

echo "== uploading to $VM"
retry gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet --command "rm -rf /tmp/bodh-release && mkdir -p /tmp/bodh-release"
retry gcloud compute scp "$OUT/release.tgz" "$OUT/vm.tgz" "$VM:/tmp/bodh-release/" --zone "$ZONE" --project "$PROJECT" --quiet

echo "== installing"
gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet --command \
  "cd /tmp/bodh-release && tar -xzf vm.tgz && sudo bash install.sh '$SHA' '$HOST' '$SEED'"
