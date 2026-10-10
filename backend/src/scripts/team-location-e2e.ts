/**
 * Dubai / Bangalore teams (lib/location.ts), on made-up staff and students:
 *   - a student's location from the CRM (Banglore CRM) or the LMS academy; unset is Dubai;
 *   - new students go only to their location's teams, each location with its own round; none there → Open Students;
 *   - the inactivity rule moves students only to a team of the same location;
 *   - the Students list filters by location.
 * The academy picked at the close (the user, 2026-10-10):
 *   - Dubai keeps the round it always had (the counter record is carried on, never reset); Bangalore has its own;
 *   - finance's `academy` decides a new student's location and wins over the CRM; an older finance (none) → the CRM;
 *     kept on the course's fees; the Banglore CRM's tag; a student already here is not moved;
 *   - LMS-direct students by the LMS academy they came from;
 *   - each list row and the student page say where the student is (current_location / history location);
 *   - the inactivity rule moves a Bangalore student to the other Bangalore team, never a Dubai one.
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

// The two intakes' shared secrets — read by config when it is first imported, below.
const FINANCE_SECRET = "team-location-e2e-finance-secret-0123456789", LMS_SECRET = "team-location-e2e-lms-secret-0123456789";
process.env.FINANCE_S2S_SECRET = FINANCE_SECRET; process.env.LMS_S2S_SECRET = LMS_SECRET;
const { connectDb, closeDb } = await import("../db");
const L = await import("../lib/location");
const { salesCrmName, salesCrmOf } = await import("../students/salesCrm");
const { createStudent } = await import("../students/intake");
const { runInactivity } = await import("../students/inactivity");
const { listStudents } = await import("../functions/studentsList");
const { getStudentHistory } = await import("../functions/getStudentHistory");
const { handleFinanceStudents } = await import("../finance/students");
const { handleLmsStudents } = await import("../lms/students");
await connectDb();
const BOSS = { id: String(boss._id), email: boss.email, full_name: "Boss", app_role: "super_admin" } as any;
const keyOf = (x: any) => `${x.created_date}|${String(x._id)}`;

console.log("\n\x1b[1mWhere a student belongs\x1b[0m");
check("Banglore CRM → Bangalore; the tag known", L.studentLocationOf({ salesCrm: "banglore" }) === "bangalore" && salesCrmOf("banglore") === "banglore" && salesCrmName("banglore") === "Banglore CRM");
check("the LMS's Bangalore academy → Bangalore", L.studentLocationOf({ academy: "Delta Bangalore" }) === "bangalore");
check("anything else → Dubai", L.studentLocationOf({ salesCrm: "delta" }) === "dubai" && L.studentLocationOf({}) === "dubai");
check("finance's academy decides: a Sales CRM close for Bangalore → Bangalore", L.studentLocationOf({ salesCrm: "delta", academy: "bangalore" }) === "bangalore");
check("…and wins over the CRM: Banglore CRM with academy dubai → Dubai", L.studentLocationOf({ salesCrm: "banglore", academy: "dubai" }) === "dubai");
check("…none (an older finance): the CRM decides", L.studentLocationOf({ salesCrm: "banglore", academy: "" }) === "bangalore" && L.studentLocationOf({ salesCrm: "remote", academy: null }) === "dubai");

let n = 0;
const make = (location: "dubai" | "bangalore") => {
  const i = ++n;
  return createStudent({ location, name: `Student ${i}`, email: `s${i}@stu.test`, phone: "", country: "", notes: "", trace: { source: "delta_lms", finance_invoice_id: `INV-${i}` }, arrived: "Arrived", createdBy: "finance", createdByName: "Finance", unique: { field: "finance_invoice_id", value: `INV-${i}`, existing: "invoice", detail: "" } });
};
const mentorOf = async (code: number) => String(((await db.collection("students").findOne({ finance_invoice_id: `INV-${code}` })) as any)?.primary_mentor_id ?? "");

console.log("\n\x1b[1mNew students\x1b[0m");
// Dubai's round as it stood before there were locations: team A took the last student.
await db.collection("counters").insertOne({ _id: "finance_student_team_turn", last_key: keyOf(chiefA), last_team_id: String(chiefA._id), last_team_name: "Dubai A" } as any);
for (let i = 0; i < 4; i++) await make("bangalore");
const blr = await Promise.all([1, 2, 3, 4].map(mentorOf));
check("4 Bangalore students: only the Bangalore team's CS, in turn", blr.join() === [c1, c2, c1, c2].map((x) => String(x._id)).join(), blr.join());
const counter = (id: string) => db.collection("counters").findOne({ _id: id } as any) as Promise<any>;
check("…in Bangalore's own round; Dubai's round untouched", (await counter("finance_student_team_turn:bangalore"))?.last_team_id === String(chiefC._id) && (await counter("finance_student_team_turn"))?.last_key === keyOf(chiefA));
for (let i = 0; i < 4; i++) await make("dubai");
const dxb = await Promise.all([5, 6, 7, 8].map(mentorOf));
const dubaiCs = new Set([a1, a2, b1].map((x) => String(x._id)));
check("4 Dubai students: only Dubai teams' CS, across both teams", dxb.every((m) => dubaiCs.has(m)) && dxb.some((m) => m === String(b1._id)) && dxb.some((m) => m !== String(b1._id)), dxb.join());
check("…Dubai's round carried on where it was (A last → B first), not reset", dxb[0] === String(b1._id) && [a1, a2].map((x) => String(x._id)).includes(dxb[1]!), dxb.join());
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
const rowsOf = async (location: string) => {
  const res = await listStudents(new Request("http://x", { method: "POST", body: JSON.stringify({ filters: { location }, limit: 100 }) }), BOSS);
  return ((await res.json()) as any)?.rows ?? [];
};
const blRows = await rowsOf("bangalore"), duRows = await rowsOf("dubai");
check("each row says where they are — the Bangalore list's rows Bangalore (the one with no team too), Dubai's Dubai",
  blRows.length === 5 && blRows.every((r: any) => r.current_location === "bangalore") && duRows.length === 4 && duRows.every((r: any) => r.current_location === "dubai"));
const historyOf = async (id: unknown) => (await (await getStudentHistory(new Request("http://x", { method: "POST", body: JSON.stringify({ studentId: String(id) }) }), BOSS)).json()) as any;
const h1 = await historyOf(((await db.collection("students").findOne({ finance_invoice_id: "INV-1" })) as any)._id);
const h9 = await historyOf(pooled._id);
const h5 = await historyOf(((await db.collection("students").findOne({ finance_invoice_id: "INV-5" })) as any)._id);
check("the student page: a Bangalore team's student, the one waiting with no team, a Dubai one",
  h1?.team?.location === "bangalore" && h1?.location === "bangalore" && h9?.team === null && h9?.location === "bangalore" && h5?.location === "dubai", JSON.stringify([h1?.team, h9?.location, h5?.location]));

console.log("\n\x1b[1mThe inactivity rule\x1b[0m");
const old = new Date(Date.now() - 200 * 864e5).toISOString();
await db.collection("students").updateMany({}, { $set: { assigned_at: new Date().toISOString() } });
await db.collection("students").updateOne({ finance_invoice_id: "INV-1" }, { $set: { assigned_at: old } });     // Bangalore, C1
const aStudent: any = await db.collection("students").findOne({ primary_mentor_id: { $in: [String(a1._id), String(a2._id)] } });
await db.collection("students").updateOne({ _id: aStudent._id }, { $set: { assigned_at: old } });                // Dubai, team A
const r = await runInactivity();
check("a Bangalore student: no other Bangalore team, so left where they are", (await mentorOf(1)) === String(c1._id) && r.left.some((x) => /same location/.test(x.reason)), JSON.stringify(r));
check("a Dubai student: moved to the other Dubai team", String(((await db.collection("students").findOne({ _id: aStudent._id })) as any).primary_mentor_id) === String(b1._id));
// A second Bangalore team: now a Bangalore student has somewhere to go — but only there, never to Dubai.
const chiefD = u("ChiefD", "chief_mentor", undefined, { team_name: "Bangalore D", team_location: "Bangalore" }), d1 = u("D1", "cs", chiefD._id);
await db.collection("users").insertMany([chiefD, d1] as any[]);
const dubaiInactivity = (await counter("inactivity_team_turn"))?.last_key;
await db.collection("students").updateOne({ finance_invoice_id: "INV-1" }, { $set: { assigned_at: new Date().toISOString() } });  // the one left above: not due now
await db.collection("students").updateOne({ finance_invoice_id: "INV-2" }, { $set: { assigned_at: old } });     // Bangalore, C2
const r2 = await runInactivity();
const moved2: any = await db.collection("students").findOne({ finance_invoice_id: "INV-2" });
check("with a second Bangalore team: a Bangalore student moved there, not to a Dubai team", String(moved2?.primary_mentor_id) === String(d1._id) && moved2?.team_id === String(chiefD._id) && r2.moved === 1, JSON.stringify(r2));
check("…in Bangalore's own inactivity round; Dubai's left as it was", (await counter("inactivity_team_turn:bangalore"))?.last_team_id === String(chiefD._id) && (await counter("inactivity_team_turn"))?.last_key === dubaiInactivity);

console.log("\n\x1b[1mFrom finance — the academy picked at the close\x1b[0m");
const blrCs = new Set([c1, c2, d1].map((x) => String(x._id)));
let f = 0;
const fromFinance = async (over: Record<string, unknown>, secret = FINANCE_SECRET) => {
  const i = ++f;
  const body = {
    invoiceId: `FIN-${i}`, invoiceNumber: `INV-F${i}`, email: `fin${i}@stu.test`, name: `Finance ${i}`, course: "Forex Mastery", lmsUserId: new ObjectId().toString(),
    feeSummary: { feeMinor: 5_000_000, paidMinor: 5_000_000, balanceMinor: 0, currency: "INR", bonus: { given: false } },
    ...over,
  };
  const res = await handleFinanceStudents(new Request("http://x/api/v1/integrations/finance/students", { method: "POST", headers: { "content-type": "application/json", "x-finance-secret": secret }, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any, student: (await db.collection("students").findOne({ finance_invoice_id: body.invoiceId })) as any };
};
const arrivedText = async (s: any) => String(((await db.collection("student_history").findOne({ student_id: String(s?._id), type: "arrived" })) as any)?.text ?? "");

let fr = await fromFinance({ crm: "delta", academy: "bangalore" });
check("a Sales CRM close for Bangalore: made, given to a Bangalore team's CS", fr.status === 200 && fr.body?.data?.created === true && blrCs.has(String(fr.student?.primary_mentor_id)), JSON.stringify(fr.body));
check("…stored as Bangalore, the Sales CRM's tag, the course's fees in INR marked Bangalore",
  fr.student?.location === "bangalore" && fr.student?.sales_crm === "delta" && fr.student?.course_fees?.[0]?.academy === "bangalore" && fr.student?.course_fees?.[0]?.currency === "INR");
check("…its history says it was for the Bangalore academy", /Delta sales CRM for the Bangalore academy, via finance/.test(await arrivedText(fr.student)), await arrivedText(fr.student));
fr = await fromFinance({ crm: "banglore", academy: "bangalore" });
check("a Banglore CRM close: Bangalore team, tagged banglore", blrCs.has(String(fr.student?.primary_mentor_id)) && fr.student?.location === "bangalore" && fr.student?.sales_crm === "banglore" && fr.student?.course_fees?.[0]?.sales_crm === "banglore");
check("…arrived from the Banglore CRM", /^Arrived from the Banglore CRM, via finance/.test(await arrivedText(fr.student)), await arrivedText(fr.student));
fr = await fromFinance({ crm: "banglore" });
check("a Banglore CRM close from an older finance (no academy): Bangalore all the same", blrCs.has(String(fr.student?.primary_mentor_id)) && fr.student?.location === "bangalore");
fr = await fromFinance({ crm: "remote", academy: "dubai", feeSummary: { feeMinor: 1_000_000, paidMinor: 500_000, balanceMinor: 500_000, currency: "AED" } });
const dubaiStudent = fr.student;
check("a Remote CRM close for Dubai: a Dubai team, stored Dubai, fees marked Dubai", dubaiCs.has(String(fr.student?.primary_mentor_id)) && fr.student?.location === "dubai" && fr.student?.course_fees?.[0]?.academy === "dubai");
fr = await fromFinance({ crm: "delta" });
check("no academy and not the Banglore CRM: Dubai, as before", dubaiCs.has(String(fr.student?.primary_mentor_id)) && fr.student?.location === "dubai");
fr = await fromFinance({ crm: "banglore", academy: "dubai" });
check("the academy wins over the CRM: Banglore CRM with academy dubai → a Dubai team", dubaiCs.has(String(fr.student?.primary_mentor_id)) && fr.student?.location === "dubai");
const beforeTurn = (await counter("finance_student_team_turn:bangalore"))?.last_key;
const again = await fromFinance({ crm: "delta", academy: "bangalore", email: dubaiStudent.email, invoiceId: "FIN-AGAIN", invoiceNumber: "INV-AGAIN" });
const after: any = await db.collection("students").findOne({ _id: dubaiStudent._id });
check("a Dubai student already here buys a Bangalore course: left on their team, still Dubai, no turn used",
  again.body?.data?.created === false && again.body?.data?.existing === "email" && String(after?.primary_mentor_id) === String(dubaiStudent.primary_mentor_id) && after?.location === "dubai"
  && (await counter("finance_student_team_turn:bangalore"))?.last_key === beforeTurn, JSON.stringify(again.body));
check("…the new course's fees added, marked Bangalore", after?.course_fees?.length === 2 && after.course_fees[1]?.invoice_id === "FIN-AGAIN" && after.course_fees[1]?.academy === "bangalore");
await db.collection("users").updateMany({ _id: { $in: [c1._id, c2._id, d1._id] } }, { $set: { status: "inactive" } });
fr = await fromFinance({ crm: "banglore", academy: "bangalore" });
check("no Bangalore CS: the finance student waits in Open Students, not with a Dubai team", fr.body?.data?.assignment === "open_pool" && !fr.student?.primary_mentor_id && fr.student?.location === "bangalore");
await db.collection("users").updateMany({ _id: { $in: [c1._id, c2._id, d1._id] } }, { $set: { status: "active" } });
const refused = await fromFinance({ crm: "delta", academy: "bangalore" }, "wrong-secret");
check("a wrong secret: refused, nothing made", refused.status === 401 && !refused.student);

console.log("\n\x1b[1mFrom the LMS directly\x1b[0m");
const fromLms = async (academy: string, i: number) => {
  const body = { lmsUserId: new ObjectId().toString(), email: `lms${i}@stu.test`, name: `LMS ${i}`, course: "Forex Mastery", academy };
  const res = await handleLmsStudents(new Request("http://x/api/v1/integrations/lms/students", { method: "POST", headers: { "content-type": "application/json", "x-lms-secret": LMS_SECRET }, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as any, student: (await db.collection("students").findOne({ lms_user_id: body.lmsUserId })) as any };
};
let lr = await fromLms("Bangalore Academy", 1);
check("the LMS's Bangalore academy: a Bangalore team, stored Bangalore, its academy kept", lr.body?.data?.created === true && blrCs.has(String(lr.student?.primary_mentor_id)) && lr.student?.location === "bangalore" && lr.student?.lms_academy === "Bangalore Academy");
lr = await fromLms("Delta Dubai", 2);
check("the LMS's Dubai academy: a Dubai team", dubaiCs.has(String(lr.student?.primary_mentor_id)) && lr.student?.location === "dubai");
lr = await fromLms("", 3);
check("no academy: Dubai", dubaiCs.has(String(lr.student?.primary_mentor_id)) && lr.student?.location === "dubai");

await new Promise((r) => setTimeout(r, 300));   // the "new student" notices sent in the background
await closeDb(); await db.dropDatabase(); await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
