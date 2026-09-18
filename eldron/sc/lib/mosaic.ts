// Mosaik-Sitzungen des Kachel-Servers als Bild-Elemente: ein WebP aus den Kacheln + XMP-Sidecar (Ort, Beschreibung).
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire("/usr/src/app/server/package.json");
const sharp = require("sharp") as typeof import("sharp");

const TILES = (process.env.PHOTOMOSAIC_TILE_URL ?? "").replace(/\/+$/, "");
const TILE = 256;
const MAX_EDGE = 4096;

export type MosaicSession = {
	id: string;
	org_id: string;
	operation_id: string;
	min_lat: number | null;
	min_lng: number | null;
	max_lat: number | null;
	max_lng: number | null;
	updated_at: number;
};

export async function listSessions(org: string): Promise<MosaicSession[]> {
	if (!TILES) return [];
	const sessions = (await (await fetch(`${TILES}/sessions`)).json()) as MosaicSession[];
	return sessions.filter((s) => s.org_id === org && s.min_lat != null && s.max_lat != null);
}

function tileXY(lat: number, lng: number, z: number) {
	const n = 2 ** z;
	const x = ((lng + 180) / 360) * n;
	const rad = (lat * Math.PI) / 180;
	const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
	return { x, y };
}

/** Größter Zoom, bei dem das ganze Mosaik in MAX_EDGE Pixel passt. */
function pickZoom(s: MosaicSession): number {
	for (let z = 21; z > 12; z--) {
		const a = tileXY(s.max_lat!, s.min_lng!, z);
		const b = tileXY(s.min_lat!, s.max_lng!, z);
		if ((b.x - a.x) * TILE <= MAX_EDGE && (b.y - a.y) * TILE <= MAX_EDGE) return z;
	}
	return 13;
}

export type RenderedMosaic = { session: MosaicSession; path: string; zoom: number; tiles: number };

/** Setzt die Kacheln einer Sitzung zu einem Bild zusammen; gibt null zurück, wenn es keine Kacheln gibt. */
export async function renderMosaic(s: MosaicSession, dir: string): Promise<RenderedMosaic | null> {
	const zoom = pickZoom(s);
	const a = tileXY(s.max_lat!, s.min_lng!, zoom);
	const b = tileXY(s.min_lat!, s.max_lng!, zoom);
	const x0 = Math.floor(a.x), y0 = Math.floor(a.y), x1 = Math.floor(b.x), y1 = Math.floor(b.y);
	const width = (x1 - x0 + 1) * TILE, height = (y1 - y0 + 1) * TILE;
	const layers: Array<{ input: Buffer; left: number; top: number }> = [];
	for (let x = x0; x <= x1; x++) {
		for (let y = y0; y <= y1; y++) {
			const res = await fetch(`${TILES}/sessions/${s.id}/tiles/${zoom}/${x}/${y}.webp`).catch(() => null);
			if (res?.ok) layers.push({ input: Buffer.from(await res.arrayBuffer()), left: (x - x0) * TILE, top: (y - y0) * TILE });
		}
	}
	if (layers.length === 0) return null;
	// Auf den Rand des Mosaiks zuschneiden – die Kachelkanten liegen außerhalb.
	const crop = {
		left: Math.round((a.x - x0) * TILE),
		top: Math.round((a.y - y0) * TILE),
		width: Math.max(1, Math.round((b.x - a.x) * TILE)),
		height: Math.max(1, Math.round((b.y - a.y) * TILE)),
	};
	mkdirSync(dir, { recursive: true });
	const path = `${dir}/mosaik_${s.operation_id}.webp`;
	const image = await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
		.composite(layers)
		.extract(crop)
		.webp({ quality: 88 })
		.toBuffer();
	writeFileSync(path, image);
	return { session: s, path, zoom, tiles: layers.length };
}

const dms = (value: number, pos: string, neg: string) => {
	const abs = Math.abs(value);
	const deg = Math.floor(abs);
	const min = ((abs - deg) * 60).toFixed(4);
	return `${deg},${min}${value >= 0 ? pos : neg}`;
};

export function writeSidecar(rendered: RenderedMosaic, title: string) {
	const s = rendered.session;
	const lat = (s.min_lat! + s.max_lat!) / 2;
	const lng = (s.min_lng! + s.max_lng!) / 2;
	const xmp = `<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <exif:GPSLatitude>${dms(lat, "N", "S")}</exif:GPSLatitude>
      <exif:GPSLongitude>${dms(lng, "E", "W")}</exif:GPSLongitude>
      <exif:DateTimeOriginal>${new Date(s.updated_at).toISOString().replace(/\.\d+Z$/, "")}</exif:DateTimeOriginal>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Fotomosaik · ${title}</rdf:li></rdf:Alt></dc:description>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
`;
	writeFileSync(`${rendered.path}.xmp`, xmp);
}
