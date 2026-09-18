#!/bin/bash
# End-to-End-Abnahme der Immich-Anbindung mit playwright-cli.
# Aufruf: eldron/e2e/run.sh   (Stack läuft, sc/export.ts + sc/sync.ts sind gelaufen)
set -uo pipefail
cd "$(dirname "$0")"
BASE=${IMMICH_URL:-http://localhost:2283}
ENV=../.env
PASS=0
FAIL=0

pw() { playwright-cli -s="$SESSION" "$@"; }
js() { pw --raw eval "$1" 2>/dev/null | tail -1 | sed -e 's/^"//' -e 's/"$//' -e 's/\\"/"/g'; }
ok() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
bad() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); pw screenshot >/dev/null 2>&1; }
check() { if [ "$2" = "true" ]; then ok "$1"; else bad "$1 (war: $2)"; fi; }
wait_for() { # wait_for <js-bool-expr> [sekunden]
	local i=0
	while [ $i -lt "${2:-30}" ]; do
		[ "$(js "() => Boolean($1)")" = "true" ] && return 0
		sleep 1; i=$((i + 1))
	done
	return 1
}

login() { # login <admin|member>
	SESSION=$1
	pw close >/dev/null 2>&1
	pw open "$(node --no-warnings --env-file=$ENV ../sc/signin-url.ts "$1")" >/dev/null 2>&1
	pw resize 1440 900 >/dev/null 2>&1
	wait_for "location.host.includes('accounts.dev') && !location.search.includes('ticket')" 30
	pw goto "$BASE/auth/login" >/dev/null 2>&1
	wait_for "[...document.querySelectorAll('button')].some(b => b.textContent.includes('OAuth'))" 20
	pw run-code "async page => { await page.getByRole('button', { name: /OAuth/ }).click(); await page.waitForURL('**/photos', { timeout: 60000 }); }" >/dev/null 2>&1
	check "[$1] Anmeldung über Clerk landet in Immich" "$(js "() => location.pathname === '/photos'")"
}

api() { js "async () => JSON.stringify(await (await fetch('/api$1', { credentials: 'include' })).json())"; }

expected() { node --no-warnings --env-file=$ENV expected.mjs "$1"; }

# ---------- Admin ----------
login admin
echo "Admin: Ordner je Einsatz"
pw goto "$BASE/albums" >/dev/null 2>&1
wait_for "document.querySelectorAll('a[href^=\"/albums/\"]').length > 0" 30
WANT=$(expected admin-albums)
GOT=$(js "async () => (await (await fetch('/api/albums', { credentials: 'include' })).json()).filter(a => a.description.includes('[sc:')).length")
check "Admin sieht alle $WANT Einsatz-Alben (API: $GOT)" "$([ "$GOT" = "$WANT" ] && echo true || echo false)"
SHOWN=$(js "() => document.querySelectorAll('a[href^=\"/albums/\"]').length")
check "Alben-Seite zeigt die Ordner direkt an ($SHOWN sichtbar)" "$([ "${SHOWN:-0}" -ge 10 ] && echo true || echo false)"
pw run-code "async page => { await page.locator('a[href^=\"/albums/\"]').first().click(); await page.waitForURL('**/albums/*'); }" >/dev/null 2>&1
wait_for "document.querySelectorAll('[data-asset-id], [data-thumbnail-focus-container]').length > 0" 30
check "Ein Einsatz-Ordner öffnet sich und zeigt Medien" "$(js "() => document.querySelectorAll('[data-asset-id], [data-thumbnail-focus-container]').length > 0")"

echo "Admin: alle Dateien ohne Umweg über »Geteiltes«"
pw goto "$BASE/photos" >/dev/null 2>&1
wait_for "document.querySelectorAll('[data-asset-id], [data-thumbnail-focus-container]').length > 5" 40
check "Zeitleiste »Fotos« zeigt die Org-Medien" "$(js "() => document.querySelectorAll('[data-asset-id], [data-thumbnail-focus-container]').length > 5")"

echo "Admin: Suche"
pw run-code "async page => { await page.goto('$BASE/search?query=' + encodeURIComponent(JSON.stringify({ originalFileName: 'DJI' }))); }" >/dev/null 2>&1
wait_for "document.querySelectorAll('[data-asset-id], [data-thumbnail-focus-container]').length > 0" 40
check "Suche nach Dateiname »DJI« liefert Treffer" "$(js "() => document.querySelectorAll('[data-asset-id], [data-thumbnail-focus-container]').length > 0")"
SMART=$(js "async () => { const r = await fetch('/api/search/smart', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'Straße mit Autos', size: 5 }) }); return r.ok ? (await r.json()).assets.items.length : -1 }")
check "Textsuche (KI) liefert Treffer ($SMART)" "$([ "${SMART:-0}" -gt 0 ] && echo true || echo false)"

echo "Admin: Karte mit Bildern, Videos und Zeitstrahl"
pw goto "$BASE/map" >/dev/null 2>&1
wait_for "document.querySelector('[data-testid=sc-timebar]')" 40
check "Zeitstrahl-Leiste ist auf der Karte" "$(js "() => Boolean(document.querySelector('[data-testid=sc-timebar]'))")"
MARKERS=$(js "async () => (await (await fetch('/api/map/markers?withPartners=true&withSharedAlbums=true', { credentials: 'include' })).json()).length")
WANT_MAP=$(expected located-assets)
check "Karte kennt alle verorteten Medien ($MARKERS von $WANT_MAP)" "$([ "${MARKERS:-0}" -ge "$WANT_MAP" ] && echo true || echo false)"
VIDEOS=$(expected located-videos)
check "darunter Videos ($VIDEOS)" "$([ "${VIDEOS:-0}" -gt 0 ] && echo true || echo false)"
count_on_map() { js "() => [...document.querySelectorAll('[data-testid=sc-map-cluster]')].reduce((n, e) => n + Number(e.dataset.count), 0) + document.querySelectorAll('[data-testid=sc-map-marker]').length"; }
wait_for "document.querySelectorAll('[data-testid=sc-map-cluster],[data-testid=sc-map-marker]').length > 0" 30
ALL=$(count_on_map)
pw run-code "async page => { const to = page.getByTestId('sc-timebar-to'); const max = Number(await to.getAttribute('max')); await to.fill(String(Math.max(1, Math.floor(max / 3)))); await page.waitForTimeout(2500); }" >/dev/null 2>&1
FILTERED=$(count_on_map)
check "Zeitstrahl filtert die Karte ($ALL → $FILTERED)" "$([ "${FILTERED:-0}" -lt "${ALL:-0}" ] && echo true || echo false)"
pw run-code "async page => { await page.getByTestId('sc-timebar-reset').click(); await page.waitForTimeout(2500); }" >/dev/null 2>&1
check "»Alle« setzt den Zeitstrahl zurück ($(count_on_map))" "$([ "$(count_on_map)" = "$ALL" ] && echo true || echo false)"

echo "Admin: Telemetrie zum Video"
TRACK=$(expected track-asset)
pw goto "$BASE/map" >/dev/null 2>&1
wait_for "document.querySelector('[data-testid=sc-timebar]')" 40
STATUS=$(js "async () => (await fetch('/sc-api/telemetry/$TRACK', { credentials: 'include' })).status")
check "Flugspur-Endpunkt liefert die Spur (HTTP $STATUS)" "$([ "$STATUS" = "200" ] && echo true || echo false)"
wait_for "document.querySelector('[data-testid=sc-tracks-toggle]')" 30
WANT_TRACKS=$(ls ../sc-data/tracks | wc -l | tr -d ' ')
check "Karte bietet alle $WANT_TRACKS Flugspuren an" "$([ "$(js "() => document.querySelector('[data-testid=sc-tracks-toggle]')?.dataset.count")" = "$WANT_TRACKS" ] && echo true || echo false)"
check "Videos mit Flugspur haben eigene Marker" "$(js "() => document.querySelectorAll('[data-testid=sc-track-marker]').length > 0")"
pw run-code "async page => {
	await page.getByTestId('sc-tracks-toggle').click();
	await page.locator('[data-testid=sc-tracks-item][data-asset-id=\"$TRACK\"]').click();
	await page.getByTestId('sc-telemetry-panel').waitFor({ timeout: 20000 });
	await page.waitForTimeout(2500);
}" >/dev/null 2>&1
check "Klick auf das Video öffnet das Telemetrie-Fenster" "$(js "() => Boolean(document.querySelector('[data-testid=sc-telemetry-panel]'))")"
check "Flugspur liegt als Linie auf der Karte" "$(js "() => Number(document.querySelector('[data-testid=sc-telemetry-panel]')?.dataset.points) >= 2 && Boolean(document.querySelector('[data-testid=sc-telemetry-drone]'))")"
check "Höhe/Geschwindigkeit werden angezeigt" "$(js "() => /\\d/.test(document.querySelector('[data-testid=sc-telemetry-alt]')?.textContent ?? '')")"
BEFORE=$(js "() => document.querySelector('[data-testid=sc-telemetry-drone]')?.dataset.lnglat")
wait_for "Number.isFinite(document.querySelector('[data-testid=sc-telemetry-video]')?.duration)" 120
check "Video wird im Fenster abgespielt" "$(js "() => Number.isFinite(document.querySelector('[data-testid=sc-telemetry-video]')?.duration)")"
pw run-code "async page => { await page.getByTestId('sc-telemetry-video').evaluate(v => { v.pause(); v.currentTime = v.duration * 0.8; }); await page.waitForTimeout(3000); }" >/dev/null 2>&1
AFTER=$(js "() => document.querySelector('[data-testid=sc-telemetry-drone]')?.dataset.lnglat")
check "Drohnen-Marker folgt dem Video ($BEFORE → $AFTER)" "$([ -n "$AFTER" ] && [ "$BEFORE" != "$AFTER" ] && echo true || echo false)"

echo "Admin: Fotomosaik"
WANT_MOSAIC=$(expected mosaic-count)
pw goto "$BASE/map" >/dev/null 2>&1
wait_for "document.querySelector('[data-testid=sc-mosaic-toggle]')" 40
check "Mosaik-Ebene bietet alle $WANT_MOSAIC Mosaike an" "$([ "$(js "() => document.querySelector('[data-testid=sc-mosaic-toggle]')?.dataset.count")" = "$WANT_MOSAIC" ] && echo true || echo false)"
TILES=$(pw run-code "async page => { const seen = []; page.on('response', r => { if (r.url().includes('/sc-api/mosaics/')) seen.push(r.status()); }); await page.getByTestId('sc-mosaic-fit').click(); await page.waitForTimeout(9000); return seen.filter(s => s === 200).length; }" 2>/dev/null | grep -A1 Result | tail -1 | tr -d '"')
check "Mosaik-Kacheln werden auf der Karte geladen ($TILES Kacheln)" "$([ "${TILES:-0}" -gt 3 ] && echo true || echo false)"
pw run-code "async page => { await page.getByTestId('sc-mosaic-toggle').click(); await page.waitForTimeout(1000); }" >/dev/null 2>&1
check "Mosaik-Ebene lässt sich ausschalten" "$(js "() => document.querySelector('[data-testid=sc-mosaic-toggle]')?.dataset.enabled === 'false'")"
MOSAIC_ASSET=$(expected mosaic-asset)
check "Mosaik liegt als Bild-Element vor" "$([ -n "$MOSAIC_ASSET" ] && echo true || echo false)"
check "Mosaik hat ein Vorschaubild" "$(js "async () => { const r = await fetch('/api/assets/$MOSAIC_ASSET/thumbnail?size=preview', { credentials: 'include' }); return r.ok && (r.headers.get('content-type') || '').startsWith('image/'); }")"
THUMB=$(js "async () => { const r = await fetch('/api/assets/$MOSAIC_ASSET/thumbnail?size=preview', { credentials: 'include' }); return r.status + ' ' + (r.headers.get('content-type') || ''); }")
INFO=$(js "async () => { const a = await (await fetch('/api/assets/$MOSAIC_ASSET', { credentials: 'include' })).json(); const albums = await (await fetch('/api/albums?assetId=$MOSAIC_ASSET', { credentials: 'include' })).json(); return JSON.stringify({ w: a.exifInfo?.exifImageWidth, gps: a.exifInfo?.latitude != null, desc: (a.exifInfo?.description || '').slice(0, 10), albums: albums.length }); }")
check "Mosaik hat Ort, Beschreibung und liegt im Einsatz-Ordner ($INFO)" "$(js "async () => { const a = await (await fetch('/api/assets/$MOSAIC_ASSET', { credentials: 'include' })).json(); const albums = await (await fetch('/api/albums?assetId=$MOSAIC_ASSET', { credentials: 'include' })).json(); return a.exifInfo?.latitude != null && (a.exifInfo?.description || '').startsWith('Fotomosaik') && albums.length >= 1; }")"
pw run-code "async page => { await page.goto('$BASE/search?query=' + encodeURIComponent(JSON.stringify({ originalFileName: 'mosaik_' }))); await page.waitForTimeout(4000); }" >/dev/null 2>&1
check "Mosaik-Bilder sind unter »Fotos«/Suche zu finden" "$(js "() => document.querySelectorAll('[data-asset-id], [data-thumbnail-focus-container]').length > 0")"
pw run-code "async page => { await page.goto('$BASE/photos/$MOSAIC_ASSET'); await page.waitForTimeout(6000); }" >/dev/null 2>&1
check "Mosaik öffnet sich im Viewer in voller Auflösung" "$(js "() => [...document.querySelectorAll('img')].some(i => i.src.includes('$MOSAIC_ASSET') && i.naturalWidth > 1000)")"

echo "Admin: Flugspuren plausibel"
TRACKS=$(expected track-check)
check "Alle Spuren liegen im Zeitfenster ihres Videos, sortiert, ≤ 5 km, Länge ≈ Video ($TRACKS)" "$(node -e "const r=JSON.parse(process.argv[1]);console.log(r.problems.length===0 && r.tracks>0)" "$TRACKS")"
check "Mehrheit der Spuren hat die Stream-Sitzung als Zeitanker" "$(node -e "const r=JSON.parse(process.argv[1]);console.log(r.sessionAnchored*2>r.tracks)" "$TRACKS")"
pw close >/dev/null 2>&1

# ---------- Mitglied ----------
login member
echo "Mitglied: nur die eigenen Einsätze"
WANT=$(expected member-albums)
GOT=$(js "async () => (await (await fetch('/api/albums?shared=true', { credentials: 'include' })).json()).filter(a => a.description.includes('[sc:')).length")
check "Mitglied sieht genau seine $WANT Einsatz-Alben (API: $GOT)" "$([ "$GOT" = "$WANT" ] && echo true || echo false)"
pw goto "$BASE/albums" >/dev/null 2>&1
wait_for "document.querySelectorAll('a[href^=\"/albums/\"]').length > 0" 30
check "Ordner stehen direkt unter »Alben«" "$(js "() => document.querySelectorAll('a[href^=\"/albums/\"]').length > 0")"
FOREIGN=$(expected foreign-asset-for-member)
if [ -n "$FOREIGN" ]; then
	CODE=$(js "async () => (await fetch('/api/assets/$FOREIGN', { credentials: 'include' })).status")
	check "Medium aus fremdem Einsatz ist gesperrt (HTTP $CODE)" "$([ "$CODE" != "200" ] && echo true || echo false)"
	CODE=$(js "async () => (await fetch('/sc-api/telemetry/$FOREIGN', { credentials: 'include' })).status")
	check "…auch dessen Flugspur (HTTP $CODE)" "$([ "$CODE" != "200" ] && echo true || echo false)"
else
	ok "kein fremder Einsatz vorhanden (Mitglied war überall dabei)"
fi
pw goto "$BASE/map" >/dev/null 2>&1
wait_for "document.querySelector('[data-testid=sc-timebar]')" 40
wait_for "document.querySelectorAll('[data-testid=sc-map-cluster],[data-testid=sc-map-marker]').length > 0" 30
check "Mitglied sieht die Medien seiner Einsätze auf der Karte" "$(js "() => document.querySelectorAll('[data-testid=sc-map-cluster],[data-testid=sc-map-marker]').length > 0")"
WANT_MM=$(expected member-mosaic-count)
GOT_MM=$(js "async () => (await (await fetch('/sc-api/mosaics', { credentials: 'include' })).json()).length")
check "Mitglied bekommt nur die Mosaike seiner Einsätze ($GOT_MM von $WANT_MM)" "$([ "$GOT_MM" = "$WANT_MM" ] && echo true || echo false)"
pw close >/dev/null 2>&1

# ---------- Mitglied ohne Einsatz ----------
login outsider
echo "Mitglied ohne Einsatz: sieht nichts"
GOT=$(js "async () => (await (await fetch('/api/albums', { credentials: 'include' })).json()).length")
check "keine Einsatz-Alben (API: $GOT)" "$([ "$GOT" = "0" ] && echo true || echo false)"
GOT=$(js "async () => (await (await fetch('/api/map/markers?withPartners=true&withSharedAlbums=true', { credentials: 'include' })).json()).length")
check "keine Medien auf der Karte ($GOT)" "$([ "$GOT" = "0" ] && echo true || echo false)"
GOT=$(js "async () => (await (await fetch('/sc-api/mosaics', { credentials: 'include' })).json()).length")
check "keine Mosaike ($GOT)" "$([ "$GOT" = "0" ] && echo true || echo false)"
FIRST_MOSAIC=$(node --no-warnings --env-file=$ENV -e "fetch(process.env.PHOTOMOSAIC_TILE_URL.replace(/\\/+$/,'')+'/sessions').then(r=>r.json()).then(s=>console.log(s.find(x=>x.org_id===process.env.SC_ORG_ID&&x.min_lat!=null).id))")
CODE=$(js "async () => (await fetch('/sc-api/mosaics/$FIRST_MOSAIC/tiles/18/136026/87577.webp', { credentials: 'include' })).status")
check "Mosaik-Kacheln fremder Einsätze sind gesperrt (HTTP $CODE)" "$([ "$CODE" != "200" ] && echo true || echo false)"
pw close >/dev/null 2>&1

echo
echo "Ergebnis: $PASS bestanden, $FAIL fehlgeschlagen"
[ "$FAIL" -eq 0 ]
