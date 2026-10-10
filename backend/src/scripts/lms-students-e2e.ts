/**
 * New students from the Delta LMS, end to end, against a real API process.
 *
 *   - POST /api/v1/integrations/lms/students only with the LMS's own secret —
 *     finance's does not open it, nor its finance's;
 *   - made the way the Students page makes one, noted with course and academy;
 *   - one round of teams with finance's students;
 *   - the same LMS account twice is one student — even one finance sent
 *     first, and even both at once;
 *   - an email already here is left exactly as it is and uses no turn.
 *
 * Run through ./test-lms-students.sh (throwaway mongod, the API — no .env).
 * Refuses anything but a scratch database on 127.0.0.1.
 */
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;
const LMS_SECRET = process.env.LMS_S2S_SECRET ?? "";
const FINANCE_SECRET = process.env.FINANCE_S2S_SECRET ?? "";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

type Res = { status: number; body: any };
async function post(path: string, body: unknown, headers: Record<string, string>): Promise<Res> {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const fromLms = (body: unknown, secret: string | null = LMS_SECRET) =>
  post("/api/v1/integrations/lms/students", body, secret ? { "x-lms-secret": secret } : {});
const fromFinance = (body: unknown, secret: string | null = FINANCE_SECRET) =>
  post("/api/v1/integrations/finance/students", body, secret ? { "x-finance-secret": secret } : {});
let n = 0;
const lmsStudent = (over: Record<string, unknown> = {}) => {
  n++;
  return {
    lmsUserId: new ObjectId().toString(), email: `Learner${n}@e2e-lms.test`, name: `Learner ${n}`,
    phone: `+97150100${String(n).padStart(4, "0")}`, country: "United Arab Emirates",
    academy: "Delta Dubai", course: "Delta Wave Theory Trading Programme", ...over,
  };
};

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
if (!/127\.0\.0\.1/.test(uri)) process.exit(1);
// Emptied rather than dropped: the API made its indexes when it started.
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});
const students = db.collection("students");

step("Setting up");
const indexes = await students.indexes();
check("the API made the one-student-per-LMS-account index when it started",
  indexes.some((i) => i.key?.lms_user_id === 1 && i.unique === true), JSON.stringify(indexes.map((i) => i.key)));
const hash = await bcrypt.hash("Password123!", 10);
const person = (full_name: string, app_role: string, created_date: string, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), email: `${full_name.toLowerCase().replace(/\s+/g, ".")}@e2e-lms.test`,
  full_name, app_role, password_hash: hash, created_date, updated_date: created_date, ...extra,
});
// Three teams, each a Chief with a CS person under them, created in this order.
const leads = [person("Lead One", "chief_mentor", "2026-01-01T00:00:00.000Z"), person("Lead Two", "chief_mentor", "2026-02-01T00:00:00.000Z"),
  person("Lead Three", "chief_mentor", "2026-03-01T00:00:00.000Z")];
const cs = leads.map((l, i) => person(`CS ${i + 1}`, "cs", l.created_date, { up_head_id: String(l._id), up_head_name: l.full_name }));
await db.collection("users").insertMany([...leads, ...cs] as any[]);
await students.insertOne({
  student_code: "STU-0007", full_name: "Taken Already", email: "taken@e2e-lms.test", primary_mentor_id: "someone",
  primary_mentor_name: "Existing Mentor", assignment_status: "assigned", status: "ACTIVE", student_level: "LEVEL_2", notes: "added by hand",
});
check("three teams, and a student a mentor added by hand", true);

step("Only the LMS, with its own secret");
let r = await fromLms(lmsStudent(), null);
check("no secret: refused", r.status === 401, `${r.status}`);
r = await fromLms(lmsStudent(), FINANCE_SECRET);
check("finance's secret does not open the LMS's door", r.status === 401, `${r.status}`);
r = await fromFinance({ invoiceId: "x", email: "x@e2e-lms.test" }, LMS_SECRET);
check("...nor the LMS's secret finance's", r.status === 401, `${r.status}`);
r = await fromLms({ email: "x@e2e-lms.test" });
check("no LMS id: refused, and says why", r.status === 400 && /lmsUserId/.test(r.body?.error?.message ?? ""), JSON.stringify(r.body));
r = await fromLms(lmsStudent({ email: "not an email" }));
check("a bad email: refused", r.status === 400 && r.body?.error?.code === "VALIDATION_ERROR");
check("...and none of that made a student", (await students.countDocuments()) === 1);

step("A new LMS student");
const first = lmsStudent();
r = await fromLms(first);
check("created, and given team 1's CS person", r.status === 200 && r.body?.data?.created === true && r.body?.data?.teamName === "Lead One" &&
  r.body?.data?.mentorName === "CS 1", JSON.stringify(r.body));
const s1 = await students.findOne({ lms_user_id: first.lmsUserId }) as any;
check("recorded like a student added on the Students page, with the team stored",
  s1?.full_name === first.name && s1?.email === first.email.toLowerCase() && s1?.phone === first.phone && s1?.country === "United Arab Emirates" &&
  s1?.status === "ACTIVE" && s1?.student_level === "LEVEL_1" && s1?.assignment_status === "assigned" && s1?.primary_mentor_id === String(cs[0]!._id) &&
  s1?.team_id === String(leads[0]!._id) && s1?.team_name === "Lead One",
  JSON.stringify(s1));
check("...with a note naming the course and the academy", s1?.notes === "From Delta LMS — Delta Wave Theory Trading Programme (Delta Dubai)", s1?.notes);
check("...the trail back to the LMS, and nothing of finance's",
  s1?.source === "delta_lms" && s1?.lms_academy === "Delta Dubai" && s1?.created_by_name === "Delta LMS" && s1?.finance_invoice_id === undefined);
const log = await db.collection("logs").findOne({ entity_id: String(s1?._id) }) as any;
check("...and the activity log has it", log?.action_type === "create_student" && log?.user_name === "Delta LMS" && /→ CS 1 \(CS\) of team Lead One/.test(log?.details ?? ""));
const noCourse = lmsStudent({ course: "", academy: "Delta Dubai" });   // Dubai: a Bangalore one waits for a Bangalore team (team-location-e2e.ts)
r = await fromLms(noCourse);
const s2 = await students.findOne({ lms_user_id: noCourse.lmsUserId }) as any;
check("approved without a course yet: noted with just the academy — and team 2", s2?.notes === "From Delta LMS (Delta Dubai)" && r.body?.data?.teamName === "Lead Two", s2?.notes);

step("One round with finance's students");
const financeLmsId = new ObjectId().toString();
r = await fromFinance({ invoiceId: new ObjectId().toString(), invoiceNumber: "IN-0500", email: "paid@e2e-lms.test", name: "Paid Student",
  course: "Delta Wave Theory Trading Programme", lmsUserId: financeLmsId });
check("a student from finance takes team 3", r.body?.data?.created === true && r.body?.data?.teamName === "Lead Three", JSON.stringify(r.body));
r = await fromLms(lmsStudent());
check("...and the next LMS student goes round to team 1", r.body?.data?.teamName === "Lead One", JSON.stringify(r.body));

step("Safe to repeat");
r = await fromLms(first);
check("the same LMS account again: the same student — and says it is the LMS's own",
  r.body?.data?.created === false && r.body?.data?.existing === "lms" && r.body?.data?.studentCode === s1?.student_code, JSON.stringify(r.body));
r = await fromLms(lmsStudent({ lmsUserId: financeLmsId, email: "paid@e2e-lms.test" }));
check("a student finance sent first: found by their LMS id, not made twice",
  r.body?.data?.created === false && r.body?.data?.existing === "lms" && (await students.countDocuments({ email: "paid@e2e-lms.test" })) === 1, JSON.stringify(r.body));
r = await fromLms(lmsStudent({ email: "TAKEN@e2e-lms.test" }));
check("an email already here: answered, not created — and says why", r.body?.data?.created === false && r.body?.data?.existing === "email", JSON.stringify(r.body));
const taken = await students.findOne({ email: "taken@e2e-lms.test" }) as any;
check("...and left exactly as it was", taken?.primary_mentor_name === "Existing Mentor" && taken?.student_level === "LEVEL_2" && taken?.lms_user_id === undefined);
r = await fromLms(lmsStudent());
check("none of that used up a turn: the next new student goes to team 2", r.body?.data?.teamName === "Lead Two", JSON.stringify(r.body));
const twice = lmsStudent();
const [a, b] = await Promise.all([fromLms(twice), fromLms(twice)]);
check("one LMS account delivered twice at the same moment: one student",
  (await students.countDocuments({ lms_user_id: twice.lmsUserId })) === 1 && [a, b].filter((x) => x.body?.data?.created === true).length === 1,
  `${JSON.stringify(a.body)} ${JSON.stringify(b.body)}`);

step("Asked now: who looks after one student (the LMS's Recheck commission portal)");
const askCs = (body: unknown, secret: string | null = LMS_SECRET) =>
  post("/api/v1/integrations/lms/student-cs", body, secret ? { "x-lms-secret": secret } : {});
r = await askCs({ lmsUserId: first.lmsUserId, email: "someone-else@e2e-lms.test" });
check("found by their LMS id: their CS, team and student code", r.status === 200 && r.body?.data?.found === true
  && r.body.data.cs === s1?.primary_mentor_name && r.body.data.team === s1?.team_name && r.body.data.code === s1?.student_code && r.body.data.open === false, JSON.stringify(r.body));
check("...and noted as told, so the ten-minute push does not send it again",
  ((await students.findOne({ _id: s1?._id })) as any)?.lms_cs_sent?.code === s1?.student_code);
r = await askCs({ email: "TAKEN@e2e-lms.test" });
check("found by email, whatever its case", r.body?.data?.found === true && r.body.data.cs === "Existing Mentor", JSON.stringify(r.body));
r = await askCs({ email: "nobody@e2e-lms.test" });
check("somebody not here: found false", r.status === 200 && r.body?.data?.found === false, JSON.stringify(r.body));
r = await askCs({ email: "not-an-email" });
check("no email and no LMS id: 400", r.status === 400, JSON.stringify(r.body));
check("a wrong secret, or none: 401", (await askCs({ email: "taken@e2e-lms.test" }, "wrong")).status === 401 && (await askCs({ email: "taken@e2e-lms.test" }, null)).status === 401);

await db.dropDatabase();
await client.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
