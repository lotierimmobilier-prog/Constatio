#!/usr/bin/env bash
# Pile locale réduite pour le développement : Postgres (image Supabase),
# authentification (GoTrue), API (PostgREST), stockage des fichiers (Storage),
# fonctions serveur (Edge Runtime), passerelle (Kong) et boîte mail de test (Mailpit).
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

stop() { docker rm -f cst-db cst-auth cst-rest cst-mail cst-stockage cst-kong cst-fonctions >/dev/null 2>&1 || true; }

start() {
  docker network inspect $NET >/dev/null 2>&1 || docker network create $NET >/dev/null
  docker run -d --name cst-db --network $NET -p 54322:5432 \
    -e POSTGRES_PASSWORD=$PW -e JWT_SECRET=$JWT -e JWT_EXP=3600 \
    supabase/postgres:17.12.0.000 >/dev/null
  attendre "base de données" psql "$DBURL" -qc "select 1"
  # L'image ne fixe pas de mot de passe aux rôles de service.
  psql "${DBURL/postgres:/supabase_admin:}" -q -c "alter role supabase_auth_admin with password '$PW'" -c "alter role authenticator with password '$PW'" -c "alter role supabase_storage_admin with password '$PW'"
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
  jeton() {  # jeton <rôle> : JWT signé avec le secret local
    node -e '
      const c=require("crypto"),b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
      const d=b({alg:"HS256",typ:"JWT"})+"."+b({role:process.argv[2],iss:"constatio-dev",exp:4102444800});
      console.log(d+"."+c.createHmac("sha256",process.argv[1]).update(d).digest("base64url"))' "$JWT" "$1"
  }
  ANON=$(jeton anon); SERVICE=$(jeton service_role)
  # Le stockage crée lui-même ses tables (storage.buckets, storage.objects) au démarrage.
  docker run -d --name cst-stockage --network $NET -p 54327:5000 \
    -e ANON_KEY=$ANON -e SERVICE_KEY=$SERVICE -e PGRST_JWT_SECRET=$JWT -e POSTGREST_URL=http://cst-rest:3000 \
    -e "DATABASE_URL=postgres://supabase_storage_admin:$PW@cst-db:5432/postgres" \
    -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -e FILE_SIZE_LIMIT=52428800 \
    -e TENANT_ID=stub -e REGION=stub -e GLOBAL_S3_BUCKET=stub -e ENABLE_IMAGE_TRANSFORMATION=false \
    supabase/storage-api:v1.96.0 >/dev/null
  attendre "stockage" curl -sf --noproxy '*' http://127.0.0.1:54327/status
  for f in supabase/migrations/*.sql; do echo "→ $f"; psql "$DBURL" -q -v ON_ERROR_STOP=1 < "$f"; done
  docker run -d --name cst-rest --network $NET -p 54326:3000 \
    -e "PGRST_DB_URI=postgres://authenticator:$PW@cst-db:5432/postgres" -e PGRST_DB_SCHEMAS=public \
    -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=$JWT postgrest/postgrest:v16.5 >/dev/null
  attendre "API" curl -sf --noproxy '*' http://127.0.0.1:54326/
  # Passerelle unique, puis fonctions serveur. Celles-ci tournent sur le réseau de la machine pour
  # pouvoir télécharger leurs dépendances ; elles joignent le reste par la passerelle.
  docker run -d --name cst-kong --network $NET --add-host host.docker.internal:host-gateway -p 54321:8000 \
    -e KONG_DATABASE=off -e KONG_DECLARATIVE_CONFIG=/kong.yml -v "$PWD/dev/kong.yml:/kong.yml:ro" kong:2.8.1 >/dev/null
  PROXY_ARGS=()
  if [ -n "${HTTPS_PROXY:-}" ]; then
    PROXY_ARGS=(-e "HTTPS_PROXY=$HTTPS_PROXY" -e "HTTP_PROXY=$HTTPS_PROXY" -e NO_PROXY=127.0.0.1,localhost)
    [ -f /root/.ccr/ca-bundle.crt ] && PROXY_ARGS+=(-v /root/.ccr/ca-bundle.crt:/ca.crt:ro -e DENO_CERT=/ca.crt -e SSL_CERT_FILE=/ca.crt)
  fi
  docker run -d --name cst-fonctions --network host \
    -v "$PWD/supabase/functions:/home/deno/functions:ro" -v "$PWD/dev/fonctions-main:/home/deno/main:ro" "${PROXY_ARGS[@]}" \
    -e SUPABASE_URL=http://127.0.0.1:54321 -e SUPABASE_ANON_KEY=$ANON -e SUPABASE_SERVICE_ROLE_KEY=$SERVICE \
    -e SIGNABAIL_WEBHOOK_SECRET=secret-local-signabail -e SITE_URL=http://127.0.0.1:5173 \
    supabase/edge-runtime:v1.79.1 start --main-service /home/deno/main -p 54328 >/dev/null
  attendre "fonctions" curl -sf --noproxy '*' http://127.0.0.1:54328/sante
  attendre "passerelle" curl -sf --noproxy '*' http://127.0.0.1:54321/functions/v1/sante
  printf 'VITE_SUPABASE_URL=http://127.0.0.1:5173\nVITE_SUPABASE_ANON_KEY=%s\nDEV_PROXY_AUTH=http://127.0.0.1:54325\nDEV_PROXY_REST=http://127.0.0.1:54326\nDEV_PROXY_STOCKAGE=http://127.0.0.1:54327\nDEV_PROXY_FONCTIONS=http://127.0.0.1:54328\n' "$ANON" > .env.local
  echo "Pile locale démarrée. .env.local écrit. E-mails de test : http://127.0.0.1:54324"
}

case "${1:-start}" in
  start) stop; start ;;
  stop)  stop ;;
  reset) stop; start ;;
  *) echo "usage : $0 start|stop|reset"; exit 1 ;;
esac
