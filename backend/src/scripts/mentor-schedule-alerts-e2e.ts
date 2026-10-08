/**
 * Mentors told of their own schedule (students/mentorScheduleAlerts.ts), against a stand-in LMS on made-up mentors:
 *   - the first look takes note and tells nobody;
 *   - a session booked with a mentor: that mentor's bell, nobody else's; another academy's class: nothing;
 *   - moved, cancelled (status or gone from the answer): told once each;
 *   - 30 minutes before: one reminder; a moved one gets a new one;
 *   - the LMS not answering: nothing is taken for cancelled.
 * Run through ./test-mentor-schedule-alerts.sh. Refuses anything but a scratch database on 127.0.0.1.
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

// The stand-in LMS: GET /api/v1/service/mentors answers with `mentors`, or 503 while `down`.
let mentors: any[] = [];
let down = false;
const lms = Bun.serve({
  port: Number(process.env.E2E_FAKE_LMS_PORT),
  fetch(req) {
    const u = new URL(req.url);
    if (down) return Response.json({ message: "down" }, { status: 503 });
    if (u.pathname.endsWith("/service/mentors")) return Response.json({ success: true, data: { timezone: "Asia/Dubai", mentors } });
    return Response.json({ message: "not found" }, { status: 404 });
  },
});

const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
const amjad = { _id: new ObjectId(), email: "amjad@e2e.test", full_name: "Amjad", app_role: "chief_mentor", status: "active" };
const megha = { _id: new ObjectId(), email: "megha@e2e.test", full_name: "Megha", app_role: "cs", status: "active" };
await db.collection("users").insertMany([amjad, megha] as any[]);

const { connectDb, closeDb } = await import("../db");
const { checkMentorSchedules } = await import("../students/mentorScheduleAlerts");
await connectDb();
const bells = async (u: any) => (await db.collection("notifications").find({ user_id: String(u._id) }).sort({ created_date: 1 }).toArray()) as any[];
const at = (base: Date, mins: number) => new Date(base.getTime() + mins * 60_000).toISOString();
const t0 = new Date("2026-10-10T06:00:00.000Z");
const mentor = (email: string, classes: any[] = [], meetings: any[] = []) => ({ id: email, name: email, email: email.toUpperCase(), slots: [], classes, meetings });
const meeting = (id: string, startsAt: string, title = "Intro call") => ({ id, title, kind: "student", startsAt, durationMins: 30, attendeeNames: ["Student One"], bookedByEmail: "cs@e2e.test", inPerson: false, location: "" });
const klass = (id: string, startsAt: string, extra: any = {}) => ({ id, title: "DWT Live", startsAt, durationMins: 60, status: "scheduled", booked: 3, capacity: 10, mine: true, ...extra });

console.log("\n\x1b[1mFirst look, then changes\x1b[0m");
mentors = [mentor("amjad@e2e.test", [klass("c1", at(t0, 600))], [meeting("m1", at(t0, 300))])];
let r = await checkMentorSchedules(t0);
check("first look: nobody told about what was already there", r.ok && r.sent === 0 && (await bells(amjad)).length === 0, JSON.stringify(r));

mentors[0].meetings.push(meeting("m2", at(t0, 400), "Weekly catch-up"));
mentors[0].classes.push(klass("c9", at(t0, 500), { mine: false, title: null }));
r = await checkMentorSchedules(t0);
let b = await bells(amjad);
check("a new session: the mentor is told", r.sent === 1 && /New session booked with you/.test(b.at(-1)?.title) && /Weekly catch-up — with Student One/.test(b.at(-1)?.message), JSON.stringify(b.at(-1)));
check("…found by their email whatever its case; the link opens Mentor Calendar", b.at(-1)?.link === "/MentorCalendar" && b.at(-1)?.type === "mentor_schedule");
check("…another academy's class: nothing; another mentor: nothing", (await bells(megha)).length === 0 && b.length === 1);

mentors[0].meetings[1].startsAt = at(t0, 450);
r = await checkMentorSchedules(t0);
b = await bells(amjad);
check("moved: told, with the new time and the old", r.sent === 1 && /Session moved/.test(b.at(-1)?.title) && /now .* \(was /.test(b.at(-1)?.message), JSON.stringify(b.at(-1)));

mentors[0].classes[0].status = "cancelled";
r = await checkMentorSchedules(t0);
b = await bells(amjad);
check("a class cancelled: told once", r.sent === 1 && /Class cancelled/.test(b.at(-1)?.title));
r = await checkMentorSchedules(t0);
check("…and not again", r.sent === 0);

down = true;
r = await checkMentorSchedules(t0);
check("the LMS not answering: skipped, nothing taken for cancelled", !r.ok && (await bells(amjad)).length === b.length);
down = false;

mentors[0].meetings = mentors[0].meetings.filter((m: any) => m.id !== "m1");
r = await checkMentorSchedules(t0);
b = await bells(amjad);
check("a session gone from the LMS's answer: told it's cancelled", r.sent === 1 && /Session cancelled/.test(b.at(-1)?.title) && /Intro call/.test(b.at(-1)?.message));

console.log("\n\x1b[1m30 minutes before\x1b[0m");
const t1 = new Date(new Date(mentors[0].meetings[0].startsAt).getTime() - 25 * 60_000);   // m2 starts in 25 minutes
r = await checkMentorSchedules(t1);
b = await bells(amjad);
check("a reminder 30 minutes before", r.sent === 1 && /Starts in 25 minutes/.test(b.at(-1)?.title), JSON.stringify(b.at(-1)));
r = await checkMentorSchedules(new Date(t1.getTime() + 2 * 60_000));
check("…only once", r.sent === 0);
mentors[0].meetings[0].startsAt = at(t1, 120);
await checkMentorSchedules(t1);
r = await checkMentorSchedules(new Date(t1.getTime() + 100 * 60_000));
b = await bells(amjad);
check("moved later: a new reminder for the new time", /Starts in 20 minutes/.test(b.at(-1)?.title), JSON.stringify(b.slice(-2).map((x) => x.title)));

await closeDb();
await client.close();
lms.stop();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
