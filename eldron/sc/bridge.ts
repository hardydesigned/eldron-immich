// Liefert Flugspuren zu Videos. Zugriff prüft Immich selbst: nur wer das Asset lesen darf, bekommt die Spur.
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const IMMICH = process.env.IMMICH_INTERNAL_URL ?? "http://localhost:2283";
const PORT = Number(process.env.SC_BRIDGE_PORT ?? 2284);
const TILES = (process.env.PHOTOMOSAIC_TILE_URL ?? "").replace(/\/+$/, "");
const MOSAIC_TILE = /^\/sc-api\/mosaics\/(op-[a-z0-9]+)\/tiles\/(\d+)\/(\d+)\/(\d+)\.webp(\?t=\d+)?$/;
const ID = /^\/sc-api\/telemetry\/([0-9a-f-]{36})$/;

type Track = { assetId: string; start: number; end: number; points: Array<{ lat: number; lng: number }> };

const ORGS_DIR = "/sc-data/orgs";
const trackDirs = () =>
	existsSync(ORGS_DIR) ? readdirSync(ORGS_DIR).map((org) => `${ORGS_DIR}/${org}/tracks`).filter((dir) => existsSync(dir)) : [];

// Übersicht aller Flugspuren, deren Video der Aufrufer auf seiner Karte sehen darf.
async function listTracks(headers: Record<string, string>) {
	const markers = await fetch(`${IMMICH}/api/map/markers?withPartners=true&withSharedAlbums=true`, { headers });
	if (!markers.ok) return null;
	const visible = new Set(((await markers.json()) as Array<{ id: string }>).map((m) => m.id));
	return trackDirs()
		.flatMap((dir) => readdirSync(dir).filter((file) => visible.has(file.replace(".json", ""))).map((file) => `${dir}/${file}`))
		.map((file) => JSON.parse(readFileSync(file, "utf8")) as Track)
		.map((t) => ({ assetId: t.assetId, start: t.start, end: t.end, lat: t.points[0].lat, lng: t.points[0].lng }))
		.sort((a, b) => b.start - a.start);
}

// Einsätze, deren Album der Aufrufer sieht – dieselbe Regel wie für Ordner und Medien.
async function allowedOperations(headers: Record<string, string>): Promise<Map<string, string> | null> {
	const res = await fetch(`${IMMICH}/api/albums?shared=true`, { headers });
	const own = await fetch(`${IMMICH}/api/albums`, { headers });
	if (!res.ok || !own.ok) return null;
	const albums = [...((await res.json()) as Array<{ albumName: string; description: string }>), ...((await own.json()) as Array<{ albumName: string; description: string }>)];
	return new Map(albums.flatMap((a) => [...a.description.matchAll(/\[sc:([a-z0-9]+)\]/g)].map((m) => [m[1], a.albumName] as const)));
}

type MosaicSession = { id: string; org_id: string; operation_id: string; min_lat: number | null; min_lng: number | null; max_lat: number | null; max_lng: number | null; created_at: number; updated_at: number };

type Mosaic = { id: string; operationId: string; name: string; bounds: number[]; createdAt: number; updatedAt: number };
// Kacheln kommen zu Dutzenden – die Rechteprüfung gilt je Sitzung 30 s.
const mosaicCache = new Map<string, { until: number; value: Mosaic[] | null }>();

async function listMosaics(headers: Record<string, string>): Promise<Mosaic[] | null> {
	if (!TILES) return [];
	const key = headers.cookie ?? headers.authorization ?? headers["x-api-key"] ?? "";
	const cached = mosaicCache.get(key);
	if (cached && cached.until > Date.now()) return cached.value;
	const value = await loadMosaics(headers);
	mosaicCache.set(key, { until: Date.now() + 30_000, value });
	return value;
}

async function loadMosaics(headers: Record<string, string>): Promise<Mosaic[] | null> {
	const allowed = await allowedOperations(headers);
	if (!allowed) return null;
	const sessions = (await (await fetch(`${TILES}/sessions`)).json()) as MosaicSession[];
	return sessions
		.filter((s) => s.min_lat != null && allowed.has(s.operation_id))
		.map((s) => ({ id: s.id, operationId: s.operation_id, name: allowed.get(s.operation_id) ?? s.operation_id, bounds: [s.min_lng, s.min_lat, s.max_lng, s.max_lat], createdAt: s.created_at, updatedAt: s.updated_at }));
}

createServer(async (req, res) => {
	const headers: Record<string, string> = {};
	for (const name of ["cookie", "authorization", "x-api-key"]) {
		const value = req.headers[name];
		if (typeof value === "string") headers[name] = value;
	}
	if (req.method === "GET" && req.url === "/sc-api/mosaics") {
		const mosaics = await listMosaics(headers).catch(() => null);
		res.writeHead(mosaics ? 200 : 401, { "content-type": "application/json", "cache-control": "no-store" });
		res.end(JSON.stringify(mosaics ?? []));
		return;
	}
	const tile = MOSAIC_TILE.exec(req.url ?? "");
	if (req.method === "GET" && tile) {
		const mosaics = await listMosaics(headers).catch(() => null);
		if (!mosaics?.some((m) => m.id === tile[1])) {
			res.writeHead(mosaics ? 404 : 401).end();
			return;
		}
		const upstream = await fetch(`${TILES}/sessions/${tile[1]}/tiles/${tile[2]}/${tile[3]}/${tile[4]}.webp${tile[5] ?? ""}`).catch(() => null);
		if (!upstream?.ok) {
			res.writeHead(404).end();
			return;
		}
		res.writeHead(200, { "content-type": "image/webp", "cache-control": upstream.headers.get("cache-control") ?? "public, max-age=5" });
		res.end(Buffer.from(await upstream.arrayBuffer()));
		return;
	}
	if (req.method === "GET" && req.url === "/sc-api/tracks") {
		const tracks = await listTracks(headers).catch(() => null);
		res.writeHead(tracks ? 200 : 401, { "content-type": "application/json", "cache-control": "no-store" });
		res.end(JSON.stringify(tracks ?? []));
		return;
	}
	const match = ID.exec(req.url ?? "");
	if (req.method !== "GET" || !match) {
		res.writeHead(404).end();
		return;
	}
	const access = await fetch(`${IMMICH}/api/assets/${match[1]}`, { headers }).catch(() => null);
	const file = trackDirs().map((dir) => `${dir}/${match[1]}.json`).find((f) => existsSync(f));
	if (!access?.ok || !file) {
		res.writeHead(access?.status === 401 ? 401 : 404).end();
		return;
	}
	res.writeHead(200, { "content-type": "application/json", "cache-control": "private, max-age=60" });
	res.end(readFileSync(file));
}).listen(PORT, () => console.log(`[sc-bridge] :${PORT}`));
