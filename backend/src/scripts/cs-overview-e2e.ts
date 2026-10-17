/**
 * GET /api/v1/service/cs-overview and /cs-overview/:userId (portal/csOverview.ts), end to end:
 *
 *   Case 1  happy path   each CS's students (Common ones too), deposits (by who initiated, else the student's CS),
 *                        commission credited (pool rows aside), today's and overdue follow-ups, instalments due in
 *                        7 days and overdue, balances per currency, bonuses waiting, not onboarded (6h+ late)
 *                        course upgrades (by who started them, else the student's CS) and the AED approved on them
 *   Case 2  edge         the period bounds deposits, commission and upgrades only; a closed follow-up, a pending deposit, a
 *                        paid fee, a due date 20 days off; one CS's page with the lists behind the figures
 *   Case 3  errors       a date that is not one, from after to, nobody by that id
 *   Case 4  permission   no secret, a wrong one
 *
 * Run through ./test-cs-overview.sh (throwaway mongod and the API — no .env). Scratch database only.
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

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const show = (v: unknown) => JSON.stringify(v).slice(0, 400);
async function get(path: string, secret: string | null = SECRET) {
  const r = await fetch(`${API}/api/v1/service${path}`, { headers: secret ? { "x-portal-secret": secret } : {} });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
await db.dropDatabase();

step("Setting up: three CSs, five students, fees, follow-ups, deposits, commission and bonuses");
const nowMs = Date.now();
const iso = (h: number) => new Date(nowMs - h * 3_600_000).toISOString();
const now = iso(0);
const bizDay = (d: number) => new Date(nowMs + 330 * 60_000 + d * 86_400_000).toISOString().slice(0, 10); // follow-ups: UTC+5:30
const uaeDay = (d: number) => new Date(nowMs + 4 * 3_600_000 + d * 86_400_000).toISOString().slice(0, 10); // dues: UTC+4
const person = (full_name: string, email: string, status = "active") => ({ _id: new ObjectId(), email, full_name, app_role: "cs", status, team_name: "Falcons", created_date: now });
const cs1 = person("Cee One", "CS1@e2e-cso.test"), cs2 = person("Cee Two", "cs2@e2e-cso.test"), cs3 = person("Cee Common", "cs3@e2e-cso.test");
await db.collection("users").insertMany([cs1, cs2, cs3]);
const id = (u: { _id: ObjectId }) => String(u._id);
const fee = (o: Record<string, unknown>) => ({ invoice_id: String(new ObjectId()), course: "MBT", status: "approved", source: "finance", ...o });
const stu = (name: string, cs: { _id: ObjectId; full_name: string }, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), full_name: name, student_code: `STU-${name}`, primary_mentor_id: id(cs), primary_mentor_name: cs.full_name,
  status: "ACTIVE", onboarded: true, created_date: iso(48), ...extra,
});
const s1 = stu("Asha", cs1, { common_cs: [{ id: id(cs3), name: cs3.full_name }],
  course_fees: [fee({ currency: "AED", balance_minor: 300000, next_due_on: uaeDay(2) })] });
const s2 = stu("Bilal", cs1, { course_fees: [fee({ currency: "USD", balance_minor: 50000, next_due_on: uaeDay(-1) }), fee({ currency: "AED", balance_minor: 100000, status: "paid", next_due_on: uaeDay(1) })] });
const s3 = stu("Chen", cs2, { course_fees: [fee({ currency: "AED", balance_minor: 100000, next_due_on: uaeDay(20), bonus_given: true, bonus_minor: 25000, bonus_currency: "USD" })] });
const s4 = stu("Divya", cs2, { onboarded: false, created_date: iso(1), finance_invoice_id: "INV-1" });
const s5 = stu("Emre", cs1, { onboarded: false, created_date: iso(7), finance_invoice_id: "INV-2" });
await db.collection("students").insertMany([s1, s2, s3, s4, s5]);
const fu = (s: { _id: ObjectId }, next: string, stage = "Interested") => ({ _id: new ObjectId(), student_id: String(s._id), stage, next_followup_date: next, title: `Call ${next}`, created_date: now });
await db.collection("student_followups").insertMany([
  fu(s1, bizDay(0)), fu(s2, bizDay(-2)), fu(s3, bizDay(1)), fu(s1, bizDay(0), "Converted"),
]);
const dep = (amount_usd: number, approved_at: string, extra: Record<string, unknown>) => ({ type: "DEPOSIT", status: "APPROVED", amount_usd, approved_at, ...extra });
await db.collection("funding_transactions").insertMany([
  dep(1000, iso(2), { initiating_mentor_id: id(cs1), primary_mentor_id: id(cs2), student_id: String(s3._id), student_name: "Chen" }), // cs1 initiated, cs2's student
  dep(400, iso(3), { primary_mentor_id: id(cs1), student_id: String(s2._id), student_name: "Bilal" }),                           // no initiator: the student's CS
  dep(900, "2026-09-01T10:00:00.000Z", { initiating_mentor_id: id(cs1), student_id: String(s1._id) }),                         // before the period
  { type: "DEPOSIT", status: "PENDING", amount_usd: 5000, requested_at: iso(1), initiating_mentor_id: id(cs1) },              // not approved
  { type: "BONUS", status: "PENDING", amount_usd: 500, student_id: String(s1._id), requested_at: iso(5) },                    // waiting for a broker admin
]);
await db.collection("commission_credits").insertMany([
  { recipient_id: id(cs1), commission_usd: 50, requested_at: iso(2), student_id: String(s3._id), level: 1, status: "accrued" },
  { recipient_id: id(cs1), commission_usd: 20, requested_at: "2026-09-01T10:00:00.000Z", status: "released" },
  { recipient_id: id(cs1), commission_usd: 999, requested_at: iso(2), is_pool: true, status: "pooled" },
  { recipient_id: id(cs2), commission_usd: 30, requested_at: iso(2), status: "accrued" },
]);
const upg = (student: { _id: ObjectId }, created_at: string, extra: Record<string, unknown> = {}) =>
  ({ _id: new ObjectId(), student_id: String(student._id), course: "CSE", plan: "full", status: "open", created_at, quote: { dueAed: 5000 }, ...extra });
const u1 = upg(s3, iso(4), { created_by: id(cs1), created_by_name: "Cee One" });           // Cee One started it on Cee Two's student
const u2 = upg(s2, "2026-09-01T10:00:00.000Z");                                            // no starter: the student's CS (Cee One); before the period
const u3 = upg(s1, iso(1), { created_by: id(cs2), status: "cancelled" });                  // cancelled: not counted
const u4 = upg(s4, iso(5), { created_by: id(cs2) });                                       // Cee Two, nothing paid yet
await db.collection("course_upgrades").insertMany([u1, u2, u3, u4]);
await db.collection("course_payments").insertMany([
  { upgrade_id: String(u1._id), amount_aed: 2000, approved_amount_aed: 2000, status: "approved", decided_at: iso(2) },
  { upgrade_id: String(u1._id), amount_aed: 1000, status: "pending", recorded_at: iso(1) },                 // not approved yet
  { upgrade_id: String(u2._id), amount_aed: 1500, status: "approved", decided_at: iso(3) },                 // approved in the period on an older upgrade
  { upgrade_id: String(u2._id), amount_aed: 700, status: "approved", decided_at: "2026-09-02T10:00:00.000Z" }, // before the period
]);
const period = `from=${encodeURIComponent(iso(24))}&to=${encodeURIComponent(new Date(nowMs + 3_600_000).toISOString())}`;

step("Case 1 — happy path: every CS's figures");
let r = await get(`/cs-overview?${period}`);
const row = (u: { _id: ObjectId }) => (r.body?.data?.rows ?? []).find((x: any) => x.id === id(u));
const a = row(cs1), b = row(cs2), c = row(cs3);
check("answered, in the envelope", r.status === 200 && r.body?.success === true && r.body.data.upcomingDays === 7, show(r.body).slice(0, 200));
check("students: Cee One 3 (Asha, Bilal, Emre), Cee Two 2, Cee Common 1 (Common with Asha)", a?.students === 3 && b?.students === 2 && c?.students === 1, show([a?.students, b?.students, c?.students]));
check("who they are: lower-case email, role, team", a?.email === "cs1@e2e-cso.test" && a.role === "cs" && a.team === "Falcons" && a.active === true, show(a));
check("deposits: the one Cee One initiated (Cee Two's student) and the one with no initiator on their student — $1,400, 2",
  a?.deposits?.usd === 1400 && a.deposits.count === 2 && (b?.deposits?.usd ?? 0) === 0, show([a?.deposits, b?.deposits]));
check("commission credited: $50 for Cee One (no pool row, nothing from September), $30 for Cee Two", a?.commissionUsd === 50 && b?.commissionUsd === 30, show([a?.commissionUsd, b?.commissionUsd]));
check("follow-ups: Cee One 1 today and 1 overdue (a converted one not counted); Common CS shares Asha's", a?.followupsToday === 1 && a.followupsOverdue === 1
  && c?.followupsToday === 1 && (b?.followupsToday ?? 0) === 0, show([a?.followupsToday, a?.followupsOverdue, c?.followupsToday]));
check("dues: AED 3,000 due in 2 days (upcoming), USD 500 a day overdue; a paid fee not counted", a?.upcoming?.count === 1 && a.upcoming.amount.AED === 3000
  && a.overdueDues.count === 1 && a.overdueDues.amount.USD === 500 && !a.upcoming.amount.USD, show([a?.upcoming, a?.overdueDues]));
check("balance due per currency, never added together: AED 3,000 and USD 500 across 2 students", a?.balance?.students === 2 && a.balance.amount.AED === 3000 && a.balance.amount.USD === 500, show(a?.balance));
check("Cee Two: AED 1,000 owed but due in 20 days — in the balance, not upcoming", b?.balance?.amount?.AED === 1000 && b.upcoming.count === 0, show(b?.balance));
check("bonus: Cee One 1 client $500 waiting for a broker admin; Cee Two 1 client $250 after full payment (Chen still owes AED 1,000 — 2026-10-17)",
  a?.bonus?.clients === 1 && a.bonus.usd === 500 && a.bonus.waitingBroker === 1 && b?.bonus?.clients === 1 && b.bonus.usd === 250 && b.bonus.afterPayment === 1 && b.bonus.needsCall === 0, show([a?.bonus, b?.bonus]));
check("not onboarded: Emre 7 hours (late) for Cee One, Divya 1 hour for Cee Two", a?.notOnboarded === 1 && a.notOnboardedLate === 1 && b?.notOnboarded === 1 && b.notOnboardedLate === 0,
  show([a?.notOnboarded, a?.notOnboardedLate, b?.notOnboarded, b?.notOnboardedLate]));
check("course upgrades: Cee One started 1 in the period (on Cee Two's student) and finance approved AED 3,500 in 2 payments; Cee Two 1, nothing paid; a cancelled one not counted",
  a?.upgrades?.count === 1 && a.upgrades.paidAed === 3500 && a.upgrades.payments === 2 && b?.upgrades?.count === 1 && b.upgrades.paidAed === 0, show([a?.upgrades, b?.upgrades]));
const t = r.body?.data?.totals;
check("the team's totals count each student once (Asha, shared with Cee Common, once): 5 students, $1,400, $80, 2 upgrades AED 3,500",
  t?.students === 5 && t.deposits.usd === 1400 && t.commissionUsd === 80 && t.upgrades.count === 2 && t.upgrades.paidAed === 3500, show(t));
check("…and now: balance AED 4,000 + USD 500 over 3 students, 1 follow-up today + 1 overdue, bonus 2 clients $750, 2 not onboarded (1 late)",
  t?.balance?.students === 3 && t.balance.amount.AED === 4000 && t.balance.amount.USD === 500 && t.followupsToday === 1 && t.followupsOverdue === 1
  && t.bonus.clients === 2 && t.bonus.usd === 750 && t.notOnboarded === 2 && t.notOnboardedLate === 1, show(t));
check("no team row among the CSs", !(r.body?.data?.rows ?? []).some((x: any) => x.id === "*"));

step("Case 2 — edges and one CS's page");
r = await get("/cs-overview");
const all = (r.body?.data?.rows ?? []).find((x: any) => x.id === id(cs1));
check("no period: all time — deposits $2,300 and commission $70; the rest the same", all?.deposits?.usd === 2300 && all.commissionUsd === 70 && all.students === 3, show(all));
check("no period: upgrades all time — 2 started, AED 4,200 approved", all?.upgrades?.count === 2 && all.upgrades.paidAed === 4200, show(all?.upgrades));
r = await get(`/cs-overview/${id(cs1)}?${period}`);
const d = r.body?.data;
check("Cee One's page: the same figures", r.status === 200 && d?.summary?.deposits?.usd === 1400 && d.summary.students === 3 && d.person.name === "Cee One", show(d?.summary));
check("…today's and overdue follow-ups, each with its student", d?.followups?.length === 2 && d.followups.some((f: any) => f.student === "Asha" && !f.overdue)
  && d.followups.some((f: any) => f.student === "Bilal" && f.overdue), show(d?.followups));
check("…dues, soonest first, with days left and currency", d?.dues?.[0]?.student === "Bilal" && d.dues[0].state === "overdue" && d.dues[0].currency === "USD"
  && d.dues[1]?.student === "Asha" && d.dues[1].daysLeft === 2, show(d?.dues));
check("…bonus waiting: Asha $500", d?.bonus?.length === 1 && d.bonus[0].student === "Asha" && d.bonus[0].usd === 500, show(d?.bonus));
check("…not onboarded: Emre, late", d?.notOnboarded?.length === 1 && d.notOnboarded[0].student === "Emre" && d.notOnboarded[0].late === true, show(d?.notOnboarded));
check("…deposits in the period: Chen $1,000 and Bilal $400", d?.deposits?.length === 2 && d.deposits.reduce((n: number, x: any) => n + x.usd, 0) === 1400, show(d?.deposits));
check("…commission in the period: $50 on Chen", d?.commission?.length === 1 && d.commission[0].usd === 50 && d.commission[0].student === "Chen", show(d?.commission));
check("…upgrades started or paid on in the period: Chen (AED 2,000 paid) and Bilal's older one (AED 1,500)", d?.upgrades?.length === 2
  && d.upgrades.some((u: any) => u.student === "Chen" && u.paidAed === 2000 && u.startedBy === "Cee One") && d.upgrades.some((u: any) => u.student === "Bilal" && u.paidAed === 1500)
  && d.summary.upgrades.count === 1, show(d?.upgrades));
r = await get(`/cs-overview/${id(cs2)}?${period}`);
check("Cee Two's page: only Divya's upgrade, not the one Cee One started on Chen", r.body?.data?.upgrades?.length === 1 && r.body.data.upgrades[0].student === "Divya", show(r.body?.data?.upgrades));

step("Case 3 — errors");
check("a date that is not one: 400", (await get("/cs-overview?from=soon")).status === 400);
check("from after to: 400", (await get(`/cs-overview?from=${encodeURIComponent(now)}&to=${encodeURIComponent(iso(48))}`)).status === 400);
check("nobody by that id: 404", (await get(`/cs-overview/${new ObjectId()}`)).status === 404);

step("Case 4 — the Root portal's secret only");
check("no secret: 401", (await get("/cs-overview", null)).status === 401);
check("a wrong one: 401", (await get("/cs-overview", "wrong-secret")).status === 401);

await client.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
