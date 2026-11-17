/**
 * GET /api/public/mentor-tv (functions/mentorTv.ts, 2026-11-17) — Root's Mentors TV board:
 *   - a mentor's revenue: approved course payments naming them as the meeting's mentor, this month, AED; today's apart;
 *     never one pending, a sales-close credit, one marked "no mentor", another mentor's, or another month's;
 *   - meetings this month from the LMS (not cancelled, each once), by the mentor's address;
 *   - only mentors with a payment or a meeting; ranked by revenue; one location (the team's), the other kept apart;
 *   - a month gone by as it ended (no today, no recent); the LMS down: meetings left out (null), revenue still there;
 *   - names, roles, teams and amounts only — never a student or an email.
 * Run through ./test-mentor-tv.sh.
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;
let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => { if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); } else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); } };
const show = (v: unknown) => JSON.stringify(v).slice(0, 500);

// A stand-in LMS: this month's meetings, or down when asked.
let lmsDown = false;
const now = new Date();
const dubai = new Date(now.getTime() + 4 * 3_600_000);
const thisMonth = dubai.toISOString().slice(0, 7);
const lastStart = new Date(Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth() - 1, 1));
const lastMonth = lastStart.toISOString().slice(0, 7);
const midLast = new Date(Date.UTC(lastStart.getUTCFullYear(), lastStart.getUTCMonth(), 15, 8)).toISOString();
const meeting = (id: string, mentorEmail: string, status = "done") => ({
  id, title: "1:1", category: "general", startsAt: now.toISOString(), endsAt: now.toISOString(), durationMins: 30, inPerson: false, location: "",
  attendees: [{ name: "Student A", email: "student-a@e2e.local" }, { name: "Student B", email: "student-b@e2e.local" }], bookedByEmail: "", mentor: { name: "x", email: mentorEmail },
  status, cancelledAt: null, outcome: null,
});
const lmsAsked: string[] = [];
const lms = Bun.serve({
  port: Number(process.env.E2E_LMS_PORT),
  fetch(req) {
    const url = new URL(req.url);
    lmsAsked.push(`${url.pathname}?${url.searchParams.get("from")}..${url.searchParams.get("to")}`);
    if (lmsDown) return Response.json({ success: false, message: "down" }, { status: 503 });
    if (url.pathname.endsWith("/meeting-outcomes/meetings")) {
      return Response.json({ success: true, data: { meetings: [
        meeting("m1", "ALPHA@e2e.local"), meeting("m2", "alpha@e2e.local", "waiting"), meeting("m3", "alpha@e2e.local", "cancelled"),
        meeting("m4", "gamma@e2e.local"), meeting("m5", "delta@e2e.local"),
      ] } });
    }
    return Response.json({ success: false, message: "no" }, { status: 404 });
  },
});

const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
const chiefDxb = new ObjectId(), chiefBlr = new ObjectId(), alpha = new ObjectId(), beta = new ObjectId(), gamma = new ObjectId(), idle = new ObjectId(), delta = new ObjectId(), gone = new ObjectId();
await db.collection("users").insertMany([
  { _id: chiefDxb, full_name: "Chief Dubai", email: "chief-dxb@e2e.local", app_role: "chief_mentor", status: "active", team_name: "Mentors Dubai" },
  { _id: chiefBlr, full_name: "Chief Bangalore", email: "chief-blr@e2e.local", app_role: "chief_mentor", status: "active", team_name: "Mentors Bangalore", team_location: "bangalore" },
  { _id: alpha, full_name: "Mentor Alpha", email: "alpha@e2e.local", app_role: "senior_mentor", status: "active", up_head_id: String(chiefDxb) },
  { _id: beta, full_name: "Mentor Beta", email: "beta@e2e.local", app_role: "junior_mentor", status: "active", up_head_id: String(chiefDxb) },
  { _id: gamma, full_name: "Mentor Gamma", email: "gamma@e2e.local", app_role: "junior_mentor", status: "active", up_head_id: String(chiefDxb) },
  { _id: idle, full_name: "Idle Mentor", email: "idle@e2e.local", app_role: "junior_mentor", status: "active", up_head_id: String(chiefDxb) },
  { _id: delta, full_name: "Mentor Delta", email: "delta@e2e.local", app_role: "junior_mentor", status: "active", up_head_id: String(chiefBlr) },
  { _id: gone, full_name: "Gone Mentor", email: "gone@e2e.local", app_role: "junior_mentor", status: "inactive", up_head_id: String(chiefDxb) },
] as any[]);
const pay = (who: ObjectId, aed: number, at: string, over: Record<string, unknown> = {}) => ({
  type: "BONUS", status: "APPROVED", bonus_credit: null, meeting_mentor_id: String(who), initiating_mentor_id: String(new ObjectId()),
  course_payment: { product: "DGMP", kind: "full", paid_today_aed: aed }, amount_aed: aed, approved_at: at, ...over,
});
const earlier = new Date(Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth(), 1, 8)).toISOString(); // this month, the 1st
const todayIso = now.toISOString();
await db.collection("funding_transactions").insertMany([
  pay(alpha, 2250, todayIso),                                   // today
  pay(alpha, 5000, earlier),                                    // this month
  pay(beta, 9000, earlier, { course_payment: { product: "DQMP", kind: "full", paid_today_aed: 9000 } }),
  pay(beta, 1000, midLast),                                    // last month
  pay(alpha, 777, todayIso, { status: "PENDING" }),             // not approved
  pay(alpha, 888, todayIso, { bonus_credit: "sales" }),         // a sales-close credit
  pay(alpha, 999, todayIso, { meeting_mentor_none: true }),     // "no mentor met them"
  pay(gone, 5555, todayIso),                                    // an inactive mentor
  pay(delta, 3000, todayIso),                                    // Bangalore
  { ...pay(alpha, 444, todayIso), course_payment: undefined },  // not a course payment
] as any[]);

const board = async (q = "") => { const r = await fetch(`${API}/api/public/mentor-tv${q}`); return { status: r.status, body: (await r.json().catch(() => ({}))) as any }; };
const by = (b: any, name: string) => (b.mentors ?? []).find((p: any) => p.name === name);

let r = await board("?location=dubai");
check("answers, open", r.status === 200 && r.body.location === "dubai" && r.body.month === thisMonth && r.body.past === false, show(r));
const h = by(r.body, "Mentor Alpha"), l = by(r.body, "Mentor Beta"), s = by(r.body, "Mentor Gamma");
check("revenue: approved course payments naming them, this month; today's apart", h?.month_aed === 7250 && h?.today_aed === 2250 && h?.payments === 2 && h?.today_payments === 1, show(h));
check("…not pending, a sales credit, 'no mentor', or one that is no course payment", h?.month_aed === 7250);
check("…not last month's", l?.month_aed === 9000 && l?.payments === 1 && l?.today_aed === 0, show(l));
check("meetings this month, by address in any case, each once, not cancelled", h?.meetings === 2 && s?.meetings === 1 && l?.meetings === 0 && r.body.meetings_available === true, show([h?.meetings, s?.meetings, l?.meetings]));
check("ranked by revenue: Beta, Alpha, then Gamma (a meeting, no payment)", (r.body.mentors ?? []).map((m: any) => `${m.rank}:${m.name}`).join() === "1:Mentor Beta,2:Mentor Alpha,3:Mentor Gamma", show(r.body.mentors?.map((m: any) => m.name)));
check("a mentor with nothing this month, an inactive one, a Chief with nothing: not on the board", !by(r.body, "Idle Mentor") && !by(r.body, "Gone Mentor") && !by(r.body, "Chief Dubai"));
check("Bangalore's mentor not on Dubai's", !by(r.body, "Mentor Delta"));
check("totals", r.body.totals?.month_aed === 16250 && r.body.totals?.today_aed === 2250 && r.body.totals?.payments === 3 && r.body.totals?.meetings === 3, show(r.body.totals));
check("role, team, photo slot; never an email", h?.role === "Senior Mentor" && h?.team === "Mentors Dubai" && "photo" in h && !JSON.stringify(r.body).includes("@"), show(h));
check("the latest payments, for the pop-up: mentor, product, amount — no student", (r.body.recent ?? []).length === 3 && r.body.recent[0].mentor && r.body.recent.every((x: any) => !("student" in x)), show(r.body.recent));
check("the LMS asked for this month", lmsAsked.some((a) => a.includes(`${thisMonth}-01..`)), show(lmsAsked));

r = await board("?location=bangalore");
check("Bangalore: its own mentor", (r.body.mentors ?? []).map((m: any) => m.name).join() === "Mentor Delta" && by(r.body, "Mentor Delta")?.month_aed === 3000 && by(r.body, "Mentor Delta")?.meetings === 1, show(r.body));

r = await board(`?location=dubai&month=${lastMonth}`);
check("last month as it ended: Beta's 1,000, no today, no recent", r.body.month === lastMonth && r.body.past === true && by(r.body, "Mentor Beta")?.month_aed === 1000
  && by(r.body, "Mentor Beta")?.today_aed === 0 && (r.body.recent ?? []).length === 0, show(r.body));
r = await board(`?location=dubai&month=2099-01`);
check("a month to come: this month instead", r.body.month === thisMonth, show(r.body.month));

lmsDown = true;
// The API keeps the board 20 seconds: wait it out, then the meetings come from its 5-minute store.
await Bun.sleep(21_000);
r = await board("?location=dubai");
check("the LMS's meetings were kept a while (5 minutes), so a short LMS blip changes nothing", r.body.meetings_available === true && by(r.body, "Mentor Alpha")?.meetings === 2, show(r.body.totals));

console.log(`\n${pass}/${pass + fail} checks passed`);
lms.stop(true);
await client.close();
process.exit(fail ? 1 : 0);
