// Dateiteil des Abgleichs: Bibliotheken, App-Uploads, Fotomosaike, Positionen, Flugspuren.
// Alles andere (Konten, Freigaben, Einsatz-Alben) macht SentryCommand selbst über die Immich-API.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { api, durationMs, listLibraryAssets, login, waitForQueues, type Asset, type Auth } from "./lib/immich.ts";
import { load, operationAt, operationCenter } from "./lib/data.ts";
import { buildTrack, droneForVideo, recordingWindow } from "./lib/tracks.ts";
import { listSessions, renderMosaic, writeSidecar } from "./lib/mosaic.ts";
import { orgLink } from "./lib/convex.ts";

const UUID = /^[0-9a-f-]{36}$/;

function sql(statement: string, vars: Record<string, string>) {
	const args = ["-h", "database", "-U", process.env.DB_USERNAME!, "-d", process.env.DB_DATABASE_NAME!, "-v", "ON_ERROR_STOP=1"];
	for (const [name, value] of Object.entries(vars)) args.push("-v", `${name}=${value}`);
	execFileSync("psql", args, { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD }, input: statement });
}

async function ensureLibraries(admin: Auth, orgName: string, ownerId: string, s3Root: string, uploadRoot: string) {
	const wanted = [
		{ name: `${orgName} · S3`, importPaths: [s3Root], exclusionPatterns: ["**/*.gz", "**/*_merged.jpg"] },
		{ name: `${orgName} · App-Uploads`, importPaths: [uploadRoot], exclusionPatterns: [] },
	];
	const libraries = await api<Array<{ id: string; name: string; ownerId: string }>>("GET", "/libraries", admin);
	const mine = libraries.filter((l) => l.ownerId === ownerId);
	for (const lib of mine.filter((l) => !wanted.some((w) => w.name === l.name))) {
		await api("DELETE", `/libraries/${lib.id}`, admin);
		console.log(`[files] Bibliothek entfernt: ${lib.name}`);
	}
	const ids: string[] = [];
	for (const want of wanted) {
		const found = mine.find((l) => l.name === want.name);
		const id = found?.id ?? (await api<{ id: string }>("POST", "/libraries", admin, { ...want, ownerId })).id;
		await api("POST", `/libraries/${id}/scan`, admin);
		ids.push(id);
	}
	await new Promise((r) => setTimeout(r, 10_000));
	await waitForQueues(admin.token!, ["library"], 30 * 60_000);
	return ids;
}

/**
 * Zwei Dinge kann die Immich-API nicht, deshalb gehen sie direkt in die Datenbank:
 * der Einrichtungsassistent beim ersten Anmelden (die Konten kommen fertig aus
 * SentryCommand) und „in der Zeitleiste anzeigen" für die Freigabe an die Verwalter,
 * das nur der Empfänger selbst setzen könnte.
 */
async function applyUserFlags(admin: Auth, orgUserId: string) {
	const users = await api<Array<{ id: string }>>("GET", "/admin/users", admin);
	const ids = users.map((u) => u.id).filter((id) => UUID.test(id));
	if (ids.length > 0) {
		const values = ids.map((id) => `('${id}', 'onboarding', '{"isOnboarded": true}')`).join(", ");
		sql(`INSERT INTO user_metadata ("userId", key, value) VALUES ${values} ON CONFLICT ("userId", key) DO NOTHING;`, {});
	}
	sql(`UPDATE partner SET "inTimeline" = true WHERE "sharedById" = :'by';`, { by: orgUserId });
}

export async function syncFiles(orgId: string): Promise<{ assets: number; tracks: number; located: number; unlocated: number }> {
	const data = process.env.SC_DATA_DIR ?? `/sc-data/orgs/${orgId}`;
	const s3Root = `/mnt/s3/${orgId}`;
	const uploadRoot = `${data}/uploads/${orgId}`;
	const link = await orgLink(orgId);
	if (!link) throw new Error(`Für ${orgId} ist in SentryCommand kein Immich-Nutzer hinterlegt`);
	const admin: Auth = { token: await login(process.env.IMMICH_ADMIN_EMAIL!, process.env.IMMICH_ADMIN_PASSWORD!) };
	const orgAuth: Auth = { key: link.api_key };
	const log = (msg: string) => console.log(`[files] ${msg}`);

	// Fotomosaike als Bilder in die Upload-Bibliothek (Datei je Einsatz, bei neuem Stand überschrieben).
	const operationsAll = load("operations");
	let mosaics = 0;
	for (const session of await listSessions(orgId)) {
		const op = operationsAll.find((o) => o._id === session.operation_id);
		const rendered = await renderMosaic(session, `${uploadRoot}/mosaik`).catch(() => null);
		if (!rendered) continue;
		writeSidecar(rendered, op?.title ?? session.operation_id);
		mosaics++;
	}
	log(`${mosaics} Fotomosaike gerendert`);

	const libraryIds = await ensureLibraries(admin, process.env.SC_ORG_NAME ?? orgId, link.immich_user_id, s3Root, uploadRoot);
	const listAssets = async () => (await Promise.all(libraryIds.map((id) => listLibraryAssets(orgAuth, id)))).flat();
	let assets: Asset[] = await listAssets();
	// Flugspuren brauchen die Videolänge – nur dann auf die Metadaten warten, wenn sie noch fehlt.
	if (assets.some((a) => a.type === "VIDEO" && !a.duration)) {
		log("warte auf Metadaten neuer Videos …");
		await waitForQueues(admin.token!, ["sidecar", "metadataExtraction"], 60 * 60_000);
		assets = await listAssets();
	}
	log(`${assets.length} Assets in den Bibliotheken`);

	const operations = operationsAll.filter((o) => !o.merged_into_id);
	const media = load("media_items").filter((m) => !m.deleted_at);
	const operationDrones = load("operation_drones");
	const telemetry = load("drone_telemetry");
	const [drones, streamKeys, bindings, streamSessions] = [load("drones"), load("stream_keys"), load("dji_device_bindings"), load("stream_sessions")];

	// App-Uploads liegen unter ihrer Medien-Id – so findet SentryCommand sie ohne Namensabgleich wieder.
	const mediaForAsset = (asset: Asset) => {
		if (asset.originalPath.startsWith(s3Root)) {
			return media.find((m) => `/mnt/s3/${m.file_url}` === asset.originalPath);
		}
		const name = (asset.originalPath.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
		return media.find((m) => m._id === name);
	};

	const trackDir = `${data}/tracks`;
	for (const file of readdirSync(trackDir)) rmSync(`${trackDir}/${file}`);
	let tracks = 0;
	let located = 0;
	const unlocated: string[] = [];
	for (const asset of assets) {
		const hasGps = asset.exifInfo?.latitude != null && asset.exifInfo?.longitude != null;
		const item = mediaForAsset(asset);
		let position: { lat: number; lng: number } | undefined;
		if (asset.type === "VIDEO" && asset.originalPath.startsWith(s3Root)) {
			const length = durationMs(asset.duration);
			const isDji = asset.originalPath.includes("/dji/");
			let start: number, end: number, anchor: string;
			if (isDji) {
				start = Date.parse(asset.exifInfo?.dateTimeOriginal ?? asset.fileCreatedAt);
				end = start + length;
				anchor = "exif";
			} else {
				const streamPath = asset.originalPath.slice(s3Root.length + 1).split("/")[0];
				({ start, end, anchor } = recordingWindow(streamPath, item?._creationTime ?? Date.parse(asset.fileCreatedAt), length, streamSessions));
			}
			const points = buildTrack(droneForVideo(asset.originalPath, orgId, drones, streamKeys, bindings), orgId, start - 15_000, end + 15_000, telemetry);
			if (points.length >= 2) {
				writeFileSync(`${trackDir}/${asset.id}.json`, JSON.stringify({ assetId: asset.id, start, end, anchor, points }));
				tracks++;
				position = { lat: points[0].lat, lng: points[0].lng };
			}
		}
		if (hasGps) continue;
		if (!position && item?.operation_id) position = operationCenter(operationDrones, item.operation_id) ?? undefined;
		if (!position) {
			const withCenter = operations.filter((o) => operationCenter(operationDrones, o._id));
			const op = operationAt(withCenter, item?._creationTime ?? Date.parse(asset.fileCreatedAt));
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

	await applyUserFlags(admin, link.immich_user_id);
	const report = { assets: assets.length, tracks, located, unlocated, at: Date.now() };
	writeFileSync(`${data}/sync-report.json`, JSON.stringify(report, null, 2));
	return { assets: assets.length, tracks, located, unlocated: unlocated.length };
}
