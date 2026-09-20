# ELDRON-Medien (Immich-Fork für SentryCommand)

Fork von [immich-app/immich](https://github.com/immich-app/immich) auf Tag `v3.2.2`. Geändert ist nur die
Web-Oberfläche (ELDRON-Branding, Zeitstrahl, Flugspur-Ebene, Telemetrie-Fenster); dazu kommt dieser Ordner mit der
SentryCommand-Anbindung. Lizenz: AGPL-3.0 wie das Original – die Oberfläche verlinkt auf dieses Repo.

## Aufbau

- `Dockerfile` – baut die Web-Oberfläche aus diesem Fork und legt sie in das offizielle `immich-server`-Image,
  dazu rclone (S3-Bucket read-only + lokale XMP-Sidecars), `ffprobe-shim.sh` und `sc/`.
- `sc/bridge.ts` – `/sc-api` (Flugspuren, Fotomosaik) hinter dem internen Caddy.
- `sc/worker.ts` – `/sc-worker/sync`: nimmt den Anstoß aus SentryCommand entgegen (gemeinsames
  Geheimnis) und läuft den Dateiteil (`files.ts`): Bibliotheken, App-Uploads, Fotomosaike,
  Positionen, Flugspuren. Danach meldet er sich an `SC_CONVEX_SITE_URL/immich/worker-done` zurück.
- `sc/lib/convex.ts` – liest SentryCommand über `POST $CONVEX_URL/api/query`
  (`immich/service_queries`), ausgewiesen mit `CONVEX_SERVICE_SECRET`. Kein Deploy-Key: der
  Dienst darf genau diese beiden Abfragen, Telemetrie nur im Zeitfenster einer Aufnahme.
- `e2e/run.sh` – Abnahme mit playwright-cli gegen eine laufende Stufe.

Konten, Freigaben und die Einsatz-Alben legt SentryCommand selbst über die Immich-API an
(`convex/immich/`); angestoßen wird der ganze Abgleich dort per Cron im Viertelstundentakt.
Der technische Organisationsnutzer samt API-Schlüssel steht in SentryCommand (`immich_links`),
nicht mehr in einer `state.json` im Container.

## Branches und Server

- `staging` → `/root/eldron-immich-staging` auf `eldron-suite`, https://media-stg.sentrycommand.com
- `main` → `/root/eldron-immich-prod`, https://media.sentrycommand.com

Push löst `.github/workflows/eldron-deploy.yml` aus (Tailnet → SSH → `eldron/deploy.sh <stufe>`).
Environments `staging`/`prod` brauchen `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`.
Je Stufe eigene `eldron/.env` (Vorlage `env.template`) und eigenes Compose-Projekt `eldron-immich-<stufe>`.

## Einrichtung einer Stufe (einmalig, in der Immich-Oberfläche)

1. Admin mit `IMMICH_ADMIN_EMAIL`/`IMMICH_ADMIN_PASSWORD` anlegen.
2. Maschinelles Lernen → CLIP-Modell `nllb-clip-base-siglip__v1` (sonst findet die deutsche Suche nichts),
   danach Job „Smart Search" mit „Alle" neu starten.
3. Transcoding aus (Videos liegen im S3-Bucket).
4. OAuth: Clerk-OAuth-App der Stufe, „Auto Register" an. Nutzer werden per E-Mail verknüpft.
5. Admin-API-Schlüssel anlegen (Kontoeinstellungen → API-Schlüssel) und am Convex-Deployment
   der Stufe als `IMMICH_ADMIN_API_KEY` hinterlegen, dazu `IMMICH_URL` (öffentliche Adresse
   dieser Stufe), `SC_WORKER_URL` (dieselbe Adresse), `IMMICH_SERVICE_SECRET` (wie in
   `eldron/.env`) und `IMMICH_S3_ROOT` (`/mnt/s3`). Ohne `IMMICH_URL` bleibt der Abgleich aus.

## Upstream-Update

```bash
git fetch upstream tag v3.x.y
git checkout staging && git merge v3.x.y
# IMMICH_VERSION in beiden Server-.env anheben; Base-Image-Digests im Dockerfile aus server/Dockerfile übernehmen
git push
```
