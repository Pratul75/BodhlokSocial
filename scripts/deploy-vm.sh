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
HOST="${HOST:-bodh-growth.sites.rechargestudio.com}"
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
tar -C "$OUT" -czf "$OUT/release.tgz" web worker
tar -C scripts/vm -czf "$OUT/vm.tgz" .
du -h "$OUT/release.tgz" | cut -f1 | xargs echo "   release size:"

echo "== uploading to $VM"
gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet --command "rm -rf /tmp/bodh-release && mkdir -p /tmp/bodh-release"
gcloud compute scp "$OUT/release.tgz" "$OUT/vm.tgz" "$VM:/tmp/bodh-release/" --zone "$ZONE" --project "$PROJECT" --quiet

echo "== installing"
gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet --command \
  "cd /tmp/bodh-release && tar -xzf vm.tgz && sudo bash install.sh '$SHA' '$HOST' '$SEED'"
