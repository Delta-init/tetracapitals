/**
 * GET /api/v1/service/calls and /calls/:id/recording-link (portal/calls.ts; 2026-10-14 — Root's "3CX calls" page and
 * the calls on its Pending page), end to end against the API with the portal secret:
 *   - the secret: none or a wrong one refused;
 *   - every call with a student: the last 7 Dubai days by default, totals, talk time and average, a row per person with
 *     their email, a missed call nobody took under "Nobody";
 *   - the filters: dates, direction, result, a person, search (student, code, number), sort, paging, list=0, bad dates;
 *   - a recording's link: signed here for Root, 10 minutes; none for a call without one; a bad id refused.
 * Run through ./test-portal-calls.sh (throwaway mongod, the API — no .env). Scratch database only.
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;
const SECRET = process.env.ROOT_ERP_SECRET ?? "";
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
async function get(path: string, secret: string | null = SECRET): Promise<{ status: number; body: any }> {
  const r = await fetch(`${API}/api/v1/service${path}`, { headers: secret ? { "x-portal-secret": secret } : {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const show = (r: { status: number; body: any }) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
for (const c of await db.listCollections().toArray()) if (c.name !== "commission_roles") await db.collection(c.name).deleteMany({});

const cs1 = new ObjectId(), cs2 = new ObjectId();
await db.collection("users").insertMany([
  { _id: cs1, email: "Cee.One@E2e.Test", full_name: "Cee One", app_role: "cs", status: "active" },
  { _id: cs2, email: "cee.two@e2e.test", full_name: "Cee Two", app_role: "cs", status: "active" },
] as any[]);
const UAE = 4 * 3_600_000;
const today = new Date(Date.now() + UAE).toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const at = (n: number, h = 10) => new Date(Date.parse(`${day(n)}T${String(h).padStart(2, "0")}:00:00Z`) - UAE).toISOString();
let k = 0;
const call = (o: Record<string, unknown>) => ({
  key: `k${++k}`, call_id: `c${k}`, segment_id: "", started_at: at(0), direction: "out", status: "answered", answered: true, talk_seconds: 60,
  ring_seconds: 5, number: "971500000001", number_key: "500000001", extension: "201", agent_name: "Cee One", recording_ids: [], recording_url: "",
  reason: "", rows: 1, student_id: "s1", student_name: "Stella Student", student_code: "STU-0001", mentor_id: String(cs1),
  user_id: String(cs1), user_name: "Cee One", synced_at: new Date().toISOString(), created_at: new Date().toISOString(), ...o,
});
const recorded = new ObjectId();
await db.collection("student_calls").insertMany([
  call({ _id: recorded, talk_seconds: 120, recording_ids: [7001] }),
  call({ started_at: at(-1), talk_seconds: 30 }),
  call({ started_at: at(0, 9), status: "no_answer", answered: false, talk_seconds: 0 }),
  call({ user_id: String(cs2), user_name: "Cee Two", extension: "202", direction: "in", talk_seconds: 300, number: "971500000002", student_id: "s2", student_name: "Omar Other", student_code: "STU-0002" }),
  call({ user_id: "", user_name: "", extension: "", agent_name: "", direction: "in", status: "missed", answered: false, talk_seconds: 0, number: "971500000002", student_name: "Omar Other", student_code: "STU-0002" }),
  call({ started_at: at(-10), talk_seconds: 999 }),
] as any[]);

step("The secret");
check("no secret: 401", (await get("/calls", null)).status === 401);
check("a wrong secret: 401", (await get("/calls", "nope")).status === 401);

step("Every call");
let r = await get("/calls");
const d = r.body.data;
check("the last 7 days by default: 5 calls, not the one 10 days ago", r.status === 200 && d?.stats?.calls === 5 && d.total === 5 && d.calls.length === 5, show(r));
check("the totals: out 3, in 2, connected 3, missed 1, not answered 1, talk 450s, average 150s",
  d.stats.outgoing === 3 && d.stats.incoming === 2 && d.stats.connected === 3 && d.stats.missed === 1 && d.stats.notAnswered === 1
  && d.stats.talkSeconds === 450 && d.stats.avgTalkSeconds === 150 && d.stats.recorded === 1, JSON.stringify(d.stats));
const ps = new Map<string, any>(d.people.map((p: any) => [p.key, p]));
check("a row per person, with their email (lowercased)", ps.get(`u:${cs1}`)?.calls === 3 && ps.get(`u:${cs1}`)?.email === "cee.one@e2e.test"
  && ps.get(`u:${cs2}`)?.calls === 1 && ps.get(`u:${cs2}`)?.email === "cee.two@e2e.test", JSON.stringify(d.people));
check("the missed call nobody took: under Nobody", ps.get("-")?.calls === 1 && ps.get("-")?.email === "" && /Nobody/.test(ps.get("-")?.name ?? ""));
check("a call: newest first, the student with their code, who took it, the recording count",
  d.calls.every((c: any, i: number) => i === 0 || c.startedAt <= d.calls[i - 1].startedAt)
  && d.calls.some((c: any) => c.id === String(recorded) && c.recordings === 1 && c.userEmail === "cee.one@e2e.test" && c.contact === "Stella Student · STU-0001" && c.contactKind === "student"));

step("The filters");
check("from 10 days ago: all 6", (await get(`/calls?from=${day(-10)}&to=${today}`)).body.data?.stats?.talkSeconds === 1449);
check("today only: 4", (await get(`/calls?from=${today}&to=${today}`)).body.data?.stats?.calls === 4);
check("incoming only: 2; connected only: 3", (await get("/calls?direction=in")).body.data?.stats?.calls === 2 && (await get("/calls?result=connected")).body.data?.stats?.calls === 3);
r = await get(`/calls?person=u:${cs1}`);
check("one person: Cee One's 3 — the people table still lists everyone", r.body.data?.stats?.calls === 3 && r.body.data.calls.length === 3 && r.body.data.people.length === 3, show(r));
check("nobody's: the missed one", (await get("/calls?person=-")).body.data?.calls?.length === 1);
check("search by student, code and number", (await get("/calls?search=omar")).body.data?.stats?.calls === 2
  && (await get("/calls?search=STU-0001")).body.data?.stats?.calls === 3 && (await get("/calls?search=500000002")).body.data?.stats?.calls === 2);
r = await get("/calls?sort=talk&order=desc&limit=2&page=1");
check("sorted by talk time, a page of 2", r.body.data?.calls?.length === 2 && r.body.data.calls[0].talkSeconds === 300 && r.body.data.calls[1].talkSeconds === 120, show(r));
check("list=0: totals and people only", (await get("/calls?list=0")).body.data?.calls?.length === 0);
check("a bad date, from after to, an unknown direction: 400", (await get("/calls?from=yesterday")).status === 400
  && (await get(`/calls?from=${today}&to=${day(-1)}`)).status === 400 && (await get("/calls?direction=up")).status === 400);

step("A recording's link");
const { checkRecordingLink } = await import("../students/calls");
r = await get(`/calls/${recorded}/recording-link?index=0`);
const link = r.body.data?.path ?? "";
const checked = checkRecordingLink(new URL(`http://x${link}`).searchParams);
check("signed here for Root, 10 minutes, for that call", r.status === 200 && link.startsWith("/api/calls/recording?") && r.body.data.expiresIn === 600
  && checked?.callId === String(recorded) && checked?.userId === "root-portal", show(r));
check("a call without one, or unknown: 404", (await get(`/calls/${new ObjectId()}/recording-link`)).status === 404
  && (await get(`/calls/${d.calls.find((c: any) => c.recordings === 0).id}/recording-link`)).status === 404);
check("a bad index: 400", (await get(`/calls/${recorded}/recording-link?index=x`)).status === 400);

console.log(`\n${pass} passed, ${fail} failed`);
await client.close();
process.exit(fail ? 1 : 0);
