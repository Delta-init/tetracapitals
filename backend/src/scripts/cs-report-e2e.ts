/**
 * GET /api/v1/service/cs-report (portal/csReport.ts) — Root's Reports → CS portal tab — end to end:
 *
 *   Case 1  happy path   per CS, team and month: revenue (deposits, withdrawals, course payments), follow-ups (logged,
 *                        opened, contacted, converted, lost), 3CX calls, programs with classes in the period,
 *                        onboarded students, bonuses by stage, commission, course upgrades — and the rows behind them
 *   Case 2  edge         outside the period, pending deposits, pool commission, other kinds of event left out; the
 *                        location, team and cs filters
 *   Case 3  errors       a bad custom period
 *   Case 4  permission   no secret, a wrong one
 *
 * Run through ./test-cs-report.sh (throwaway mongod, the API, a fake LMS — no .env). Scratch database only.
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "", dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) { console.error(`Refusing: ${uri} / ${dbName}`); process.exit(1); }
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;
const SECRET = process.env.ROOT_ERP_SECRET ?? "", LMS_SECRET = process.env.LMS_SERVICE_SECRET ?? "";

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"} ${label}\x1b[0m${ok ? "" : ` — ${detail}`}`); };
const same = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
async function get(q: string, secret: string | null = SECRET) {
  const r = await fetch(`${API}/api/v1/service/cs-report${q}`, { headers: secret ? { "x-portal-secret": secret } : {} });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
}

const nowMs = Date.now();
const ago = (d: number) => new Date(nowMs - d * 86_400_000).toISOString();
const day = (d: number) => new Date(nowMs + 4 * 3_600_000 - d * 86_400_000).toISOString().slice(0, 10);
const FROM = day(10), TO = day(0);
const P = `?from=${FROM}&to=${TO}`;

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
await db.dropDatabase();

const person = (full_name: string, email: string, app_role: string, extra: Record<string, unknown> = {}) =>
  ({ _id: new ObjectId(), email, full_name, app_role, status: "active", created_date: ago(100), ...extra });
const lead = person("Dubai Lead", "dlead@e2e.test", "chief_mentor", { team_name: "Falcons" });
const blrLead = person("Blr Lead", "blead@e2e.test", "chief_mentor", { team_name: "Blr", team_location: "bangalore" });
const one = person("Cee One", "one@e2e.test", "cs", { up_head_id: String(lead._id) });
const two = person("Cee Two", "two@e2e.test", "cs", { up_head_id: String(lead._id) });
const blr = person("Cee Blr", "blr@e2e.test", "cs", { up_head_id: String(blrLead._id) });
await db.collection("users").insertMany([lead, blrLead, one, two, blr] as any[]);
const id = (u: any) => String(u._id);

const stu = (name: string, cs: any, extra: Record<string, unknown> = {}) => ({ _id: new ObjectId(), full_name: name, student_code: `STU-${name}`, email: `${name.toLowerCase()}@s.test`,
  primary_mentor_id: id(cs), primary_mentor_name: cs.full_name, status: "ACTIVE", onboarded: false, created_date: ago(30), ...extra });
const asha = stu("Asha", one, { onboarded: true, onboarded_at: ago(2), onboarded_by_name: "Cee One", finance_invoice_id: "inv1" });
const bilal = stu("Bilal", two, { onboarded: true, onboarded_at: ago(40), onboarded_by_name: "Cee Two" }); // onboarded before the period
const cara = stu("Cara", blr, { onboarded: true, onboarded_at: ago(1), onboarded_by_name: "Cee Blr", created_date: ago(1),
  course_fees: [{ invoice_id: "inv9", course: "MBT", bonus_given: true, bonus_minor: 30000, currency: "USD" }] });
await db.collection("students").insertMany([asha, bilal, cara] as any[]);
const sid = (s: any) => String(s._id);

const tx = (o: Record<string, unknown>) => ({ _id: new ObjectId(), status: "APPROVED", requested_at: ago(3), created_date: ago(3), approved_at: ago(2), ...o });
await db.collection("funding_transactions").insertMany([
  tx({ type: "DEPOSIT", amount_usd: 1000, amount_aed: 3670, initiating_mentor_id: id(one), student_id: sid(asha) }),
  tx({ type: "DEPOSIT", amount_usd: 500, primary_mentor_id: id(two), student_id: sid(bilal) }),              // no AED: 3.67
  tx({ type: "DEPOSIT", amount_usd: 900, primary_mentor_id: id(two), student_id: sid(bilal), status: "PENDING" }), // not approved: not revenue
  tx({ type: "DEPOSIT", amount_usd: 700, primary_mentor_id: id(one), student_id: sid(asha), approved_at: ago(30) }), // outside
  tx({ type: "WITHDRAWAL", amount_usd: 200, initiating_mentor_id: id(one), student_id: sid(asha) }),
  // Bonuses raised in the period: approved, with finance, rejected
  tx({ type: "BONUS", amount_usd: 100, initiating_mentor_id: id(one), student_id: sid(asha), mt5_login: "5001" }),
  tx({ type: "BONUS", amount_usd: 250, initiating_mentor_id: id(blr), student_id: sid(cara), status: "PENDING", finance_approval: { state: "sent" } }),
  tx({ type: "BONUS", amount_usd: 50, initiating_mentor_id: id(two), student_id: sid(bilal), status: "REJECTED" }),
] as any[]);
const up = { _id: new ObjectId(), student_id: sid(asha), course: "DGMP", plan: "full", status: "paid", created_by: id(one), created_by_name: "Cee One", created_at: ago(4), quote: { dueAed: 5000 } };
const oldUp = { _id: new ObjectId(), student_id: sid(bilal), course: "DQMP", plan: "split", status: "part_paid", created_by: id(two), created_by_name: "Cee Two", created_at: ago(40), quote: { dueAed: 8000 } };
await db.collection("course_upgrades").insertMany([up, oldUp] as any[]);
await db.collection("course_payments").insertMany([
  { upgrade_id: String(up._id), student_id: sid(asha), amount_aed: 5000, approved_amount_aed: 5000, status: "approved", decided_at: ago(3) },
  { upgrade_id: String(oldUp._id), student_id: sid(bilal), amount_aed: 4000, status: "approved", decided_at: ago(1) },   // old upgrade, paid in the period
  { upgrade_id: String(oldUp._id), student_id: sid(bilal), amount_aed: 4000, status: "approved", decided_at: ago(35) },  // outside
] as any[]);
const ev = (by: any, s: any, kind: string, o: Record<string, unknown> = {}) => ({ _id: new ObjectId(), followup_id: "f", student_id: sid(s), at: ago(2), by_id: id(by), by_name: by.full_name, kind, ...o });
await db.collection("student_followup_events").insertMany([
  ev(one, asha, "created", { stage_to: "New" }),
  ev(one, asha, "logged", { stage_from: "New", stage_to: "Contacted", text: "Spoke, interested" }),
  ev(one, asha, "logged", { stage_from: "Contacted", stage_to: "Converted" }),
  ev(two, bilal, "logged", { stage_from: "Contacted", stage_to: "Lost" }),
  ev(two, bilal, "edited"),                         // not follow-up work
  ev(two, bilal, "logged", { at: ago(30) }),        // outside
] as any[]);
const call = (by: any, o: Record<string, unknown> = {}) => ({ _id: new ObjectId(), key: String(new ObjectId()), started_at: ago(1), direction: "out", status: "answered", answered: true,
  talk_seconds: 120, user_id: id(by), user_name: by.full_name, student_id: sid(asha), student_name: "Asha", recording_ids: [1], ...o });
await db.collection("student_calls").insertMany([call(one), call(one, { answered: false, status: "no_answer", talk_seconds: 0, recording_ids: [] }), call(two, { direction: "in", talk_seconds: 60 }),
  call(one, { started_at: ago(20) })] as any[]);
await db.collection("commission_credits").insertMany([
  { recipient_id: id(one), recipient_name: "Cee One", commission_usd: 40, requested_at: ago(2), student_id: sid(asha), level: 1, transaction_type: "DEPOSIT", status: "credited" },
  { recipient_id: id(two), recipient_name: "Cee Two", commission_usd: 20, requested_at: ago(2), student_id: sid(bilal), level: 2, transaction_type: "DEPOSIT", status: "credited" },
  { recipient_id: id(one), commission_usd: 999, requested_at: ago(2), is_pool: true },   // pool: left out
  { recipient_id: id(one), commission_usd: 5, requested_at: ago(25) },                    // outside
] as any[]);
await db.collection("program_notices").insertMany([
  { program_id: "p1", student_email: "asha@s.test", response: "confirmed" },
  { program_id: "p1", student_email: "x@s.test", response: "declined" },
  { program_id: "p1", student_email: "y@s.test", response: null },
] as any[]);

/* The LMS: two programs — one with classes in the period (made by Cee One), one only later. */
const lms = Bun.serve({
  port: Number(process.env.E2E_FAKE_LMS_PORT),
  fetch(req) {
    if (req.headers.get("x-portal-secret") !== LMS_SECRET) return Response.json({ success: false, message: "Bad secret" }, { status: 401 });
    if (new URL(req.url).pathname !== "/api/v1/service/programs") return Response.json({ success: false, message: "Route not found" }, { status: 404 });
    return Response.json({ success: true, data: [
      { id: "p1", title: "Gold weekly", status: "active", repeat: "weekly", createdByEmail: "ONE@e2e.test", createdByName: "Cee One", mentor: { name: "Mentor M" },
        students: [{ id: "a" }, { id: "b" }, { id: "c" }],
        classes: [{ startsAt: ago(6), status: "ended" }, { startsAt: ago(3), status: "cancelled" }, { startsAt: ago(-3), status: "scheduled" }, { startsAt: ago(20), status: "ended" }] },
      { id: "p2", title: "Later", status: "active", createdByEmail: "two@e2e.test", students: [], classes: [{ startsAt: ago(-20), status: "scheduled" }] },
    ] });
  },
});

step("Case 4 — permission");
same("no secret: 401", (await get(P, null)).status, 401);
same("a wrong secret: 401", (await get(P, "nope")).status, 401);

step("Case 1 — the period's work");
const r = await get(P);
same("200", r.status, 200);
const d = r.body.data ?? {};
const row = (sec: string, u: any) => (d[sec]?.people ?? []).find((p: any) => p.id === id(u)) ?? {};
const rv1 = row("revenue", one), rv2 = row("revenue", two);
same("revenue, Cee One: 1 deposit $1000 / AED 3670, 1 withdrawal $200, net $800, 1 course payment AED 5000",
  [rv1.deposits, rv1.deposit_usd, rv1.deposit_aed, rv1.withdrawals, rv1.withdrawal_usd, rv1.net_usd, rv1.course_payments, rv1.course_payment_aed], [1, 1000, 3670, 1, 200, 800, 1, 5000]);
same("revenue, Cee Two: $500 at 3.67, and the old upgrade's payment in the period", [rv2.deposit_usd, rv2.deposit_aed, rv2.course_payment_aed], [500, 1835, 4000]);
same("in AED: Cee One's withdrawal AED 734 (USD at 3.67), net AED 2936", [rv1.withdrawal_aed, rv1.net_aed], [734, 2936]);
same("revenue total", [d.revenue?.total?.deposits, d.revenue?.total?.deposit_usd, d.revenue?.total?.course_payment_aed], [2, 1500, 9000]);
check("revenue rows: kind, student, CS, team", (d.revenue?.rows ?? []).some((x: any) => x.kind === "deposit" && x.student === "Asha" && x.cs === "Cee One" && x.team === "Falcons"));
const f1 = row("followups", one), f2 = row("followups", two);
same("follow-ups, Cee One: 1 opened, 2 logged, 1 student contacted, 1 converted", [f1.opened, f1.logged, f1.contacted, f1.converted], [1, 2, 1, 1]);
same("follow-ups, Cee Two: 1 logged, 1 lost", [f2.logged, f2.lost], [1, 1]);
const c1 = row("calls", one);
same("calls, Cee One: 2 calls, 1 connected, 1 missed, 120s, 1 recorded", [c1.calls, c1.connected, c1.missed, c1.talk_seconds, c1.recorded], [2, 1, 1, 120, 1]);
check("call rows carry their id for the recording", (d.calls?.rows ?? []).every((x: any) => /^[0-9a-f]{24}$/.test(x.id)));
const pg1 = row("programs", one);
same("programs, Cee One: 1 program, 2 classes in the period (1 held, 1 cancelled), 3 students, 1 confirmed, 1 declined",
  [pg1.programs, pg1.classes, pg1.held, pg1.cancelled, pg1.students, pg1.confirmed, pg1.declined], [1, 2, 1, 1, 3, 1, 1]);
same("programs: the one only later left out", (d.programs?.rows ?? []).map((x: any) => x.title), ["Gold weekly"]);
same("onboarded: Asha (Cee One, from finance) and Cara (Bangalore), not Bilal (before)", (d.onboarded?.rows ?? []).map((x: any) => x.student).sort(), ["Asha", "Cara"]);
same("onboarded total, from finance", [d.onboarded?.total?.onboarded, d.onboarded?.total?.from_finance], [2, 1]);
const b1 = row("bonus", one);
same("bonus, Cee One: 1 approved $100", [b1.count, b1.approved, b1.approved_usd], [1, 1, 100]);
same("bonus, Bangalore: with finance $250, plus the sales-close bonus needing a call $300", [row("bonus", blr).with_finance, row("bonus", blr).needs_call, row("bonus", blr).usd], [1, 1, 550]);
same("bonus, Cee Two: 1 rejected", row("bonus", two).rejected, 1);
same("commission: Cee One $40, Cee Two $20 (pool and outside left out)", [row("commission", one).usd, row("commission", two).usd, d.commission?.total?.usd], [40, 20, 60]);
same("commission in AED at 3.67: Cee One 146.8, Cee Two 73.4", [row("commission", one).aed, row("commission", two).aed, d.commission?.total?.aed], [146.8, 73.4, 220.2]);
const u1 = row("upgrades", one), u2 = row("upgrades", two);
same("upgrades, Cee One: 1 started, AED 5000 quoted, AED 5000 paid", [u1.started, u1.quoted_aed, u1.paid_aed], [1, 5000, 5000]);
same("upgrades, Cee Two: none started, AED 4000 paid on an older one", [u2.started, u2.paid_aed], [0, 4000]);
check("teams and months come with each section", (d.revenue?.teams ?? []).some((t: any) => t.team === "Falcons") && (d.revenue?.months ?? []).length >= 1);
check("filters: teams and people", (d.filters?.teams ?? []).length === 2 && (d.filters?.people ?? []).some((p: any) => p.name === "Cee One"));

step("Case 2 — filters");
const blrOnly = (await get(`${P}&location=bangalore`)).body.data;
same("Bangalore only: Cara's bonus, onboarding; no Dubai deposits", [blrOnly?.revenue?.total?.deposits ?? 0, blrOnly?.bonus?.total?.count, blrOnly?.onboarded?.total?.onboarded], [0, 2, 1]);
const oneOnly = (await get(`${P}&cs=${id(one)}`)).body.data;
same("one CS: only their commission", oneOnly?.commission?.total?.usd, 40);
const team = (await get(`${P}&team=${id(lead)}`)).body.data;
same("one team (Falcons): Cee One + Cee Two's commission", team?.commission?.total?.usd, 60);

step("Case 3 — errors");
same("from after to: 400", (await get(`?from=${TO}&to=${FROM}`)).status, 400);

console.log(`\n${pass}/${pass + fail} checks passed`);
lms.stop(true);
await client.close();
process.exit(fail ? 1 : 0);
