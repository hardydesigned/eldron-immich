export type Auth = { token?: string; key?: string };

const BASE = process.env.IMMICH_INTERNAL_URL ?? "http://localhost:2283";

export async function api<T>(method: string, path: string, auth: Auth, body?: unknown): Promise<T> {
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (auth.token) headers.authorization = `Bearer ${auth.token}`;
	if (auth.key) headers["x-api-key"] = auth.key;
	const res = await fetch(`${BASE}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
	const text = await res.text();
	if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
	return (text ? JSON.parse(text) : null) as T;
}

export async function login(email: string, password: string): Promise<string> {
	return (await api<{ accessToken: string }>("POST", "/auth/login", {}, { email, password })).accessToken;
}

export type Asset = {
	id: string;
	originalPath: string;
	type: "IMAGE" | "VIDEO";
	duration: string | null;
	fileCreatedAt: string;
	localDateTime: string;
	exifInfo?: { latitude?: number | null; longitude?: number | null; dateTimeOriginal?: string | null };
};

export async function listLibraryAssets(auth: Auth, libraryId: string): Promise<Asset[]> {
	const assets: Asset[] = [];
	let cursor: string | undefined;
	do {
		const page = await api<{ assets: { items: Asset[]; nextCursor: string | null } }>("POST", "/search/metadata", auth, {
			libraryId,
			size: 1000,
			withExif: true,
			...(cursor ? { cursor } : {}),
		});
		assets.push(...page.assets.items);
		cursor = page.assets.nextCursor ?? undefined;
	} while (cursor);
	return assets;
}

export function durationMs(duration: string | null): number {
	if (!duration) return 0;
	if (/^\d+(\.\d+)?$/.test(duration)) return Number(duration);
	const [h, m, s] = duration.split(":").map(Number);
	return ((h * 60 + m) * 60 + s) * 1000;
}

export async function waitForQueues(token: string, names: string[], timeoutMs: number) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const queues = await api<Array<{ name: string; statistics: { active: number; waiting: number } }>>("GET", "/queues", { token });
		const busy = queues.filter((q) => names.includes(q.name) && q.statistics.active + q.statistics.waiting > 0);
		if (busy.length === 0) return true;
		await new Promise((r) => setTimeout(r, 5000));
	}
	return false;
}
