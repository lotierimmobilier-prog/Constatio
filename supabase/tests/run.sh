#!/usr/bin/env bash
# Applique les migrations sur une base Postgres locale jetable et lance les tests.
# Usage : supabase/tests/run.sh   (Postgres local démarré, utilisateur « postgres »)
set -euo pipefail
cd "$(dirname "$0")/.."
DB=constatio_test
PSQL=(psql -U postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
"${PSQL[@]}" -d postgres -c "drop role if exists anon" -c "drop role if exists authenticated" -c "drop role if exists service_role"
"${PSQL[@]}" -d "$DB" < tests/00_stub_supabase.sql
for f in migrations/*.sql; do
  echo "→ $f"
  "${PSQL[@]}" -d "$DB" < "$f"
done
psql -U postgres -d "$DB" < tests/01_regles.sql 2>&1 | sed 's/^psql:<stdin>:[0-9]*: //'
