#!/usr/bin/env bash
# Deploy BODH Growth OS to a plain VM, no CI/CD: builds Linux images locally, extracts the
# runnable files, uploads them, and runs scripts/vm/install.sh on the VM.
#
#   scripts/deploy-vm.sh            # deploy
#   SEED=1 scripts/deploy-vm.sh     # first deploy: also load sample data
#   BUCKET= scripts/deploy-vm.sh    # copy straight to the VM over scp instead of the bucket
#   IAP=1 scripts/deploy-vm.sh      # run ssh through Google's IAP tunnel (HTTPS)
#
# Defaults target the rapido-demo VM; override with PROJECT, ZONE, VM, HOST. The release goes
# through the private bucket gs://bodh-growth-releases (BUCKET), which the VM's service account
# can read, because some networks reset long uploads over SSH.
set -euo pipefail

PROJECT="${PROJECT:-absolute-water-387410}"
ZONE="${ZONE:-asia-south1-c}"
VM="${VM:-rapido-demo}"
HOST="${HOST:-growth.rechargestudio.com}"
SEED="${SEED:-0}"
BUCKET="${BUCKET-bodh-growth-releases}"
# Upload folder on the VM, one per person deploying: a folder another person's ssh account left
# behind can't be cleared by the next one, which stopped a deploy on 5 Nov 2026.
STAGING="/tmp/bodh-release-$(id -un | tr -cd 'A-Za-z0-9_-')"
# Every gcloud compute ssh/scp below takes these (the tunnel, when IAP=1).
VIA=(--zone "$ZONE" --project "$PROJECT" --quiet)
[ "${IAP:-0}" = 1 ] && VIA+=(--tunnel-through-iap)

cd "$(dirname "$0")/.."
SHA="$(git rev-parse --short HEAD)"
[ -n "$(git status --porcelain)" ] && SHA="${SHA}-dirty"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

# Registry and Compute API calls time out now and then on slow networks; retry them.
retry() { for i in 1 2 3 4 5; do "$@" && return 0; echo "   retrying ($i)…"; sleep 10; done; return 1; }

echo "== building linux/amd64 images for $SHA"
retry docker build --platform linux/amd64 --target web -t bodh-web:vm .
retry docker build --platform linux/amd64 --target worker -t bodh-worker:vm .

echo "== extracting"
cid="$(docker create --platform linux/amd64 bodh-web:vm)"; docker cp "$cid:/app" "$OUT/web"; docker rm "$cid" >/dev/null
cid="$(docker create --platform linux/amd64 bodh-worker:vm)"; docker cp "$cid:/repo" "$OUT/worker"; docker rm "$cid" >/dev/null
# COPYFILE_DISABLE keeps macOS metadata out of the archives.
TAR_FLAGS=(); tar --no-xattrs --no-mac-metadata -cf /dev/null /dev/null 2>/dev/null && TAR_FLAGS=(--no-xattrs --no-mac-metadata)
COPYFILE_DISABLE=1 tar "${TAR_FLAGS[@]}" -C "$OUT" -czf "$OUT/release.tgz" web worker
# Installer files, plus the extra agent skills from scripts/sync-skills.sh when built.
rm -rf "$OUT/vm" && cp -R scripts/vm "$OUT/vm"
if [ -d .skills ]; then cp -R .skills "$OUT/vm/skills"; echo "   skills: $(ls .skills | wc -l | tr -d ' ')"; fi
COPYFILE_DISABLE=1 tar "${TAR_FLAGS[@]}" -C "$OUT/vm" -czf "$OUT/vm.tgz" .
du -h "$OUT/release.tgz" | cut -f1 | xargs echo "   release size:"

echo "== uploading to $VM"
(cd "$OUT" && shasum -a 256 release.tgz vm.tgz > release.sha256)
retry gcloud compute ssh "$VM" "${VIA[@]}" --command "rm -rf $STAGING && mkdir -p $STAGING"
if [ -n "$BUCKET" ]; then
  # Through the private releases bucket: HTTPS with resumable uploads gets through networks that
  # reset long uploads over SSH, and the VM reads it with its own service account. The bucket
  # deletes objects after 14 days.
  STAGE="gs://$BUCKET/$SHA-$(date +%Y%m%d%H%M%S)"
  retry gcloud storage cp "$OUT/release.tgz" "$OUT/vm.tgz" "$OUT/release.sha256" "$STAGE/" --project "$PROJECT"
  retry gcloud compute ssh "$VM" "${VIA[@]}" --command \
    "cd $STAGING && gcloud storage cp '$STAGE/*' . --quiet && sha256sum -c release.sha256"
  gcloud storage rm --recursive "$STAGE" --project "$PROJECT" >/dev/null 2>&1 || true
else
  # -O: the classic scp protocol. The SFTP mode (macOS scp's default) gets its session closed the
  # moment it starts on some networks, while plain ssh and classic scp go through.
  retry gcloud compute scp "$OUT/release.tgz" "$OUT/vm.tgz" "$OUT/release.sha256" "$VM:$STAGING/" "${VIA[@]}" --scp-flag=-O
  retry gcloud compute ssh "$VM" "${VIA[@]}" --command "cd $STAGING && sha256sum -c release.sha256"
fi

echo "== installing"
gcloud compute ssh "$VM" "${VIA[@]}" --command \
  "cd $STAGING && tar -xzf vm.tgz && sudo bash install.sh '$SHA' '$HOST' '$SEED'"
