/**
 * The CS commission Delta finance pays (2026-11-03), against a scratch database and the real API
 * (run by test-cs-commission-finance.sh):
 *
 *   1. finance's secret only; a bad kind or period refused;
 *   2. a bonus month: each staff member's credits counted as Bonus Closing counts them (pool accruals, deposits and
 *      another month left out), their location (a Bangalore team's) and email, where their approval has got;
 *   3. finance's approval: refused until Broker and Academic head have approved; then the credits released here,
 *      recorded as Delta finance's; again → "already"; one a Super Admin released here → "already", not finance's
 *      to take back; a period still open refused;
 *   4. taken back: back with finance, only those credits unreleased; approved again;
 *   5. the CS Portal's own Finance button: a finance admin refused (it's finance's now), a Super Admin still may.
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
const SECRET = process.env.FINANCE_S2S_SECRET ?? "";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
type Res = { status: number; body: any };
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const r = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const show = (r: Res) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
const asFinance = { "x-finance-secret": SECRET };
const list = (kind: string, period: string) => call("POST", "/api/v1/integrations/finance/cs-commission", { kind, period }, asFinance);
const approve = (recipient_id: string, period = "2026-09", kind = "bonus") =>
  call("POST", "/api/v1/integrations/finance/cs-commission/approve", { kind, period, recipient_id, by: "Mona Manager" }, asFinance);
const unapprove = (recipient_id: string, period = "2026-09", kind = "bonus") =>
  call("POST", "/api/v1/integrations/finance/cs-commission/unapprove", { kind, period, recipient_id, by: "Mona Manager" }, asFinance);

const client = await MongoClient.connect(uri);
const db = client.db(dbName);
await db.dropDatabase();
const hash = await bcrypt.hash("Password123!", 10);
const now = new Date().toISOString();
const person = (full_name: string, app_role: string, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), email: `${full_name.toLowerCase().replace(/\s+/g, ".")}@E2E-CSC.test`, full_name, app_role,
  password_hash: hash, created_date: now, updated_date: now, ...extra,
});
// Signing in matches the email exactly: the two who sign in are stored in small letters.
const admin = person("Super Admin", "super_admin", { email: "super.admin@e2e-csc.test" });
const financeAdmin = person("Finance Fay", "finance_admin", { email: "finance.fay@e2e-csc.test" });
const chief = person("Chief Cara", "chief_mentor", { team_name: "Team Cara" });
const csA = person("Mentor Meera", "junior_mentor", { up_head_id: String(chief._id), up_head_name: chief.full_name });
const blrChief = person("Chief Bala", "chief_mentor", { team_name: "Team Bala", team_location: "bangalore" });
const csB = person("Mentor Bindu", "junior_mentor", { up_head_id: String(blrChief._id), up_head_name: blrChief.full_name });
await db.collection("users").insertMany([admin, financeAdmin, chief, csA, blrChief, csB]);

const credit = (who: any, method: string, usd: number, day: string, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), recipient_id: String(who._id), recipient_name: who.full_name, method, commission_usd: usd, base_amount: usd * 10,
  level: 1, position: "Junior", percentage: 10, student_name: "Student", txn_id: `TX-${usd}`, initiator_name: who.full_name,
  requested_at: `${day}T10:00:00.000Z`, created_date: `${day}T10:00:00.000Z`, status: "accrued", is_pool: false, ...extra,
});
const A1 = credit(csA, "bonus_with", 100, "2026-09-05"), A2 = credit(csA, "bonus_without", 50.5, "2026-09-20");
const B1 = credit(csB, "bonus_with", 40, "2026-09-10");
await db.collection("commission_credits").insertMany([
  A1, A2, B1,
  credit(csA, "bonus_with", 999, "2026-09-12", { is_pool: true, status: "pooled", pool_group_id: String(chief._id) }),
  credit(csA, "deposit", 70, "2026-09-15"),
  credit(csA, "bonus_with", 33, "2026-10-02"),
]);
const approvals = db.collection("commission_period_approvals");
const approval = (who: any, overall_status: string, extra: Record<string, unknown> = {}) => ({
  kind: "bonus", period: "2026-09", recipient_id: String(who._id), recipient_name: who.full_name, overall_status,
  broker_admin_approval_status: "pending", academic_head_approval_status: "pending", finance_admin_approval_status: "pending",
  created_date: now, updated_date: now, ...extra,
});
await approvals.insertOne(approval(csA, "pending_broker_approval"));
const creditsOf = async (who: any) => db.collection("commission_credits").find({ recipient_id: String(who._id), method: { $in: ["bonus_with", "bonus_without"] }, is_pool: false }).toArray();

step("1. Finance's secret only");
check("no secret, a wrong one: refused", (await call("POST", "/api/v1/integrations/finance/cs-commission", { kind: "bonus", period: "2026-09" })).status === 401
  && (await call("POST", "/api/v1/integrations/finance/cs-commission", { kind: "bonus", period: "2026-09" }, { "x-finance-secret": "wrong" })).status === 401);
check("a kind or period that isn't one: refused", (await list("salary", "2026-09")).status === 400 && (await list("bonus", "2026-Q3")).status === 400
  && (await list("deposit", "2026-09")).status === 400);

step("2. A bonus month");
let r = await list("bonus", "2026-09");
const row = (who: any) => r.body?.data?.people?.find((p: any) => p.recipient_id === String(who._id));
check("September's bonus commission: Meera 150.50 from her two credits — not the pool's 999, the deposit or October's",
  r.status === 200 && row(csA)?.total_usd === 150.5 && row(csA).credits.length === 2 && row(csA).credits.every((c: any) => c.method.startsWith("bonus")), show(r));
check("…her email in small letters, Dubai; Bindu 40, Bangalore (her team's)", row(csA).email === "mentor.meera@e2e-csc.test" && row(csA).location === "dubai"
  && row(csB)?.total_usd === 40 && row(csB).location === "bangalore", JSON.stringify([row(csA)?.location, row(csB)?.location]));
check("…where each approval has got: Meera with the broker, Bindu not started; the month over", row(csA).approval.overall_status === "pending_broker_approval"
  && row(csB).approval.overall_status === "pending_broker_approval" && r.body.data.ended === true);
const dep = await list("deposit", "2026-Q3");
check("the deposit quarter: only Meera's deposit credit", dep.body?.data?.people?.length === 1 && dep.body.data.people[0].total_usd === 70, show(dep));

step("3. Finance's approval");
r = await approve(String(csA._id));
check("still with the broker: refused, saying who it waits for", r.status === 409 && /broker admin/.test(r.body?.error?.message ?? ""), show(r));
await approvals.updateOne({ recipient_id: String(csA._id) }, { $set: { overall_status: "pending_academic_approval", broker_admin_approval_status: "approved" } });
r = await approve(String(csA._id));
check("with the academic head: refused", r.status === 409 && /academic head/.test(r.body?.error?.message ?? ""), show(r));
await approvals.updateOne({ recipient_id: String(csA._id) }, { $set: { overall_status: "pending_finance_approval", academic_head_approval_status: "approved" } });
r = await approve(String(csA._id));
const relA = await approvals.findOne({ recipient_id: String(csA._id) });
check("with finance: approved — 150.50, her two credits, her email and location", r.status === 200 && r.body.data.already === false && r.body.data.total_usd === 150.5
  && r.body.data.credit_ids.length === 2 && r.body.data.email === "mentor.meera@e2e-csc.test" && r.body.data.location === "dubai", show(r));
check("…released here, as Delta finance's", relA?.overall_status === "released" && relA.released_by_id === "delta-finance" && /Mona Manager \(Delta finance\)/.test(relA.released_by_name)
  && relA.finance_admin_approval_status === "approved");
const credA = await creditsOf(csA);
const sept = credA.filter((c) => String(c.requested_at).startsWith("2026-09"));
const oct = credA.find((c) => String(c.requested_at).startsWith("2026-10"));
check("…her September credits released; October's not", sept.every((c) => c.status === "released" && c.released_by_id === "delta-finance") && oct?.status === "accrued");
const pool = await db.collection("commission_credits").findOne({ recipient_id: String(csA._id), is_pool: true });
check("…her pool accrual left in the pool, for its distribution", pool?.status === "pooled", String(pool?.status));
r = await approve(String(csA._id));
check("approved again: already, the same figure", r.status === 200 && r.body.data.already === true && r.body.data.total_usd === 150.5, show(r));
await approvals.insertOne(approval(csB, "released", { released_by_id: String(admin._id), released_by_name: "Super Admin", finance_admin_approval_status: "approved" }));
r = await approve(String(csB._id));
check("Bindu, released by a Super Admin here: already — finance pays it", r.status === 200 && r.body.data.already === true && r.body.data.total_usd === 40 && r.body.data.location === "bangalore", show(r));
r = await unapprove(String(csB._id));
check("…and not finance's to take back", r.status === 409 && r.body?.error?.code === "NOT_FINANCES", show(r));
r = await approve(String(csA._id), "2099-01");
check("a month still open: refused", r.status === 409 && r.body?.error?.code === "PERIOD_OPEN", show(r));

step("4. Taken back");
r = await unapprove(String(csA._id));
const backA = await approvals.findOne({ recipient_id: String(csA._id) });
const credBack = (await creditsOf(csA)).filter((c) => String(c.requested_at).startsWith("2026-09"));
check("back with finance, her two credits accrued again", r.status === 200 && r.body.data.undone === true && r.body.data.credits === 2
  && backA?.overall_status === "pending_finance_approval" && !backA.released_by_id && credBack.every((c) => c.status === "accrued" && !c.released_by_id), show(r));
check("taken back again: nothing to do", (await unapprove(String(csA._id))).body?.data?.undone === false);
r = await approve(String(csA._id));
check("approved again: released", r.status === 200 && r.body.data.already === false, show(r));

step("5. The CS Portal's own Finance button");
const login = async (u: any) => (await call("POST", "/api/auth/login", { email: u.email.toLowerCase(), password: "Password123!" })).body?.token as string;
await approvals.updateOne({ recipient_id: String(csA._id) }, { $set: { overall_status: "pending_finance_approval" } });
const fin = await call("POST", "/api/functions/approveCommissionPeriod", { kind: "bonus", period: "2026-09", recipient_id: String(csA._id), action: "approve" }, { authorization: `Bearer ${await login(financeAdmin)}` });
check("a finance admin: refused — it's approved in Delta finance", fin.status === 403 && /Delta finance/.test(JSON.stringify(fin.body)), show(fin));
const sup = await call("POST", "/api/functions/approveCommissionPeriod", { kind: "bonus", period: "2026-09", recipient_id: String(csA._id), action: "approve" }, { authorization: `Bearer ${await login(admin)}` });
check("a Super Admin: still may", sup.status === 200 && sup.body?.overall_status === "released", show(sup));

await client.close();
console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${pass}/${pass + fail} checks passed\x1b[0m`);
process.exit(fail ? 1 : 0);
