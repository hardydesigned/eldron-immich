// Soll-Werte für run.sh – aus dem SentryCommand-Export und dem Immich-Bestand der Org.
import { readFileSync, readdirSync } from "node:fs";

const DATA = new URL("../sc-data/", import.meta.url).pathname;
const BASE = process.env.IMMICH_URL ?? "http://localhost:2283";
const ORG = process.env.SC_ORG_ID;

// Soll-Daten und der Schlüssel des Organisationsnutzers kommen aus SentryCommand.
const sc = await (async () => {
	const res = await fetch(`${process.env.CONVEX_URL.replace(/\/+$/, "")}/api/query`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			path: "immich/service_queries:syncData",
			args: { org_id: ORG, service_secret: process.env.CONVEX_SERVICE_SECRET },
			format: "json",
		}),
	});
	const body = await res.json();
	if (body.status !== "success") throw new Error(`Convex → ${body.errorMessage}`);
	return body.value;
})();
const key = sc.link.api_key;
const api = async (method, path, body) =>
	(await fetch(`${BASE}/api${path}`, { method, headers: { "x-api-key": key, "content-type": "application/json" }, body: body && JSON.stringify(body) })).json();

const participates = (op, crewId) => op.crew_ids.includes(crewId);

async function clerkMemberships() {
	const res = await fetch(`https://api.clerk.com/v1/organizations/${ORG}/memberships?limit=100`, {
		headers: { authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
	});
	if (!res.ok) throw new Error(`Clerk → ${res.status}`);
	return (await res.json()).data.map((m) => ({ clerk_user_id: m.public_user_data.user_id, role: m.role }));
}

async function albums() {
	return (await api("GET", "/albums")).filter((a) => a.description.includes("[sc:"));
}

async function memberAlbums() {
	const memberships = await clerkMemberships();
	const member = memberships.find((m) => m.role === "org:member" && sc.crew.some((c) => c.clerk_user_id === m.clerk_user_id));
	const crewIds = sc.crew.filter((c) => c.clerk_user_id === member.clerk_user_id).map((c) => c.id);
	return (await albums()).filter((album) => {
		const op = sc.operations.find((o) => album.description.includes(`[sc:${o.id}]`));
		return op && crewIds.some((id) => participates(op, id));
	});
}

async function assets(extra) {
	const items = [];
	let cursor;
	do {
		const page = (await api("POST", "/search/metadata", { size: 1000, withExif: true, ...extra, ...(cursor ? { cursor } : {}) })).assets;
		items.push(...page.items);
		cursor = page.nextCursor;
	} while (cursor);
	return items;
}

const located = (a) => a.exifInfo?.latitude != null;
const what = process.argv[2];
async function mosaicOperations() {
	const tiles = process.env.PHOTOMOSAIC_TILE_URL.replace(/\/+$/, "");
	const sessions = await (await fetch(`${tiles}/sessions`)).json();
	return sessions.filter((s) => s.org_id === ORG && s.min_lat != null).map((s) => s.operation_id);
}
if (what === "admin-albums") console.log((await albums()).length);
else if (what === "member-albums") console.log((await memberAlbums()).length);
else if (what === "located-assets") console.log((await assets()).filter(located).length);
else if (what === "located-videos") console.log((await assets({ type: "VIDEO" })).filter(located).length);
else if (what === "mosaic-count") console.log((await mosaicOperations()).length);
else if (what === "member-mosaic-count") {
	const mine = new Set((await memberAlbums()).map((a) => sc.operations.find((o) => a.description.includes(`[sc:${o.id}]`))?.id));
	console.log((await mosaicOperations()).filter((id) => mine.has(id)).length);
} else if (what === "mosaic-asset") {
	const [first] = await assets({ originalFileName: "mosaik_" });
	console.log(first?.id ?? "");
} else if (what === "track-check") {
	// Plausibilität aller Flugspuren: Zeitfenster, Sortierung, Ausdehnung, Länge ≈ Videolänge.
	const problems = [];
	let sessionAnchored = 0;
	for (const file of readdirSync(DATA + "tracks")) {
		const t = read("tracks/" + file);
		if (t.anchor === "session" || t.anchor === "session-end") sessionAnchored++;
		if (!(t.start < t.end)) problems.push(`${file}: start ≥ end`);
		if (t.points.some((p, i) => i > 0 && p.t < t.points[i - 1].t)) problems.push(`${file}: Punkte nicht sortiert`);
		if (t.points.some((p) => p.t < t.start - 15_000 || p.t > t.end + 15_000)) problems.push(`${file}: Punkt außerhalb des Videos`);
		const p0 = t.points[0];
		const far = t.points.filter((p) => Math.hypot((p.lat - p0.lat) * 111_000, (p.lng - p0.lng) * 70_000) > 5000);
		if (far.length) problems.push(`${file}: Punkt > 5 km vom Start`);
		const asset = (await api("GET", `/assets/${t.assetId}`));
		const videoMs = (() => { const d = String(asset.duration ?? ""); if (/^\d+(\.\d+)?$/.test(d)) return Number(d); const [h, m, s] = d.split(":").map(Number); return d.includes(":") ? ((h * 60 + m) * 60 + s) * 1000 : 0; })();
		if (videoMs > 0 && Math.abs((t.end - t.start) - videoMs) > Math.max(30_000, videoMs * 0.2)) problems.push(`${file}: Spur ${Math.round((t.end - t.start) / 1000)}s vs Video ${Math.round(videoMs / 1000)}s`);
	}
	console.log(JSON.stringify({ tracks: readdirSync(DATA + "tracks").length, sessionAnchored, problems }));
} else if (what === "track-asset") {
	// Die Spur mit der größten Bewegung – bei einer stehenden Drohne wandert der Marker nicht.
	const spread = (points) => Math.max(...points.map((p) => Math.hypot(p.lat - points[0].lat, p.lng - points[0].lng)));
	const tracks = readdirSync(DATA + "tracks").map((f) => ({ id: f.replace(".json", ""), n: spread(read("tracks/" + f).points) }));
	console.log(tracks.sort((a, b) => b.n - a.n)[0]?.id ?? "");
} else if (what === "foreign-asset-for-member") {
	const mine = new Set((await memberAlbums()).map((a) => a.id));
	const visible = new Set();
	for (const id of mine) for (const a of await assets({ albumIds: [id] })) visible.add(a.id);
	for (const album of (await albums()).filter((a) => !mine.has(a.id))) {
		const foreign = (await assets({ albumIds: [album.id] })).find((a) => !visible.has(a.id));
		if (foreign) { console.log(foreign.id); break; }
	}
}
