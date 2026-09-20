// Lesezugriff auf SentryCommand über die HTTP-API des Deployments.
// Ausgewiesen wird sich mit dem Dienstgeheimnis, nicht mit einem Deploy-Key:
// dieser Dienst darf genau die Abfragen in convex/immich/service_queries.ts.
const BASE = (process.env.CONVEX_URL ?? "").replace(/\/+$/, "");
const SECRET = process.env.CONVEX_SERVICE_SECRET ?? "";

async function ask<T>(path: string, args: Record<string, unknown>): Promise<T> {
	if (!BASE || !SECRET) throw new Error("CONVEX_URL oder CONVEX_SERVICE_SECRET fehlt");
	const res = await fetch(`${BASE}/api/query`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ path, args: { ...args, service_secret: SECRET }, format: "json" }),
	});
	const body = (await res.json()) as { status: string; value?: T; errorMessage?: string };
	if (!res.ok || body.status !== "success") {
		throw new Error(`Convex ${path} → ${body.errorMessage ?? res.status}`);
	}
	return body.value as T;
}

export type MediaFile =
	| { id: string; type: string; operation_id: string | null; created_at: number; kind: "s3"; path: string }
	| { id: string; type: string; operation_id: string | null; created_at: number; kind: "upload"; name: string; url: string };

export type SyncData = {
	link: { immich_user_id: string; api_key: string } | null;
	operations: Array<{ id: string; title: string; start_time: string; end_time: string | null; merged: boolean }>;
	media: MediaFile[];
	centers: Array<{ operation_id: string; lat: number; lng: number }>;
	drones: Array<{ id: string; live_stream_url: string | null }>;
	streamKeys: Array<{ path: string | null; drone_id: string | null }>;
	bindings: Array<{ device_sn: string; drone_id: string | null }>;
	sessions: Array<{ stream_path: string; started_at: string; ended_at: string }>;
	crew: Array<{ id: string; clerk_user_id: string | null }>;
};

export type TelemetryPoint = {
	t: number;
	lat: number;
	lng: number;
	alt: number | null;
	speed: number | null;
	heading: number | null;
	battery: number | null;
};

export const syncData = (orgId: string) => ask<SyncData>("immich/service_queries:syncData", { org_id: orgId });

export const telemetryWindow = (droneId: string, from: number, to: number) =>
	ask<TelemetryPoint[]>("immich/service_queries:telemetryWindow", { drone_id: droneId, from, to });
