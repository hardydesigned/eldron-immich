import { readFileSync } from "node:fs";

const DIR = `${process.env.SC_DATA_DIR ?? "/sc-data"}/convex`;

export type Row = Record<string, any> & { _id: string; _creationTime: number };

export function load(table: string): Row[] {
	return JSON.parse(readFileSync(`${DIR}/${table}.json`, "utf8")) as Row[];
}

export function operationCenter(operationDrones: Row[], operationId: string): { lat: number; lng: number } | null {
	for (const od of operationDrones) {
		const center = od.operation_id === operationId ? od.flight_zones?.center : undefined;
		if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) return { lat: center.lat, lng: center.lon };
	}
	return null;
}

/** Einsatz, in dessen Zeitraum (±2 h) der Zeitpunkt fällt – sonst der zeitlich nächste innerhalb von 24 h. */
export function operationAt(operations: Row[], time: number): Row | null {
	const HOUR = 3_600_000;
	let best: { op: Row; distance: number } | null = null;
	for (const op of operations) {
		const start = Date.parse(op.start_time);
		if (!Number.isFinite(start)) continue;
		const end = op.end_time ? Date.parse(op.end_time) : start + 6 * HOUR;
		const distance = time < start ? start - time : time > end ? time - end : 0;
		if (!best || distance < best.distance) best = { op, distance };
	}
	return best && best.distance <= 24 * HOUR ? best.op : null;
}
