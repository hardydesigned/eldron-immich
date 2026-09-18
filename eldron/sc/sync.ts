// Gleicht eine SentryCommand-Org nach Immich ab: Bibliotheken, Einsatz-Alben, Crew/Admins, Positionen, Flugspuren.
// docker compose exec immich-server node /sc/sync.ts
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { api, durationMs, listLibraryAssets, login, waitForQueues, type Asset, type Auth } from "./lib/immich.ts";
import { crewEmail, crewParticipates, load, operationAt, operationCenter, type Member } from "./lib/data.ts";
import { buildTrack, droneForVideo, recordingWindow } from "./lib/tracks.ts";
import { listSessions, renderMosaic, writeSidecar } from "./lib/mosaic.ts";

const DATA = process.env.SC_DATA_DIR ?? "/sc-data";
const ORG = (JSON.parse(readFileSync(`${DATA}/convex/meta.json`, "utf8")) as { org_id: string }).org_id;
const ORG_NAME = process.env.SC_ORG_NAME ?? "Feuerwehr";
const STATE_FILE = `${DATA}/state.json`;
const S3_ROOT = `/mnt/s3/${ORG}`;
const UPLOAD_ROOT = `${DATA}/uploads/${ORG}`;

type User = { id: string; email: string };
type State = { orgUser?: { id: string; key: string } };

const state: State = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const admin: Auth = { token: await login(process.env.IMMICH_ADMIN_EMAIL!, process.env.IMMICH_ADMIN_PASSWORD!) };
const log = (msg: string) => console.log(`[sync] ${msg}`);

function sql(statement: string, vars: Record<string, string>) {
	const args = ["-h", "database", "-U", process.env.DB_USERNAME!, "-d", process.env.DB_DATABASE_NAME!, "-v", "ON_ERROR_STOP=1"];
	for (const [name, value] of Object.entries(vars)) args.push("-v", `${name}=${value}`);
	execFileSync("psql", args, { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD }, input: statement });
}

// Personen bekommen kein bekanntes Passwort: sie melden sich per OIDC an und werden per E-Mail verknüpft.
async function ensureUser(email: string, name: string): Promise<User> {
	const users = await api<User[]>("GET", "/admin/users", admin);
	const existing = users.find((u) => u.email.toLowerCase() === email);
	if (existing) return existing;
	const user = await api<User>("POST", "/admin/users", admin, { email, name, password: randomBytes(24).toString("hex"), shouldChangePassword: false });
	// Kein Immich-Einrichtungsassistent beim ersten Login – das Konto kommt fertig aus SentryCommand.
	sql(`INSERT INTO user_metadata ("userId", key, value) VALUES (:'id', 'onboarding', '{"isOnboarded": true}') ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value;`, { id: user.id });
	return user;
}

async function ensureOrgUser(): Promise<Auth> {
	const email = `${ORG.toLowerCase()}@orgs.local`;
	const user = await ensureUser(email, `${ORG_NAME} (Org)`);
	await api("PUT", `/admin/users/${user.id}`, admin, { name: `${ORG_NAME} (Org)` });
	if (state.orgUser?.id !== user.id) {
		const password = randomBytes(24).toString("hex");
		await api("PUT", `/admin/users/${user.id}`, admin, { password });
		const key = await api<{ secret: string }>("POST", "/api-keys", { token: await login(email, password) }, { name: "sc-sync", permissions: ["all"] });
		state.orgUser = { id: user.id, key: key.secret };
		writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
	}
	return { key: state.orgUser!.key };
}

async function ensureLibraries(ownerId: string) {
	const wanted = [
		{ name: `${ORG_NAME} · S3`, importPaths: [S3_ROOT], exclusionPatterns: ["**/*.gz", "**/*_merged.jpg"] },
		{ name: `${ORG_NAME} · App-Uploads`, importPaths: [UPLOAD_ROOT], exclusionPatterns: [] },
	];
	const libraries = await api<Array<{ id: string; name: string }>>("GET", "/libraries", admin);
	for (const lib of libraries.filter((l) => !wanted.some((w) => w.name === l.name))) {
		await api("DELETE", `/libraries/${lib.id}`, admin);
		log(`Bibliothek entfernt: ${lib.name}`);
	}
	const ids: string[] = [];
	for (const want of wanted) {
		const found = libraries.find((l) => l.name === want.name);
		const id = found?.id ?? (await api<{ id: string }>("POST", "/libraries", admin, { ...want, ownerId })).id;
		await api("POST", `/libraries/${id}/scan`, admin);
		ids.push(id);
	}
	await new Promise((r) => setTimeout(r, 10_000));
	await waitForQueues(admin.token!, ["library"], 30 * 60_000);
	return ids;
}

const orgAuth = await ensureOrgUser();

// Fotomosaike als Bilder in die Upload-Bibliothek (Datei je Einsatz, bei neuem Stand überschrieben).
const operationsAll = load("operations");
const mosaicByOperation = new Map<string, string>();
for (const session of await listSessions(ORG)) {
	const op = operationsAll.find((o) => o._id === session.operation_id);
	const rendered = await renderMosaic(session, `${UPLOAD_ROOT}/mosaik`).catch(() => null);
	if (!rendered) continue;
	writeSidecar(rendered, op?.title ?? session.operation_id);
	mosaicByOperation.set(session.operation_id, rendered.path);
}
log(`${mosaicByOperation.size} Fotomosaike gerendert`);

const libraryIds = await ensureLibraries(state.orgUser!.id);
const listAssets = async () => (await Promise.all(libraryIds.map((id) => listLibraryAssets(orgAuth, id)))).flat();
let assets: Asset[] = await listAssets();
// Flugspuren brauchen die Videolänge – nur dann auf die Metadaten warten, wenn sie noch fehlt.
if (assets.some((a) => a.type === "VIDEO" && !a.duration)) {
	log("warte auf Metadaten neuer Videos …");
	await waitForQueues(admin.token!, ["sidecar", "metadataExtraction"], 60 * 60_000);
	assets = await listAssets();
}
const byPath = new Map(assets.map((a) => [a.originalPath, a]));
log(`${assets.length} Assets in den Bibliotheken`);

const operations = load("operations").filter((o) => !o.merged_into_id);
const media = load("media_items").filter((m) => !m.deleted_at);
const crew = load("crew");
const members = JSON.parse(readFileSync(`${DATA}/convex/members.json`, "utf8")) as Member[];
const uploads = JSON.parse(readFileSync(`${DATA}/convex/uploads.json`, "utf8")) as Array<{ media_id: string; path: string }>;
const operationDrones = load("operation_drones");
const telemetry = load("drone_telemetry");
const [drones, streamKeys, bindings, streamSessions] = [load("drones"), load("stream_keys"), load("dji_device_bindings"), load("stream_sessions")];

function assetForMedia(item: (typeof media)[number]): Asset | undefined {
	if (typeof item.file_url === "string" && item.file_url.startsWith(`${ORG}/`)) return byPath.get(`/mnt/s3/${item.file_url}`);
	const upload = uploads.find((u) => u.media_id === item._id);
	return upload ? byPath.get(upload.path) : undefined;
}

// Flugspuren + Positionen (alte Spurdateien weg, damit nichts Verwaistes liegen bleibt)
for (const file of readdirSync(`${DATA}/tracks`)) rmSync(`${DATA}/tracks/${file}`);
let tracks = 0;
let located = 0;
const unlocated: string[] = [];
for (const asset of assets) {
	const hasGps = asset.exifInfo?.latitude != null && asset.exifInfo?.longitude != null;
	let position: { lat: number; lng: number } | undefined;
	if (asset.type === "VIDEO" && asset.originalPath.startsWith(S3_ROOT)) {
		const item = media.find((m) => `/mnt/s3/${m.file_url}` === asset.originalPath);
		const length = durationMs(asset.duration);
		const isDji = asset.originalPath.includes("/dji/");
		let start: number, end: number, anchor: string;
		if (isDji) {
			start = Date.parse(asset.exifInfo?.dateTimeOriginal ?? asset.fileCreatedAt);
			end = start + length;
			anchor = "exif";
		} else {
			const streamPath = asset.originalPath.slice(S3_ROOT.length + 1).split("/")[0];
			({ start, end, anchor } = recordingWindow(streamPath, item?._creationTime ?? Date.parse(asset.fileCreatedAt), length, streamSessions));
		}
		const points = buildTrack(droneForVideo(asset.originalPath, ORG, drones, streamKeys, bindings), ORG, start - 15_000, end + 15_000, telemetry);
		if (points.length >= 2) {
			writeFileSync(`${DATA}/tracks/${asset.id}.json`, JSON.stringify({ assetId: asset.id, start, end, anchor, points }));
			tracks++;
			position = { lat: points[0].lat, lng: points[0].lng };
		}
	}
	if (hasGps) continue;
	if (!position) {
		for (const m of media.filter((x) => x.operation_id && assetForMedia(x)?.id === asset.id)) {
			position ??= operationCenter(operationDrones, m.operation_id) ?? undefined;
		}
	}
	if (!position) {
		const item = media.find((m) => assetForMedia(m)?.id === asset.id);
		const located = operations.filter((o) => operationCenter(operationDrones, o._id));
		const op = operationAt(located, item?._creationTime ?? Date.parse(asset.fileCreatedAt));
		if (op) position = operationCenter(operationDrones, op._id) ?? undefined;
	}
	if (position) {
		await api("PUT", "/assets", orgAuth, { ids: [asset.id], latitude: position.lat, longitude: position.lng });
		located++;
	} else {
		unlocated.push(asset.originalPath);
	}
}
log(`${tracks} Flugspuren, ${located} Positionen gesetzt, ${unlocated.length} ohne Ortsquelle`);

// Nutzer: Crew als Album-Betrachter, Admins per Partner-Freigabe
const crewUsers = new Map<string, User>();
for (const c of crew) {
	const email = crewEmail(c, members);
	if (email) crewUsers.set(c._id, await ensureUser(email, `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || email));
}
// Admins sehen die ganze Org-Bibliothek in ihrer Zeitleiste und jedes Einsatz-Album unter „Alben".
const partners = await api<Array<{ id: string }>>("GET", "/partners?direction=shared-by", orgAuth);
const adminUserIds: string[] = [];
for (const m of members.filter((x) => x.role === "org:admin")) {
	const user = await ensureUser(m.email, m.email);
	adminUserIds.push(user.id);
	if (!partners.some((p) => p.id === user.id)) await api("POST", "/partners", orgAuth, { sharedWithId: user.id });
	// „In Zeitleiste anzeigen" kann per API nur der Empfänger selbst setzen – deshalb direkt in der Datenbank.
	sql(`UPDATE partner SET "inTimeline" = true WHERE "sharedById" = :'by' AND "sharedWithId" = :'with';`, { by: state.orgUser!.id, with: user.id });
}

// Einsatz-Alben
type Album = { id: string; description: string; albumUsers: Array<{ user: { id: string } }> };
const albums = await api<Album[]>("GET", "/albums", orgAuth);
let albumCount = 0;
for (const op of operations) {
	const mosaicAsset = mosaicByOperation.has(op._id) ? byPath.get(mosaicByOperation.get(op._id)!) : undefined;
	const assetIds = [...new Set([...media.filter((m) => m.operation_id === op._id).map((m) => assetForMedia(m)?.id), mosaicAsset?.id].filter(Boolean))] as string[];
	if (assetIds.length === 0) continue;
	const marker = `[sc:${op._id}]`;
	const description = `${op.location ?? ""} · ${op.status} ${marker}`.trim();
	const found = albums.find((a) => a.description?.includes(marker));
	const album = found ? await api<Album>("GET", `/albums/${found.id}?withoutAssets=true`, orgAuth) : await api<Album>("POST", "/albums", orgAuth, { albumName: op.title, description });
	await api("PATCH", `/albums/${album.id}`, orgAuth, { albumName: op.title, description });
	await api("PUT", `/albums/${album.id}/assets`, orgAuth, { ids: assetIds });

	const viewers = new Set([...adminUserIds, ...[...crewUsers].filter(([crewId]) => crewParticipates(op, crewId)).map(([, u]) => u.id)]);
	viewers.delete(state.orgUser!.id);
	const current = new Set((album.albumUsers ?? []).map((u) => u.user.id).filter((id) => id !== state.orgUser!.id));
	const toAdd = [...viewers].filter((id) => !current.has(id));
	if (toAdd.length) await api("PUT", `/albums/${album.id}/users`, orgAuth, { albumUsers: toAdd.map((userId) => ({ userId, role: "viewer" })) });
	for (const id of [...current].filter((id) => !viewers.has(id))) await api("DELETE", `/albums/${album.id}/user/${id}`, orgAuth);
	albumCount++;
}
log(`${albumCount} Einsatz-Alben abgeglichen`);

writeFileSync(`${DATA}/sync-report.json`, JSON.stringify({ assets: assets.length, tracks, located, unlocated, albums: albumCount, at: Date.now() }, null, 2));
