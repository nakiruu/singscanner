#!/usr/bin/env bash
# Singularity Scanner — production deploy script.
# Runs on the app LXC. Assumes:
#   - repo cloned at /opt/singscanner
#   - .env present and pointed at the pg LXC
#   - systemd unit `singscanner.service` installed (see scripts/singscanner.service)
#   - script run as the service user OR as root
#
# Usage (on the app LXC):
#   cd /opt/singscanner && ./scripts/deploy.sh
#
# Behavior:
#   - fast-fails on any error (set -euo pipefail)
#   - only runs `npm ci` when package-lock.json changed
#   - always runs prisma migrate deploy (no-op if up to date)
#   - rebuilds, then restarts the service
#   - emits timestamps so you can grep journal vs deploy log

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/singscanner}"
SERVICE_NAME="${SERVICE_NAME:-singscanner}"
BRANCH="${BRANCH:-main}"

log()  { printf '\033[36m[deploy %s]\033[0m %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
warn() { printf '\033[33m[deploy %s WARN]\033[0m %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }
die()  { printf '\033[31m[deploy %s FAIL]\033[0m %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; exit 1; }

cd "$REPO_DIR" || die "REPO_DIR $REPO_DIR does not exist"

# Refuse to run with uncommitted changes — protects against editing on the server.
if ! git diff --quiet || ! git diff --cached --quiet; then
  die "working tree has uncommitted changes — refuse to deploy. clean it first."
fi

log "checking out $BRANCH"
git fetch --quiet origin "$BRANCH"

LOCK_BEFORE="$(sha1sum package-lock.json 2>/dev/null | cut -d' ' -f1 || echo none)"
SCHEMA_BEFORE="$(sha1sum prisma/schema.prisma 2>/dev/null | cut -d' ' -f1 || echo none)"
BEFORE_SHA="$(git rev-parse HEAD)"

git reset --hard "origin/$BRANCH"
AFTER_SHA="$(git rev-parse HEAD)"

if [ "$BEFORE_SHA" = "$AFTER_SHA" ]; then
  log "no new commits ($BEFORE_SHA) — forcing rebuild anyway"
else
  log "advancing $BEFORE_SHA -> $AFTER_SHA"
  git log --oneline "$BEFORE_SHA..$AFTER_SHA" | sed 's/^/         /'
fi

LOCK_AFTER="$(sha1sum package-lock.json | cut -d' ' -f1)"
SCHEMA_AFTER="$(sha1sum prisma/schema.prisma | cut -d' ' -f1)"

# Deps: only reinstall when lockfile shifted. npm ci is the prod-correct command —
# it nukes node_modules and reproduces from the lock exactly, no semver drift.
if [ "$LOCK_BEFORE" != "$LOCK_AFTER" ]; then
  log "package-lock.json changed -> npm ci"
  npm ci
else
  log "deps unchanged -> skipping install"
fi

# Prisma client is rebuilt whenever the schema moves; migrate deploy is the
# prod-safe migrator (never generates, never prompts).
if [ "$SCHEMA_BEFORE" != "$SCHEMA_AFTER" ]; then
  log "prisma schema changed -> regenerating client"
  npx prisma generate --no-hints
fi
log "running prisma migrate deploy"
npx prisma migrate deploy

log "building"
npm run build

log "restarting $SERVICE_NAME"
if command -v sudo >/dev/null 2>&1 && [ "$(id -u)" -ne 0 ]; then
  sudo systemctl restart "$SERVICE_NAME"
else
  systemctl restart "$SERVICE_NAME"
fi

log "waiting for service to come up"
for i in $(seq 1 30); do
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    log "service active"
    break
  fi
  sleep 1
  [ "$i" -eq 30 ] && die "service did not become active in 30s — check: journalctl -u $SERVICE_NAME -n 50"
done

log "smoke test: /api/status"
if curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3000/api/status >/dev/null; then
  log "OK — deploy complete ($AFTER_SHA)"
else
  warn "smoke test failed — service is up but /api/status didn't respond"
  warn "check: journalctl -u $SERVICE_NAME -n 100"
  exit 1
fi
