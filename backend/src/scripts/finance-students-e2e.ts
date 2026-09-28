/**
 * New Delta LMS students arriving from finance, end to end, against a real API process.
 *
 *   - POST /api/v1/integrations/finance/students only with finance's own secret;
 *   - each new student goes to the next team in turn — team 1, 2, 3, 4, then
 *     team 1 again — as the primary student of that team's leader;
 *   - the teams are the Teams page's: named teams whoever leads them, chains
 *     with no Chief above them, never somebody on their own;
 *   - a team added takes its place in the round, a team whose leader is
 *     switched off sits out, and with no team at all the student waits in
 *     Delta Open Students;
 *   - the same invoice twice is one student, even when both arrive at once;
 *   - an email already here is left exactly as it is and uses up no turn;
 *   - codes continue the Students page's own STU-NNNN sequence.
 *
 * Run through ./test-finance-students.sh (throwaway mongod, the API — no .env).
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
const SECRET = process.env.FINANCE_S2S_SECRET ?? "";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

type Res = { status: number; body: any };
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const send = (body: unknown, secret: string | null = SECRET) =>
  call("POST", "/api/v1/integrations/finance/students", body, secret ? { "x-finance-secret": secret } : {});
let n = 0;
/** A new enrolment as finance sends it. */
const enrolment = (over: Record<string, unknown> = {}) => {
  n++;
  return {
    invoiceId: new ObjectId().toString(),
    invoiceNumber: `INV-${String(n).padStart(4, "0")}`,
    email: `student${n}@e2e-finance.test`,
    name: `Student ${n}`,
    phone: `+97150000${String(n).padStart(4, "0")}`,
    country: "United Arab Emirates",
    course: "Delta Wave Theory Trading Programme",
    lmsUserId: new ObjectId().toString(),
    ...over,
  };
};

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
if (!/127\.0\.0\.1/.test(uri)) process.exit(1);
// Emptied rather than dropped: the API made its indexes when it started, and
// the one-student-per-invoice guarantee is one of them.
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});

step("Setting up");
const indexes = await db.collection("students").indexes();
check("the API made the one-student-per-invoice index when it started",
  indexes.some((i) => i.key?.finance_invoice_id === 1 && i.unique === true), JSON.stringify(indexes.map((i) => i.key)));
const hash = await bcrypt.hash("Password123!", 10);
const person = (full_name: string, app_role: string, created_date: string, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), email: `${full_name.toLowerCase().replace(/\s+/g, ".")}@e2e-finance.test`,
  full_name, app_role, password_hash: hash, commission_rate: 4, created_date, updated_date: created_date, ...extra,
});
// Four teams, created in this order — and a Chief whose account was switched off from the portal.
const one = person("Chief One", "chief_mentor", "2026-01-01T00:00:00.000Z");
const off = person("Chief Off", "chief_mentor", "2026-01-15T00:00:00.000Z", { status: "inactive" });
const two = person("Chief Two", "chief_mentor", "2026-02-01T00:00:00.000Z");
const three = person("Chief Three", "chief_mentor", "2026-03-01T00:00:00.000Z");
const four = person("Chief Four", "chief_mentor", "2026-04-01T00:00:00.000Z");
// Staff inside a team are members, not teams of their own.
const junior = person("Jun Ior", "junior_mentor", "2026-01-02T00:00:00.000Z", { up_head_id: String(one._id), up_head_name: one.full_name });
const mentor = person("Existing Mentor", "senior_mentor", "2025-12-01T00:00:00.000Z");
const admin = person("Ad Min", "super_admin", "2025-11-01T00:00:00.000Z");
await db.collection("users").insertMany([one, off, two, three, four, junior, mentor, admin] as any[]);
// Somebody a mentor already added by hand — the highest code so far is STU-0007.
await db.collection("students").insertOne({
  student_code: "STU-0007", full_name: "Taken Already", email: "taken@e2e-finance.test",
  primary_mentor_id: String(mentor._id), primary_mentor_name: mentor.full_name,
  assignment_status: "assigned", status: "ACTIVE", student_level: "LEVEL_2", notes: "added by hand",
  created_date: "2026-05-01T00:00:00.000Z", updated_date: "2026-05-01T00:00:00.000Z",
});
check("four teams, a switched-off Chief, a team member, and a student already here", true);

step("Only finance, with its secret");
let r = await send(enrolment(), null);
check("no secret: refused", r.status === 401 && r.body?.error?.code === "UNAUTHORISED", `${r.status}`);
r = await send(enrolment(), "not-the-secret");
check("a wrong secret: refused", r.status === 401, `${r.status}`);
r = await send({ email: "x@e2e-finance.test" });
check("no invoice: refused, and says why", r.status === 400 && /invoiceId/.test(r.body?.error?.message ?? ""), JSON.stringify(r.body));
r = await send(enrolment({ email: "not an email" }));
check("a bad email: refused", r.status === 400 && r.body?.error?.code === "VALIDATION_ERROR", JSON.stringify(r.body));
check("...and none of that made a student", (await db.collection("students").countDocuments()) === 1);

step("Six new students go round the four teams");
const first: any[] = [];
for (let i = 0; i < 6; i++) {
  const e = enrolment();
  const res = await send(e);
  first.push({ e, res });
}
const mentors = first.map((x) => x.res.body?.data?.mentorName);
check("team 1, 2, 3, 4, then team 1 and team 2 again",
  JSON.stringify(mentors) === JSON.stringify(["Chief One", "Chief Two", "Chief Three", "Chief Four", "Chief One", "Chief Two"]),
  JSON.stringify(mentors));
check("each answered as created", first.every((x) => x.res.status === 200 && x.res.body?.data?.created === true), JSON.stringify(first.map((x) => x.res.status)));
const codes = first.map((x) => x.res.body?.data?.studentCode);
check("codes continue the Students page's sequence: STU-0008 … STU-0013",
  JSON.stringify(codes) === JSON.stringify(["STU-0008", "STU-0009", "STU-0010", "STU-0011", "STU-0012", "STU-0013"]), JSON.stringify(codes));
const s1 = await db.collection("students").findOne({ finance_invoice_id: first[0].e.invoiceId }) as any;
check("recorded like a student added on the Students page",
  s1?.full_name === "Student 4" && s1?.email === "student4@e2e-finance.test" && s1?.status === "ACTIVE" &&
  s1?.student_level === "LEVEL_1" && s1?.assignment_status === "assigned" && s1?.phone === first[0].e.phone &&
  s1?.country === "United Arab Emirates" && s1?.senior_mentor_id === "",
  JSON.stringify(s1));
check("...owned by the team's Chief", s1?.primary_mentor_id === String(one._id) && s1?.primary_mentor_name === "Chief One");
check("...with a note saying where they came from", s1?.notes === "From Delta LMS — Delta Wave Theory Trading Programme, invoice INV-0004", s1?.notes);
check("...and the trail back to finance and the LMS",
  s1?.source === "delta_lms" && s1?.finance_invoice_number === "INV-0004" && s1?.lms_user_id === first[0].e.lmsUserId &&
  s1?.auto_assigned_team_name === "Chief One" && s1?.created_by_name === "Delta LMS (via finance)");
check("the switched-off Chief and the team member got none",
  (await db.collection("students").countDocuments({ primary_mentor_id: { $in: [String(off._id), String(junior._id)] } })) === 0);
const log = await db.collection("logs").findOne({ entity_id: String(s1?._id) }) as any;
check("the activity log has it, as the Students page would", log?.action_type === "create_student" && log?.entity_type === "Student" &&
  /Student 4 → team Chief One/.test(log?.details ?? ""), JSON.stringify(log));

step("Safe to repeat");
r = await send(first[0].e);
check("the same invoice again: the same student, not a new one — and says it is this invoice's",
  r.status === 200 && r.body?.data?.created === false && r.body?.data?.existing === "invoice" && r.body?.data?.studentCode === "STU-0008", JSON.stringify(r.body));
r = await send(enrolment({ email: "taken@e2e-finance.test" }));
check("an email already here: answered, not created — and says why", r.status === 200 && r.body?.data?.created === false &&
  r.body?.data?.existing === "email" && r.body?.data?.studentCode === "STU-0007", JSON.stringify(r.body));
r = await send(enrolment({ email: "TAKEN@E2E-Finance.test" }));
check("...whatever its capitals", r.body?.data?.created === false && r.body?.data?.studentCode === "STU-0007", JSON.stringify(r.body));
const taken = await db.collection("students").findOne({ email: "taken@e2e-finance.test" }) as any;
check("...and left exactly as it was",
  taken?.primary_mentor_name === "Existing Mentor" && taken?.student_level === "LEVEL_2" && taken?.notes === "added by hand" && taken?.finance_invoice_id === undefined,
  JSON.stringify(taken));
r = await send(enrolment());
check("none of that used up a turn: the next new student goes to team 3", r.body?.data?.mentorName === "Chief Three", JSON.stringify(r.body));

step("Teams changing between students");
// A Chief created now joins the end of the round, after team 4.
const five = person("Chief Five", "chief_mentor", "2026-06-01T00:00:00.000Z");
await db.collection("users").insertOne(five as any);
r = await send(enrolment());
check("after team 3 comes team 4, as before", r.body?.data?.mentorName === "Chief Four", JSON.stringify(r.body));
r = await send(enrolment());
check("...then the new Chief's team, at the end of the round", r.body?.data?.mentorName === "Chief Five", JSON.stringify(r.body));
r = await send(enrolment());
check("...then round to team 1", r.body?.data?.mentorName === "Chief One", JSON.stringify(r.body));
await db.collection("users").updateOne({ _id: two._id }, { $set: { status: "inactive" } });
r = await send(enrolment());
check("a team whose leader is switched off sits out: team 2's turn goes to team 3", r.body?.data?.mentorName === "Chief Three", JSON.stringify(r.body));

step("Teams as the Teams page makes them");
// A named team with a senior mentor leading it, created empty; a chain with no
// Chief above it; and people on their own, who are not teams.
const falcons = person("Sen Ior", "senior_mentor", "2026-07-01T00:00:00.000Z", { team_name: "Falcons" });
const leadTwo = person("Lead Two", "senior_mentor", "2026-08-01T00:00:00.000Z");
const underLead = person("Jun Three", "junior_mentor", "2026-08-02T00:00:00.000Z", { up_head_id: String(leadTwo._id), up_head_name: leadTwo.full_name });
const underFour = person("Jun Four", "junior_mentor", "2026-08-03T00:00:00.000Z", { up_head_id: String(four._id), up_head_name: four.full_name });
const solo = person("Solo Senior", "senior_mentor", "2026-09-01T00:00:00.000Z");
const underAdmin = person("Admin Kid", "junior_mentor", "2026-09-02T00:00:00.000Z", { up_head_id: String(admin._id), up_head_name: admin.full_name });
await db.collection("users").insertMany([falcons, leadTwo, underLead, underFour, solo, underAdmin] as any[]);
const round: any[] = [];
for (let i = 0; i < 5; i++) round.push((await send(enrolment())).body?.data);
check("the round is now 4, 5, Falcons, Lead Two, then back to 1",
  JSON.stringify(round.map((d) => d?.teamName)) === JSON.stringify(["Chief Four", "Chief Five", "Falcons", "Lead Two", "Chief One"]),
  JSON.stringify(round.map((d) => d?.teamName)));
check("a named team takes its turn under its name, its leader as the mentor",
  round[2]?.teamName === "Falcons" && round[2]?.mentorName === "Sen Ior", JSON.stringify(round[2]));
const falconsStudent = await db.collection("students").findOne({ student_code: round[2]?.studentCode }) as any;
check("...recorded that way on the student and in the log",
  falconsStudent?.primary_mentor_id === String(falcons._id) && falconsStudent?.auto_assigned_team_name === "Falcons" &&
  /→ team Falcons \(Sen Ior\)/.test(((await db.collection("logs").findOne({ entity_id: String(falconsStudent?._id) })) as any)?.details ?? ""));
check("a chain with no Chief above it is a team too, under its leader's name", round[3]?.mentorName === "Lead Two");
check("people on their own, team members, and staff under an admin are never given a student",
  (await db.collection("students").countDocuments({
    primary_mentor_id: { $in: [solo, underAdmin, underLead, underFour, junior, mentor].map((u) => String(u._id)) },
    source: "delta_lms",
  })) === 0);

const [p, q] = await Promise.all([send(enrolment()), send(enrolment())]);
check("two new students at the same moment take the next two turns, not the same one",
  JSON.stringify([p.body?.data?.teamName, q.body?.data?.teamName].sort()) === JSON.stringify(["Chief Four", "Chief Three"]),
  `${p.body?.data?.teamName} / ${q.body?.data?.teamName}`);
await db.collection("users").updateMany({ app_role: { $in: ["chief_mentor", "senior_mentor"] } }, { $set: { status: "inactive" } });
r = await send(enrolment());
const pooled = await db.collection("students").findOne({ student_code: r.body?.data?.studentCode }) as any;
check("no team with a leader able to take them: the student waits in Delta Open Students",
  r.body?.data?.created === true && r.body?.data?.assignment === "open_pool" && pooled?.assignment_status === "open_pool" && pooled?.primary_mentor_id === "",
  JSON.stringify(r.body));
const twice = enrolment();
const [a, b] = await Promise.all([send(twice), send(twice)]);
check("one invoice delivered twice at the same moment: one student",
  (await db.collection("students").countDocuments({ finance_invoice_id: twice.invoiceId })) === 1 &&
  [a, b].filter((x) => x.body?.data?.created === true).length === 1, `${JSON.stringify(a.body)} ${JSON.stringify(b.body)}`);

step("The Students page's own codes");
const login = await call("POST", "/api/auth/login", { email: admin.email, password: "Password123!" });
// The counter, not the highest code stored: a delivery that lost a race above
// drew a code it never used, exactly as a failed save on the Students page does.
const seq = ((await db.collection("counters").findOne({ _id: "student_code" as any })) as any)?.seq;
const code = await call("POST", "/api/functions/getNextStudentCode", {}, { authorization: `Bearer ${login.body?.token}` });
const nextExpected = `STU-${String(seq + 1).padStart(4, "0")}`;
check("getNextStudentCode carries on from the same sequence", typeof seq === "number" && code.body?.code === nextExpected, `${JSON.stringify(code.body)} vs ${nextExpected}`);

await db.dropDatabase();
await client.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
