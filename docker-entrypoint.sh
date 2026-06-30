#!/bin/sh
# Wait for Postgres, run migrations, then start the Next.js standalone server.
set -e

# Parse host + port out of DATABASE_URL (postgresql://user:pass@host:port/db?...)
DB_HOST=$(printf '%s' "${DATABASE_URL:-}" | sed -E 's|.*@([^:/]+)[:/].*|\1|')
DB_PORT=$(printf '%s' "${DATABASE_URL:-}" | sed -E 's|.*@[^:]+:([0-9]+).*|\1|')
DB_PORT="${DB_PORT:-5432}"

if [ -n "$DB_HOST" ]; then
  echo "[entrypoint] waiting for postgres at $DB_HOST:$DB_PORT"
  i=0
  while ! nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -gt 60 ]; then
      echo "[entrypoint] postgres did not come up in 60s; giving up"
      exit 1
    fi
    sleep 1
  done
  echo "[entrypoint] postgres reachable"
fi

# Apply any pending migrations. Safe to run every boot (no-op when up to date).
echo "[entrypoint] running prisma migrate deploy"
npx --no-install prisma migrate deploy

echo "[entrypoint] starting next server"
exec node server.js
