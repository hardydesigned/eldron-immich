// Holt Convex-, Clerk- und App-Upload-Daten einer Org nach SC_DATA_DIR (nur lesend).
// node --env-file=eldron/.env eldron/sc/export.ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ORG = process.env.SC_ORG_ID!;
const REPO = process.env.SC_REPO ?? "/opt/convex-cli";
const OUT = process.env.SC_DATA_DIR ?? new URL("../sc-data/", import.meta.url).pathname;
const TABLES = [
	"operations",
	"media_items",
	"crew",
	"drones",
	"stream_keys",
	"stream_sessions",
	"dji_device_bindings",
	"drone_telemetry",
	"operation_drones",
];
const MEDIA_TYPES = new Set(["image", "video", "drone_photo", "drone_video", "livestream_video"]);

type Row = Record<string, unknown> & { _id: string; org_id?: string };

function convex(args: string[]): string {
	return execFileSync("npx", ["convex", ...args], { cwd: REPO, maxBuffer: 1 << 30, encoding: "utf8" });
}

function exportTable(table: string): Row[] {
	const rows = convex(["data", table, "--format", "jsonLines", "--limit", "8000"])
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Row)
		.filter((row) => row.org_id === ORG);
	writeFileSync(join(OUT, "convex", `${table}.json`), JSON.stringify(rows));
	return rows;
}

async function clerk<T>(path: string): Promise<T> {
	const res = await fetch(`https://api.clerk.com/v1${path}`, {
		headers: { authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
	});
	if (!res.ok) throw new Error(`Clerk ${path} → ${res.status}`);
	return (await res.json()) as T;
}

type Membership = { role: string; public_user_data: { user_id: string; identifier: string } };

async function exportMembers() {
	const res = await clerk<{ data: Membership[] }>(`/organizations/${ORG}/memberships?limit=100`);
	const members = res.data.map((m) => ({
		clerk_user_id: m.public_user_data.user_id,
		email: m.public_user_data.identifier.toLowerCase(),
		role: m.role,
	}));
	writeFileSync(join(OUT, "convex", "members.json"), JSON.stringify(members));
	return members;
}

function extension(contentType: string | null, name: string): string {
	const known: Record<string, string> = {
		"image/jpeg": ".jpg",
		"image/png": ".png",
		"image/webp": ".webp",
		"image/heic": ".heic",
		"video/mp4": ".mp4",
		"video/quicktime": ".mov",
		"video/webm": ".webm",
	};
	const fromName = /\.[a-z0-9]{2,4}$/i.exec(name)?.[0];
	return fromName ?? known[contentType ?? ""] ?? "";
}

/**
 * Medien, die nicht im Bucket liegen, kommen als Datei dazu – benannt nach ihrer
 * Medien-Id, damit SentryCommand sie in Immich ohne Namensabgleich wiederfindet.
 */
async function downloadAppUploads(media: Row[]): Promise<number> {
	const items = media.filter(
		(m) => MEDIA_TYPES.has(String(m.type)) && typeof m.file_url === "string" && !m.file_url.startsWith(`${ORG}/`) && !m.deleted_at,
	);
	let count = 0;
	for (let i = 0; i < items.length; i += 50) {
		const ids = items.slice(i, i + 50).map((m) => m._id);
		const summaries = JSON.parse(convex(["run", "media/embeddings/data:getMediaSummaries", JSON.stringify({ ids })])) as Array<{
			_id: string;
			name: string;
			fileUrl: string | null;
		}>;
		for (const summary of summaries) {
			if (!summary.fileUrl?.startsWith("http")) continue;
			const target = join(OUT, "uploads", ORG, `${summary._id}${extension(null, summary.name)}`);
			count++;
			if (existsSync(target)) continue;
			const res = await fetch(summary.fileUrl);
			if (!res.ok) continue;
			writeFileSync(target, Buffer.from(await res.arrayBuffer()));
		}
	}
	return count;
}

mkdirSync(join(OUT, "convex"), { recursive: true });
mkdirSync(join(OUT, "uploads", ORG), { recursive: true });
mkdirSync(join(OUT, "tracks"), { recursive: true });

const counts: Record<string, number> = {};
let media: Row[] = [];
for (const table of TABLES) {
	const rows = exportTable(table);
	counts[table] = rows.length;
	if (table === "media_items") media = rows;
}
counts.members = (await exportMembers()).length;
counts.uploads = await downloadAppUploads(media);
writeFileSync(join(OUT, "convex", "meta.json"), JSON.stringify({ org_id: ORG, exported_at: Date.now() }));
console.log(counts);
