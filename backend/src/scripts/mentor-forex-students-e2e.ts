/**
 * Every Forex student for the mentors (the user, 2026-11-10: "every forex student can see by the mentors"), on made-up
 * staff in a throwaway mongod — listStudents (functions/studentsList.ts) called as each of them:
 *   - a Chief, Senior, Junior and Sub-junior Mentor get the All tab: every student in the portal, both teams, never a
 *     "not a student"; the page's filters work on it (team, CS, search);
 *   - their own tabs are as before (My Students their own, Team Students their team's);
 *   - a CS gets no All tab and is refused it; a CS Manager keeps theirs.
 * Run through ./test-mentor-forex-students.sh. Refuses anything but a scratch database on 127.0.0.1.
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "", dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const show = (v: unknown) => String(JSON.stringify(v)).slice(0, 600);

const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});
const u = (name: string, app_role: string, up?: ObjectId) =>
  ({ _id: new ObjectId(), full_name: name, email: `${name.toLowerCase().replace(/ /g, ".")}@e2e.test`, app_role, status: "active", up_head_id: up ? String(up) : "", created_date: new Date().toISOString() });
const chiefA = u("Chief A", "chief_mentor");
const seniorA = u("Senior A", "senior_mentor", chiefA._id);
const juniorA = u("Junior A", "junior_mentor", chiefA._id);
const subA = u("Sub A", "subjunior_mentor", chiefA._id);
const csA = u("Cee A", "cs", seniorA._id);
const chiefB = u("Chief B", "chief_mentor");
const csB = u("Cee B", "cs", chiefB._id);
const csm = u("Cee Manager", "cs_manager");
await db.collection("users").insertMany([chiefA, seniorA, juniorA, subA, csA, chiefB, csB, csm] as any[]);
let n = 0;
const st = (name: string, cs: any, team: any, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), full_name: name, student_code: `STU-${String(++n).padStart(4, "0")}`, email: `${name.toLowerCase().replace(/ /g, ".")}@e2e.test`,
  primary_mentor_id: cs ? String(cs._id) : "", primary_mentor_name: cs?.full_name ?? "", team_id: team ? String(team._id) : "", status: "ACTIVE",
  created_date: new Date(Date.now() - n * 60_000).toISOString(), ...extra,
});
const ownA = st("Alpha Student", csA, chiefA);
const ofSenior = st("Sen Own", seniorA, chiefA);
const otherB = st("Bravo Student", csB, chiefB);
const pool = st("Pool Student", null, null, { assignment_status: "open_pool" });
const gone = st("Not Student", csB, chiefB, { not_student: true });
await db.collection("students").insertMany([ownA, ofSenior, otherB, pool, gone] as any[]);
const EVERY = [ownA, ofSenior, otherB, pool].map((s) => String(s._id)).sort();

const { connectDb, closeDb } = await import("../db");
const { listStudents } = await import("../functions/studentsList");
await connectDb();
const asUser = (d: any) => ({ id: String(d._id), email: d.email, full_name: d.full_name, app_role: d.app_role, up_head_id: d.up_head_id }) as any;
const list = async (who: any, body: Record<string, unknown>) => {
  const res = await listStudents(new Request("http://e2e/api/functions/listStudents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), asUser(who));
  return { status: res.status, body: (await res.json()) as any };
};
const ids = (r: any) => (r.body.rows ?? []).map((x: any) => String(x.id)).sort();

step("The mentors: every Forex student under All");
for (const who of [seniorA, juniorA, subA, chiefA]) {
  const r = await list(who, { tab: "all", pageSize: 100 });
  check(`${who.full_name} (${who.app_role}): the All tab, every student in the portal — both teams, the open pool, never a "not a student"`,
    r.status === 200 && r.body.tabs.includes("all") && JSON.stringify(ids(r)) === JSON.stringify(EVERY) && r.body.total === 4, show(r.body?.tabs ?? r.body));
}
let r = await list(seniorA, { tab: "all", pageSize: 100, filters: { team: String(chiefB._id) } });
check("…the Team filter: the other team's only", r.status === 200 && JSON.stringify(ids(r)) === JSON.stringify([String(otherB._id)]), show(ids(r)));
r = await list(seniorA, { tab: "all", pageSize: 100, filters: { mentor: "Cee B" } });
check("…the CS filter", r.status === 200 && JSON.stringify(ids(r)) === JSON.stringify([String(otherB._id)]), show(ids(r)));
r = await list(juniorA, { tab: "all", pageSize: 100, filters: { search: "bravo" } });
check("…the search", r.status === 200 && JSON.stringify(ids(r)) === JSON.stringify([String(otherB._id)]), show(ids(r)));

step("Their own tabs, as before");
r = await list(seniorA, { tab: "my", pageSize: 100 });
check("a Senior's My Students: their own only", r.status === 200 && JSON.stringify(ids(r)) === JSON.stringify([String(ofSenior._id)]), show(ids(r)));
r = await list(seniorA, { tab: "team", pageSize: 100 });
check("…Team Students: their team's, not the other team's", r.status === 200 && ids(r).includes(String(ownA._id)) && !ids(r).includes(String(otherB._id)), show(ids(r)));
r = await list(chiefA, { tab: "team", pageSize: 100 });
check("a Chief's Team Students: their people's only", r.status === 200 && !ids(r).includes(String(otherB._id)) && ids(r).includes(String(ownA._id)), show(ids(r)));
r = await list(seniorA, {});
check("no tab asked: My Students first, as before", r.status === 200 && r.body.tab === "my", show(r.body.tab));

step("Not for everyone");
r = await list(csA, { tab: "all" });
check("a CS: no All tab, refused it", r.status === 403, show(r.body));
r = await list(csA, { tab: "my", pageSize: 100 });
check("…their own still", r.status === 200 && !r.body.tabs.includes("all") && JSON.stringify(ids(r)) === JSON.stringify([String(ownA._id)]), show(r.body));
r = await list(csm, { tab: "all", pageSize: 100 });
check("a CS Manager keeps All", r.status === 200 && r.body.total >= 2, show(r.body?.total));

await closeDb(); await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
