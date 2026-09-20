#!/usr/bin/env bash
# Überträgt die Zugänge aus einer SentryCommand-.env in die Immich-.env einer Stufe auf eldron-suite.
# Aufruf: eldron/push-env.sh <staging|prod> [sc-env-datei]
# Fehlende Werte (z. B. CONVEX_SERVICE_SECRET) werden verdeckt abgefragt oder aus gleichnamigen Umgebungsvariablen genommen.
set -euo pipefail

STAGE="${1:?Aufruf: push-env.sh <staging|prod> [sc-env-datei]}"
# Der Fork liegt als Submodul unter external/immich – die SC-.env also drei Ebenen höher.
SC_ENV="${2:-$(cd "$(dirname "$0")/../../.." && pwd)/.env}"
HOST="${ELDRON_SSH_HOST:-hetzner_eldron}"
TARGET="/root/eldron-immich-$STAGE/eldron/.env"
KEYS=(HETZNER_BUCKET HETZNER_S3_ENDPOINT HETZNER_S3_REGION HETZNER_S3_ACCESS_KEY HETZNER_S3_SECRET_KEY CLERK_SECRET_KEY CONVEX_URL CONVEX_SERVICE_SECRET IMMICH_SERVICE_SECRET SC_CONVEX_SITE_URL IMMICH_ADMIN_EMAIL)

[ -f "$SC_ENV" ] || { echo "$SC_ENV nicht gefunden" >&2; exit 1; }

from_file() {
  grep -E "^$1=" "$SC_ENV" | tail -1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/'
}

# Zwei Werte heißen in der SentryCommand-.env anders.
alias_of() {
  case "$1" in
    CONVEX_URL) echo NEXT_PUBLIC_CONVEX_URL ;;
    SC_CONVEX_SITE_URL) echo NEXT_PUBLIC_CONVEX_SITE_URL ;;
  esac
}

BLOCK=""
for key in "${KEYS[@]}"; do
  value="${!key:-}"
  [ -n "$value" ] || value="$(from_file "$key")"
  if [ -z "$value" ]; then
    other="$(alias_of "$key")"
    [ -z "$other" ] || value="$(from_file "$other")"
  fi
  if [ -z "$value" ] && [ "$key" = IMMICH_ADMIN_EMAIL ]; then value="admin@eldron.local"; fi
  if [ -z "$value" ]; then
    # Ohne Terminal (z. B. aus einem Agenten heraus) lässt sich nichts abfragen –
    # dann lieber laut abbrechen als stumm aussteigen.
    if ! { : </dev/tty; } 2>/dev/null; then
      echo "$key fehlt in $SC_ENV und kann hier nicht abgefragt werden." >&2
      echo "Voranstellen: $key=… eldron/push-env.sh $STAGE" >&2
      exit 1
    fi
    read -r -s -p "$key für $STAGE: " value </dev/tty
    echo >&2
  fi
  [ -n "$value" ] || { echo "$key fehlt" >&2; exit 1; }
  BLOCK+="$key=$value"$'\n'
done

printf '%s' "$BLOCK" | ssh "$HOST" "python3 -c '
import sys
target = \"$TARGET\"
new = dict(l.split(\"=\", 1) for l in sys.stdin.read().splitlines() if \"=\" in l)
lines = open(target).read().splitlines()
seen = set()
for i, l in enumerate(lines):
    k = l.split(\"=\", 1)[0]
    if k in new:
        lines[i] = k + \"=\" + new[k]
        seen.add(k)
lines += [k + \"=\" + v for k, v in new.items() if k not in seen]
open(target, \"w\").write(\"\\n\".join(lines) + \"\\n\")
open_keys = [l.split(\"=\", 1)[0] for l in lines if \"=<\" in l]
print(\"$STAGE: \" + str(len(new)) + \" Werte gesetzt, offen: \" + (\", \".join(open_keys) or \"nichts\"))
'"
