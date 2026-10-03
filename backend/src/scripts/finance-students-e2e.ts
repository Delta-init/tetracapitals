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
 *   - codes continue the Students page's own STU-NNNN sequence;
 *   - finance can ask who looks after the students it sent (CS and CS team, live).
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
// Four teams, created in this order, each a Chief with somebody under them; a
// team whose Chief was switched off from the portal; and a Chief on their own
// with no team name — "unassigned" on the Teams page, so not a team.
const one = person("Chief One", "chief_mentor", "2026-01-01T00:00:00.000Z");
const off = person("Chief Off", "chief_mentor", "2026-01-15T00:00:00.000Z", { status: "inactive" });
const lone = person("Lone Chief", "chief_mentor", "2026-01-20T00:00:00.000Z");
const two = person("Chief Two", "chief_mentor", "2026-02-01T00:00:00.000Z");
const three = person("Chief Three", "chief_mentor", "2026-03-01T00:00:00.000Z");
const four = person("Chief Four", "chief_mentor", "2026-04-01T00:00:00.000Z");
const memberOf = (lead: any, name: string, created_date: string, role = "junior_mentor") =>
  person(name, role, created_date, { up_head_id: String(lead._id), up_head_name: lead.full_name });
// Staff inside a team are members, not teams of their own. Each team's CS
// person is who its students go to.
const junior = memberOf(one, "Jun Ior", "2026-01-02T00:00:00.000Z");
const members = [junior, memberOf(off, "Off Member", "2026-01-16T00:00:00.000Z"), memberOf(two, "Two Member", "2026-02-02T00:00:00.000Z"),
  memberOf(three, "Three Member", "2026-03-02T00:00:00.000Z"), memberOf(four, "Four Member", "2026-04-02T00:00:00.000Z")];
const csOf = (lead: any, name: string, created_date: string) => memberOf(lead, name, created_date, "cs");
const [oneCs, offCs, twoCs, threeCs, fourCs] = [csOf(one, "One CS", "2026-01-03T00:00:00.000Z"), csOf(off, "Off CS", "2026-01-17T00:00:00.000Z"),
  csOf(two, "Two CS", "2026-02-03T00:00:00.000Z"), csOf(three, "Three CS", "2026-03-03T00:00:00.000Z"), csOf(four, "Four CS", "2026-04-03T00:00:00.000Z")];
const mentor = person("Existing Mentor", "senior_mentor", "2025-12-01T00:00:00.000Z");
const admin = person("Ad Min", "super_admin", "2025-11-01T00:00:00.000Z");
await db.collection("users").insertMany([one, off, lone, two, three, four, ...members, oneCs, offCs, twoCs, threeCs, fourCs, mentor, admin] as any[]);
// Somebody a mentor already added by hand — the highest code so far is STU-0007.
await db.collection("students").insertOne({
  student_code: "STU-0007", full_name: "Taken Already", email: "taken@e2e-finance.test",
  primary_mentor_id: String(mentor._id), primary_mentor_name: mentor.full_name,
  assignment_status: "assigned", status: "ACTIVE", student_level: "LEVEL_2", notes: "added by hand",
  created_date: "2026-05-01T00:00:00.000Z", updated_date: "2026-05-01T00:00:00.000Z",
});
check("four teams, a switched-off Chief, a Chief on their own, and a student already here", true);

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
const teamsGiven = first.map((x) => x.res.body?.data?.teamName);
check("team 1, 2, 3, 4, then team 1 and team 2 again",
  JSON.stringify(teamsGiven) === JSON.stringify(["Chief One", "Chief Two", "Chief Three", "Chief Four", "Chief One", "Chief Two"]),
  JSON.stringify(teamsGiven));
const mentors = first.map((x) => x.res.body?.data?.mentorName);
check("...each to its team's CS person", JSON.stringify(mentors) === JSON.stringify(["One CS", "Two CS", "Three CS", "Four CS", "One CS", "Two CS"]),
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
check("...owned by the team's CS person, with the team stored", s1?.primary_mentor_id === String(oneCs._id) && s1?.primary_mentor_name === "One CS" &&
  s1?.team_id === String(one._id) && s1?.team_name === "Chief One" && s1?.first_assignee_name === "One CS" && s1?.first_assignee_role === "cs");
check("...with a note saying where they came from", s1?.notes === "From Delta LMS — Delta Wave Theory Trading Programme, invoice INV-0004", s1?.notes);
check("...and the trail back to finance and the LMS",
  s1?.source === "delta_lms" && s1?.finance_invoice_number === "INV-0004" && s1?.lms_user_id === first[0].e.lmsUserId &&
  s1?.auto_assigned_team_name === "Chief One" && s1?.created_by_name === "Delta LMS (via finance)");
check("the switched-off Chief's team, the Chief on their own, the leaders and the other members got none",
  (await db.collection("students").countDocuments({ primary_mentor_id: { $in: [off, offCs, lone, one, two, three, four, ...members].map((u) => String(u._id)) } })) === 0);
const log = await db.collection("logs").findOne({ entity_id: String(s1?._id) }) as any;
check("the activity log has it, as the Students page would", log?.action_type === "create_student" && log?.entity_type === "Student" &&
  /Student 4 → One CS \(CS\) of team Chief One/.test(log?.details ?? ""), JSON.stringify(log));

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
check("none of that used up a turn: the next new student goes to team 3", r.body?.data?.teamName === "Chief Three", JSON.stringify(r.body));

step("Teams changing between students");
// A team made now — a Chief with a CS person under them — joins the end of the round, after team 4.
const five = person("Chief Five", "chief_mentor", "2026-06-01T00:00:00.000Z");
await db.collection("users").insertMany([five, csOf(five, "Five CS", "2026-06-02T00:00:00.000Z")] as any[]);
r = await send(enrolment());
check("after team 3 comes team 4, as before", r.body?.data?.teamName === "Chief Four", JSON.stringify(r.body));
r = await send(enrolment());
check("...then the new team, at the end of the round", r.body?.data?.teamName === "Chief Five" && r.body?.data?.mentorName === "Five CS", JSON.stringify(r.body));
r = await send(enrolment());
check("...then round to team 1", r.body?.data?.teamName === "Chief One", JSON.stringify(r.body));
await db.collection("users").updateOne({ _id: two._id }, { $set: { status: "inactive" } });
r = await send(enrolment());
check("a team whose leader is switched off sits out: team 2's turn goes to team 3", r.body?.data?.teamName === "Chief Three", JSON.stringify(r.body));

step("Teams as the Teams page makes them");
// A named team with a senior mentor leading it, created empty; a chain with no
// Chief above it; and people on their own, who are not teams.
const falcons = person("Sen Ior", "senior_mentor", "2026-07-01T00:00:00.000Z", { team_name: "Falcons" });
const leadTwo = person("Lead Two", "senior_mentor", "2026-08-01T00:00:00.000Z");
const underLead = person("Jun Three", "junior_mentor", "2026-08-02T00:00:00.000Z", { up_head_id: String(leadTwo._id), up_head_name: leadTwo.full_name });
const underFour = person("Jun Four", "junior_mentor", "2026-08-03T00:00:00.000Z", { up_head_id: String(four._id), up_head_name: four.full_name });
const solo = person("Solo Senior", "senior_mentor", "2026-09-01T00:00:00.000Z");
const underAdmin = person("Admin Kid", "junior_mentor", "2026-09-02T00:00:00.000Z", { up_head_id: String(admin._id), up_head_name: admin.full_name });
const falconsCs = csOf(falcons, "Falcons CS", "2026-07-02T00:00:00.000Z");
const leadTwoCs = csOf(leadTwo, "Lead Two CS", "2026-08-04T00:00:00.000Z");
await db.collection("users").insertMany([falcons, leadTwo, underLead, underFour, solo, underAdmin, falconsCs, leadTwoCs] as any[]);
const round: any[] = [];
for (let i = 0; i < 5; i++) round.push((await send(enrolment())).body?.data);
check("the round is now 4, 5, Falcons, Lead Two, then back to 1",
  JSON.stringify(round.map((d) => d?.teamName)) === JSON.stringify(["Chief Four", "Chief Five", "Falcons", "Lead Two", "Chief One"]),
  JSON.stringify(round.map((d) => d?.teamName)));
check("a named team takes its turn under its name, its CS person as the mentor",
  round[2]?.teamName === "Falcons" && round[2]?.mentorName === "Falcons CS", JSON.stringify(round[2]));
const falconsStudent = await db.collection("students").findOne({ student_code: round[2]?.studentCode }) as any;
check("...recorded that way on the student and in the log",
  falconsStudent?.primary_mentor_id === String(falconsCs._id) && falconsStudent?.team_name === "Falcons" && falconsStudent?.team_id === String(falcons._id) &&
  /→ Falcons CS \(CS\) of team Falcons/.test(((await db.collection("logs").findOne({ entity_id: String(falconsStudent?._id) })) as any)?.details ?? ""));
check("a chain with no Chief above it is a team too, under its leader's name", round[3]?.teamName === "Lead Two" && round[3]?.mentorName === "Lead Two CS");
check("people on their own (a Chief included), leaders, other members, and staff under an admin are never given a student",
  (await db.collection("students").countDocuments({
    primary_mentor_id: { $in: [solo, lone, underAdmin, underLead, underFour, falcons, leadTwo, five, ...members, mentor].map((u) => String(u._id)) },
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

step("The language they study in, from the close");
const fees = { currency: "AED", feeMinor: 130_000, paidMinor: 50_000, balanceMinor: 80_000 };
const hindi = enrolment({ language: "Hindi / Urdu", feeSummary: fees });
await send(hindi);
let lang = await db.collection("students").findOne({ finance_invoice_id: hindi.invoiceId }) as any;
check("however finance writes it, it is one of the CRMs' four — on the student and on the course's fees",
  lang?.language === "Hindi/Urdu" && lang?.course_fees?.[0]?.language === "Hindi/Urdu", JSON.stringify({ language: lang?.language, fees: lang?.course_fees }));
const arabic = enrolment({ language: "Arabic" });
await send(arabic);
check("a language the CRMs do not ask: none", !(await db.collection("students").findOne({ finance_invoice_id: arabic.invoiceId }) as any)?.language);
await send(enrolment({ email: hindi.email, language: "tamil", feeSummary: fees }));
lang = await db.collection("students").findOne({ _id: lang._id }) as any;
const changed = await db.collection("student_history").find({ student_id: String(lang?._id), type: "details_changed" }).toArray();
check("their next close, in Tamil: the student studies in Tamil now, in their history from finance",
  lang?.language === "Tamil" && lang?.course_fees?.length === 2 && lang.course_fees[1]?.language === "Tamil" && changed.length === 1 &&
  /Language: Hindi\/Urdu → Tamil/.test(changed[0]?.text ?? "") && changed[0]?.by_name === "Delta finance", JSON.stringify({ language: lang?.language, history: changed.map((h) => h.text) }));
await send(hindi);
check("finance retrying the first close: still Tamil, and no more history",
  ((await db.collection("students").findOne({ _id: lang._id })) as any)?.language === "Tamil" &&
  (await db.collection("student_history").countDocuments({ student_id: String(lang?._id), type: "details_changed" })) === 1);

step("The language, changed by the student's CS");
const held = { _id: new ObjectId(), full_name: "Held By One", email: "held@e2e-finance.test", student_code: "STU-9001", status: "ACTIVE",
  student_level: "LEVEL_1", primary_mentor_id: String(oneCs._id), primary_mentor_name: oneCs.full_name, created_date: new Date().toISOString() };
await db.collection("students").insertOne(held);
const csToken = (await call("POST", "/api/auth/login", { email: oneCs.email, password: "Password123!" })).body?.token;
const edit = (body: Record<string, unknown>) => call("POST", "/api/functions/updateStudentDetails", { studentId: String(held._id), ...body }, { authorization: `Bearer ${csToken}` });
let e = await edit({ language: "malayalam" });
const heldNow = await db.collection("students").findOne({ _id: held._id }) as any;
const heldLine = await db.collection("student_history").findOne({ student_id: String(held._id), type: "details_changed" }) as any;
check("set by their CS, written the CRMs' way, and in their history", e.status === 200 && heldNow?.language === "Malayalam" &&
  /Language: none → Malayalam/.test(heldLine?.text ?? "") && heldLine?.by_name === oneCs.full_name, JSON.stringify({ status: e.status, body: e.body, line: heldLine?.text }));
e = await edit({ language: "Klingon" });
check("a language that is not one of the four: refused, saying which", e.status === 400 && /English, Malayalam, Hindi\/Urdu, Tamil/.test(JSON.stringify(e.body)) &&
  ((await db.collection("students").findOne({ _id: held._id })) as any)?.language === "Malayalam", JSON.stringify(e.body));
e = await edit({ language: "" });
check("…and taken off again", e.status === 200 && ((await db.collection("students").findOne({ _id: held._id })) as any)?.language === "", JSON.stringify(e.body));

step("Which sales CRM sold it");
const adminAuth = { authorization: `Bearer ${login.body?.token}` };
const arrivalOf = async (id: unknown) =>
  ((await db.collection("student_history").findOne({ student_id: String(id), type: "arrived" })) as any)?.text ?? "";
const remote = enrolment({ crm: "remote", feeSummary: fees });
await send(remote);
let tagged = await db.collection("students").findOne({ finance_invoice_id: remote.invoiceId }) as any;
check("Case 1 — a student the Remote CRM sold is tagged so, on the student and on the course's fees",
  tagged?.sales_crm === "remote" && tagged?.course_fees?.[0]?.sales_crm === "remote", JSON.stringify({ crm: tagged?.sales_crm, fees: tagged?.course_fees }));
check("…and arrives from it, by name", /^Arrived from the Remote CRM, via finance/.test(await arrivalOf(tagged?._id)), await arrivalOf(tagged?._id));
let page = await call("POST", "/api/functions/getStudentHistory", { studentId: String(tagged?._id) }, adminAuth);
check("…their page says where they came from, with the tag", page.status === 200 && page.body?.cameFrom?.label === "Remote CRM, via finance"
  && page.body?.cameFrom?.salesCrm === "remote", JSON.stringify(page.body?.cameFrom));
await send(enrolment({ email: remote.email, crm: "delta", feeSummary: fees }));
tagged = await db.collection("students").findOne({ _id: tagged._id }) as any;
check("Case 2 — their next course, from the Sales CRM, is tagged on its own fees; the student keeps the CRM they came through",
  tagged?.sales_crm === "remote" && tagged?.course_fees?.length === 2 && tagged.course_fees[1]?.sales_crm === "delta", JSON.stringify(tagged?.course_fees?.map((f: any) => f.sales_crm)));
const untagged = enrolment({ feeSummary: fees });
await send(untagged);
let older = await db.collection("students").findOne({ finance_invoice_id: untagged.invoiceId }) as any;
check("Case 2 — from a finance that does not say: nothing stored, rather than a guess, and arrives as before",
  !older?.sales_crm && older?.course_fees?.[0]?.sales_crm === "" && /^Arrived from the Delta sales CRM, via finance/.test(await arrivalOf(older?._id)),
  JSON.stringify({ crm: older?.sales_crm, fee: older?.course_fees?.[0]?.sales_crm }));
page = await call("POST", "/api/functions/getStudentHistory", { studentId: String(older?._id) }, adminAuth);
check("…and their page reads as the Sales CRM's, as every student from finance before was", page.body?.cameFrom?.label === "Delta sales CRM, via finance"
  && page.body?.cameFrom?.salesCrm === "delta", JSON.stringify(page.body?.cameFrom));
await send(enrolment({ email: untagged.email, crm: "remote", feeSummary: fees }));
older = await db.collection("students").findOne({ _id: older._id }) as any;
check("Case 2 — a student from before is given the CRM of their next close", older?.sales_crm === "remote", String(older?.sales_crm));
const odd = enrolment({ crm: "Facebook Ads" });
await send(odd);
check("Case 3 — a CRM that is not one of the three: no tag", !((await db.collection("students").findOne({ finance_invoice_id: odd.invoiceId })) as any)?.sales_crm);
const patched = await call("PATCH", `/api/entities/Student/${String(tagged?._id)}`, { sales_crm: "draw" }, adminAuth);
check("Case 4 — not even an admin can change it from a screen: only finance sets it",
  ((await db.collection("students").findOne({ _id: tagged._id })) as any)?.sales_crm === "remote", `${patched.status} ${JSON.stringify(patched.body).slice(0, 160)}`);
check("Case 4 — and finance's door still wants its secret", (await send(enrolment({ crm: "remote" }), "wrong-secret")).status === 401);

step("Who looks after them — finance asking, for the sales CRMs' My Enrolments");
{
  const lookup = (body: unknown, secret: string | null = SECRET) =>
    call("POST", "/api/v1/integrations/finance/students/lookup", body, secret ? { "x-finance-secret": secret } : {});
  // One finance sent, given to a team and its CS by the round.
  const looked = await db.collection("students").findOne({ finance_invoice_id: { $exists: true }, assignment_status: "assigned",
    primary_mentor_name: { $nin: ["", null] }, team_name: { $nin: ["", null] } }) as any;
  await db.collection("students").insertOne({ student_code: "STU-9990", email: "Waiting.Student@e2e-finance.test", full_name: "Waiting Student",
    assignment_status: "open_pool", primary_mentor_name: "", team_name: "" });
  const r = await lookup({ codes: [String(looked?.student_code).toLowerCase(), "STU-0000"], emails: [String(looked?.email).toUpperCase(), "nobody@e2e-finance.test"] });
  const [byCode, noCode, byEmail, noEmail] = r.body?.data?.students ?? [];
  check("Case 1 — by student code: their CS and CS team, as they are now",
    r.status === 200 && byCode?.found && byCode.code === looked?.student_code && byCode.cs === looked?.primary_mentor_name && byCode.team === looked?.team_name && byCode.assignment === "assigned",
    JSON.stringify(byCode));
  check("…and by email, whatever its capitals", byEmail?.found && byEmail.code === looked?.student_code, JSON.stringify(byEmail));
  check("Case 2 — a code or an email nobody has: not found, nothing invented",
    noCode?.found === false && noCode.cs === "" && noEmail?.found === false, JSON.stringify([noCode, noEmail]));
  await db.collection("students").updateOne({ _id: looked._id }, { $set: { primary_mentor_name: "Moved Mentor", team_name: "Moved Team" } });
  const moved = (await lookup({ codes: [looked.student_code] })).body?.data?.students?.[0];
  check("Case 1 — given to another CS and team: said at once, not as finance was first told", moved?.cs === "Moved Mentor" && moved?.team === "Moved Team", JSON.stringify(moved));
  const waiting = (await lookup({ emails: ["waiting.student@e2e-finance.test"] })).body?.data?.students?.[0];
  check("Case 2 — waiting in Delta Open Students: no CS, and says so", waiting?.found && waiting.cs === "" && waiting.assignment === "open_pool", JSON.stringify(waiting));
  check("Case 2 — asked for nobody: an empty answer", ((await lookup({})).body?.data?.students ?? null)?.length === 0);
  check("Case 3 — more than 200 at a time: refused", (await lookup({ codes: Array.from({ length: 201 }, (_, i) => `STU-${i}`) })).status === 400);
  check("Case 3 — not a JSON object: refused", (await call("POST", "/api/v1/integrations/finance/students/lookup", ["STU-1"], { "x-finance-secret": SECRET })).status === 400);
  check("Case 4 — no secret, or a wrong one: refused",
    (await lookup({ codes: [looked.student_code] }, null)).status === 401 && (await lookup({ codes: [looked.student_code] }, "wrong-secret")).status === 401);
}

await db.dropDatabase();
await client.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
