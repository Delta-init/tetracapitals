/**
 * Meetings done's Meeting commission tab and its Converted meetings (the user, 2026-11-10), on made-up staff in a
 * throwaway mongod (functions/meetingCommissions.ts, functions/meetingOutcomes.ts convertedFor):
 *   - a mentor sees their own Meeting mentor commission, a Chief their team's, a CS Manager and an admin everyone's,
 *     a CS none (refused); the mentor filter stays inside what one may see; only the days asked for;
 *   - each row: the payment, the student, the % and AED, the commission's status; the meeting it came from — the one the
 *     request links, else the mentor's last Mentor Calendar meeting with the student before the payment, else none;
 *   - totals leave reversed (cancelled) credits out;
 *   - converted: an approved course payment linked to the meeting, or not linked and naming the meeting's mentor after
 *     it — not one before it, not another mentor's, not a pending one, not one linked to another meeting.
 * Run through ./test-meeting-commissions.sh. Refuses anything but a scratch database on 127.0.0.1.
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

const u = (name: string, app_role: string, up?: ObjectId) => ({ _id: new ObjectId(), full_name: name, email: `${name.toLowerCase().replace(/ /g, ".")}@e2e.test`, app_role, status: "active", up_head_id: up ? String(up) : "" });
const chief = u("Chief A", "chief_mentor");
const senior = u("Senior A", "senior_mentor", chief._id);
const chiefB = u("Chief B", "chief_mentor");
const junior = u("Junior B", "junior_mentor", chiefB._id);
const csm = u("Manager", "cs_manager");
const admin = u("Admin", "super_admin");
const cs = u("Cee Ess", "cs", senior._id);
await db.collection("users").insertMany([chief, senior, chiefB, junior, csm, admin, cs] as any[]);
const s1 = { _id: new ObjectId(), full_name: "Student One", student_code: "STU-0001", email: "one@e2e.test" };
const s2 = { _id: new ObjectId(), full_name: "Student Two", student_code: "STU-0002", email: "two@e2e.test" };
const s3 = { _id: new ObjectId(), full_name: "Student Three", student_code: "STU-0003", email: "three@e2e.test" };
await db.collection("students").insertMany([s1, s2, s3] as any[]);
const meet = (id: string, student: any, mentor: any, at: string, stage = "interested") =>
  ({ _id: id, student_ids: [String(student._id)], meeting: { title: `Meeting ${id}`, starts_at: at }, mentor: { name: mentor.full_name.toUpperCase(), email: mentor.email.toUpperCase() }, stage });
await db.collection("meeting_outcomes").insertMany([
  meet("m-linked", s1, senior, "2026-11-01T10:00:00.000Z"),
  meet("m-old", s2, senior, "2026-10-20T10:00:00.000Z", "follow_up"),
  meet("m-cal", s2, senior, "2026-11-02T10:00:00.000Z"),
  meet("m-after", s2, senior, "2026-11-20T10:00:00.000Z"),
] as any[]);
const tx = async (student: any, mentor: any, requested_at: string, extra: Record<string, unknown> = {}) => {
  const _id = new ObjectId();
  await db.collection("funding_transactions").insertOne({ _id, type: "BONUS", status: "APPROVED", student_id: String(student._id), student_name: student.full_name, requested_at, approved_at: requested_at, txn_id: `MB-${String(_id).slice(-4)}`,
    course_payment: { product: "DSLP", paid_today_aed: 2000 }, meeting_mentor_id: String(mentor._id), meeting_mentor_name: mentor.full_name, ...extra } as any);
  return String(_id);
};
const credit = async (txId: string, mentor: any, requested_at: string, usd: number, status = "accrued") =>
  db.collection("commission_credits").insertOne({ transaction_id: txId, position: "Meeting mentor", percentage: 2, commission_usd: usd, status, recipient_id: String(mentor._id), recipient_name: mentor.full_name, requested_at, method: "bonus_with" } as any);
// Senior: linked to m-linked; found on the calendar (m-cal, not m-old, not m-after); none on the calendar; one reversed.
const T1 = await tx(s1, senior, "2026-11-03T08:00:00.000Z", { meeting_link: { meeting_id: "m-linked" } });
const T2 = await tx(s2, senior, "2026-11-05T08:00:00.000Z");
const T3 = await tx(s3, senior, "2026-11-06T08:00:00.000Z");
const T4 = await tx(s3, senior, "2026-11-07T08:00:00.000Z");
await credit(T1, senior, "2026-11-03T08:00:00.000Z", 10.9);
await credit(T2, senior, "2026-11-05T08:00:00.000Z", 10);
await credit(T3, senior, "2026-11-06T08:00:00.000Z", 20);
await credit(T4, senior, "2026-11-07T08:00:00.000Z", 5, "cancelled");
// Junior on Chief B's team; one in October (outside the days).
const T5 = await tx(s3, junior, "2026-11-08T08:00:00.000Z");
await credit(T5, junior, "2026-11-08T08:00:00.000Z", 30, "released");
const T6 = await tx(s3, junior, "2026-10-15T08:00:00.000Z");
await credit(T6, junior, "2026-10-15T08:00:00.000Z", 99);

const { connectDb, closeDb } = await import("../db");
const { getMeetingCommissions } = await import("../functions/meetingCommissions");
const { convertedFor } = await import("../functions/meetingOutcomes");
await connectDb();
const as = (x: any) => ({ id: String(x._id), email: x.email, full_name: x.full_name, app_role: x.app_role }) as any;
const ask = async (who: any, body: Record<string, unknown> = {}) => {
  const res = await getMeetingCommissions(new Request("http://e2e/api/functions/getMeetingCommissions", { method: "POST", body: JSON.stringify({ from: "2026-11-01", to: "2026-11-30", ...body }) }), as(who));
  return { status: res.status, body: (await res.json()) as any };
};
const names = (b: any) => (b.rows ?? []).map((r: any) => r.mentor.name + ":" + r.txn_id).sort();

step("Who sees what");
let r = await ask(senior);
check("a Senior: their own four, nobody else's", r.status === 200 && r.body.rows.length === 4 && r.body.rows.every((x: any) => x.mentor.name === "Senior A") && r.body.sees === "own", show(r.body));
r = await ask(chief);
check("their Chief: the team's (the Senior's), not Chief B's Junior", r.status === 200 && r.body.rows.length === 4 && r.body.sees === "team", show(names(r.body)));
r = await ask(chiefB);
check("Chief B: their Junior's November one", r.body.rows.length === 1 && r.body.rows[0].mentor.name === "Junior B", show(names(r.body)));
r = await ask(csm);
check("a CS Manager: everyone's", r.body.rows.length === 5 && r.body.sees === "everyone", show(names(r.body)));
r = await ask(admin);
check("an admin: everyone's, and the mentor list for the filter", r.body.rows.length === 5 && JSON.stringify(r.body.mentors.map((m: any) => m.name)) === JSON.stringify(["Junior B", "Senior A"]), show(r.body.mentors));
r = await ask(cs);
check("a CS: refused", r.status === 403, show(r.body));

step("Filters");
r = await ask(admin, { mentor: String(junior._id) });
check("the mentor filter", r.body.rows.length === 1 && r.body.rows[0].mentor.name === "Junior B");
r = await ask(senior, { mentor: String(junior._id) });
check("…never outside what one may see", r.status === 200 && r.body.rows.length === 0, show(r.body));
r = await ask(admin, { from: "2026-10-01", to: "2026-10-31" });
check("only the days asked for (Dubai)", r.body.rows.length === 1 && r.body.rows[0].commission_aed === 363.33, show(r.body.rows));
r = await ask(admin, { from: "2026-11-30", to: "2026-11-01" });
check("days the wrong way round: refused", r.status === 400);

step("Each row");
r = await ask(senior);
const row = (id: string) => r.body.rows.find((x: any) => x.txn_id === `MB-${id.slice(-4)}`);
const a = row(T1), b = row(T2), c = row(T3), d = row(T4);
check("the payment, student, course, %, AED", a.student.name === "Student One" && a.student.code === "STU-0001" && a.course === "DSLP" && a.paid_aed === 2000 && a.pct === 2 && a.commission_aed === 40 && a.status === "accrued", show(a));
check("linked on the request: that meeting", a.meeting?.id === "m-linked" && a.meeting.how === "linked" && a.meeting.stage === "interested", show(a.meeting));
check("not linked: the mentor's last calendar meeting before the payment (whatever the email's case)", b.meeting?.id === "m-cal" && b.meeting.how === "calendar", show(b.meeting));
check("none on the calendar: says so (null)", c.meeting === null, show(c.meeting));
check("a reversed one listed as cancelled", d.status === "cancelled");
check("totals leave the reversed one out", r.body.totals.count === 3 && r.body.totals.aed === 150.1 && r.body.totals.by_status.accrued === 150.1 && !("cancelled" in r.body.totals.by_status), show(r.body.totals));
check("newest first", r.body.rows[0].txn_id === d.txn_id);

step("Converted");
// A pending payment, one linked to another meeting, one by another mentor.
await tx(s1, junior, "2026-11-04T08:00:00.000Z", { status: "PENDING" });
const conv = await convertedFor([
  { meeting_id: "m-linked", student_id: String(s1._id), starts_at: "2026-11-01T10:00:00.000Z", mentor_id: String(junior._id) },
  { meeting_id: "m-cal", student_id: String(s2._id), starts_at: "2026-11-02T10:00:00.000Z", mentor_id: String(senior._id) },
  { meeting_id: "m-old", student_id: String(s2._id), starts_at: "2026-10-20T10:00:00.000Z", mentor_id: String(senior._id) },
  { meeting_id: "m-after", student_id: String(s2._id), starts_at: "2026-11-20T10:00:00.000Z", mentor_id: String(senior._id) },
  { meeting_id: "m-other-mentor", student_id: String(s2._id), starts_at: "2026-11-01T10:00:00.000Z", mentor_id: String(junior._id) },
  { meeting_id: "m-s1-unlinked", student_id: String(s1._id), starts_at: "2026-10-01T10:00:00.000Z", mentor_id: String(senior._id) },
]);
check("linked to the meeting: converted (whoever the mentor)", conv.has(`m-linked|${s1._id}`));
check("not linked, names the meeting's mentor, after it: converted — earlier ones of theirs too", conv.has(`m-cal|${s2._id}`) && conv.has(`m-old|${s2._id}`), show([...conv]));
check("a meeting after the payment: not", !conv.has(`m-after|${s2._id}`));
check("another mentor's meeting: not", !conv.has(`m-other-mentor|${s2._id}`));
check("a payment linked to another meeting doesn't convert this one", !conv.has(`m-s1-unlinked|${s1._id}`), show([...conv]));
const pendingOnly = await convertedFor([{ meeting_id: "m-x", student_id: String(s1._id), starts_at: "2026-11-01T00:00:00.000Z", mentor_id: String(junior._id) }]);
check("a pending payment: not", pendingOnly.size === 0);

await closeDb(); await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
