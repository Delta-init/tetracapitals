/**
 * The LMS admin's Meeting requests / Meetings done (the user, 2026-11-10), through POST /api/v1/integrations/lms/mentor-meetings
 * (lms/mentorMeetings.ts), on made-up staff in a throwaway mongod and a stand-in LMS:
 *   - the LMS's own secret, or nothing; the mentor found by the address the LMS sends (any letter case, an inactive
 *     account never); "me" says whether they are a mentor, whether they ask, which Meetings done tabs;
 *   - a Senior asks, finds students, sees and takes back only their own requests (box forced to "mine"), opens only
 *     their own; a Chief can't ask but reads the team's Meetings done with Converted; a CS is refused everything;
 *   - deciding or anything not listed: refused; the portal's own refusals come back with their message.
 * Run through ./test-lms-mentor-meetings.sh. Refuses anything but a scratch database on 127.0.0.1.
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

// The stand-in LMS: the meetings feed the portal reads (functions/meetingOutcomes.ts meetingRows, meetingRequests.ts).
let meetings: any[] = [];
const lms = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  fetch(req) {
    const u = new URL(req.url);
    if (req.headers.get("x-portal-secret") !== process.env.LMS_SERVICE_SECRET) return Response.json({ success: false, error: { message: "bad secret" } }, { status: 401 });
    if (u.pathname === "/api/v1/service/meeting-outcomes/meetings") return Response.json({ success: true, data: { meetings } });
    return Response.json({ success: false, error: { message: "not here" } }, { status: 404 });
  },
});
process.env.LMS_API_URL = `http://127.0.0.1:${lms.port}`;

const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});
const u = (name: string, app_role: string, up?: ObjectId, extra: Record<string, unknown> = {}) =>
  ({ _id: new ObjectId(), full_name: name, email: `${name.toLowerCase().replace(/ /g, ".")}@e2e.test`, app_role, status: "active", up_head_id: up ? String(up) : "", ...extra });
const chief = u("Chief A", "chief_mentor");
const senior = u("Senior A", "senior_mentor", chief._id);
const junior = u("Junior A", "junior_mentor", chief._id);
const cs = u("Cee Ess", "cs", senior._id);
const gone = u("Gone Mentor", "senior_mentor", chief._id, { status: "inactive" });
const boss = u("Boss Admin", "super_admin");
const csm = u("Cee Manager", "cs_manager");
await db.collection("users").insertMany([chief, senior, junior, cs, gone, boss, csm] as any[]);
const s1 = { _id: new ObjectId(), full_name: "Student One", student_code: "STU-0001", email: "one@e2e.test", primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name };
await db.collection("students").insertOne(s1 as any);
meetings = [{
  id: "m-chief", startsAt: "2026-11-02T10:00:00.000Z", endsAt: "2026-11-02T10:30:00.000Z", title: "Session with Student One", category: "course_pitch", status: "done",
  attendees: [{ name: "Student One", email: "ONE@e2e.test" }], mentor: { name: "Chief A", email: chief.email }, bookedByEmail: cs.email, outcome: { stage: "interested" },
}];
// A paid course payment naming the Chief as who held the meeting, after it → Converted; and a Meeting mentor credit for the Senior.
const txId = new ObjectId();
await db.collection("funding_transactions").insertOne({ _id: txId, type: "BONUS", status: "APPROVED", student_id: String(s1._id), student_name: s1.full_name, requested_at: "2026-11-03T08:00:00.000Z",
  approved_at: "2026-11-03T09:00:00.000Z", txn_id: "MB-0001", course_payment: { product: "DSLP", paid_today_aed: 2000 }, meeting_mentor_id: String(chief._id), meeting_mentor_name: chief.full_name } as any);
await db.collection("commission_credits").insertOne({ transaction_id: String(txId), position: "Meeting mentor", percentage: 2, commission_usd: 10.9, status: "accrued",
  recipient_id: String(senior._id), recipient_name: senior.full_name, requested_at: "2026-11-03T08:00:00.000Z", method: "bonus_with" } as any);

const { connectDb, closeDb } = await import("../db");
const { handleLmsMentorMeetings } = await import("../lms/mentorMeetings");
const { config } = await import("../config");
await connectDb();
const SECRET = process.env.LMS_S2S_SECRET!;
const call = async (payload: unknown, secret: string | null = SECRET) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-lms-secret"] = secret;
  const res = await handleLmsMentorMeetings(new Request("http://e2e/api/v1/integrations/lms/mentor-meetings", { method: "POST", headers, body: typeof payload === "string" ? payload : JSON.stringify(payload) }));
  return { status: res.status, body: (await res.json()) as any };
};
const as = (who: any, action: string, body?: Record<string, unknown>) => call({ email: who.email, action, ...(body ? { body } : {}) });

step("The link");
let r = await call({ email: senior.email, action: "me" }, null);
check("no secret: 401", r.status === 401, show(r));
r = await call({ email: senior.email, action: "me" }, "wrong");
check("a wrong secret: 401", r.status === 401);
config.lmsS2sSecret = "";
r = await call({ email: senior.email, action: "me" });
check("not set up here: 503", r.status === 503);
config.lmsS2sSecret = SECRET;
r = await call("[1]");
check("not an object: 400", r.status === 400);
r = await call({ email: "nope", action: "me" });
check("no address: 400", r.status === 400);

step("Who is asking (me)");
r = await call({ email: `  ${senior.email.toUpperCase()} `, action: "me" });
check("a Senior, whatever the letter case: a mentor who asks, Meeting commission only", r.status === 200 && r.body.data.mentor === true && r.body.data.asks === true
  && r.body.data.role === "senior_mentor" && JSON.stringify(r.body.data.meetings_done) === '["commission"]', show(r.body));
r = await as(chief, "me");
check("a Chief: books, so doesn't ask; Meetings + Meeting commission", r.body.data.mentor === true && r.body.data.asks === false && JSON.stringify(r.body.data.meetings_done) === '["meetings","commission"]', show(r.body));
r = await as(cs, "me");
check("a CS: not a mentor (answered, not refused)", r.status === 200 && r.body.data.mentor === false, show(r.body));
r = await call({ email: "nobody@e2e.test", action: "me" });
check("no account: not a mentor", r.status === 200 && r.body.data.mentor === false && /No CS Portal account/.test(r.body.data.message));
r = await as(gone, "me");
check("an inactive account: not a mentor", r.body.data.mentor === false, show(r.body));

step("Asking for a meeting");
r = await as(senior, "searchMeetingStudents", { q: "Student" });
check("a Senior finds any student, with their CS", r.status === 200 && r.body.data.students[0]?.id === String(s1._id) && r.body.data.students[0]?.cs_name === "Cee Ess", show(r.body));
r = await as(chief, "searchMeetingStudents", { q: "Student" });
check("…a Chief doesn't (they book): 403", r.status === 403, show(r));
const ask = { studentId: String(s1._id), category: "course_upgrade", course: "DSLP", durationMins: 30, mode: "cs", notes: "Wants the upgrade" };
r = await as(senior, "createMeetingRequest", ask);
const reqId = r.body.data?.request?.id;
check("a Senior asks: waiting for the CS, numbered, the mentor is them", r.status === 200 && r.body.data.request.status === "pending" && /^MR-/.test(r.body.data.request.number)
  && r.body.data.request.mentor.name === "Senior A", show(r.body));
const told = await db.collection("notifications").find({ user_id: String(cs._id) }).toArray();
check("…the student's CS is told", told.length === 1 && /Meeting request/.test(String(told[0].title)), show(told));
r = await as(senior, "createMeetingRequest", ask);
check("asking again while it waits: the portal's own refusal, with its message", r.status === 409 && /already have a request waiting/.test(r.body.error.message), show(r.body));
r = await as(chief, "createMeetingRequest", ask);
check("a Chief can't ask", r.status === 403);
r = await as(cs, "createMeetingRequest", ask);
check("a CS: not a mentor, refused", r.status === 403 && r.body.error.code === "NOT_A_MENTOR", show(r.body));
r = await as(gone, "createMeetingRequest", ask);
check("an inactive account: refused (no account)", r.status === 404, show(r.body));
r = await as(junior, "createMeetingRequest", { ...ask, category: "overview" });
const juniorReq = r.body.data?.request?.id;
check("the Junior asks too", r.status === 200 && !!juniorReq, show(r.body));

step("Their requests");
r = await as(senior, "listMeetingRequests", { box: "to_decide" });
check("only their own, whatever box is sent", r.status === 200 && r.body.data.requests.length === 1 && r.body.data.requests[0].id === reqId && r.body.data.requests[0].view === "needs_review", show(r.body));
check("…with the counts per tab", r.body.data.counts.all === 1 && r.body.data.counts.needs_review === 1, show(r.body.data.counts));
r = await as(senior, "getMeetingRequestReview", { id: reqId });
check("their own opened: the 7-day check, not theirs to decide", r.status === 200 && !!r.body.data.eligibility && r.body.data.may_decide === false && r.body.data.eligibility.blocked === false, show(r.body));
r = await as(senior, "getMeetingRequestReview", { id: juniorReq });
check("another mentor's: refused", r.status === 403, show(r.body));
r = await as(senior, "getStudentMeetingHistory", { studentId: String(s1._id) });
check("the student's earlier meetings: both requests listed", r.status === 200 && r.body.data.meetings.filter((m: any) => m.kind === "request").length === 2, show(r.body));
r = await as(senior, "cancelMeetingRequest", { id: juniorReq });
check("can't take back another mentor's", r.status === 409, show(r.body));
r = await as(senior, "cancelMeetingRequest", { id: reqId });
check("takes back their own", r.status === 200 && (await db.collection("meeting_requests").findOne({ _id: new ObjectId(reqId) }))?.status === "cancelled");
r = await as(senior, "decideMeetingRequest", { id: juniorReq, action: "reject", reason: "x" });
check("deciding is never possible from the LMS", r.status === 400 && (await db.collection("meeting_requests").findOne({ _id: new ObjectId(juniorReq) }))?.status === "pending", show(r.body));

step("Meetings done");
r = await as(senior, "getMeetingCommissions", { from: "2026-11-01", to: "2026-11-30" });
check("a Senior: their Meeting mentor commission", r.status === 200 && r.body.data.sees === "own" && r.body.data.rows.length === 1 && r.body.data.rows[0].commission_aed === 40, show(r.body));
r = await as(senior, "getMeetingsDone", { from: "2026-11-01", to: "2026-11-30" });
check("a Senior can't read the meetings list", r.status === 403);
r = await as(chief, "getMeetingsDone", { from: "2026-11-01", to: "2026-11-30", status: "all" });
const row = r.body.data?.rows?.find((x: any) => x.meeting_id === "m-chief");
check("a Chief: the team's meetings, Converted where the payment names them after it", r.status === 200 && row?.student?.name === "Student One" && row?.converted === true, show(r.body));
r = await as(chief, "getMeetingCommissions", { from: "2026-11-01", to: "2026-11-30" });
check("a Chief: the team's commission", r.status === 200 && r.body.data.sees === "team" && r.body.data.rows.length === 1, show(r.body));
r = await as(chief, "getMeetingsDone", { from: "2026-11-30", to: "2026-11-01" });
check("days the wrong way round: the portal's message", r.status === 400 && /Pick the days/.test(r.body.error.message), show(r.body));
r = await as(cs, "getMeetingCommissions", { from: "2026-11-01", to: "2026-11-30" });
check("a CS: refused", r.status === 403);

step("An LMS admin: what their account here may read, read only");
r = await as(boss, "me");
check("a Super Admin: a viewer — the requests they decide, Meetings + Meeting commission", r.status === 200 && r.body.data.viewer === true && r.body.data.mentor === false
  && r.body.data.requests === "to_decide" && JSON.stringify(r.body.data.meetings_done) === '["meetings","commission"]', show(r.body));
r = await as(csm, "me");
check("a CS Manager: a viewer — Meeting commission only", r.body.data.viewer === true && JSON.stringify(r.body.data.meetings_done) === '["commission"]', show(r.body));
r = await as(boss, "listMeetingRequests", { box: "mine" });
check("…every request (the ones they decide), whatever box is sent", r.status === 200 && r.body.data.requests.length === 2, show(r.body.data?.counts));
r = await as(boss, "getMeetingRequestReview", { id: juniorReq });
check("…opens one", r.status === 200 && r.body.data.request.id === juniorReq);
r = await as(boss, "createMeetingRequest", ask);
check("…can't ask", r.status === 403 && r.body.error.code === "READ_ONLY", show(r.body));
r = await as(boss, "cancelMeetingRequest", { id: juniorReq });
check("…can't take one back", r.status === 403 && (await db.collection("meeting_requests").findOne({ _id: new ObjectId(juniorReq) }))?.status === "pending");
r = await as(boss, "getMeetingsDone", { from: "2026-11-01", to: "2026-11-30", status: "all" });
check("…every meeting", r.status === 200 && r.body.data.rows.some((x: any) => x.meeting_id === "m-chief"), show(r.body));
r = await as(boss, "getMeetingCommissions", { from: "2026-11-01", to: "2026-11-30" });
check("…everyone's commission", r.status === 200 && r.body.data.sees === "everyone" && r.body.data.rows.length === 1, show(r.body));
r = await as(csm, "getMeetingsDone", { from: "2026-11-01", to: "2026-11-30" });
check("a CS Manager: no meetings list", r.status === 403);
r = await as(csm, "getMeetingCommissions", { from: "2026-11-01", to: "2026-11-30" });
check("…the commission", r.status === 200 && r.body.data.rows.length === 1, show(r.body));

await closeDb(); await client.close(); lms.stop(true);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
