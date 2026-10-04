/**
 * The MT5 Bonus Approvals page's list (functions/bonusApprovals.ts), end to end against the API:
 *   - what is pending for a broker admin: sales-close bonuses, and bonus requests once finance approved them — not
 *     the ones finance still has (only counted), nor deposits; this month's approved and rejected ones;
 *   - each row carries the student's CS, their welcome, the course and where the bonus came from;
 *   - approving and rejecting through the same update the page uses: off pending, onto approved / rejected;
 *   - who may see it: broker admins and Super Admins only; and the sidebar's count, for them alone.
 * Run through ./test-bonus-approvals.sh (throwaway mongod, the API — no .env). Scratch database only.
 */
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
async function call(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function login(email: string): Promise<string> {
  const r = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "Password123!" }) });
  const token = ((await r.json().catch(() => ({}))) as any).token;
  if (!token) throw new Error(`could not sign in as ${email}: ${r.status}`);
  return token;
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
for (const c of await db.listCollections().toArray()) if (c.name !== "commission_roles") await db.collection(c.name).deleteMany({});

step("Setting up");
const hash = await bcrypt.hash("Password123!", 10);
const now = new Date().toISOString();
const person = (full_name: string, email: string, app_role: string) => ({
  _id: new ObjectId(), email, full_name, app_role, password_hash: hash, commission_rate: 4, status: "active", created_date: now, updated_date: now,
});
const admin = person("Super Admin", "admin@e2e-bonus.test", "super_admin");
const broker = person("Broker Admin", "broker@e2e-bonus.test", "broker_admin");
const financeAdmin = person("Finance Admin", "finance@e2e-bonus.test", "finance_admin");
const cs = person("Cee Ess", "cs@e2e-bonus.test", "junior_mentor");
await db.collection("users").insertMany([admin, broker, financeAdmin, cs] as any[]);
const s1 = { _id: new ObjectId(), student_code: "STU-0001", full_name: "Student One", primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, team_name: "Team Asha", status: "ACTIVE", onboarded: true, onboarded_at: now, created_date: now };
const s2 = { _id: new ObjectId(), student_code: "STU-0002", full_name: "Student Two", primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, status: "ACTIVE", created_date: now };
await db.collection("students").insertMany([s1, s2] as any[]);
const lastMonth = new Date(Date.now() - 40 * 86_400_000).toISOString();
const tx = (s: any, extra: Record<string, unknown>) => ({
  _id: new ObjectId(), type: "BONUS", status: "PENDING", student_id: String(s._id), student_name: s.full_name, student_code: s.student_code,
  primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, amount_currency: "USD", amount_original: 500, amount_usd: 500,
  mt5_login: "7001001", requested_by_name: cs.full_name, requested_at: now, created_date: now, updated_date: now, tags: [], ...extra,
});
const salesClose = tx(s1, { bonus_credit: "sales_close", sales_close: { invoice_id: "inv-1", invoice_number: "IN-0001", course: "COURSE 1 (WITH CREDIT)" } });
const financeApproved = tx(s2, { amount_usd: 1000, finance_approval: { state: "decided", decision: "approved" }, tags: ["Bonus Product"] });
const withFinance = tx(s2, { finance_approval: { state: "sent" } });
const neverWentToFinance = tx(s2, {});
const approvedNow = tx(s1, { status: "APPROVED", approved_at: now, approved_by_name: broker.full_name, transaction_id: "TX-1" });
const rejectedNow = tx(s1, { status: "REJECTED", approved_at: now, approved_by_name: broker.full_name, rejection_reason: "Wrong account" });
const approvedLastMonth = tx(s1, { status: "APPROVED", approved_at: lastMonth });
const deposit = tx(s1, { type: "DEPOSIT" });
await db.collection("funding_transactions").insertMany([salesClose, financeApproved, withFinance, neverWentToFinance, approvedNow, rejectedNow, approvedLastMonth, deposit] as any[]);
const tAdmin = await login(admin.email), tBroker = await login(broker.email), tFinance = await login(financeAdmin.email), tCs = await login(cs.email);
const list = (token: string) => call("POST", "/api/functions/getBonusApprovals", {}, token);
const ids = (rows: any[] | undefined) => (rows ?? []).map((r) => r.id).sort().join(",");

step("Case 1 — what a broker admin is asked to decide");
let r = await list(tBroker);
check("the list answers", r.status === 200, JSON.stringify(r.body).slice(0, 200));
check("pending: the sales-close bonus, the one finance approved, and one that never went to finance",
  ids(r.body.pending) === [salesClose, financeApproved, neverWentToFinance].map((t) => String(t._id)).sort().join(","), ids(r.body.pending));
check("…not the one finance still has — that one is only counted", !r.body.pending.some((t: any) => t.id === String(withFinance._id)) && r.body.counts?.with_finance === 1);
check("…nor a deposit", !r.body.pending.some((t: any) => t.id === String(deposit._id)));
check("this month's approved and rejected; last month's not", ids(r.body.approved) === String(approvedNow._id) && ids(r.body.rejected) === String(rejectedNow._id));
const sc = r.body.pending.find((t: any) => t.id === String(salesClose._id));
check("a row: where it came from, its course, the student's CS and welcome", sc?.source === "sales_close" && sc?.course === "COURSE 1 (WITH CREDIT)"
  && sc?.student?.cs === cs.full_name && sc?.student?.onboarded === true && sc?.student?.team === "Team Asha", JSON.stringify(sc));
check("…a bonus request reads as one", r.body.pending.find((t: any) => t.id === String(financeApproved._id))?.source === "request");
check("counts", r.body.counts?.pending === 3 && r.body.counts?.approved === 1 && r.body.counts?.rejected === 1, JSON.stringify(r.body.counts));

step("Case 1 — deciding, as the page does");
r = await call("PATCH", `/api/entities/FundingTransaction/${salesClose._id}`, { status: "APPROVED", transaction_id: "TX-SC-1", approved_by_name: broker.full_name, approved_at: new Date().toISOString() }, tBroker);
check("the broker admin approves the sales-close bonus", r.status === 200, JSON.stringify(r.body));
r = await call("PATCH", `/api/entities/FundingTransaction/${financeApproved._id}`, { status: "REJECTED", rejection_reason: "Receipt unreadable", approved_by_name: broker.full_name, approved_at: new Date().toISOString() }, tBroker);
check("…and rejects the bonus request", r.status === 200, JSON.stringify(r.body));
r = await list(tBroker);
check("off pending, onto approved and rejected, newest first", !r.body.pending.some((t: any) => t.id === String(salesClose._id))
  && r.body.approved[0]?.id === String(salesClose._id) && r.body.rejected[0]?.id === String(financeApproved._id) && r.body.rejected[0]?.rejection_reason === "Receipt unreadable",
  JSON.stringify({ a: r.body.approved?.map((t: any) => t.id), rj: r.body.rejected?.map((t: any) => t.id) }));
r = await call("PATCH", `/api/entities/FundingTransaction/${withFinance._id}`, { status: "APPROVED" }, tBroker);
check("Case 3 — one finance still has can't be decided here: 409", r.status === 409, `${r.status}`);

step("Case 4 — who may see it");
r = await list(tAdmin);
check("a Super Admin may", r.status === 200 && r.body.counts?.pending === 1);
r = await list(tFinance);
check("a finance admin may not: 403", r.status === 403, `${r.status}`);
r = await list(tCs);
check("a CS may not: 403", r.status === 403);
r = await call("POST", "/api/functions/getBonusApprovals", {});
check("no token: 401", r.status === 401);
r = await call("PATCH", `/api/entities/FundingTransaction/${neverWentToFinance._id}`, { status: "APPROVED" }, tFinance);
check("a finance admin can't decide a bonus either: 403", r.status === 403, `${r.status}`);

step("The sidebar's count");
r = await call("POST", "/api/functions/getNavCounts", {}, tBroker);
check("a broker admin: the bonuses waiting for them", r.status === 200 && r.body.bonus_approvals_pending === 1, JSON.stringify(r.body));
r = await call("POST", "/api/functions/getNavCounts", {}, tCs);
check("a CS: none", r.status === 200 && r.body.bonus_approvals_pending === 0);

console.log(`\n${pass}/${pass + fail} checks passed`);
await client.close();
process.exit(fail ? 1 : 0);
