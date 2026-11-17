#!/usr/bin/env bash
# Pile locale réduite pour le développement : Postgres (image Supabase),
# authentification (GoTrue), API (PostgREST) et boîte mail de test (Mailpit).
# À utiliser quand « supabase start » n'est pas possible. Secrets de
# développement uniquement, sans valeur en dehors de cette machine.
#   dev/pile-locale.sh start | stop | reset
set -euo pipefail
cd "$(dirname "$0")/.."
NET=constatio-dev
PW=postgres
JWT=secret-de-developpement-local-constatio-32car
DBURL="postgresql://postgres:$PW@127.0.0.1:54322/postgres"

attendre() {  # attendre <libellé> <commande…> : 60 s au plus
  echo -n "$1"; shift
  for _ in $(seq 60); do if "$@" >/dev/null 2>&1; then echo " prête"; return 0; fi; echo -n .; sleep 1; done
  echo " ÉCHEC : le service ne répond pas (voir docker logs)"; exit 1
}

stop() { docker rm -f cst-db cst-auth cst-rest cst-mail >/dev/null 2>&1 || true; }

start() {
  docker network inspect $NET >/dev/null 2>&1 || docker network create $NET >/dev/null
  docker run -d --name cst-db --network $NET -p 54322:5432 \
    -e POSTGRES_PASSWORD=$PW -e JWT_SECRET=$JWT -e JWT_EXP=3600 \
    supabase/postgres:17.12.0.000 >/dev/null
  attendre "base de données" psql "$DBURL" -qc "select 1"
  # L'image ne fixe pas de mot de passe aux rôles de service.
  psql "${DBURL/postgres:/supabase_admin:}" -q -c "alter role supabase_auth_admin with password '$PW'" -c "alter role authenticator with password '$PW'"
  docker run -d --name cst-mail --network $NET -p 54324:8025 axllent/mailpit:v1.31.3 >/dev/null
  docker run -d --name cst-auth --network $NET -p 54325:9999 \
    -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=http://127.0.0.1:5173/auth/v1 \
    -e GOTRUE_DB_DRIVER=postgres -e "GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:$PW@cst-db:5432/postgres" \
    -e GOTRUE_SITE_URL=http://127.0.0.1:5173 -e GOTRUE_URI_ALLOW_LIST=http://127.0.0.1:5173/** \
    -e GOTRUE_JWT_SECRET=$JWT -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated \
    -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_ADMIN_ROLES=service_role \
    -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
    -e GOTRUE_SMTP_HOST=cst-mail -e GOTRUE_SMTP_PORT=1025 -e GOTRUE_SMTP_ADMIN_EMAIL=ne-pas-repondre@constatio.test \
    -e GOTRUE_MAILER_URLPATHS_RECOVERY=/auth/v1/verify -e GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify \
    supabase/gotrue:v2.198.0 >/dev/null
  attendre "authentification" curl -sf --noproxy '*' http://127.0.0.1:54325/health
  # Le stockage Supabase n'est pas disponible dans cette pile : tables minimales à la place.
  psql "${DBURL/postgres:/supabase_admin:}" -q -v ON_ERROR_STOP=1 <<'SQL'
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.buckets owner to postgres;
alter table storage.objects owner to postgres;
grant usage on schema storage to postgres, authenticated, service_role;
grant all on storage.buckets, storage.objects to authenticated, service_role;
SQL
  for f in supabase/migrations/*.sql; do echo "→ $f"; psql "$DBURL" -q -v ON_ERROR_STOP=1 < "$f"; done
  docker run -d --name cst-rest --network $NET -p 54326:3000 \
    -e "PGRST_DB_URI=postgres://authenticator:$PW@cst-db:5432/postgres" -e PGRST_DB_SCHEMAS=public \
    -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=$JWT postgrest/postgrest:v16.5 >/dev/null
  attendre "API" curl -sf --noproxy '*' http://127.0.0.1:54326/
  ANON=$(node -e '
    const c=require("crypto"),b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
    const d=b({alg:"HS256",typ:"JWT"})+"."+b({role:"anon",iss:"constatio-dev",exp:4102444800});
    console.log(d+"."+c.createHmac("sha256",process.argv[1]).update(d).digest("base64url"))' "$JWT")
  printf 'VITE_SUPABASE_URL=http://127.0.0.1:5173\nVITE_SUPABASE_ANON_KEY=%s\nDEV_PROXY_AUTH=http://127.0.0.1:54325\nDEV_PROXY_REST=http://127.0.0.1:54326\n' "$ANON" > .env.local
  echo "Pile locale démarrée. .env.local écrit. E-mails de test : http://127.0.0.1:54324"
}

case "${1:-start}" in
  start) stop; start ;;
  stop)  stop ;;
  reset) stop; start ;;
  *) echo "usage : $0 start|stop|reset"; exit 1 ;;
esac
