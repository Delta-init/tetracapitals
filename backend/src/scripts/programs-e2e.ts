/**
 * Programs in the portal (functions/programs.ts) against a stand-in LMS on made-up staff and students:
 *   - a CS sees programs they made and ones with their students — not another CS's; a Super Admin every one;
 *   - picking students: their own by default, any CS's by searching ("everyone");
 *   - made with the signed-in person as maker, whatever the request says; only CS / CS Manager / Chief / Super Admin;
 *   - changed or stopped only by who made it, or a Super Admin.
 * Run through ./test-programs.sh. Refuses anything but a scratch database on 127.0.0.1.
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "", dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) { console.error("Refusing to run"); process.exit(1); }
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); } else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}

// The stand-in LMS: /service/programs kept in memory, answering as the LMS does.
const programs = new Map<string, any>();
const calls: any[] = [];
const lms = Bun.serve({
  port: Number(process.env.E2E_FAKE_LMS_PORT),
  async fetch(req) {
    const u = new URL(req.url);
    const body: any = req.method === "GET" ? null : await req.json().catch(() => ({}));
    calls.push({ method: req.method, path: u.pathname, body });
    const m = u.pathname.match(/\/service\/programs(?:\/([a-f0-9]{24}))?(\/students|\/stop)?$/);
    if (!m) return Response.json({ success: false, error: { message: "not found" } }, { status: 404 });
    const [, id, tail] = m;
    if (!id && req.method === "GET") return Response.json({ success: true, data: [...programs.values()] });
    if (!id && req.method === "POST") {
      const p = { id: new ObjectId().toHexString(), title: body.title, status: "active", source: "portal", repeat: body.repeat, weekdays: body.weekdays ?? [], monthDay: null, startDate: body.startDate, endDate: body.endDate, time: body.time, durationMins: body.durationMins, isOnline: true, location: "",
        mentor: { id: "m1", name: "Mentor", email: body.mentorEmail }, students: body.students.map((e: string) => ({ id: e, name: e.split("@")[0], email: e })), createdByEmail: body.actorEmail, createdByName: body.actorName, classes: [], nextClassAt: null, missing: [] };
      programs.set(p.id, p);
      return Response.json({ success: true, data: p });
    }
    const p = programs.get(id!);
    if (!p) return Response.json({ success: false, error: { message: "No such program" } }, { status: 404 });
    if (tail === "/stop") p.status = "stopped";
    if (tail === "/students") p.students = [...p.students.filter((s: any) => !(body.remove ?? []).includes(s.email)), ...(body.add ?? []).map((e: string) => ({ id: e, name: e.split("@")[0], email: e }))];
    if (req.method === "PATCH") Object.assign(p, body);
    return Response.json({ success: true, data: p });
  },
});

const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
await db.dropDatabase();
const u = (name: string, app_role: string, up?: ObjectId) => ({ _id: new ObjectId(), full_name: name, email: `${name.toLowerCase()}@e2e.test`, app_role, status: "active", up_head_id: up ? String(up) : "" });
const chief = u("Chief", "chief_mentor"), anna = u("Anna", "cs", chief._id), ben = u("Ben", "cs", chief._id), boss = u("Boss", "super_admin"), sales = u("Seller", "sales");
await db.collection("users").insertMany([chief, anna, ben, boss, sales] as any[]);
const s = (name: string, cs: any, extra: any = {}) => ({ _id: new ObjectId(), full_name: name, email: `${name.toLowerCase()}@stu.test`, student_code: `STU-${name}`, primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, ...extra });
await db.collection("students").insertMany([s("Aisha", anna), s("Omar", anna), s("Bilal", ben), s("Common", ben, { common_cs: [{ id: String(anna._id), name: "Anna" }] })] as any[]);

const { connectDb, closeDb } = await import("../db");
const F = await import("../functions/programs");
await connectDb();
const as = (x: any) => ({ id: String(x._id), email: x.email, full_name: x.full_name, app_role: x.app_role }) as any;
const call = async (fn: (r: Request, u: any) => Promise<Response>, who: any, body: any = {}) => {
  const res = await fn(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), as(who));
  return { status: res.status, body: await res.json().catch(() => null) as any };
};

console.log("\n\x1b[1mPicking students\x1b[0m");
let r = await call(F.searchProgramStudents, anna, {});
check("a CS's own students by default (a Common one too)", r.body?.students?.map((x: any) => x.name).sort().join() === "Aisha,Common,Omar", JSON.stringify(r.body));
r = await call(F.searchProgramStudents, anna, { q: "bil", everyone: true });
check("…another CS's by searching, marked as theirs", r.body?.students?.length === 1 && r.body.students[0].csName === "Ben" && r.body.students[0].yours === false);
r = await call(F.searchProgramStudents, chief, {});
check("a Chief: the team's", r.body?.students?.length === 4);
r = await call(F.searchProgramStudents, sales, {});
check("not for the sales role", r.status === 403);

console.log("\n\x1b[1mMaking one\x1b[0m");
r = await call(F.createProgram, anna, { title: "Anna's review", mentorEmail: "mentor@lms.test", repeat: "weekly", weekdays: [2], startDate: "2026-11-01", endDate: "2026-11-30", time: "19:00", durationMins: 60, studentEmails: ["aisha@stu.test", "bilal@stu.test"], actorEmail: "someone@else.test" });
const annas = r.body?.id;
check("made, with the signed-in CS as maker whatever the request says", r.status === 200 && calls.at(-1)?.body?.actorEmail === "anna@e2e.test", JSON.stringify(calls.at(-1)?.body));
check("…students marked: hers, and Ben's", r.body?.students?.find((x: any) => x.email === "aisha@stu.test")?.yours === true && r.body?.students?.find((x: any) => x.email === "bilal@stu.test")?.csName === "Ben");
r = await call(F.createProgram, sales, { title: "Nope", mentorEmail: "m@x.test", studentEmails: ["aisha@stu.test"] });
check("the sales role cannot make one", r.status === 403);
await call(F.createProgram, boss, { title: "Boss only", mentorEmail: "mentor@lms.test", repeat: "weekly", weekdays: [1], startDate: "2026-11-01", endDate: "2026-11-30", time: "10:00", durationMins: 60, studentEmails: ["omar@stu.test"] });

console.log("\n\x1b[1mWho sees what\x1b[0m");
const titles = async (who: any) => ((await call(F.listPrograms, who)).body?.programs ?? []).map((p: any) => p.title).sort().join();
check("Anna: hers, and the one with her student", (await titles(anna)) === "Anna's review,Boss only");
check("Ben: the one with his student only", (await titles(ben)) === "Anna's review");
check("the Super Admin: every one", (await titles(boss)) === "Anna's review,Boss only");

console.log("\n\x1b[1mWho changes it\x1b[0m");
r = await call(F.stopProgram, ben, { id: annas });
check("Ben (not the maker) cannot stop Anna's", r.status === 403 && programs.get(annas).status === "active");
r = await call(F.changeProgramStudents, anna, { id: annas, addEmails: ["omar@stu.test"], removeEmails: ["bilal@stu.test"] });
check("Anna changes her students", r.status === 200 && programs.get(annas).students.map((x: any) => x.email).sort().join() === "aisha@stu.test,omar@stu.test");
check("…and then Ben no longer sees it", (await titles(ben)) === "");
r = await call(F.stopProgram, boss, { id: annas });
check("a Super Admin can stop anyone's", r.status === 200 && programs.get(annas).status === "stopped");

await closeDb(); await db.dropDatabase(); await client.close(); lms.stop();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
