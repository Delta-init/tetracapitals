/**
 * "Act as student" — read & write (functions/lmsEnrolmentRequests.ts viewStudentInLms { mode: "write" }), against a
 * stand-in LMS on made-up staff and students:
 *   - a CS for their own students (Common ones too), never another CS's;
 *   - a CS Manager for their team's students, not another team's; a Chief Mentor never (read-only stays theirs);
 *   - a Super Admin anyone's; the sales role nobody's;
 *   - the LMS is asked for mode write, by the real person; each use in the portal's activity log;
 *   - read-only (no mode) unchanged; an LMS not yet updated (no mode in its answer) is reported as read-only.
 * Run through ./test-act-as-student.sh. Refuses anything but a scratch database on 127.0.0.1.
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "", dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) { console.error("Refusing to run"); process.exit(1); }
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); } else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}

let oldLms = false;
const asked: any[] = [];
const lms = Bun.serve({
  port: Number(process.env.E2E_FAKE_LMS_PORT),
  async fetch(req) {
    const body: any = await req.json().catch(() => ({}));
    asked.push(body);
    if (!new URL(req.url).pathname.endsWith("/service/students/view")) return Response.json({ success: false }, { status: 404 });
    return Response.json({ success: true, data: { url: "https://learn.test/imp/enter?code=x", expiresIn: 60, sessionExpiresAt: new Date(Date.now() + 18e5).toISOString(), from: "own", ...(oldLms ? {} : { mode: body.mode === "write" ? "write" : "read" }) } });
  },
});

const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
await db.dropDatabase();
const u = (name: string, app_role: string, up?: ObjectId) => ({ _id: new ObjectId(), full_name: name, email: `${name.toLowerCase()}@e2e.test`, app_role, status: "active", up_head_id: up ? String(up) : "" });
const chiefA = u("ChiefA", "chief_mentor"), mgrA = u("MgrA", "cs_manager", chiefA._id), anna = u("Anna", "cs", mgrA._id), ben = u("Ben", "cs", mgrA._id);
const chiefB = u("ChiefB", "chief_mentor"), cara = u("Cara", "cs", chiefB._id), boss = u("Boss", "super_admin"), seller = u("Seller", "sales");
await db.collection("users").insertMany([chiefA, mgrA, anna, ben, chiefB, cara, boss, seller] as any[]);
const st = (name: string, cs: any, extra: any = {}) => ({ _id: new ObjectId(), full_name: name, email: `${name.toLowerCase()}@stu.test`, primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, ...extra });
const aisha = st("Aisha", anna), bilal = st("Bilal", ben), common = st("Common", ben, { common_cs: [{ id: String(anna._id), name: "Anna" }] }), carol = st("Carol", cara);
await db.collection("students").insertMany([aisha, bilal, common, carol] as any[]);

const { connectDb, closeDb } = await import("../db");
const { viewStudentInLms } = await import("../functions/lmsEnrolmentRequests");
await connectDb();
const as = (x: any) => ({ id: String(x._id), email: x.email, full_name: x.full_name, app_role: x.app_role }) as any;
const view = async (who: any, student: any, mode?: string) => {
  const res = await viewStudentInLms(new Request("http://x", { method: "POST", body: JSON.stringify({ studentId: String(student._id), ...(mode ? { mode } : {}) }) }), as(who));
  return { status: res.status, body: await res.json().catch(() => null) as any };
};
const logs = () => db.collection("logs").countDocuments({ action_type: "lms_act_as_student" });

console.log("\n\x1b[1mA CS\x1b[0m");
let r = await view(anna, aisha, "write");
check("their own student: read & write, the LMS asked for it by them", r.status === 200 && r.body?.mode === "write" && asked.at(-1)?.mode === "write" && asked.at(-1)?.byEmail === "anna@e2e.test", JSON.stringify(r.body));
check("…in the activity log", (await logs()) === 1);
check("a student Common with them: yes", (await view(anna, common, "write")).status === 200);
check("another CS's student: no", (await view(anna, bilal, "write")).status === 403);

console.log("\n\x1b[1mLeaders\x1b[0m");
check("a CS Manager: their team's student, yes", (await view(mgrA, bilal, "write")).body?.mode === "write");
check("…another team's, no", (await view(mgrA, carol, "write")).status === 403);
check("a Chief Mentor: read & write refused", (await view(chiefA, bilal, "write")).status === 403);
check("…read-only still theirs", (await view(chiefA, bilal)).body?.mode === "read");

console.log("\n\x1b[1mOthers\x1b[0m");
check("a Super Admin: anyone's", (await view(boss, carol, "write")).body?.mode === "write");
check("the sales role: nobody's", (await view(seller, aisha, "write")).status === 403);

console.log("\n\x1b[1mRead-only, and an older LMS\x1b[0m");
const before = await logs();
r = await view(anna, aisha);
check("no mode: read-only asked, nothing logged", r.body?.mode === "read" && asked.at(-1)?.mode === "read" && (await logs()) === before);
oldLms = true;
r = await view(anna, aisha, "write");
check("an LMS not yet updated: reported as read-only", r.status === 200 && r.body?.mode === "read");

await closeDb(); await db.dropDatabase(); await client.close(); lms.stop();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
