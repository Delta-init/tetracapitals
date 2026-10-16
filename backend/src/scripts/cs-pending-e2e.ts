/**
 * GET /api/v1/service/cs-pending (portal/csPending.ts) — Root's Pending → CS portal tab — end to end:
 *
 *   Case 1  happy path   per CS: not onboarded (late = from finance 6h+), bonuses by where they are stuck (sent back,
 *                        needs a call, with finance, waiting for a broker admin), open LMS tickets (waiting for an answer /
 *                        on the student), follow-ups due today and overdue, class completions to call — and the students
 *   Case 2  edge         a Common student counts for both CSs and once for the team; a student with no CS goes to "No CS
 *                        yet"; an active CS with nothing still has a row, an inactive one only with something; resolved
 *                        tickets, closed follow-ups, called classes, decided bonuses left out; Bangalore apart
 *   Case 3  errors       the LMS down: tickets marked unavailable, everything else still answered
 *   Case 4  permission   no secret, a wrong one
 *
 * Run through ./test-cs-pending.sh (throwaway mongod, the API and a fake LMS — no .env). Scratch database only.
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;
const SECRET = process.env.ROOT_ERP_SECRET ?? "";
const LMS_SECRET = process.env.LMS_SERVICE_SECRET ?? "";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const same = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
async function get(path: string, secret: string | null = SECRET) {
  const r = await fetch(`${API}/api/v1/service${path}`, { headers: secret ? { "x-portal-secret": secret } : {} });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
}

/* Phase "down" (the second run of ./test-cs-pending.sh): the API restarted with the LMS unreachable, the first run's data kept. */
if (process.env.E2E_PHASE === "down") {
  step("Case 3 — errors: the LMS can't be reached");
  const r = await get("/cs-pending");
  same("Still 200", r.status, 200);
  same("Tickets marked unavailable, with why", [r.body.data?.tickets?.available, typeof r.body.data?.tickets?.message], [false, "string"]);
  same("No tickets counted", [r.body.data?.totals?.tickets_open, r.body.data?.items?.tickets?.length], [0, 0]);
  same("Everything else still answered (onboarding 4, bonuses 4)", [r.body.data?.totals?.onboarding, r.body.data?.totals?.bonus], [4, 4]);
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
}

/* The LMS: every ticket of the students asked about, as POST /service/support-tickets { emails } answers. */
let lmsAsks = 0;
const lmsTickets: any[] = [];
const lms = Bun.serve({
  port: Number(process.env.E2E_FAKE_LMS_PORT),
  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get("x-portal-secret") !== LMS_SECRET) return Response.json({ success: false, error: { message: "Bad secret" } }, { status: 401 });
    if (url.pathname !== "/api/v1/service/support-tickets") return Response.json({ success: false, error: { message: "Route not found" } }, { status: 404 });
    lmsAsks++;
    const body: any = await req.json().catch(() => ({}));
    const wanted = new Set((body.emails ?? []).map((e: string) => e.toLowerCase()));
    const tickets = lmsTickets.filter((t) => wanted.has(t.email));
    return Response.json({ success: true, data: { students: [], tickets } });
  },
});

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
await db.dropDatabase();

step("Setting up: four CSs (one in Bangalore, one switched off), students with something waiting");
const nowMs = Date.now();
const ago = (h: number) => new Date(nowMs - h * 3_600_000).toISOString();
const now = ago(0);
const dayOf = (d: number) => new Date(nowMs + 330 * 60_000 + d * 86_400_000).toISOString().slice(0, 10); // follow-ups: UTC+5:30
const today = dayOf(0), yesterday = dayOf(-1), tomorrow = dayOf(1);

const person = (full_name: string, email: string, app_role: string, extra: Record<string, unknown> = {}) =>
  ({ _id: new ObjectId(), email, full_name, app_role, status: "active", team_name: "Falcons", created_date: now, ...extra });
const lead = person("Blr Lead", "lead@e2e-csp.test", "chief_mentor", { team_location: "bangalore" });
const cs1 = person("Cee One", "CS1@e2e-csp.test", "cs");
const cs2 = person("Cee Two", "cs2@e2e-csp.test", "cs");
const csIdle = person("Cee Idle", "idle@e2e-csp.test", "cs");
const csBlr = person("Cee Blr", "blr@e2e-csp.test", "cs", { up_head_id: String(lead._id) });
const csOff = person("Cee Gone", "gone@e2e-csp.test", "cs", { status: "inactive" });
const csOffIdle = person("Cee Gone Idle", "goneidle@e2e-csp.test", "cs", { status: "inactive" });
await db.collection("users").insertMany([lead, cs1, cs2, csIdle, csBlr, csOff, csOffIdle] as any[]);
const id = (u: any) => String(u._id);

let n = 0;
const student = (name: string, cs: any | null, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), student_code: `STU-${String(++n).padStart(4, "0")}`, full_name: name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@e2e-csp.test`,
  status: "ACTIVE", created_date: ago(1), onboarded: true,
  ...(cs ? { primary_mentor_id: id(cs), primary_mentor_name: cs.full_name } : {}),
  ...extra,
});
// Not onboarded, from finance, 10 hours ago (late) — CS One, Common with CS Two.
const sCommon = student("Late Common", cs1, { onboarded: false, finance_invoice_id: "inv-1", created_date: ago(10), common_cs: [{ id: id(cs2), name: cs2.full_name }] });
// Not onboarded, from finance, 2 hours ago (not late yet) — CS Two.
const sFresh = student("Fresh Two", cs2, { onboarded: false, finance_invoice_id: "inv-2", created_date: ago(2) });
// Not onboarded, added by hand (not from finance), 20 hours ago: never late — CS One.
const sHand = student("By Hand", cs1, { onboarded: false, created_date: ago(20) });
// Nobody's: not onboarded, from finance, late.
const sNone = student("No CS", null, { onboarded: false, finance_invoice_id: "inv-4", created_date: ago(8) });
// Bangalore CS's student: a bonus with finance, a ticket.
const sBlr = student("Blr Student", csBlr);
// The switched-off CS's student: an overdue follow-up.
const sGone = student("Gone CS Student", csOff);
// Given a bonus at the sales close, not credited yet (needs a call) — CS One.
const sClose = student("Close Bonus", cs1, { course_fees: [{ invoice_id: "inv-7", course: "MBT", bonus_given: true, bonus_minor: 50000, currency: "USD" }] });
// Onboarded before the page began, not counted.
const sOld = student("Before Start", cs1, { onboarded: false, created_date: "2026-09-01T00:00:00.000Z" });
await db.collection("students").insertMany([sCommon, sFresh, sHand, sNone, sBlr, sGone, sClose, sOld] as any[]);
const sid = (s: any) => String(s._id);

const fu = (s: any, next_followup_date: string, stage = "Contacted") => ({
  _id: new ObjectId(), student_id: sid(s), student_name: s.full_name, target_outcome: "Onboarding call", title: `Call ${s.full_name}`, stage, next_followup_date, created_date: now,
});
await db.collection("student_followups").insertMany([
  fu(sCommon, today), fu(sNone, today), // today: CS One + CS Two; nobody
  fu(sFresh, yesterday), fu(sGone, yesterday), // overdue: CS Two; the switched-off CS
  fu(sFresh, yesterday, "Converted"), fu(sHand, tomorrow), // closed, not yet due: not counted
] as any[]);

const done = (key: string, s: any, extra: Record<string, unknown> = {}) => ({
  _id: key, student_id: sid(s), student_name: s.full_name, student_code: s.student_code,
  class: { title: "Price action live", course: "MBT", mentor: "Mentor M" }, ended_at: ago(3), notify_at: ago(3), notified_at: ago(3), created_date: ago(3), ...extra,
});
await db.collection("class_completions").insertMany([
  done("c1", sCommon), done("c2", sHand), // to call: CS One + CS Two; CS One
  done("c3", sFresh, { called_at: ago(1), called_via: "3CX call" }), // called: not counted
] as any[]);

const bonus = (s: any, extra: Record<string, unknown>) => ({
  _id: new ObjectId(), type: "BONUS", status: "PENDING", student_id: sid(s), amount_usd: 100, mt5_login: "5001", requested_at: ago(5), created_date: ago(5), ...extra,
});
await db.collection("funding_transactions").insertMany([
  bonus(sCommon, {}), // waiting for a broker admin — CS One + CS Two
  bonus(sCommon, { returned: { at: ago(1), reason: "Wrong MT5" } }), // sent back to the CS
  bonus(sBlr, { finance_approval: { state: "sent" }, amount_usd: 250 }), // with finance — Bangalore
  bonus(sHand, { status: "APPROVED" }), bonus(sHand, { type: "DEPOSIT" }), // decided, not a bonus: not counted
] as any[]);

const ticket = (s: any, id: string, status: string, h: number) =>
  ({ id, subject: `Help ${id}`, category: "general", status, openedAt: ago(h + 1), lastMessageAt: ago(h), lastFrom: "student", messages: [], email: s.email });
lmsTickets.push(
  ticket(sCommon, "t1", "open", 4), ticket(sHand, "t2", "pending", 2), ticket(sBlr, "t3", "open", 1), // open: CS One+Two, CS One (on student), Blr
  ticket(sFresh, "t4", "resolved", 1), ticket(sFresh, "t5", "closed", 1), // finished: not counted
  { ...ticket(sFresh, "t6", "open", 1), email: "stranger@e2e-csp.test" }, // not a student here: not counted
);

step("Case 4 — permission");
same("No secret → 401", (await get("/cs-pending", null)).status, 401);
same("A wrong secret → 401", (await get("/cs-pending", "nope")).status, 401);

step("Case 1 — happy path: what waits on each CS, and which students");
const r = await get("/cs-pending");
same("200", r.status, 200);
const d = r.body.data ?? {};
const row = (u: any) => (d.people ?? []).find((p: any) => p.id === id(u));
const one = row(cs1)?.counts ?? {}, two = row(cs2)?.counts ?? {}, blr = row(csBlr)?.counts ?? {};
same("CS One onboarding: Late Common + By Hand, 1 late", [one.onboarding, one.onboarding_late], [2, 1]);
same("CS Two onboarding: Late Common (Common) + Fresh Two, 1 late", [two.onboarding, two.onboarding_late], [2, 1]);
same("CS One bonuses: 1 waiting broker, 1 sent back, 1 needs a call", [one.bonus, one.bonus_waiting_broker, one.bonus_sent_back, one.bonus_needs_call, one.bonus_with_finance], [3, 1, 1, 1, 0]);
same("CS One bonus $: 100 + 100 + 500 (close bonus)", one.bonus_usd, 700);
same("Bangalore CS: 1 bonus with finance, $250", [blr.bonus, blr.bonus_with_finance, blr.bonus_usd], [1, 1, 250]);
same("CS One tickets: 1 waiting for an answer, 1 on the student", [one.tickets_open, one.tickets_waiting], [1, 1]);
same("CS Two tickets: the Common student's", [two.tickets_open, two.tickets_waiting], [1, 0]);
same("Follow-ups: CS One today 1; CS Two today 1, overdue 1", [one.followups_today, one.followups_overdue, two.followups_today, two.followups_overdue], [1, 0, 1, 1]);
same("Class completions: CS One 2, CS Two 1 (the called one left out)", [one.completions, two.completions], [2, 1]);
check("Each row has its total, email lowercase, role and location", row(cs1)?.total === 2 + 3 + 2 + 1 + 2 && row(cs1)?.email === "cs1@e2e-csp.test"
  && row(cs1)?.role === "cs" && row(cs1)?.location === "dubai" && row(csBlr)?.location === "bangalore", JSON.stringify(row(cs1)));

const items = d.items ?? {};
const onb = (items.onboarding ?? []).find((x: any) => x.studentId === sid(sCommon));
check("Onboarding list: the student, code, both CSs, late, from finance, since", !!onb && onb.student === "Late Common" && onb.code === sCommon.student_code
  && onb.late === true && onb.fromFinance === true && onb.since === sCommon.created_date && onb.cs.map((c: any) => c.name).sort().join() === "Cee One,Cee Two", JSON.stringify(onb));
same("Onboarding list: oldest first, the old one left out", (items.onboarding ?? []).map((x: any) => x.student), ["By Hand", "Late Common", "No CS", "Fresh Two"]);
const bon = (items.bonus ?? []).find((x: any) => x.studentId === sid(sCommon));
check("Bonus list: the earliest stage (sent back), both stages with their $", !!bon && bon.stage === "sent_back" && bon.count === 2 && bon.usd === 200
  && bon.stages?.sent_back?.count === 1 && bon.stages?.waiting_broker?.count === 1, JSON.stringify(bon));
check("Bonus list: the close bonus needs a call", (items.bonus ?? []).some((x: any) => x.studentId === sid(sClose) && x.stage === "needs_call" && x.usd === 500));
const tk = (items.tickets ?? []).find((x: any) => x.ticketId === "t2");
check("Ticket list: subject, waiting on the student, the student and CS", !!tk && tk.subject === "Help t2" && tk.status === "waiting_on_student" && tk.student === "By Hand"
  && tk.cs[0]?.id === id(cs1), JSON.stringify(tk));
same("Ticket list: 3 open, resolved / closed / strangers left out", (items.tickets ?? []).map((x: any) => x.ticketId).sort(), ["t1", "t2", "t3"]);
const fuRow = (items.followups ?? []).find((x: any) => x.studentId === sid(sFresh));
check("Follow-up list: due date, overdue, stage, title, outcome", !!fuRow && fuRow.due === yesterday && fuRow.overdue === true && fuRow.stage === "Contacted"
  && fuRow.title === "Call Fresh Two" && fuRow.outcome === "Onboarding call", JSON.stringify(fuRow));
const cc = (items.completions ?? []).find((x: any) => x.studentId === sid(sHand));
check("Completion list: class, course, mentor, ended", !!cc && cc.className === "Price action live" && cc.course === "MBT" && cc.mentor === "Mentor M" && !!cc.endedAt, JSON.stringify(cc));
same("Tickets available", d.tickets?.available, true);

step("Case 2 — edge: Common counted once for the team, No CS, who has a row, Bangalore apart");
const t = d.totals ?? {};
same("Team onboarding: 4 students once each (Common once), 2 late", [t.onboarding, t.onboarding_late], [4, 2]);
same("Team bonuses: 4 (2 Common, 1 Bangalore, 1 close), $950", [t.bonus, t.bonus_usd], [4, 950]);
same("Team tickets: 2 waiting for an answer, 1 on the student", [t.tickets_open, t.tickets_waiting], [2, 1]);
same("Team follow-ups: today 2, overdue 2", [t.followups_today, t.followups_overdue], [2, 2]);
same("Team completions: 2", t.completions, 2);
same("No CS yet: 1 onboarding (late), 1 follow-up today", [d.noCs?.counts?.onboarding, d.noCs?.counts?.onboarding_late, d.noCs?.counts?.followups_today], [1, 1, 1]);
check("No CS yet students listed with no CS", (items.onboarding ?? []).some((x: any) => x.studentId === sid(sNone) && x.cs.length === 0 && x.csIds[0] === ""));
check("An active CS with nothing still has a row (total 0)", row(csIdle)?.total === 0, JSON.stringify(row(csIdle)));
check("A switched-off CS with something has a row, marked inactive", row(csOff)?.active === false && row(csOff)?.counts?.followups_overdue === 1);
check("A switched-off CS with nothing has no row; the team lead (not a CS) neither", !row(csOffIdle) && !row(lead));
same("Bangalore apart: 1 bonus $250, 1 ticket", [d.totalsByLocation?.bangalore?.bonus, d.totalsByLocation?.bangalore?.bonus_usd, d.totalsByLocation?.bangalore?.tickets_open], [1, 250, 1]);
same("Dubai: the rest", [d.totalsByLocation?.dubai?.bonus, d.totalsByLocation?.dubai?.tickets_open], [3, 1]);
check("Busiest first", (d.people ?? [])[0]?.id === id(cs1), (d.people ?? []).map((p: any) => `${p.name}:${p.total}`).join(", "));

step("Case 2 — edge: the LMS is asked at most once a minute");
const asked = lmsAsks;
await get("/cs-pending");
same("Asked again within a minute: the LMS isn't asked again", lmsAsks, asked);

console.log(`\n${pass}/${pass + fail} checks passed`);
lms.stop(true);
await client.close();
process.exit(fail ? 1 : 0);
