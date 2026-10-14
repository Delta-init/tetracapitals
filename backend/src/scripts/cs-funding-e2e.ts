/**
 * The CSEs page's funding requests and recent course upgrades (portal/csFunding.ts, portal/csOverview.ts; the user,
 * 2026-10-14), end to end through GET /api/v1/service/cs-overview[/:userId] with the portal secret:
 *   - the period's requests and every one still waiting from any date, never an old decided one;
 *   - where each is paused: sent back (with the note), with finance, waiting for a broker admin; approved, rejected;
 *   - a bonus's MT5 bonus in USD with AED at 3.67, what the student paid in AED; a deposit's USD and AED;
 *   - the commission each earned (pool rows aside), and on one CS's page their own share;
 *   - each CS's counts and the team's: pending, $ and AED, by stage, raised in the period; a CS with only a request
 *     waiting still has a row; waiting first, the oldest first;
 *   - the period's course upgrades with who started them;
 *   - fully in AED (2026-10-14): a request's AED as Funding Requests shows it (a course payment what the student paid,
 *     else the request's AED, else USD at 3.67), a bonus's MT5 bonus in AED, deposits in their recorded AED;
 *   - Bangalore apart: each CS's location (their team's), the team's figures per location, a request typed in INR.
 * Run through ./test-cs-funding.sh (throwaway mongod, the API — no .env). Scratch database only.
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
const show = (v: unknown) => JSON.stringify(v).slice(0, 500);
async function get(path: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${API}/api/v1/service${path}`, { headers: { "x-portal-secret": SECRET } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
await db.dropDatabase();

const nowMs = Date.now();
const iso = (h: number) => new Date(nowMs - h * 3_600_000).toISOString();
const from = iso(24 * 7), to = iso(-1);
const person = (full_name: string, email: string) => ({ _id: new ObjectId(), email, full_name, app_role: "cs", status: "active", team_name: "Falcons", created_date: iso(0) });
const cs1 = person("Cee One", "cs1@e2e-csf.test"), cs2 = person("Cee Two", "cs2@e2e-csf.test"), cs3 = person("Cee Quiet", "cs3@e2e-csf.test");
// Cee Quiet is on a Bangalore team: its leader's team_location.
const blrChief = { _id: new ObjectId(), email: "chief@e2e-csf.test", full_name: "Blr Chief", app_role: "chief_mentor", status: "active", team_name: "Bangalore Hawks", team_location: "bangalore", created_date: iso(0) };
(cs3 as any).up_head_id = String(blrChief._id);
await db.collection("users").insertMany([cs1, cs2, cs3, blrChief]);
const id = (u: { _id: ObjectId }) => String(u._id);
const s1 = { _id: new ObjectId(), full_name: "Asha", student_code: "STU-A", primary_mentor_id: id(cs1), primary_mentor_name: "Cee One", status: "ACTIVE", onboarded: true, created_date: iso(48) };
const s2 = { _id: new ObjectId(), full_name: "Bilal", student_code: "STU-B", primary_mentor_id: id(cs2), primary_mentor_name: "Cee Two", status: "ACTIVE", onboarded: true, created_date: iso(48) };
await db.collection("students").insertMany([s1, s2]);

const tx = (o: Record<string, unknown>) => ({ _id: new ObjectId(), student_id: String(s1._id), student_name: "Asha", student_code: "STU-A", primary_mentor_id: id(cs1), primary_mentor_name: "Cee One", ...o });
const depOk = tx({ type: "DEPOSIT", status: "APPROVED", amount_usd: 1000, amount_aed: 3675, requested_at: iso(30), approved_at: iso(29), initiating_mentor_id: id(cs1), initiating_mentor_name: "Cee One" });
const bonusFin = tx({ type: "BONUS", status: "PENDING", amount_usd: 1500, requested_at: iso(24 * 20), finance_approval: { state: "sent" },
  course_payment: { product: "DSLP", kind: "partial", bonus_usd: 500, paid_today_aed: 4000 } });                                   // waiting since before the period
const bonusBroker = tx({ type: "BONUS", status: "PENDING", amount_usd: 200, requested_at: iso(5), finance_approval: { state: "decided" } });
const bonusBack = tx({ type: "BONUS", status: "PENDING", amount_usd: 300, requested_at: iso(10), returned: { at: iso(2), note: "Wrong MT5 login" } });
const finBack = tx({ type: "BONUS", status: "REJECTED", amount_usd: 100, requested_at: iso(24 * 30), finance_approval: { state: "decided", sent_back: true, reason: "Receipt unreadable" } });
const depStale = tx({ type: "DEPOSIT", status: "PENDING", amount_usd: 700, requested_at: iso(24 * 12), finance_approval: { state: "sent" },
  student_id: String(s2._id), student_name: "Bilal", student_code: "STU-B", primary_mentor_id: id(cs2), primary_mentor_name: "Cee Two" });
const wdRejected = tx({ type: "WITHDRAWAL", status: "REJECTED", amount_usd: 50, requested_at: iso(20), rejection_reason: "Not enough balance" });
const oldDecided = tx({ type: "DEPOSIT", status: "APPROVED", amount_usd: 9999, requested_at: iso(24 * 40), approved_at: iso(24 * 40) });
const cs3Waiting = tx({ type: "DEPOSIT", status: "PENDING", amount_usd: 60, amount_currency: "INR", amount_original: 6000, requested_at: iso(24 * 15), initiating_mentor_id: id(cs3), initiating_mentor_name: "Cee Quiet" });
await db.collection("funding_transactions").insertMany([depOk, bonusFin, bonusBroker, bonusBack, finBack, depStale, wdRejected, oldDecided, cs3Waiting]);
await db.collection("commission_credits").insertMany([
  { transaction_id: depOk._id, recipient_id: id(cs1), commission_usd: 25, requested_at: iso(29), status: "accrued" },
  { transaction_id: String(depOk._id), recipient_id: id(cs2), commission_usd: 5, requested_at: iso(29), status: "accrued" },
  { transaction_id: String(depOk._id), recipient_id: "pool", commission_usd: 999, requested_at: iso(29), is_pool: true, status: "pooled" },
]);
const up = { _id: new ObjectId(), student_id: String(s1._id), course: "DQMP", plan: "partial", status: "open", created_by: id(cs1), created_by_name: "Cee One", created_at: iso(3), quote: { dueAed: 10000 } };
const upOld = { _id: new ObjectId(), student_id: String(s2._id), course: "DSLP", plan: "full", status: "open", created_by: id(cs2), created_by_name: "Cee Two", created_at: iso(24 * 60), quote: { dueAed: 5000 } };
await db.collection("course_upgrades").insertMany([up, upOld]);
await db.collection("course_payments").insertMany([
  { upgrade_id: String(upOld._id), status: "approved", amount_aed: 2000, approved_amount_aed: 2000, decided_at: iso(4) },   // paid on in the period
]);

const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

step("The CSEs page");
let r = await get(`/cs-overview${q}`);
const d = r.body.data;
const rows: any[] = d?.funding?.rows ?? [];
const byId = new Map(rows.map((x) => [x.id, x]));
check("the period's requests and every one still waiting — never an old decided one", r.status === 200 && rows.length === 8 && !byId.has(String(oldDecided._id))
  && byId.has(String(bonusFin._id)) && byId.has(String(finBack._id)) && byId.has(String(depStale._id)), show(rows.map((x) => `${x.type}:${x.stage}`)));
check("where each waits: sent back (broker, with the note; accounts, with the reason), with finance, waiting for a broker admin",
  byId.get(String(bonusBack._id))?.stage === "sent_back" && byId.get(String(bonusBack._id))?.reason === "Wrong MT5 login"
  && byId.get(String(finBack._id))?.stage === "sent_back" && byId.get(String(finBack._id))?.reason === "Receipt unreadable"
  && byId.get(String(bonusFin._id))?.stage === "with_finance" && byId.get(String(bonusBroker._id))?.stage === "waiting_broker"
  && byId.get(String(depStale._id))?.stage === "with_finance");
check("decided: approved; rejected with why", byId.get(String(depOk._id))?.stage === "approved" && byId.get(String(depOk._id))?.decidedAt === (depOk as any).approved_at
  && byId.get(String(wdRejected._id))?.stage === "rejected" && byId.get(String(wdRejected._id))?.reason === "Not enough balance");
const bf = byId.get(String(bonusFin._id));
check("a course payment's bonus, in AED: what the student paid AED 4,000; its MT5 bonus $500 = AED 1,835", bf?.usd === 500 && bf.aed === 4000 && bf.bonusAed === 1835 && bf.receivedAed === 4000
  && /Course payment bonus · DSLP/.test(bf.label), show(bf));
const dk = byId.get(String(depOk._id));
check("a deposit: its recorded AED 3,675 ($1,000); its commission $30 (pool aside); its CS", dk?.usd === 1000 && dk.aed === 3675 && dk.bonusAed === 0 && dk.commissionUsd === 30 && dk.cs === "Cee One" && dk.label === "Deposit", show(dk));
check("waiting first — sent back, with finance, the broker admin — the oldest first; then decided, the newest first",
  rows.slice(0, 6).map((x) => x.stage).join() === "sent_back,sent_back,with_finance,with_finance,waiting_broker,waiting_broker"
  && rows[0].id === String(finBack._id) && rows[2].id === String(bonusFin._id) && rows[6].id === String(wdRejected._id), show(rows.map((x) => x.stage)));
const t = d.totals.funding;
check("the team: 6 waiting ($1,860 — a course payment counts its $500 bonus; in AED what was paid: 8,991.20) — 2 sent back, 2 with finance, 2 broker admin; 4 raised in the period",
  t.pending === 6 && t.pendingUsd === 1860 && t.pendingAed === 8991.2 && t.sentBack === 2 && t.withFinance === 2 && t.waitingBroker === 2 && t.raised === 4, show(t));
const row1 = d.rows.find((x: any) => x.id === id(cs1)), row2 = d.rows.find((x: any) => x.id === id(cs2)), row3 = d.rows.find((x: any) => x.id === id(cs3));
check("each CS's: Cee One 4 waiting, Cee Two 1 (the stale deposit with finance)", row1?.funding?.pending === 4 && row1.funding.sentBack === 2 && row2?.funding?.pending === 1 && row2.funding.withFinance === 1, show([row1?.funding, row2?.funding]));
check("a CS with only a request waiting still has a row", row3?.funding?.pending === 1 && row3.funding.waitingBroker === 1, show(row3));
check("each CS's location, by their team: Cee Quiet Bangalore, the others Dubai", row3?.location === "bangalore" && row1?.location === "dubai" && row2?.location === "dubai", show([row1?.location, row3?.location]));
const tl = d.totalsByLocation;
check("the team's figures per location, never mixed: Dubai 5 waiting, AED 8,771; Bangalore 1, AED 220.20; deposits AED 3,675 in Dubai",
  tl?.dubai?.funding?.pending === 5 && tl.dubai.funding.pendingAed === 8771 && tl?.bangalore?.funding?.pending === 1 && tl.bangalore.funding.pendingAed === 220.2
  && tl.dubai.deposits.aed === 3675 && tl.bangalore.deposits.aed === 0 && d.totals.deposits.aed === 3675, show(tl));
const q3 = byId.get(String(cs3Waiting._id));
check("a Bangalore CS's request: located there, typed in INR shown as typed", q3?.location === "bangalore" && q3.typedInr === 6000 && q3.aed === 220.2, show(q3));
const ups = d.recentUpgrades ?? [];
check("recent upgrades: started in the period, or paid on in it — with who started them and the AED", ups.length === 2 && ups[0].course === "DQMP" && ups[0].cs === "Cee One"
  && ups[0].dueAed === 10000 && ups[1].course === "DSLP" && ups[1].paidAed === 2000 && ups[1].cs === "Cee Two", show(ups));

step("One CS's page");
r = await get(`/cs-overview/${id(cs1)}${q}`);
const one = r.body.data;
check("their location on their page", one?.person?.location === "dubai" && one.deposits?.[0]?.aed === 3675, show(one?.person));
check("their requests only, with their counts", r.status === 200 && one.funding.rows.length === 6 && one.funding.rows.every((x: any) => x.csId === id(cs1))
  && one.summary.funding.pending === 4, show(one?.summary?.funding));
check("…and their own share of the commission", one.funding.rows.find((x: any) => x.id === String(depOk._id))?.mineUsd === 25
  && one.funding.rows.find((x: any) => x.id === String(depOk._id))?.commissionUsd === 30);
r = await get(`/cs-overview/${id(cs2)}${q}`);
check("Cee Two: the stale deposit with finance", r.body.data?.funding?.rows?.length === 1 && r.body.data.funding.rows[0].stage === "with_finance");
r = await get(`/cs-overview/${id(cs3)}${q}`);
check("a Bangalore CS's page: located there, their request too", r.body.data?.person?.location === "bangalore" && r.body.data.funding.rows[0]?.location === "bangalore", show(r.body.data?.funding?.rows));

console.log(`\n${pass} passed, ${fail} failed`);
await client.close();
process.exit(fail ? 1 : 0);
