#!/usr/bin/env bash
# Baut und startet eine Stufe aus diesem Checkout: eldron/deploy.sh <prod|staging>
set -euo pipefail

STAGE="${1:?Aufruf: deploy.sh <prod|staging>}"
cd "$(dirname "$0")"

[ -f .env ] || { echo ".env fehlt in $(pwd)" >&2; exit 1; }
if ! grep -qx "ELDRON_STAGE=$STAGE" .env; then
  echo ".env in $(pwd) gehört nicht zur Stufe $STAGE" >&2
  exit 1
fi
PORT=$(grep -E '^HOST_PORT=' .env | cut -d= -f2)

export SOURCE_COMMIT
SOURCE_COMMIT=$(git rev-parse HEAD)
DC=(docker compose -p "eldron-immich-$STAGE")
"${DC[@]}" build immich-server
"${DC[@]}" up -d --remove-orphans

code=""
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/server/ping" || true)
  if [ "$code" = "200" ]; then
    echo "Immich $STAGE läuft auf Port $PORT"
    exit 0
  fi
  sleep 10
done
echo "Immich $STAGE nach 10 min nicht gesund (letzter Status: ${code:-keine Antwort})" >&2
"${DC[@]}" ps
exit 1
