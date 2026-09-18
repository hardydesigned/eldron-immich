// Kurzlebiger Clerk-Anmeldelink (Dev-Instanz) – nur für den lokalen E2E-Test.
// node --env-file=eldron/.env eldron/sc/signin-url.ts <admin|member|outsider|clerk_user_id>   (member = mit Crew-Eintrag, outsider = ohne)
import { readFileSync } from "node:fs";

const members = JSON.parse(readFileSync(new URL("../sc-data/convex/members.json", import.meta.url), "utf8")) as Array<{ clerk_user_id: string; role: string }>;
const crew = JSON.parse(readFileSync(new URL("../sc-data/convex/crew.json", import.meta.url), "utf8")) as Array<{ clerk_user_id?: string }>;
const inCrew = (id: string) => crew.some((c) => c.clerk_user_id === id);
const who = process.argv[2] ?? "admin";
const admin = members.find((m) => {
	if (who.startsWith("user_")) return m.clerk_user_id === who;
	if (who === "admin") return m.role === "org:admin";
	return m.role === "org:member" && inCrew(m.clerk_user_id) === (who === "member");
});
if (!admin) throw new Error(`Kein Mitglied für "${who}" gefunden`);
const res = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
	method: "POST",
	headers: { authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`, "content-type": "application/json" },
	body: JSON.stringify({ user_id: admin.clerk_user_id, expires_in_seconds: 300 }),
});
if (!res.ok) throw new Error(`Clerk → ${res.status} ${await res.text()}`);
console.log(((await res.json()) as { url: string }).url);
