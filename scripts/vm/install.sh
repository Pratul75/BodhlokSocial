#!/usr/bin/env bash
# Runs on the VM as root: install.sh <release> <host> <seed 0|1>
# Safe to re-run. Keeps the env file and data between releases.
set -euo pipefail
REL="$1"; HOST="$2"; SEED="${3:-0}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE=/opt/bodh
NODE_VERSION=v24.13.0
SHARED="$BASE/shared"
ENVF="$SHARED/bodh.env"

log() { echo "== $*"; }

id bodh >/dev/null 2>&1 || useradd --system --home "$BASE" --shell /usr/sbin/nologin bodh
mkdir -p "$BASE/releases" "$BASE/bin" "$SHARED/secrets" "$SHARED/uploads"
chown -R bodh:bodh "$SHARED"; chmod 700 "$SHARED/secrets"

# Node 24, separate from the system Node other apps use.
if [ "$("$BASE/node/bin/node" -v 2>/dev/null || true)" != "$NODE_VERSION" ]; then
  log "installing Node $NODE_VERSION"
  tmp="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz" -o "$tmp/node.tar.xz"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " node-$NODE_VERSION-linux-x64.tar.xz\$" SHASUMS256.txt | sed "s/node-$NODE_VERSION-linux-x64.tar.xz/node.tar.xz/" | sha256sum -c -)
  rm -rf "$BASE/node" && mkdir -p "$BASE/node"
  tar -xJf "$tmp/node.tar.xz" -C "$BASE/node" --strip-components=1
  rm -rf "$tmp"
fi
export PATH="$BASE/node/bin:$PATH"

# Settings and secrets, generated once.
if [ ! -f "$ENVF" ]; then
  log "creating $ENVF"
  rnd() { openssl rand -hex "$1"; }
  DBPASS="$(rnd 24)"
  cat > "$ENVF" <<ENV
NODE_ENV=production
TZ=Asia/Kolkata
APP_URL=https://$HOST
ALLOWED_EMAIL_DOMAINS=rechargestudio.com
BOOTSTRAP_ADMIN_EMAIL=kshitij@rechargestudio.com
BOOTSTRAP_ADMIN_NAME=Kshitij Shivprasad
DATABASE_URL=postgres://bodh_growth:$DBPASS@127.0.0.1:5432/bodh_growth
AUTH_SECRET=$(rnd 32)
BODH_EVENTS_SECRET=$(rnd 32)
WORKER_TOKEN=$(rnd 24)
# Google sign-in: paste the OAuth client here, then: sudo systemctl restart bodh-web
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SECRETS_BACKEND=local
SECRETS_DIR=$SHARED/secrets
ALLOW_LOCAL_SECRETS=true
STORAGE_BACKEND=local
UPLOADS_DIR=$SHARED/uploads
ALLOW_LOCAL_STORAGE=true
DEMO_DATA=true
ENV
  chown root:bodh "$ENVF"; chmod 640 "$ENVF"
fi

# The public address follows the host given to this run.
sed -i "s#^APP_URL=.*#APP_URL=https://$HOST#" "$ENVF"
# Settings added after the first install.
grep -q '^WORKER_URL=' "$ENVF" || echo 'WORKER_URL=http://127.0.0.1:8787' >> "$ENVF"
grep -q '^AI_MONTHLY_BUDGET_USD=' "$ENVF" || echo 'AI_MONTHLY_BUDGET_USD=150' >> "$ENVF"
grep -q '^SKILLS_DIR=' "$ENVF" || echo "SKILLS_DIR=$SHARED/skills" >> "$ENVF"
grep -q '^SEO_FEED_TOKEN=' "$ENVF" || echo "SEO_FEED_TOKEN=$(openssl rand -hex 24)" >> "$ENVF"
# Google Ads: fill in once the developer token is approved, then restart bodh-web and bodh-worker.
grep -q '^GOOGLE_ADS_DEVELOPER_TOKEN=' "$ENVF" || printf 'GOOGLE_ADS_DEVELOPER_TOKEN=\nGOOGLE_ADS_CUSTOMER_ID=\nGOOGLE_ADS_LOGIN_CUSTOMER_ID=\n' >> "$ENVF"

# Extra agent skills (markdown only), replaced on each deploy that brings them.
if [ -d "$HERE/skills" ]; then
  rm -rf "$SHARED/skills.new" && cp -R "$HERE/skills" "$SHARED/skills.new"
  rm -rf "$SHARED/skills" && mv "$SHARED/skills.new" "$SHARED/skills"
  chown -R root:bodh "$SHARED/skills" && chmod -R a+rX,go-w "$SHARED/skills"
fi

# Database on the existing Postgres.
DBPASS="$(sed -n 's#^DATABASE_URL=postgres://bodh_growth:\([^@]*\)@.*#\1#p' "$ENVF")"
if ! sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='bodh_growth'" | grep -q 1; then
  log "creating database bodh_growth"
  sudo -u postgres psql -qc "create role bodh_growth login password '$DBPASS'"
  sudo -u postgres psql -qc "create database bodh_growth owner bodh_growth"
  FIRST_INSTALL=1
fi

# Unpack the release.
DEST="$BASE/releases/$REL"
log "unpacking release $REL"
rm -rf "$DEST" && mkdir -p "$DEST"
tar -xzf "$HERE/release.tgz" -C "$DEST"
chown -R bodh:bodh "$DEST"

# One KEY=value per line, values may contain spaces; read without shell word splitting.
mapfile -t ENV_LINES < <(grep -vE '^(#|$)' "$ENVF")
run_node() { sudo -u bodh env -i HOME="$BASE" PATH="$PATH" "${ENV_LINES[@]}" "$@"; }

log "migrating"
(cd "$DEST/worker" && run_node node packages/db/node_modules/tsx/dist/cli.mjs packages/db/src/migrate.ts)
if [ "$SEED" = "1" ] && [ "${FIRST_INSTALL:-0}" = "1" ]; then
  log "loading sample data"
  (cd "$DEST/worker/apps/worker" && run_node node node_modules/tsx/dist/cli.mjs src/seed.ts)
  (cd "$DEST/worker" && run_node node packages/db/node_modules/tsx/dist/cli.mjs packages/db/src/migrate.ts)
fi

# Switch to the new release.
ln -sfn "$DEST" "$BASE/current"
install -m 755 "$HERE/job.sh" "$BASE/bin/job"
install -m 644 "$HERE"/systemd/* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now bodh-web bodh-worker >/dev/null
systemctl restart bodh-web bodh-worker
for t in "$HERE"/systemd/*.timer; do systemctl enable --now "$(basename "$t")" >/dev/null; done

# Caddy site, validated before reload so other sites are never affected. The block between
# the BODH markers is ours; it is replaced on every run so the host can change.
BEGIN_MARK="# >>> BODH Growth OS (managed by scripts/vm/install.sh)"
END_MARK="# <<< BODH Growth OS"
BLOCK="$(printf '%s\n%s {\n    encode gzip\n    reverse_proxy 127.0.0.1:3100\n}\n%s' "$BEGIN_MARK" "$HOST" "$END_MARK")"
CURRENT="$(awk -v b="$BEGIN_MARK" -v e="$END_MARK" '$0 == b { p = 1 } p { print } $0 == e { p = 0 }' /etc/caddy/Caddyfile)"
if [ "$CURRENT" != "$BLOCK" ]; then
  log "setting Caddy site to $HOST"
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date -u +%Y%m%dT%H%M%SZ)"
  # Drop our previous block (and the unmarked one from the first install), then append the new one.
  awk -v b="$BEGIN_MARK" -v e="$END_MARK" '
    $0 == b { skip = 1; next }
    $0 == e { skip = 0; next }
    $0 == "# BODH Growth OS (installed by scripts/vm/install.sh)" { legacy = 1; next }
    legacy && /^\}/ { legacy = 0; next }
    legacy { next }
    !skip { print }
  ' /etc/caddy/Caddyfile > /tmp/Caddyfile.new
  printf '\n%s\n' "$BLOCK" >> /tmp/Caddyfile.new
  if caddy validate --adapter caddyfile --config /tmp/Caddyfile.new >/dev/null 2>&1; then
    cp /tmp/Caddyfile.new /etc/caddy/Caddyfile
    systemctl reload caddy
  else
    echo "Caddy rejected the new config; Caddyfile left unchanged." >&2
    caddy validate --adapter caddyfile --config /tmp/Caddyfile.new || true
    exit 1
  fi
fi

log "health"
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3100/api/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1 && break; sleep 1; done
echo "web:    $(curl -sS http://127.0.0.1:3100/api/health)"
echo "worker: $(curl -sS http://127.0.0.1:8787/health)"

# Keep the three newest releases.
ls -1dt "$BASE"/releases/* | tail -n +4 | xargs -r rm -rf
log "deployed $REL at https://$HOST"
