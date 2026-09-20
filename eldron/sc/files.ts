// Dateiteil des Abgleichs: Bibliotheken, App-Uploads, Fotomosaike, Positionen, Flugspuren.
// Alles andere (Konten, Freigaben, Einsatz-Alben) macht SentryCommand selbst über die Immich-API.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { api, durationMs, listLibraryAssets, login, waitForQueues, type Asset, type Auth } from "./lib/immich.ts";
import { buildTrack, droneForVideo, recordingWindow } from "./lib/tracks.ts";
import { listSessions, renderMosaic, writeSidecar } from "./lib/mosaic.ts";
import { syncData, type MediaFile, type SyncData } from "./lib/convex.ts";

const UUID = /^[0-9a-f-]{36}$/;
const HOUR = 3_600_000;

function sql(statement: string, vars: Record<string, string>) {
	const args = ["-h", "database", "-U", process.env.DB_USERNAME!, "-d", process.env.DB_DATABASE_NAME!, "-v", "ON_ERROR_STOP=1"];
	for (const [name, value] of Object.entries(vars)) args.push("-v", `${name}=${value}`);
	execFileSync("psql", args, { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD }, input: statement });
}

/** App-Uploads liegen unter ihrer Medien-Id – so findet SentryCommand sie ohne Namensabgleich wieder. */
async function downloadUploads(media: MediaFile[], uploadRoot: string): Promise<number> {
	mkdirSync(uploadRoot, { recursive: true });
	let count = 0;
	for (const item of media) {
		if (item.kind !== "upload") continue;
		const suffix = /\.[a-z0-9]{2,4}$/i.exec(item.name)?.[0] ?? "";
		const target = `${uploadRoot}/${item.id}${suffix}`;
		count++;
		if (existsSync(target)) continue;
		const res = await fetch(item.url);
		if (!res.ok) continue;
		writeFileSync(target, Buffer.from(await res.arrayBuffer()));
	}
	return count;
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

/** Einsatz, in dessen Zeitraum (±2 h) der Zeitpunkt fällt – sonst der zeitlich nächste innerhalb von 24 h. */
function operationAt(operations: SyncData["operations"], centers: SyncData["centers"], time: number) {
	let best: { id: string; distance: number } | null = null;
	for (const op of operations) {
		if (!centers.some((c) => c.operation_id === op.id)) continue;
		const start = Date.parse(op.start_time);
		if (!Number.isFinite(start)) continue;
		const end = op.end_time ? Date.parse(op.end_time) : start + 6 * HOUR;
		const distance = time < start ? start - time : time > end ? time - end : 0;
		if (!best || distance < best.distance) best = { id: op.id, distance };
	}
	return best && best.distance <= 24 * HOUR ? best.id : null;
}

export async function syncFiles(orgId: string): Promise<{ assets: number; tracks: number; located: number; unlocated: number }> {
	const dir = process.env.SC_DATA_DIR ?? `/sc-data/orgs/${orgId}`;
	const s3Root = `/mnt/s3/${orgId}`;
	const uploadRoot = `${dir}/uploads/${orgId}`;
	const trackDir = `${dir}/tracks`;
	mkdirSync(trackDir, { recursive: true });
	const log = (msg: string) => console.log(`[files] ${msg}`);

	const data = await syncData(orgId);
	if (!data.link) throw new Error(`Für ${orgId} ist in SentryCommand kein Immich-Nutzer hinterlegt`);
	const admin: Auth = { token: await login(process.env.IMMICH_ADMIN_EMAIL!, process.env.IMMICH_ADMIN_PASSWORD!) };
	const orgAuth: Auth = { key: data.link.api_key };

	log(`${await downloadUploads(data.media, uploadRoot)} App-Uploads bereitgestellt`);

	// Fotomosaike als Bilder in die Upload-Bibliothek (Datei je Einsatz, bei neuem Stand überschrieben).
	let mosaics = 0;
	for (const session of await listSessions(orgId)) {
		const op = data.operations.find((o) => o.id === session.operation_id);
		const rendered = await renderMosaic(session, `${uploadRoot}/mosaik`).catch(() => null);
		if (!rendered) continue;
		writeSidecar(rendered, op?.title ?? session.operation_id);
		mosaics++;
	}
	log(`${mosaics} Fotomosaike gerendert`);

	const libraryIds = await ensureLibraries(admin, process.env.SC_ORG_NAME ?? orgId, data.link.immich_user_id, s3Root, uploadRoot);
	const listAssets = async () => (await Promise.all(libraryIds.map((id) => listLibraryAssets(orgAuth, id)))).flat();
	let assets: Asset[] = await listAssets();
	// Flugspuren brauchen die Videolänge – nur dann auf die Metadaten warten, wenn sie noch fehlt.
	if (assets.some((a) => a.type === "VIDEO" && !a.duration)) {
		log("warte auf Metadaten neuer Videos …");
		await waitForQueues(admin.token!, ["sidecar", "metadataExtraction"], 60 * 60_000);
		assets = await listAssets();
	}
	log(`${assets.length} Assets in den Bibliotheken`);

	const mediaForAsset = (asset: Asset) => {
		if (asset.originalPath.startsWith(s3Root)) {
			return data.media.find((m) => m.kind === "s3" && m.path === asset.originalPath);
		}
		const name = (asset.originalPath.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
		return data.media.find((m) => m.id === name);
	};
	const centerOf = (operationId: string | null | undefined) =>
		operationId ? data.centers.find((c) => c.operation_id === operationId) : undefined;

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
			const registeredAt = item?.created_at ?? Date.parse(asset.fileCreatedAt);
			let start: number, end: number, anchor: string;
			if (asset.originalPath.includes("/dji/")) {
				start = Date.parse(asset.exifInfo?.dateTimeOriginal ?? asset.fileCreatedAt);
				end = start + length;
				anchor = "exif";
			} else {
				const streamPath = asset.originalPath.slice(s3Root.length + 1).split("/")[0];
				({ start, end, anchor } = recordingWindow(streamPath, registeredAt, length, data.sessions));
			}
			const points = await buildTrack(droneForVideo(asset.originalPath, orgId, data), orgId, start - 15_000, end + 15_000);
			if (points.length >= 2) {
				writeFileSync(`${trackDir}/${asset.id}.json`, JSON.stringify({ assetId: asset.id, start, end, anchor, points }));
				tracks++;
				position = { lat: points[0].lat, lng: points[0].lng };
			}
		}
		if (hasGps) continue;
		position ??= centerOf(item?.operation_id);
		position ??= centerOf(operationAt(data.operations, data.centers, item?.created_at ?? Date.parse(asset.fileCreatedAt)));
		if (position) {
			await api("PUT", "/assets", orgAuth, { ids: [asset.id], latitude: position.lat, longitude: position.lng });
			located++;
		} else {
			unlocated.push(asset.originalPath);
		}
	}
	log(`${tracks} Flugspuren, ${located} Positionen gesetzt, ${unlocated.length} ohne Ortsquelle`);

	await applyUserFlags(admin, data.link.immich_user_id);
	writeFileSync(`${dir}/sync-report.json`, JSON.stringify({ assets: assets.length, tracks, located, unlocated, at: Date.now() }, null, 2));
	return { assets: assets.length, tracks, located, unlocated: unlocated.length };
}
