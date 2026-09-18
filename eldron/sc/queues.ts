// Warteschlangen pausieren/fortsetzen: node /sc/queues.ts <pause|resume|status> [name...]
import { api, login } from "./lib/immich.ts";

const [action, ...names] = process.argv.slice(2);
const token = await login(process.env.IMMICH_ADMIN_EMAIL!, process.env.IMMICH_ADMIN_PASSWORD!);
type Queue = { name: string; isPaused: boolean; statistics: { active: number; waiting: number; failed: number } };
if (action === "pause" || action === "resume") {
	for (const name of names) await api("PUT", `/queues/${name}`, { token }, { isPaused: action === "pause" });
}
for (const q of await api<Queue[]>("GET", "/queues", { token })) {
	const s = q.statistics;
	if (q.isPaused || s.active + s.waiting + s.failed > 0) console.log(`${q.name.padEnd(22)} ${q.isPaused ? "pausiert" : "läuft   "} aktiv=${s.active} wartend=${s.waiting} fehler=${s.failed}`);
}
