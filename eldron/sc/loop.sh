#!/bin/bash
# Gleicht in festen Abständen jede SC-Org nach Immich ab (Export aus Convex/Clerk, dann Sync), Daten je Org unter /sc-data/orgs/<org>.
if [ -z "${CLERK_SECRET_KEY:-}" ] || [ -z "${CONVEX_DEPLOY_KEY:-}" ]; then
	echo "[loop] CLERK_SECRET_KEY oder CONVEX_DEPLOY_KEY fehlt – kein Abgleich"
	exit 0
fi
until curl -sf http://localhost:2283/api/server/ping >/dev/null; do sleep 10; done
while true; do
	if orgs=$(node /sc/orgs.ts); then
		while IFS=$'\t' read -r id name; do
			[ -n "$id" ] || continue
			echo "[loop] $name ($id)"
			export SC_ORG_ID="$id" SC_ORG_NAME="$name" SC_DATA_DIR="/sc-data/orgs/$id"
			node /sc/export.ts && node /sc/sync.ts || echo "[loop] Abgleich $id fehlgeschlagen"
		done <<< "$orgs"
	else
		echo "[loop] Org-Liste nicht abrufbar"
	fi
	sleep "${SC_SYNC_INTERVAL:-900}"
done
