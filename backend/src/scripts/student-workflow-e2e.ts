/**
 * The student workflow chart (students/studentWorkflow.ts) end to end — the portal's own functions and Root's service
 * route:
 *
 *   Case 1  the boxes   came in, assigned / open pool, onboarded / waiting (under 6 h) / late, enrolled, contacted (a
 *                       call or a follow-up), first deposit, moved by hand — not the admins' bulk moves, the no-deposit
 *                       rule apart; follow-up stage now; sources; per team and per CS; by day
 *   Case 2  edge        outside the period, not a student, an approved deposit only, the filters (location, team, cs)
 *   Case 3  the people  the students behind a box or a stage, a team's, a CS's, the open pool's
 *   Case 4  who sees    an admin everything, a team leader their team, a CS their own; Root with the secret only
 *
 * Run through ./test-student-workflow.sh (throwaway mongod and the API — no .env). Scratch database only.
 */
import { MongoClient, ObjectId } from "mongodb";
import { signJwt } from "../auth/jwt";

const uri = process.env.MONGO_URI ?? "", dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) { console.error(`Refusing: ${uri} / ${dbName}`); process.exit(1); }
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;
const SECRET = process.env.ROOT_ERP_SECRET ?? "";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"} ${label}\x1b[0m${ok ? "" : ` — ${detail}`}`); };
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const j = (v: unknown) => String(JSON.stringify(v)).slice(0, 400);

const nowMs = Date.now();
const ago = (hours: number) => new Date(nowMs - hours * 3_600_000).toISOString();
const day = (d: number) => new Date(nowMs + 4 * 3_600_000 - d * 86_400_000).toISOString().slice(0, 10);
const FROM = day(10), TO = day(0);

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
await db.dropDatabase();

const person = (full_name: string, email: string, app_role: string, extra: Record<string, unknown> = {}) =>
  ({ _id: new ObjectId(), email, full_name, app_role, status: "active", created_date: ago(2400), ...extra });
const admin = person("Super Sara", "sara@e2e.test", "super_admin");
const lead = person("Dubai Lead", "dlead@e2e.test", "chief_mentor", { team_name: "Falcons", team_location: "dubai" });
const blrLead = person("Blr Lead", "blead@e2e.test", "chief_mentor", { team_name: "Tigers", team_location: "bangalore" });
const one = person("Cee One", "one@e2e.test", "cs", { up_head_id: String(lead._id) });
const two = person("Cee Two", "two@e2e.test", "cs", { up_head_id: String(lead._id) });
const blr = person("Cee Blr", "blr@e2e.test", "cs", { up_head_id: String(blrLead._id) });
await db.collection("users").insertMany([admin, lead, blrLead, one, two, blr] as any[]);
await db.collection("commission_roles").insertOne({ key: "cs", name: "CS", data_scope: "own", permissions: [] } as any);
const id = (u: any) => String(u._id);

const stu = (name: string, cs: any | null, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), full_name: name, student_code: `STU-${name}`, email: `${name.toLowerCase()}@s.test`, status: "ACTIVE",
  ...(cs ? { primary_mentor_id: id(cs), primary_mentor_name: cs.full_name, assignment_status: "assigned" } : { assignment_status: "open_pool" }),
  onboarded: false, created_date: ago(48), ...extra,
});
const asha = stu("Asha", one, { onboarded: true, onboarded_at: ago(40), finance_invoice_id: "inv1", enrolment_status: "closed", location: "dubai" });
const bilal = stu("Bilal", one, { created_date: ago(2), source: "delta_lms", lms_user_id: "l1" });              // waiting: 2 h in
const cara = stu("Cara", two, { created_date: ago(30), source: "cs_sheet" });                                   // late
const dev = stu("Dev", blr, { onboarded: true, onboarded_at: ago(20), finance_invoice_id: "inv2", location: "bangalore" });
const eve = stu("Eve", null, { location: "dubai", finance_invoice_id: "inv3" });                               // open pool, late
const old = stu("Old", one, { created_date: ago(24 * 40) });                                                    // outside the period
const fake = stu("Fake", one, { not_student: true });                                                           // not a student
await db.collection("students").insertMany([asha, bilal, cara, dev, eve, old, fake] as any[]);
const sid = (s: any) => String(s._id);

await db.collection("student_calls").insertMany([
  { _id: new ObjectId(), key: "k1", started_at: ago(30), direction: "out", status: "no_answer", answered: false, user_id: id(one), student_id: sid(asha) },
] as any[]);
await db.collection("student_followup_events").insertMany([
  { _id: new ObjectId(), followup_id: "f2", student_id: sid(dev), at: ago(10), by_id: id(blr), kind: "created" },
  { _id: new ObjectId(), followup_id: "f3", student_id: sid(cara), at: ago(5), by_id: id(two), kind: "edited" },    // not contact
] as any[]);
await db.collection("student_followups").insertMany([
  { _id: new ObjectId(), student_id: sid(asha), stage: "Converted", created_date: ago(45) },
  { _id: new ObjectId(), student_id: sid(asha), stage: "Contacted", created_date: ago(20) },                       // the open one wins
  { _id: new ObjectId(), student_id: sid(dev), stage: "New", created_date: ago(10) },
] as any[]);
await db.collection("funding_transactions").insertMany([
  { _id: new ObjectId(), type: "DEPOSIT", status: "APPROVED", amount_usd: 1000, student_id: sid(asha), approved_at: ago(10) },
  { _id: new ObjectId(), type: "DEPOSIT", status: "PENDING", amount_usd: 500, student_id: sid(dev) },              // not approved
  { _id: new ObjectId(), type: "WITHDRAWAL", status: "APPROVED", amount_usd: 100, student_id: sid(cara) },         // not a deposit
] as any[]);
await db.collection("student_history").insertMany([
  { _id: new ObjectId(), student_id: sid(cara), at: ago(25), type: "mentor_changed", via: "reassign", text: "Moved" },
  { _id: new ObjectId(), student_id: sid(asha), at: ago(25), type: "mentor_changed", text: "Transferred" },
  { _id: new ObjectId(), student_id: sid(bilal), at: ago(1), type: "mentor_changed", via: "unassign-all", text: "Bulk" },   // bulk: not counted
  { _id: new ObjectId(), student_id: sid(dev), at: ago(5), type: "mentor_changed", via: "inactivity", text: "No approved deposit for 90 days" },
] as any[]);

async function fn(who: any, name: string, body: Record<string, unknown> = {}) {
  const token = await signJwt({ sub: String(who._id), email: who.email, app_role: who.app_role, full_name: who.full_name });
  const r = await fetch(`${API}/api/functions/${name}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ period: "custom", from: FROM, to: TO, ...body }) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
}
async function svc(path: string, q: string, secret: string | null = SECRET) {
  const r = await fetch(`${API}/api/v1/service${path}?from=${FROM}&to=${TO}${q}`, { headers: secret ? { "x-portal-secret": secret } : {} });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
}

step("Case 1 — the boxes (an admin)");
const all = await fn(admin, "getStudentWorkflow");
const t = all.body?.totals ?? {};
check("answers", all.status === 200, j(all.body));
check("came in: 5 — not the old one, not the one marked not a student", t.came === 5, j(t));
check("assigned 4, open pool 1", t.assigned === 4 && t.pool === 1, j(t));
check("onboarded 2, waiting (under 6 h) 1, late 2", t.onboarded === 2 && t.waiting === 1 && t.late === 2, j(t));
check("enrolled in the LMS 1", t.enrolled === 1, j(t));
check("contacted 2: a call (unanswered counts), a follow-up opened — an edit doesn't", t.contacted === 2, j(t));
check("first deposit 1: an approved deposit only", t.deposited === 1, j(t));
check("moved by hand 2 (a reassign, a transfer) — the bulk move left out; the no-deposit rule apart (1)", t.moved === 2 && t.moved_inactivity === 1, j(t));
const stages = Object.fromEntries((all.body?.stages ?? []).map((s: any) => [s.stage, s.count]));
check("follow-up stage now: the open one wins — Contacted 1, New 1, no follow-up 3", stages.Contacted === 1 && stages.New === 1 && stages["No follow-up"] === 3 && !stages.Converted, j(all.body?.stages));
const src = Object.fromEntries((all.body?.sources ?? []).map((s: any) => [s.source, s.count]));
check("sources: finance 3, LMS 1, sheet 1", src.finance === 3 && src.lms === 1 && src.sheet === 1, j(all.body?.sources));
const teams = Object.fromEntries((all.body?.teams ?? []).map((x: any) => [x.name, x]));
check("per team: Falcons 3, Tigers 1, Open pool 1", teams.Falcons?.came === 3 && teams.Tigers?.came === 1 && teams["Open pool"]?.came === 1, j(all.body?.teams));
const ppl = Object.fromEntries((all.body?.people ?? []).map((x: any) => [x.name, x]));
check("per CS: Cee One 2 (1 waiting), Cee Two 1 (late), Cee Blr 1", ppl["Cee One"]?.came === 2 && ppl["Cee One"]?.waiting === 1 && ppl["Cee Two"]?.late === 1 && ppl["Cee Blr"]?.came === 1, j(all.body?.people));
check("by day: adds up to 5", (all.body?.timeline ?? []).reduce((n: number, d: any) => n + d.came, 0) === 5, j(all.body?.timeline));
check("the wait it uses: 6 hours", all.body?.wait_hours === 6);

step("Case 2 — filters");
const dubai = await fn(admin, "getStudentWorkflow", { location: "dubai" });
check("Dubai: Falcons' 3 and the Dubai pool student", dubai.body?.totals?.came === 4, j(dubai.body?.totals));
const blrOnly = await fn(admin, "getStudentWorkflow", { location: "bangalore" });
check("Bangalore: 1", blrOnly.body?.totals?.came === 1, j(blrOnly.body?.totals));
const team = await fn(admin, "getStudentWorkflow", { team: id(lead) });
check("one team: 3 — the pool left out", team.body?.totals?.came === 3 && team.body?.totals?.pool === 0, j(team.body?.totals));
const cs = await fn(admin, "getStudentWorkflow", { cs: id(two) });
check("one CS: 1", cs.body?.totals?.came === 1, j(cs.body?.totals));
const bad = await fn(admin, "getStudentWorkflow", { from: "nope" });
check("a bad period: 400", bad.status === 400, String(bad.status));

step("Case 3 — the students behind a box");
const late = await fn(admin, "getStudentWorkflowStudents", { box: "late" });
check("late: Cara and Eve, newest first, with their CS", late.body?.total === 2 && late.body.students.map((s: any) => s.name).sort().join() === "Cara,Eve" && late.body.students.find((s: any) => s.name === "Cara")?.cs?.name === "Cee Two", j(late.body));
const moved = await fn(admin, "getStudentWorkflowStudents", { box: "moved" });
check("moved by hand: Asha and Cara", moved.body?.students?.map((s: any) => s.name).sort().join() === "Asha,Cara", j(moved.body));
const noFu = await fn(admin, "getStudentWorkflowStudents", { stage: "No follow-up" });
check("a stage: no follow-up — 3", noFu.body?.total === 3, j(noFu.body));
const pool = await fn(admin, "getStudentWorkflowStudents", { teamId: "" });
check("the open pool's: Eve", pool.body?.students?.map((s: any) => s.name).join() === "Eve", j(pool.body));
const ofOne = await fn(admin, "getStudentWorkflowStudents", { csId: id(one), box: "came" });
check("one CS's: Asha, Bilal", ofOne.body?.students?.map((s: any) => s.name).sort().join() === "Asha,Bilal", j(ofOne.body));
const badBox = await fn(admin, "getStudentWorkflowStudents", { box: "nope" });
check("an unknown box: 400", badBox.status === 400, String(badBox.status));

step("Case 4 — who sees what");
const asLead = await fn(lead, "getStudentWorkflow");
check("a team leader: their team's 3 only, no pool", asLead.status === 200 && asLead.body?.totals?.came === 3 && asLead.body?.totals?.pool === 0, j(asLead.body?.totals));
const asCs = await fn(one, "getStudentWorkflow");
check("a CS: their own 2", asCs.status === 200 && asCs.body?.totals?.came === 2, j(asCs.body?.totals));
const csAsks = await fn(one, "getStudentWorkflowStudents", { csId: id(two), box: "came" });
check("a CS asking for another's students: none", csAsks.body?.total === 0, j(csAsks.body));
const root = await svc("/student-workflow", "");
check("Root with the secret: everyone's 5", root.status === 200 && root.body?.data?.totals?.came === 5, j(root.body));
const rootStudents = await svc("/student-workflow/students", "&box=onboarded");
check("…and the students behind a box", rootStudents.status === 200 && rootStudents.body?.data?.total === 2, j(rootStudents.body));
const rootBlr = await svc("/student-workflow", "&location=bangalore");
check("…with its filters", rootBlr.body?.data?.totals?.came === 1, j(rootBlr.body));
check("no secret: 401", (await svc("/student-workflow", "", null)).status === 401);
check("a wrong one: 401", (await svc("/student-workflow", "", "wrong-secret-0123456789abcdef")).status === 401);
check("a bad box from Root: 400", (await svc("/student-workflow/students", "&box=nope")).status === 400);

console.log(`\n${pass}/${pass + fail} checks passed${fail ? ` — ${fail} FAILED` : ""}`);
await client.close();
process.exit(fail ? 1 : 0);
