// Gibt die abzugleichenden Orgs als "id<TAB>name" aus: SC_ORG_IDS (kommagetrennt) oder alle Orgs der Clerk-Instanz.
type Org = { id: string; name: string };

const res = await fetch("https://api.clerk.com/v1/organizations?limit=500", {
	headers: { authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
});
if (!res.ok) throw new Error(`Clerk /organizations → ${res.status}`);
const orgs = ((await res.json()) as { data: Org[] }).data;
const only = (process.env.SC_ORG_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
for (const org of orgs) {
	if (only.length && !only.includes(org.id)) continue;
	console.log(`${org.id}\t${org.name.replace(/\s+/g, " ")}`);
}
