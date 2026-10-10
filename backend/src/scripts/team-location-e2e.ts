/**
 * Dubai / Bangalore teams (lib/location.ts), on made-up staff and students:
 *   - a student's location from the CRM (Banglore CRM) or the LMS academy; unset is Dubai;
 *   - new students go only to their location's teams, each location with its own round; none there → Open Students;
 *   - the inactivity rule moves students only to a team of the same location;
 *   - the Students list filters by location.
 * Run through ./test-team-location.sh. Refuses anything but a scratch database on 127.0.0.1.
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "", dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) { console.error("Refusing to run"); process.exit(1); }
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); } else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
await db.dropDatabase();
let t = 0;
const u = (name: string, app_role: string, up?: ObjectId, extra: any = {}) => ({ _id: new ObjectId(), full_name: name, email: `${name.toLowerCase()}@e2e.test`, app_role, status: "active", up_head_id: up ? String(up) : "", created_date: `2026-01-${String(++t).padStart(2, "0")}`, ...extra });
const chiefA = u("ChiefA", "chief_mentor", undefined, { team_name: "Dubai A" }), a1 = u("A1", "cs", chiefA._id), a2 = u("A2", "cs", chiefA._id);
const chiefB = u("ChiefB", "chief_mentor", undefined, { team_name: "Dubai B", team_location: "dubai" }), b1 = u("B1", "cs", chiefB._id);
const chiefC = u("ChiefC", "chief_mentor", undefined, { team_name: "Bangalore C", team_location: "bangalore" }), c1 = u("C1", "cs", chiefC._id), c2 = u("C2", "cs", chiefC._id);
const boss = u("Boss", "super_admin");
await db.collection("users").insertMany([chiefA, a1, a2, chiefB, b1, chiefC, c1, c2, boss] as any[]);

const { connectDb, closeDb } = await import("../db");
const L = await import("../lib/location");
const { salesCrmName, salesCrmOf } = await import("../students/salesCrm");
const { createStudent } = await import("../students/intake");
const { runInactivity } = await import("../students/inactivity");
const { listStudents } = await import("../functions/studentsList");
await connectDb();

console.log("\n\x1b[1mWhere a student belongs\x1b[0m");
check("Banglore CRM → Bangalore; the tag known", L.studentLocationOf({ salesCrm: "banglore" }) === "bangalore" && salesCrmOf("banglore") === "banglore" && salesCrmName("banglore") === "Banglore CRM");
check("the LMS's Bangalore academy → Bangalore", L.studentLocationOf({ academy: "Delta Bangalore" }) === "bangalore");
check("anything else → Dubai", L.studentLocationOf({ salesCrm: "delta" }) === "dubai" && L.studentLocationOf({}) === "dubai");

let n = 0;
const make = (location: "dubai" | "bangalore") => {
  const i = ++n;
  return createStudent({ location, name: `Student ${i}`, email: `s${i}@stu.test`, phone: "", country: "", notes: "", trace: { source: "delta_lms", finance_invoice_id: `INV-${i}` }, arrived: "Arrived", createdBy: "finance", createdByName: "Finance", unique: { field: "finance_invoice_id", value: `INV-${i}`, existing: "invoice", detail: "" } });
};
const mentorOf = async (code: number) => String(((await db.collection("students").findOne({ finance_invoice_id: `INV-${code}` })) as any)?.primary_mentor_id ?? "");

console.log("\n\x1b[1mNew students\x1b[0m");
for (let i = 0; i < 4; i++) await make("bangalore");
const blr = await Promise.all([1, 2, 3, 4].map(mentorOf));
check("4 Bangalore students: only the Bangalore team's CS, in turn", blr.join() === [c1, c2, c1, c2].map((x) => String(x._id)).join(), blr.join());
for (let i = 0; i < 4; i++) await make("dubai");
const dxb = await Promise.all([5, 6, 7, 8].map(mentorOf));
const dubaiCs = new Set([a1, a2, b1].map((x) => String(x._id)));
check("4 Dubai students: only Dubai teams' CS, across both teams", dxb.every((m) => dubaiCs.has(m)) && dxb.some((m) => m === String(b1._id)) && dxb.some((m) => m !== String(b1._id)), dxb.join());
check("…stored with their location", (await db.collection("students").countDocuments({ location: "bangalore" })) === 4 && (await db.collection("students").countDocuments({ location: "dubai" })) === 4);
await db.collection("users").updateMany({ _id: { $in: [c1._id, c2._id] } }, { $set: { status: "inactive" } });
await make("bangalore");
const pooled: any = await db.collection("students").findOne({ finance_invoice_id: "INV-9" });
check("no Bangalore CS: Open Students, never a Dubai team", pooled?.assignment_status === "open_pool" && !pooled?.primary_mentor_id);
check("…and its history says why", !!(await db.collection("student_history").findOne({ student_id: String(pooled._id), text: /no Bangalore team has a CS/ })));
await db.collection("users").updateMany({ _id: { $in: [c1._id, c2._id] } }, { $set: { status: "active" } });

console.log("\n\x1b[1mThe Students list\x1b[0m");
const list = async (location: string) => {
  const res = await listStudents(new Request("http://x", { method: "POST", body: JSON.stringify({ filters: { location }, limit: 100 }) }), { id: String(boss._id), email: boss.email, full_name: "Boss", app_role: "super_admin" } as any);
  return ((await res.json()) as any)?.rows?.map((r: any) => r.full_name).sort() ?? [];
};
const bl = await list("bangalore"), du = await list("dubai");
check("Bangalore: its team's 4 and the one waiting in Open Students", bl.length === 5 && bl.includes("Student 9"), bl.join());
check("Dubai: the Dubai teams' 4", du.length === 4 && !du.includes("Student 9"), du.join());

console.log("\n\x1b[1mThe inactivity rule\x1b[0m");
const old = new Date(Date.now() - 200 * 864e5).toISOString();
await db.collection("students").updateMany({}, { $set: { assigned_at: new Date().toISOString() } });
await db.collection("students").updateOne({ finance_invoice_id: "INV-1" }, { $set: { assigned_at: old } });     // Bangalore, C1
const aStudent: any = await db.collection("students").findOne({ primary_mentor_id: { $in: [String(a1._id), String(a2._id)] } });
await db.collection("students").updateOne({ _id: aStudent._id }, { $set: { assigned_at: old } });                // Dubai, team A
const r = await runInactivity();
check("a Bangalore student: no other Bangalore team, so left where they are", (await mentorOf(1)) === String(c1._id) && r.left.some((x) => /same location/.test(x.reason)), JSON.stringify(r));
check("a Dubai student: moved to the other Dubai team", String(((await db.collection("students").findOne({ _id: aStudent._id })) as any).primary_mentor_id) === String(b1._id));

await closeDb(); await db.dropDatabase(); await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
