/**
 * How student meetings went (students/meetingOutcomes.ts, functions/meetingOutcomes.ts), against a stand-in LMS on
 * made-up students:
 *   - outcomes filled in the LMS land on the students on the meeting (by email): the stage, the history;
 *   - interested / follow-up: a reminder for the CS — the open follow-up moves, else a new one; the bell for the CS;
 *   - each outcome once, the cursor moves, an older outcome never overwrites a newer stage;
 *   - the pop-up's calls pass the signed-in person's email, and saving puts it on the student at once;
 *   - the Students page's Stage filter; the student page's history for whoever may see the student.
 * Run through ./test-meeting-outcomes.sh. Refuses anything but a scratch database on 127.0.0.1.
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const j = (v: unknown) => JSON.stringify(v).slice(0, 400);

// The stand-in LMS: the outcomes feed (from ?since=, inclusive), the pending list, saving one, and the meetings list.
let feed: any[] = [];
let meetingsList: any[] = [];
const seen: { path: string; query: Record<string, string>; body?: any }[] = [];
const lms = Bun.serve({
  port: Number(process.env.E2E_FAKE_LMS_PORT),
  async fetch(req) {
    const u = new URL(req.url);
    const query = Object.fromEntries(u.searchParams);
    const body: any = req.method === "POST" ? await req.json() : undefined;
    seen.push({ path: u.pathname, query, body });
    if (u.pathname.endsWith("/service/meeting-outcomes")) {
      const since = query.since ? Date.parse(query.since) : -Infinity;
      const meetings = feed.filter((m) => Date.parse(m.outcome.filledAt) >= since).sort((a, b) => a.outcome.filledAt.localeCompare(b.outcome.filledAt));
      return Response.json({ success: true, data: { meetings, next: meetings.at(-1)?.outcome.filledAt ?? query.since ?? null } });
    }
    if (u.pathname.endsWith("/service/meeting-outcomes/meetings")) {
      const emails = (query.emails ?? "").split(",").filter(Boolean);
      const meetings = emails.length ? meetingsList.filter((m) => m.attendees.some((a: any) => emails.includes(a.email.toLowerCase()))) : meetingsList;
      return Response.json({ success: true, data: { meetings } });
    }
    if (u.pathname.endsWith("/service/meeting-outcomes/pending")) {
      return Response.json({ success: true, data: { meetings: query.mentorEmail === "ann@e2e.test" ? [{ id: "m9", title: "Pitch" }] : [] } });
    }
    const save = u.pathname.match(/\/service\/mentor-meetings\/(\w+)\/outcome$/);
    if (save) {
      if (save[1] === "taken") return Response.json({ success: false, error: { message: "Already filled by ANN" } }, { status: 409 });
      feed.push(outcomeMeeting(save[1]!, ["s3@e2e.test"], { stage: body.stage, reason: body.reason, remark: body.remark, filledAt: "2026-10-27T09:00:00.000Z", filledByName: "ANN", filledVia: "portal" }));
      return Response.json({ success: true, data: { id: save[1], outcome: { stage: body.stage } } });
    }
    return Response.json({ message: "not found" }, { status: 404 });
  },
});

function outcomeMeeting(id: string, emails: string[], o: Record<string, unknown>) {
  return {
    id, title: `Meeting ${id}`, category: "course_pitch", startsAt: "2026-10-27T06:00:00.000Z", durationMins: 30,
    attendees: emails.map((e, i) => ({ name: `Attendee ${i}`, email: e.toUpperCase() })), bookedByEmail: "booker@e2e.test",
    mentor: { name: "ANN", email: "ann@e2e.test" },
    outcome: { stage: "", courseId: "", courseTitle: "", paymentDate: "", paymentMode: "", followUpKind: "", followUpDate: "", withMentorName: "", withMentorEmail: "", moduleTitle: "", reason: "", remark: "", filledByName: "ANN", filledByEmail: "ann@e2e.test", filledVia: "lms", filledAt: "", ...o },
  };
}

const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
const megha = { _id: new ObjectId(), email: "megha@e2e.test", full_name: "Megha", app_role: "cs", status: "active" };
const ravi = { _id: new ObjectId(), email: "ravi@e2e.test", full_name: "Ravi", app_role: "cs", status: "active" };
const booker = { _id: new ObjectId(), email: "booker@e2e.test", full_name: "Booker", app_role: "cs", status: "active" };
const boss = { _id: new ObjectId(), email: "boss@e2e.test", full_name: "Boss", app_role: "super_admin", status: "active" };
await db.collection("users").insertMany([megha, ravi, booker, boss] as any[]);
const stu = (name: string, email: string, cs: any, extra: any = {}) => ({ _id: new ObjectId(), full_name: name, student_code: name.slice(0, 3).toUpperCase(), email, primary_mentor_id: cs ? String(cs._id) : null, primary_mentor_name: cs?.full_name ?? "", status: "ACTIVE", created_date: "2026-09-01T00:00:00.000Z", ...extra });
const saif = stu("Saif", "s1@e2e.test", megha), hamda = stu("Hamda", "s2@e2e.test", megha), nitish = stu("Nitish", "s3@e2e.test", ravi), orphan = stu("Orphan", "s4@e2e.test", null);
await db.collection("students").insertMany([saif, hamda, nitish, orphan] as any[]);
await db.collection("transaction_tags").insertMany([{ name: "Market Breakout", active: true }, { name: "DSLP PRO", active: true }] as any[]);
// Hamda already has an open follow-up: it moves rather than a second one.
const hamdaFollowup = await db.collection("student_followups").insertOne({ student_id: String(hamda._id), target_outcome: "DSLP PRO", stage: "Contacted", next_followup_date: "2026-10-28", next_followup_time: "15:00", created_date: "2026-10-20T00:00:00.000Z" } as any);

const { connectDb, closeDb } = await import("../db");
const { syncMeetingOutcomes, outcomeSummary } = await import("../students/meetingOutcomes");
const F = await import("../functions/meetingOutcomes");
const { listStudents } = await import("../functions/studentsList");
await connectDb();
const asUser = (u: any) => ({ id: String(u._id), email: u.email, full_name: u.full_name, app_role: u.app_role }) as any;
const call = async (fn: any, user: any, body: any = {}) => { const r: Response = await fn(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), asUser(user)); return { status: r.status, body: await r.json() as any }; };
const student = async (s: any) => (await db.collection("students").findOne({ _id: s._id })) as any;
const bells = async (u: any) => (await db.collection("notifications").find({ user_id: String(u._id) }).toArray()) as any[];

console.log("\n\x1b[1mOutcomes from the LMS onto the students\x1b[0m");
feed = [
  outcomeMeeting("m1", ["s1@e2e.test"], { stage: "interested", courseTitle: "Market Breakout", paymentDate: "2026-11-02", paymentMode: "Tabby", concern: "Afraid of losing again", remark: "Pays after salary", filledAt: "2026-10-27T07:00:00.000Z",
    profile: { experience: "beginner", years: 2, hadLosses: true, lossAmount: 5000, lossCurrency: "AED", lossHow: ["scammed"], country: "UAE", familyInDubai: true, occupation: "Engineer" } }),
  outcomeMeeting("m2", ["s2@e2e.test", "stranger@e2e.test"], { stage: "follow_up", followUpKind: "revision_needed", followUpDate: "2026-10-30", remark: "Lost on entries", filledAt: "2026-10-27T07:05:00.000Z" }),
  outcomeMeeting("m3", ["nobody@e2e.test"], { stage: "not_interested", reason: "Price", remark: "Too dear", filledAt: "2026-10-27T07:10:00.000Z" }),
  outcomeMeeting("m4", ["s4@e2e.test"], { stage: "meeting_with", withMentorName: "BOB", withMentorEmail: "bob@e2e.test", remark: "Wants Bob", filledAt: "2026-10-27T07:15:00.000Z" }),
];
let r = await syncMeetingOutcomes(new Date("2026-10-27T08:00:00.000Z"));
check("four outcomes in", r.ok && r.applied === 4, j(r));
let s1 = await student(saif);
check("Saif: stage interested, with the summary", s1.meeting_stage === "interested" && s1.meeting_stage_summary === "Interested — Market Breakout, pay 2026-11-02 by Tabby" && s1.meeting_stage_meeting_id === "m1", j(s1));
const saifF = (await db.collection("student_followups").find({ student_id: String(saif._id) }).toArray()) as any[];
check("…a new follow-up on the payment date, about the course, for his CS", saifF.length === 1 && saifF[0].next_followup_date === "2026-11-02" && saifF[0].target_outcome === "Market Breakout" && saifF[0].stage === "New" && saifF[0].notes === "Pays after salary", j(saifF));
const mb = await bells(megha);
check("…the client's profile and concern on him", s1.client_profile?.occupation === "Engineer" && s1.client_profile.lossHow?.[0] === "scammed" && s1.client_profile.by === "ANN" && s1.meeting_concern === "Afraid of losing again", j(s1.client_profile));
check("…Megha (his CS) belled with what the mentor said", mb.some((b) => /Meeting outcome: Interested/.test(b.title) && /ANN met Saif/.test(b.message) && /Concern: Afraid of losing again/.test(b.message) && /Follow-up set for 2026-11-02/.test(b.message) && b.link === `/StudentDetail?id=${saif._id}`), j(mb));
const hamdaFs = (await db.collection("student_followups").find({ student_id: String(hamda._id) }).toArray()) as any[];
check("Hamda: her open follow-up moved to the date (no second one), the time cleared", hamdaFs.length === 1 && hamdaFs[0].next_followup_date === "2026-10-30" && hamdaFs[0].next_followup_time === "" && hamdaFs[0].stage === "Contacted", j(hamdaFs));
const ev = (await db.collection("student_followup_events").find({ followup_id: String(hamdaFollowup.insertedId) }).toArray()) as any[];
check("…with the outcome and the remark in its log", ev.length === 1 && /Meeting outcome: Follow-up — Revision needed on 2026-10-30/.test(ev[0].text) && ev[0].notes === "Lost on entries", j(ev));
check("a meeting with nobody of ours: kept, on nobody", ((await db.collection("meeting_outcomes").findOne({ _id: "m3" } as any)) as any)?.student_ids?.length === 0);
const o4 = await student(orphan);
check("meeting with a mentor: the stage, no reminder", o4.meeting_stage === "meeting_with" && (await db.collection("student_followups").countDocuments({ student_id: String(orphan._id) })) === 0, j(o4));
check("…no CS: whoever booked it is belled", (await bells(booker)).some((b) => b.link === `/StudentDetail?id=${orphan._id}`));

console.log("\n\x1b[1mOnce each; a later outcome wins\x1b[0m");
r = await syncMeetingOutcomes(new Date("2026-10-27T08:02:00.000Z"));
check("the next look: nothing new (the last one is read again and skipped)", r.ok && r.applied === 0, j(r));
check("the cursor is the last one's time", ((await db.collection("sync_cursors").findOne({ _id: "meeting_outcomes" } as any)) as any)?.since === "2026-10-27T07:15:00.000Z");
check("…and asked from it", seen.filter((x) => x.path.endsWith("/meeting-outcomes")).at(-1)?.query.since === "2026-10-27T07:15:00.000Z");
// An older outcome for Saif (a second meeting filled earlier, read late): his stage stays the later one.
feed.push(outcomeMeeting("m0", ["s1@e2e.test"], { stage: "not_interested", reason: "Time", remark: "Old", filledAt: "2026-10-27T07:20:00.000Z" }));
feed.push(outcomeMeeting("m5", ["s1@e2e.test"], { stage: "revision", courseTitle: "Market Breakout", moduleTitle: "Price action", withMentorName: "BOB", remark: "Revise", filledAt: "2026-10-27T07:30:00.000Z" }));
await db.collection("students").updateOne({ _id: saif._id }, { $set: { meeting_stage_at: "2026-10-27T07:25:00.000Z", meeting_stage: "interested" } });
r = await syncMeetingOutcomes(new Date("2026-10-27T08:04:00.000Z"));
s1 = await student(saif);
check("a newer outcome without a second step keeps the profile there was", s1.client_profile?.occupation === "Engineer", j(s1.client_profile));
check("an outcome older than the stage leaves it; a newer one takes over", r.applied === 2 && s1.meeting_stage === "revision" && s1.meeting_stage_summary === "Revision — Market Breakout · Price action, with BOB", j(s1));
check("revision makes no reminder", (await db.collection("student_followups").countDocuments({ student_id: String(saif._id) })) === 1);

console.log("\n\x1b[1mThe pop-up's calls\x1b[0m");
let res = await call(F.getPendingMeetingOutcomes, { ...megha, email: "ann@e2e.test" });
check("pending: asked for the signed-in person's email", res.status === 200 && res.body.meetings?.[0]?.id === "m9" && seen.at(-1)?.query.mentorEmail === "ann@e2e.test", j(res));
res = await call(F.getPendingMeetingOutcomes, megha);
check("…somebody who is no mentor: none", res.body.meetings?.length === 0);
res = await call(F.saveMeetingOutcome, { ...ravi, email: "ann@e2e.test" }, { meetingId: "m7", stage: "not_interested", reason: "Price", concern: "Money", remark: "No budget", mentorEmail: "hacker@e2e.test", profile: { experience: "fresher", country: "India" } });
const sent = seen.find((x) => x.path.endsWith("/m7/outcome"))?.body;
check("saving: sent as the signed-in person, whatever the page says", res.status === 200 && sent?.mentorEmail === "ann@e2e.test", j(res));
check("…with the concern and the second step passed on", sent?.concern === "Money" && sent?.profile?.country === "India", j(sent));
await new Promise((ok) => setTimeout(ok, 300));
const n = await student(nitish);
check("…and on the student at once", n.meeting_stage === "not_interested", j(n));
res = await call(F.saveMeetingOutcome, megha, { meetingId: "taken", stage: "not_interested" });
check("filled already: the LMS's reason, as a 409", res.status === 409 && /Already filled by ANN/.test(res.body?.error ?? res.body?.message ?? j(res.body)), j(res));

console.log("\n\x1b[1mThe Students page and the student page\x1b[0m");
const list = async (user: any, meetingStage: string) => (await call(listStudents, user, { tab: "all", filters: { meetingStage } })).body;
let L = await list(boss, "interested");
check("Stage filter: nobody interested now (Saif moved on)", L.rows?.length === 0, j(L));
L = await list(boss, "revision");
check("Stage filter: revision → Saif, with his stage on the row", L.rows?.length === 1 && L.rows[0].meeting_stage === "revision", j(L.rows?.map((x: any) => x.full_name)));
L = await list(boss, "none");
check("Stage filter: none → nobody without a meeting outcome (all four have one)", L.rows?.length === 0, j(L.rows?.map((x: any) => x.full_name)));
res = await call(F.getStudentMeetingOutcomes, boss, { studentId: String(saif._id) });
check("history: Saif's three, newest first, with the mentor and the reminder", j(res.body.outcomes?.map((x: any) => x.id)) === j(["m5", "m0", "m1"]) && res.body.outcomes[2].reminder?.date === "2026-11-02" && res.body.outcomes[0].mentor.name === "ANN", j(res.body));
res = await call(F.getStudentMeetingOutcomes, ravi, { studentId: String(new ObjectId()) });
check("…a student who isn't there: 404 (who may see one is the student page's own rule)", res.status === 404, j(res));
check("summary of each stage", outcomeSummary({ stage: "meeting_with", withMentorName: "BOB" }) === "Meeting with mentor — BOB" && outcomeSummary({ stage: "not_interested", reason: "Price" }) === "Not interested — Price");

console.log("\n\x1b[1mMeetings: the student's tab, Meetings done, the report\x1b[0m");
const mtg = (id: string, emails: string[], status: string, mentor: { name: string; email: string }, outcome: any = null, startsAt = "2026-10-27T06:00:00.000Z") => ({
  id, title: `Meeting ${id}`, category: "course_pitch", startsAt, endsAt: startsAt, durationMins: 30, inPerson: false, location: "",
  attendees: emails.map((e, i) => ({ name: `Attendee ${i}`, email: e })), bookedByEmail: "booker@e2e.test", mentor, status, cancelledAt: null, outcome,
});
const ANN = { name: "ANN", email: "ann@e2e.test" }, BOB = { name: "BOB", email: "bob@e2e.test" };
meetingsList = [
  mtg("m1", ["s1@e2e.test"], "done", ANN, { stage: "interested", courseTitle: "Market Breakout", paymentDate: "2026-11-02", paymentMode: "Tabby", remark: "Pays after salary" }),
  mtg("m2", ["s2@e2e.test"], "done", ANN, { stage: "follow_up", followUpKind: "revision_needed", followUpDate: "2026-10-30", remark: "Lost on entries" }),
  mtg("w1", ["s3@e2e.test"], "waiting", BOB),
  mtg("c1", ["s1@e2e.test"], "cancelled", BOB),
  mtg("u1", ["s2@e2e.test"], "upcoming", ANN, null, "2026-10-29T06:00:00.000Z"),
  mtg("x1", ["stranger@e2e.test"], "done", BOB, { stage: "not_interested", reason: "Price", remark: "Too dear" }),
];
const days = { from: "2026-10-01", to: "2026-10-31" };
res = await call(F.getMeetingsDone, boss, days);
check("Meetings done (an admin): held ones — done and waiting — one row per student, ours and a stranger's", res.status === 200
  && j(res.body.rows.map((r: any) => r.meeting_id).sort()) === j(["m1", "m2", "w1", "x1"]), j(res.body.rows?.map((r: any) => [r.meeting_id, r.status])));
const r1 = res.body.rows.find((r: any) => r.meeting_id === "m1");
check("…a row: the student with their CS and team, the mentor, the stage, the summary, the follow-up it set", r1?.student?.name === "Saif" && r1.student.cs === "Megha" && r1.mentor.name === "ANN"
  && r1.stage === "interested" && /Market Breakout/.test(r1.summary) && r1.reminder?.date === "2026-11-02", j(r1));
check("…and the filters' lists", res.body.mentors.length === 2 && res.body.cses.some((c: any) => c.name === "Megha"), j([res.body.mentors, res.body.cses]));
res = await call(F.getMeetingsDone, boss, { ...days, stage: "waiting" });
check("stage: waiting for the mentor", j(res.body.rows.map((r: any) => r.meeting_id)) === j(["w1"]), j(res.body.rows));
res = await call(F.getMeetingsDone, boss, { ...days, mentor: "ann@e2e.test" });
check("mentor: ANN's", res.body.rows.every((r: any) => r.mentor.email === "ann@e2e.test") && res.body.rows.length === 2);
res = await call(F.getMeetingsDone, boss, { ...days, status: "cancelled" });
check("status: cancelled", j(res.body.rows.map((r: any) => r.meeting_id)) === j(["c1"]));
res = await call(F.getMeetingsDone, megha, days);
check("a CS: their own students' only (Saif, Hamda) — not Ravi's, not a stranger's", j(res.body.rows.map((r: any) => r.student?.name).sort()) === j(["Hamda", "Saif"]), j(res.body.rows.map((r: any) => [r.meeting_id, r.student?.name])));
await db.collection("users").insertOne({ _id: new ObjectId(), email: "bob@e2e.test", full_name: "BOB", app_role: "senior_mentor", status: "active" });
const bobUser = await db.collection("users").findOne({ email: "bob@e2e.test" });
res = await call(F.getMeetingsDone, bobUser, days);
check("a mentor: the meetings they held, students of theirs or not", res.body.rows.some((r: any) => r.meeting_id === "w1") && res.body.rows.some((r: any) => r.meeting_id === "x1") && res.body.rows.every((r: any) => r.mentor.email === "bob@e2e.test"), j(res.body.rows.map((r: any) => r.meeting_id)));
res = await call(F.getMeetingsDone, boss, { from: "2026-10-31", to: "2026-10-01" });
check("days the wrong way round: refused", res.status === 400);
res = await call(F.getMeetingsReport, megha, days);
check("the report: not for a CS", res.status === 403);
res = await call(F.getMeetingsReport, boss, days);
const T = res.body?.totals;
check("the report: held 4, done 3, waiting 1, cancelled 1, upcoming 1", res.status === 200 && T?.held === 4 && T.done === 3 && T.waiting === 1 && T.cancelled === 1 && T.upcoming === 1, j(T));
check("…done by stage", res.body.stages.interested === 1 && res.body.stages.follow_up === 1 && res.body.stages.not_interested === 1, j(res.body.stages));
const annRow = res.body.mentors.find((m: any) => m.id === "ann@e2e.test");
check("…per mentor (ANN: held 2, done 2, 1 interested)", annRow?.held === 2 && annRow.done === 2 && annRow.interested === 1, j(res.body.mentors));
check("…per CS (Megha: 2 held) and per team", res.body.cses.find((c: any) => c.name === "Megha")?.held === 2 && Array.isArray(res.body.teams), j(res.body.cses));
res = await call(F.getStudentMeetings, boss, { studentId: String(saif._id) });
check("Saif's Meetings tab: his, newest first, each with where it stands, the outcome and the follow-up", res.status === 200 && j(res.body.meetings.map((m: any) => m.id)) === j(["m1", "c1"])
  && res.body.meetings[0].reminder?.date === "2026-11-02" && /Market Breakout/.test(res.body.meetings[0].summary) && res.body.client_profile?.occupation === "Engineer", j(res.body));
res = await call(F.getStudentMeetings, boss, { studentId: String(new ObjectId()) });
check("…a student who isn't there: 404", res.status === 404);

await closeDb();
await client.close();
lms.stop(true);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
