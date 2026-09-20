import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { telemetryWindow, type SyncData, type TelemetryPoint } from "./convex.ts";

export type TrackPoint = TelemetryPoint;

const S3 = "/mnt/s3";
const BLOCK_MS = 15 * 60_000;

export function droneForVideo(
	path: string,
	org: string,
	sources: Pick<SyncData, "drones" | "streamKeys" | "bindings">,
): { droneId?: string; sn?: string } {
	const rel = path.slice(`${S3}/${org}/`.length).split("/");
	if (rel[0] === "dji" && rel[1]) {
		return { sn: rel[1], droneId: sources.bindings.find((b) => b.device_sn === rel[1])?.drone_id ?? undefined };
	}
	const streamPath = rel[0];
	const droneId =
		sources.drones.find((d) => d.live_stream_url === streamPath)?.id ??
		sources.streamKeys.find((k) => k.path === streamPath && k.drone_id)?.drone_id;
	if (!droneId) return {};
	return { droneId, sn: sources.bindings.find((b) => b.drone_id === droneId)?.device_sn };
}

function s3Points(org: string, sn: string, start: number, end: number): TrackPoint[] {
	const dir = `${S3}/${org}/${sn}`;
	if (!existsSync(dir)) return [];
	const points: TrackPoint[] = [];
	for (const file of readdirSync(dir)) {
		const blockStart = Number(file.replace(".jsonl.gz", ""));
		if (!Number.isFinite(blockStart) || blockStart > end || blockStart + BLOCK_MS < start) continue;
		const lines = gunzipSync(readFileSync(`${dir}/${file}`)).toString("utf8").split("\n");
		for (const line of lines) {
			if (!line.includes('"telemetry"')) continue;
			const { ts, data } = JSON.parse(line) as { ts: number; data: Record<string, any> };
			if (ts < start || ts > end || !data.latitude || !data.longitude) continue;
			points.push({
				t: ts,
				lat: data.latitude,
				lng: data.longitude,
				alt: data.height ?? data.elevation ?? null,
				speed: data.horizontal_speed ?? null,
				heading: data.attitude_head ?? null,
				battery: data.battery?.capacity_percent ?? null,
			});
		}
	}
	return points;
}

export async function buildTrack(
	source: { droneId?: string; sn?: string },
	org: string,
	start: number,
	end: number,
): Promise<TrackPoint[]> {
	const merged = [
		...(source.sn ? s3Points(org, source.sn, start, end) : []),
		...(source.droneId ? await telemetryWindow(source.droneId, start, end) : []),
	].sort((a, b) => a.t - b.t);
	const deduped: TrackPoint[] = [];
	for (const point of merged) {
		if (deduped.length === 0 || point.t - deduped[deduped.length - 1].t >= 500) deduped.push(point);
	}
	return deduped;
}

/**
 * Zeitfenster einer Stream-Aufnahme. Das Media-Item entsteht erst nach dem Zusammenfügen (Upload),
 * also ~1–2 min nach Stream-Ende. Passt eine Publisher-Sitzung desselben Pfads dazu, liefert sie das
 * Ende; der Start folgt aus der Videolänge (Sitzungen decken die Aufnahme nicht immer ganz ab).
 */
export function recordingWindow(
	streamPath: string,
	registeredAt: number,
	lengthMs: number,
	sessions: SyncData["sessions"],
): { start: number; end: number; anchor: "session" | "session-end" | "upload" } {
	const candidates = sessions
		.filter((s) => s.stream_path === streamPath)
		.map((s) => ({ start: Date.parse(s.started_at), end: Date.parse(s.ended_at) }))
		.filter((s) => Number.isFinite(s.start) && registeredAt - s.end >= -60_000 && registeredAt - s.end <= 5 * 60_000);
	if (candidates.length > 0) {
		const best = candidates.sort((a, b) => Math.abs(a.end - b.end))[0];
		const covers = Math.abs(best.end - best.start - lengthMs) <= Math.max(30_000, lengthMs * 0.2);
		return covers ? { start: best.start, end: best.end, anchor: "session" } : { start: best.end - lengthMs, end: best.end, anchor: "session-end" };
	}
	const end = registeredAt - 60_000;
	return { start: end - lengthMs, end, anchor: "upload" };
}
