/**
 * The mentors' working hours on the Mentor Calendar, from the HRMS — end to end, against a real API process and a real
 * HRMS process (students/mentorHours.ts, the HRMS's GET /integrations/directory/work-hours):
 *
 *   - each mentor the LMS lists gets their HRMS schedule by email, signed as the Root portal signs;
 *   - in Dubai time: a Dubai shift as it is, an India night shift turned into Dubai's and split across midnight;
 *   - their work days and half days, and nobody-assigned shown as the HRMS's default;
 *   - approved leave on its days (half days said), pending leave not; leavers and unknown emails get nothing;
 *   - the HRMS's own limits answered as refusals.
 *
 * Run through ./test-mentor-hours.sh (throwaway mongod, the API and the HRMS — no .env). The LMS is a stand-in here.
 * Refuses anything but scratch databases on 127.0.0.1.
 */
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";
import { hrmsGet } from "../lib/hrms";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
const hrmsDbName = process.env.E2E_HRMS_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName) || !/e2e/.test(hrmsDbName)) {
  console.error(`Refusing to run: needs scratch e2e databases on 127.0.0.1, got ${uri} / ${dbName} / ${hrmsDbName}`);
  process.exit(1);
}
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

/* ── The LMS, standing in: four mentors, nothing booked ─────────────────── */
const mentor = (name: string, email: string) => ({ id: new ObjectId().toString(), name, email, slots: [], classes: [], meetings: [] });
const lmsMentors = [
  mentor("Akhil Evening", "akhil@e2e-hours.test"),
  mentor("Bina India", "BINA@e2e-hours.test"),
  mentor("Chitra Default", "chitra@e2e-hours.test"),
  mentor("Dev Unknown", "dev@e2e-hours.test"),
  mentor("Elias Left", "elias@e2e-hours.test"),
];
const lms = Bun.serve({
  port: Number(process.env.E2E_FAKE_LMS_PORT),
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/v1/service/mentors") {
      return Response.json({ success: true, data: { timezone: "Asia/Dubai", from: url.searchParams.get("from"), to: url.searchParams.get("to"), mentors: lmsMentors } });
    }
    return Response.json({ success: false, error: { message: "no such route" } }, { status: 404 });
  },
});

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
const hrms = client.db(hrmsDbName);
for (const d of [db, hrms]) for (const c of await d.listCollections().toArray()) await d.collection(c.name).deleteMany({});

step("Setting up");
const org = new ObjectId();
await hrms.collection("organizations").insertOne({ _id: org, name: "Delta", code: "DELTA", status: "active" });
const evening = { _id: new ObjectId(), organization: org, name: "Evening mentors", timeZone: "Asia/Dubai", loginTime: "16:00", logoutTime: "23:00", workDays: [0, 1, 2, 3, 4, 5], halfDays: [5], mode: "fixed", status: "active" };
const night = { _id: new ObjectId(), organization: org, name: "India night", timeZone: "Asia/Kolkata", loginTime: "18:00", logoutTime: "02:00", workDays: [1, 2, 3, 4, 5, 6], halfDays: [], mode: "fixed", status: "active" };
await hrms.collection("workschedules").insertMany([evening, night]);
const [ua, ub, uc, ue] = [new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId()];
const employee = (code: string, name: string, email: string, user: ObjectId, workSchedule: ObjectId | null, status = "active") =>
  ({ _id: new ObjectId(), organization: org, employeeCode: code, name, email, user, workSchedule, status });
await hrms.collection("employees").insertMany([
  employee("E1", "Akhil Evening", "akhil@e2e-hours.test", ua, evening._id),
  employee("E2", "Bina India", "bina@e2e-hours.test", ub, night._id),
  employee("E3", "Chitra Default", "chitra@e2e-hours.test", uc, null),
  employee("E5", "Elias Left", "elias@e2e-hours.test", ue, evening._id, "resigned"),
]);
// A Dubai day kept as its local midnight in UTC, as the HRMS keeps it: the 6th is 20:00Z on the 5th.
const dubaiDay = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() - 4 * 3_600_000);
const leave = (user: ObjectId, type: string, from: string, to: string, status: string, halfDay = false) =>
  ({ organization: org, user, type, startDate: dubaiDay(from), endDate: dubaiDay(to), halfDay, days: 1, timeZone: "Asia/Dubai", status });
await hrms.collection("leaverequests").insertMany([
  leave(ua, "sick", "2026-10-06", "2026-10-07", "approved"),
  leave(ua, "casual", "2026-10-08", "2026-10-08", "pending"),
  leave(ua, "casual", "2026-10-09", "2026-10-09", "approved", true),
  leave(uc, "annual", "2026-10-01", "2026-10-05", "approved"),
  leave(ub, "sick", "2026-10-20", "2026-10-21", "approved"),
]);
const hash = await bcrypt.hash("Password123!", 10);
await db.collection("users").insertOne({ email: "admin@e2e-hours.test", full_name: "Admin", app_role: "super_admin", password_hash: hash, status: "active", created_date: "2026-01-01T00:00:00.000Z" } as any);
const login = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "admin@e2e-hours.test", password: "Password123!" }) });
const token = ((await login.json()) as any).token;
check("signed in", !!token);
const schedule = async (from: string, to: string) => {
  const r = await fetch(`${API}/api/functions/getMentorSchedule`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ from, to }) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
};

step("The week of Sun 4 – Sat 10 Oct, in Dubai");
const r = await schedule("2026-10-03T20:00:00.000Z", "2026-10-10T20:00:00.000Z");
check("the calendar answers, with the HRMS asked and answering", r.status === 200 && r.body?.hrms?.configured === true && r.body?.hrms?.available === true, JSON.stringify(r.body?.hrms ?? r.body).slice(0, 300));
const byEmail = new Map<string, any>((r.body?.mentors ?? []).map((m: any) => [String(m.email).toLowerCase(), m]));
const a = byEmail.get("akhil@e2e-hours.test")?.work;
const b = byEmail.get("bina@e2e-hours.test")?.work;
const c = byEmail.get("chitra@e2e-hours.test")?.work;
check("Akhil: 16:00–23:00, Sun–Fri, his schedule's name", a?.schedule?.from === "16:00" && a?.schedule?.to === "23:00" && JSON.stringify(a?.schedule?.workDays) === "[0,1,2,3,4,5]" && a?.schedule?.name === "Evening mentors" && a?.schedule?.assigned === true, JSON.stringify(a?.schedule));
check("…the seven days, Sunday first", JSON.stringify(Object.keys(a?.days ?? {})) === JSON.stringify(["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]), JSON.stringify(Object.keys(a?.days ?? {})));
check("…Sunday at work 16:00–23:00", JSON.stringify(a?.days?.["2026-10-04"]) === JSON.stringify({ shifts: [{ from: "16:00", to: "23:00" }], half: false, leave: null }), JSON.stringify(a?.days?.["2026-10-04"]));
check("…Saturday off", a?.days?.["2026-10-10"]?.shifts?.length === 0 && a?.days?.["2026-10-10"]?.leave === null);
check("…Tuesday and Wednesday on approved sick leave", a?.days?.["2026-10-06"]?.leave?.type === "sick" && a?.days?.["2026-10-07"]?.leave?.type === "sick");
check("…Thursday's leave is only asked for (pending): not shown", a?.days?.["2026-10-08"]?.leave === null);
check("…Friday a half day by his schedule, and half a day's casual leave", a?.days?.["2026-10-09"]?.half === true && a?.days?.["2026-10-09"]?.leave?.type === "casual" && a?.days?.["2026-10-09"]?.leave?.half === true);
check("Bina (India, 18:00–02:00): 16:30–00:30 in Dubai, set in Asia/Kolkata", b?.schedule?.from === "16:30" && b?.schedule?.to === "00:30" && b?.schedule?.timeZone === "Asia/Kolkata", JSON.stringify(b?.schedule));
check("…Sunday: only the end of Saturday's night shift, 00:00–00:30", JSON.stringify(b?.days?.["2026-10-04"]?.shifts) === JSON.stringify([{ from: "00:00", to: "00:30" }]), JSON.stringify(b?.days?.["2026-10-04"]));
check("…Monday: from 16:30 to midnight", JSON.stringify(b?.days?.["2026-10-05"]?.shifts) === JSON.stringify([{ from: "16:30", to: "24:00" }]), JSON.stringify(b?.days?.["2026-10-05"]));
check("…Tuesday: both pieces", JSON.stringify(b?.days?.["2026-10-06"]?.shifts) === JSON.stringify([{ from: "00:00", to: "00:30" }, { from: "16:30", to: "24:00" }]));
check("…matched though the LMS spells her email in capitals", !!b);
check("…her leave later in the month is not in this week", Object.values(b?.days ?? {}).every((d: any) => d.leave === null));
check("Chitra: nobody assigned her a schedule — the HRMS default, said so", c?.schedule?.from === "09:00" && c?.schedule?.to === "18:00" && c?.schedule?.assigned === false && JSON.stringify(c?.schedule?.workDays) === "[1,2,3,4,5,6]", JSON.stringify(c?.schedule));
check("…her leave that began before the week shows on Monday", c?.days?.["2026-10-05"]?.leave?.type === "annual" && c?.days?.["2026-10-06"]?.leave === null);
check("Dev, whom the HRMS does not know: no working hours", byEmail.get("dev@e2e-hours.test")?.work === null);
check("Elias, who has left: no working hours", byEmail.get("elias@e2e-hours.test")?.work === null);
check("the LMS's own data is untouched (slots, classes, meetings)", (r.body?.mentors ?? []).every((m: any) => Array.isArray(m.slots) && Array.isArray(m.classes) && Array.isArray(m.meetings)));

step("The HRMS's own limits");
const refused = async (query: Record<string, string>) => { try { await hrmsGet("/directory/work-hours", query); return ""; } catch (e) { return (e as Error).message; } };
check("no emails: refused", /400/.test(await refused({ emails: "", from: "2026-10-04", to: "2026-10-10" })));
check("more than 62 days: refused", /400/.test(await refused({ emails: "akhil@e2e-hours.test", from: "2026-01-01", to: "2026-06-01" })));
check("dates the wrong way round: refused", /400/.test(await refused({ emails: "akhil@e2e-hours.test", from: "2026-10-10", to: "2026-10-04" })));
const scoped: any[] = await hrmsGet("/directory/work-hours", { emails: "akhil@e2e-hours.test", from: "2026-10-04", to: "2026-10-10", organizationId: new ObjectId().toString() });
check("another organization: nobody", Array.isArray(scoped) && scoped.length === 0);

lms.stop(true);
await client.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
