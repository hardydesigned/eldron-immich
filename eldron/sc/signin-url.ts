// Kurzlebiger Clerk-Anmeldelink (Dev-Instanz) – nur für den lokalen E2E-Test.
// node --env-file=eldron/.env eldron/sc/signin-url.ts <admin|member|outsider|clerk_user_id>   (member = mit Crew-Eintrag, outsider = ohne)
import { syncData } from "./lib/convex.ts";

const ORG = process.env.SC_ORG_ID;
if (!ORG) throw new Error("SC_ORG_ID fehlt");

async function clerk<T>(path: string, init?: { method: string; body?: unknown }): Promise<T> {
	const res = await fetch(`https://api.clerk.com/v1${path}`, {
		method: init?.method ?? "GET",
		headers: { authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`, "content-type": "application/json" },
		body: init?.body === undefined ? undefined : JSON.stringify(init.body),
	});
	if (!res.ok) throw new Error(`Clerk ${path} → ${res.status} ${await res.text()}`);
	return (await res.json()) as T;
}

type Membership = { role: string; public_user_data: { user_id: string } };

const { data: memberships } = await clerk<{ data: Membership[] }>(`/organizations/${ORG}/memberships?limit=100`);
const { crew } = await syncData(ORG);
const inCrew = (id: string) => crew.some((c) => c.clerk_user_id === id);
const who = process.argv[2] ?? "admin";
const found = memberships.find((m) => {
	const userId = m.public_user_data.user_id;
	if (who.startsWith("user_")) return userId === who;
	if (who === "admin") return m.role === "org:admin";
	return m.role === "org:member" && inCrew(userId) === (who === "member");
});
if (!found) throw new Error(`Kein Mitglied für "${who}" gefunden`);
const token = await clerk<{ url: string }>("/sign_in_tokens", {
	method: "POST",
	body: { user_id: found.public_user_data.user_id, expires_in_seconds: 300 },
});
console.log(token.url);
