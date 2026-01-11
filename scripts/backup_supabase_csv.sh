#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SCHEMA_PATH="${SCHEMA_PATH:-$ROOT_DIR/api/supabase/schema.sql}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/supabase_csv}"
BACKUP_MODE="${BACKUP_MODE:-timestamp}"

SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [[ -z "$SUPABASE_URL" || -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  echo "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." >&2
  echo "Example: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... $0" >&2
  exit 1
fi

if [[ ! -f "$SCHEMA_PATH" ]]; then
  echo "Schema not found at $SCHEMA_PATH" >&2
  exit 1
fi

BASE_URL="${SUPABASE_URL%/}/rest/v1"

if [[ "$BACKUP_MODE" == "latest" ]]; then
  OUT_DIR="$BACKUP_DIR/latest"
  rm -rf "$OUT_DIR"
else
  OUT_DIR="$BACKUP_DIR/$(date +%Y%m%d_%H%M%S)"
fi

mkdir -p "$OUT_DIR"

mapfile -t tables < <(awk '/^create table if not exists /{print $5}' "$SCHEMA_PATH")
if [[ ${#tables[@]} -eq 0 ]]; then
  echo "No tables found in schema." >&2
  exit 1
fi

for table in "${tables[@]}"; do
  url="$BASE_URL/${table}?select=*"
  curl -sS --fail \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Accept: text/csv" \
    "$url" > "$OUT_DIR/${table}.csv"
done

echo "Supabase CSV backup saved to $OUT_DIR"
