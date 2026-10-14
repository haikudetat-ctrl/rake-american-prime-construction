#!/usr/bin/env bash
# Applies every migration to a throwaway local Postgres and runs the pgTAP
# suites in supabase/tests. Used where `supabase test db` cannot run (no
# Docker). Needs postgresql-16 and postgresql-16-pgtap.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGTEST_PORT:-54329}"
DATA="$(mktemp -d)"
LOG="$DATA/postgres.log"

as_pg() {
  if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

chmod 777 "$DATA"
as_pg "$PGBIN/initdb" -D "$DATA/db" -U postgres --auth=trust >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$DATA/db" -l "$LOG" -o "-p $PORT -k $DATA -c listen_addresses=''" -w start >/dev/null
trap 'as_pg "$PGBIN/pg_ctl" -D "$DATA/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT

export PGHOST="$DATA" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres
PSQL=(psql -q -v ON_ERROR_STOP=1 -X)

"${PSQL[@]}" -f "$ROOT/supabase/tests/support/supabase-shim.sql"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$migration" || { echo "migration failed: $(basename "$migration")"; exit 1; }
done
"${PSQL[@]}" -c "create extension if not exists pgtap"

pg_prove --ext .sql "$ROOT"/supabase/tests/*.test.sql
