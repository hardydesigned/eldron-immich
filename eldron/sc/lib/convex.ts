// Liest SentryCommand-Daten über die Convex-CLI (Deploy-Key steckt in der Umgebung).
import { execFileSync } from "node:child_process";

const REPO = process.env.SC_REPO ?? "/opt/convex-cli";

export function convexRun<T>(fn: string, args: unknown): T {
	const out = execFileSync("npx", ["convex", "run", fn, JSON.stringify(args)], {
		cwd: REPO,
		maxBuffer: 1 << 28,
		encoding: "utf8",
	});
	return JSON.parse(out.trim()) as T;
}

export type OrgLink = { org_id: string; immich_user_id: string; api_key: string };

/** Der technische Immich-Nutzer einer Organisation – angelegt hat ihn SentryCommand. */
export async function orgLink(orgId: string): Promise<OrgLink | null> {
	return convexRun<OrgLink | null>("immich/internal_queries:linkForOrg", { orgId });
}
