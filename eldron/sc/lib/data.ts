import { readFileSync } from "node:fs";

const DIR = `${process.env.SC_DATA_DIR ?? "/sc-data"}/convex`;

export type Row = Record<string, any> & { _id: string; _creationTime: number };

export function load(table: string): Row[] {
	return JSON.parse(readFileSync(`${DIR}/${table}.json`, "utf8")) as Row[];
}

export type Member = { clerk_user_id: string; email: string; role: string };

export function crewParticipates(op: Row, crewId: string): boolean {
	if ([op.observer_id, op.mission_commander_id, op.driver_id].includes(crewId)) return true;
	if ((op.additional_crew ?? []).some((e: { crew_member_id?: string }) => e.crew_member_id === crewId)) return true;
	return (op.crew_member_ids ?? []).some((id: string) => String(id) === crewId);
}

export function crewEmail(crew: Row, members: Member[]): string | null {
	const linked = crew.clerk_user_id ? members.find((m) => m.clerk_user_id === crew.clerk_user_id)?.email : undefined;
	const email = linked ?? crew.contact_email;
	return typeof email === "string" && email.includes("@") ? email.trim().toLowerCase() : null;
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
