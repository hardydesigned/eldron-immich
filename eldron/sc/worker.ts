// Nimmt den Anstoß aus SentryCommand entgegen und läuft den Dateiteil des Abgleichs.
// Der Aufrufer weist sich mit dem gemeinsamen Geheimnis aus; geantwortet wird sofort,
// gearbeitet im Hintergrund – ein Lauf je Organisation, Nachzügler werden angehängt.
import { createServer } from "node:http";
import { syncFiles } from "./files.ts";

const PORT = Number(process.env.SC_WORKER_PORT ?? 2285);
const SECRET = process.env.IMMICH_SERVICE_SECRET ?? "";
const CONVEX = (process.env.SC_CONVEX_SITE_URL ?? "").replace(/\/+$/, "");

const running = new Set<string>();
const queued = new Set<string>();

async function run(orgId: string, orgName: string) {
	if (running.has(orgId)) {
		queued.add(orgId);
		return;
	}
	running.add(orgId);
	try {
		process.env.SC_DATA_DIR = `/sc-data/orgs/${orgId}`;
		process.env.SC_ORG_NAME = orgName;
		const result = await syncFiles(orgId);
		console.log(`[worker] ${orgId} fertig`, result);
		if (CONVEX && SECRET) {
			await fetch(`${CONVEX}/immich/worker-done`, {
				method: "POST",
				headers: { "content-type": "application/json", "x-service-secret": SECRET },
				body: JSON.stringify({ orgId }),
			}).catch((error) => console.error("[worker] Rückmeldung fehlgeschlagen", error));
		}
	} catch (error) {
		console.error(`[worker] ${orgId} fehlgeschlagen`, error);
	} finally {
		running.delete(orgId);
		if (queued.delete(orgId)) void run(orgId, orgName);
	}
}

createServer(async (req, res) => {
	if (req.method !== "POST" || req.url !== "/sc-worker/sync") {
		res.writeHead(404).end();
		return;
	}
	if (!SECRET || req.headers["x-service-secret"] !== SECRET) {
		res.writeHead(401).end();
		return;
	}
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	const body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as { orgId?: string; orgName?: string };
	if (!body.orgId) {
		res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "orgId fehlt" }));
		return;
	}
	void run(body.orgId, body.orgName ?? body.orgId);
	res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ accepted: true }));
}).listen(PORT, () => console.log(`[sc-worker] :${PORT}`));
