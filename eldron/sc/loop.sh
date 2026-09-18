#!/bin/bash
# Gleicht die SC-Org in festen Abständen nach Immich ab (Export aus Convex/Clerk, dann Sync).
if [ -z "${SC_ORG_ID:-}" ] || [ -z "${CONVEX_DEPLOY_KEY:-}" ]; then
	echo "[loop] SC_ORG_ID oder CONVEX_DEPLOY_KEY fehlt – kein Abgleich"
	exit 0
fi
until curl -sf http://localhost:2283/api/server/ping >/dev/null; do sleep 10; done
while true; do
	node /sc/export.ts && node /sc/sync.ts || echo "[loop] Abgleich fehlgeschlagen"
	sleep "${SC_SYNC_INTERVAL:-900}"
done
