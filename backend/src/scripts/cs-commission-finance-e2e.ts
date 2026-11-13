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
 *   5. the CS Portal's own Finance button: a finance admin refused (it's finance's now), a Super Admin still may;
 *   6. the Senior/Junior pools (2026-11-07): each member's share of a pool not split yet listed (a member with nothing
 *      else too), approving one splits the pools they're in first; finance's Split; the Distribute button the same.
 *   7. counting stopped, and additions / deductions (2026-11-13): finance stops someone with a reason — a new credit
 *      skips them, as the initiator and as an up-line, the others still get theirs; resumed, credited again; a month
 *      still running approved only for someone stopped; an amount added or deducted is listed (someone with nothing
 *      else too), comes back with the approval, is fixed once released; a stopped pool member keeps what their position
 *      put into the pool before the stop — listed, paid out on its own when they are approved (the rest left pooled),
 *      never twice — and what is written for them while stopped goes to nobody, still after they are resumed (then a
 *      member like any other, paid what was written outside the stop); the person's own Commission report shows the
 *      stop and the amounts.
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
  requested_at: `${day}T10:00:00.000Z`, created_date: `${day}T10:00:00.000Z`, status: "accrued", is_pool: false, transaction_id: `FT-${who.full_name}-${usd}`, ...extra,
});
const A1 = credit(csA, "bonus_with", 100, "2026-09-05"), A2 = credit(csA, "bonus_without", 50.5, "2026-09-20");
const B1 = credit(csB, "bonus_with", 40, "2026-09-10");
await db.collection("commission_credits").insertMany([
  A1, A2, B1,
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
check("September's bonus commission: Meera 150.50 from her two credits — not the deposit or October's; no pool",
  r.status === 200 && row(csA)?.total_usd === 150.5 && row(csA).credits.length === 2 && row(csA).credits.every((c: any) => c.method.startsWith("bonus"))
  && row(csA).pool_usd === 0 && row(csA).pool.length === 0 && r.body.data.pools.length === 0, show(r));
check("…each credit names the funding request it came from", row(csA).credits.every((c: any) => /^FT-Mentor Meera-/.test(c.funding_id)), JSON.stringify(row(csA).credits.map((c: any) => c.funding_id)));
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

step("4b. Paid by Delta finance before the broker admin and academic head (2026-11-06)");
const csC = person("Mentor Chitra", "junior_mentor", { up_head_id: String(chief._id), up_head_name: chief.full_name });
await db.collection("users").insertOne(csC);
await db.collection("commission_credits").insertMany([credit(csC, "bonus_with", 80, "2026-09-08"), credit(csC, "bonus_without", 20, "2026-09-18")]);
const force = (recipient_id: string, reason?: string) =>
  call("POST", "/api/v1/integrations/finance/cs-commission/approve", { kind: "bonus", period: "2026-09", recipient_id, by: "Mona Manager", force: true, ...(reason !== undefined ? { reason } : {}) }, asFinance);
r = await approve(String(csC._id));
check("no approvals here yet: refused without force", r.status === 409 && r.body?.error?.code === "NOT_READY", show(r));
r = await force(String(csC._id));
check("…with force but no reason: refused, asking why", r.status === 400 && /Say why/.test(r.body?.error?.message ?? ""), show(r));
check("…nothing written for her yet", !(await approvals.findOne({ recipient_id: String(csC._id) })));
r = await force(String(csC._id), "Leaving this week, paid with her final settlement");
const relC = await approvals.findOne({ recipient_id: String(csC._id) });
check("with a reason: released as finance's — 100, her two credits, said to be early", r.status === 200 && r.body.data.already === false && r.body.data.total_usd === 100 && r.body.data.credit_ids.length === 2
  && r.body.data.finance_override === true, show(r));
check("…the release says so, and why; the broker admin and academic head still pending",
  relC?.overall_status === "released" && relC.finance_override === true && relC.finance_override_from === "pending_broker_approval"
  && /before the CS Portal's approvals: Leaving this week/.test(relC.released_by_name) && relC.broker_admin_approval_status === "pending" && relC.academic_head_approval_status === "pending",
  JSON.stringify(relC));
check("…her credits released, with the reason on them", (await creditsOf(csC)).every((c) => c.status === "released" && /Leaving this week/.test(String(c.released_by_name))));
r = await list("bonus", "2026-09");
check("…finance's list shows it overridden, with the reason", row(csC)?.approval.finance_override === true && /Leaving this week/.test(row(csC).approval.override_reason) && row(csC).approval.by_finance === true, JSON.stringify(row(csC)?.approval));
r = await force(String(csC._id), "Again");
check("forced again: already", r.status === 200 && r.body.data.already === true);
r = await unapprove(String(csC._id));
const backC = await approvals.findOne({ recipient_id: String(csC._id) });
check("taken back: where it waited — with the broker admin — credits accrued, no trace of the override",
  r.status === 200 && r.body.data.overall_status === "pending_broker_approval" && backC?.overall_status === "pending_broker_approval" && !backC.finance_override && !backC.released_by_id
  && (await creditsOf(csC)).every((c) => c.status === "accrued" && !c.released_by_id), JSON.stringify(backC));
await approvals.updateOne({ recipient_id: String(csC._id) }, { $set: { overall_status: "pending_academic_approval", broker_admin_approval_status: "approved" } });
await force(String(csC._id), "Paid early");
r = await unapprove(String(csC._id));
check("forced from the academic head: back to the academic head", r.body?.data?.overall_status === "pending_academic_approval", show(r));
await approvals.updateOne({ recipient_id: String(csC._id) }, { $set: { overall_status: "rejected" } });
check("a rejected one: refused even with force", (await force(String(csC._id), "Pay anyway")).body?.error?.code === "REJECTED");

step("5. The CS Portal's own Finance button");
const login = async (u: any) => (await call("POST", "/api/auth/login", { email: u.email.toLowerCase(), password: "Password123!" })).body?.token as string;
await approvals.updateOne({ recipient_id: String(csA._id) }, { $set: { overall_status: "pending_finance_approval" } });
const fin = await call("POST", "/api/functions/approveCommissionPeriod", { kind: "bonus", period: "2026-09", recipient_id: String(csA._id), action: "approve" }, { authorization: `Bearer ${await login(financeAdmin)}` });
check("a finance admin: refused — it's approved in Delta finance", fin.status === 403 && /Delta finance/.test(JSON.stringify(fin.body)), show(fin));
const sup = await call("POST", "/api/functions/approveCommissionPeriod", { kind: "bonus", period: "2026-09", recipient_id: String(csA._id), action: "approve" }, { authorization: `Bearer ${await login(admin)}` });
check("a Super Admin: still may", sup.status === 200 && sup.body?.overall_status === "released", show(sup));

step("6. The Senior/Junior pools (2026-11-07)");
const sam = person("Senior Sam", "senior_mentor", { up_head_id: String(chief._id), up_head_name: chief.full_name });
const jay = person("Junior Jay", "junior_mentor", { up_head_id: String(sam._id), up_head_name: sam.full_name });
await db.collection("users").insertMany([sam, jay]);
const pooled = (who: any, method: string, usd: number, day: string) =>
  credit(who, method, usd, day, { is_pool: true, status: "pooled", pool_group_id: String(chief._id), pool_group_name: "Chief Cara SEN/JUN POOL", position: who === sam ? "Senior" : "Junior" });
await db.collection("commission_credits").insertMany([
  credit(jay, "bonus_with", 20, "2026-08-03"),
  pooled(jay, "bonus_with", 10, "2026-08-05"), pooled(sam, "bonus_with", 5, "2026-08-05"),
  pooled(jay, "bonus_without", 10, "2026-08-07"), pooled(sam, "bonus_without", 5, "2026-08-07"),
  pooled(jay, "bonus_with", 10, "2026-07-09"), pooled(sam, "bonus_with", 5, "2026-07-09"),
  pooled(jay, "deposit", 6, "2026-05-02"), pooled(sam, "deposit", 4, "2026-05-02"),
]);
r = await list("bonus", "2026-08");
check("August: Jay — 20 of his own and 20 from the pools (his own 10 in each, by own share), two members; his pools and their accruals listed",
  row(jay)?.total_usd === 20 && row(jay).pool_usd === 20 && row(jay).pool.length === 2 && row(jay).pool.every((g: any) => g.share_usd === 10 && g.members.length === 2 && g.credits.length === 2
    && g.members.some((m: any) => m.name === "Senior Sam" && m.share_usd === 5)),
  JSON.stringify(row(jay)));
check("…Sam, with nothing of his own, listed too — his 10 from the pools (5 in each)", row(sam)?.total_usd === 0 && row(sam).credits.length === 0 && row(sam).pool_usd === 10 && row(sam).name === "Senior Sam",
  JSON.stringify(row(sam)));
check("…the pools themselves: two (with / without MT5), Chief Cara's, 15 each, members located with their own shares (10 / 5)",
  r.body.data.pools.length === 2 && r.body.data.pools.every((g: any) => g.total_usd === 15 && g.group_name === "Chief Cara SEN/JUN POOL" && g.members.every((m: any) => m.location === "dubai")
    && g.members.map((m: any) => m.share_usd).sort().join(",") === "10,5"),
  JSON.stringify(r.body.data.pools));
const split = (body: Record<string, unknown>) => call("POST", "/api/v1/integrations/finance/cs-commission/split-pool", { kind: "bonus", by: "Mona Manager", ...body }, asFinance);
r = await split({ period: "2099-01" });
check("a month still running: its pools not split", r.status === 409 && r.body?.error?.code === "PERIOD_OPEN", show(r));
r = await call("POST", "/api/v1/integrations/finance/cs-commission/approve",
  { kind: "bonus", period: "2026-08", recipient_id: String(jay._id), by: "Mona Manager", force: true, reason: "Paid with his settlement" }, asFinance);
check("Jay approved (early, with a reason): his pools split first — 20 + 10 + 10 = 40, three credits", r.status === 200 && r.body.data.total_usd === 40 && r.body.data.credit_ids.length === 3, show(r));
const samShares = await db.collection("commission_credits").find({ recipient_id: String(sam._id), from_pool: true, pool_period: "2026-08" }).toArray();
check("…Sam has his two shares now (his own 5 each), his own to approve (accrued, not released)", samShares.length === 2 && samShares.every((c) => c.commission_usd === 5 && c.status === "accrued"),
  JSON.stringify(samShares.map((c) => [c.commission_usd, c.status])));
const aug = await db.collection("commission_credits").find({ is_pool: true, requested_at: { $regex: "^2026-08" } }).toArray();
check("…the August accruals marked distributed, by Delta finance", aug.length === 4 && aug.every((c) => c.status === "distributed" && c.distributed_by_id === "delta-finance"));
r = await list("bonus", "2026-08");
check("…the list: no pools left; Sam 10 of his own", r.body.data.pools.length === 0 && row(sam)?.total_usd === 10 && row(sam).pool_usd === 0 && row(jay)?.pool_usd === 0, show(r));
await db.collection("commission_credits").insertMany([pooled(jay, "bonus_without", 4, "2026-07-11"), pooled(sam, "bonus_without", 2, "2026-07-11")]);
r = await split({ period: "2026-07", pool_group_id: String(chief._id), method: "bonus_with" });
check("finance's Split, July's Bonus-with-MT5 pool: 15 between two, each their own (10 / 5)", r.status === 200 && r.body.data.split.length === 1 && r.body.data.split[0].pool_total === 15
  && r.body.data.split[0].members === 2 && r.body.data.split[0].shares.map((x: any) => x.share_usd).sort().join(",") === "10,5" && r.body.data.split[0].method === "bonus_with", show(r));
r = await list("bonus", "2026-07");
check("…only that one: the Bonus-without pool still to split; the shares marked as from the pool", r.body.data.pools.length === 1 && r.body.data.pools[0].method === "bonus_without"
  && row(sam)?.credits.length === 1 && row(sam).credits[0].from_pool === true && row(sam).credits[0].amount_usd === 5 && row(sam).pool_usd === 2, show(r));
r = await split({ period: "2026-07", pool_group_id: String(chief._id) });
check("…the group without a method: what is left of it split", r.status === 200 && r.body.data.split.length === 1 && r.body.data.split[0].method === "bonus_without", show(r));
r = await split({ period: "2026-07", pool_group_id: String(chief._id) });
check("…split again: nothing left to split", r.status === 200 && r.body.data.split.length === 0, show(r));
const adminToken = await login(admin);
const dist = (body: Record<string, unknown>) => call("POST", "/api/functions/distributeDepositPool", body, { authorization: `Bearer ${adminToken}` });
r = await dist({ pool_group_id: String(chief._id), period: "2026-Q2", method: "deposit" });
check("the CS Portal's Distribute, Q2's deposit pool: 10 between two, each their own (6 / 4)", r.status === 200 && r.body?.pool_total === 10 && r.body.members === 2
  && r.body.breakdown.map((b: any) => b.share).sort().join(",") === "4,6" && r.body.distributed === 2, show(r));
r = await dist({ pool_group_id: String(chief._id), period: "2026-Q2", method: "deposit" });
check("…again: nothing pooled", r.status === 200 && r.body?.distributed === 0, show(r));

step("7. Counting stopped, and additions / deductions (2026-11-13)");
const post = (path: string, body: Record<string, unknown>, headers: Record<string, string> = asFinance) =>
  call("POST", `/api/v1/integrations/finance/cs-commission/${path}`, { by: "Mona Manager", ...body }, headers);
// A plan paid step by step: Level 1 the one who raised it (2%), Level 2 their Up Head (1%).
const plan = { _id: new ObjectId(), name: "Step plan", active: true, bonus_with_levels: [{ label: "Level 1", percentage: 2 }, { label: "Level 2", percentage: 1 }] };
await db.collection("commission_plans").insertOne(plan as any);
const onPlan = { commission_plan_id: String(plan._id) };
const hugo = person("Head Hugo", "chief_mentor", onPlan);
const stella = person("Staff Stella", "cs", { ...onPlan, email: "staff.stella@e2e-csc.test", up_head_id: String(hugo._id), up_head_name: hugo.full_name });
const tara = person("Staff Tara", "cs", { ...onPlan, up_head_id: String(stella._id), up_head_name: stella.full_name });
const esha = person("Mentor Esha", "junior_mentor", { up_head_id: String(chief._id), up_head_name: chief.full_name });
await db.collection("users").insertMany([hugo, stella, tara, esha]);
const stops = db.collection("commission_stops");
const today = new Date();
const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
// A bonus of 1,000 approved now, credited as an approval credits it: who got what.
const bonus = async (by: any) => {
  const _id = new ObjectId();
  await db.collection("funding_transactions").insertOne({ _id, type: "BONUS", status: "APPROVED", amount_usd: 1000, initiating_mentor_id: String(by._id),
    initiating_mentor_name: by.full_name, student_name: "Student", requested_at: new Date().toISOString() } as any);
  const res = await call("POST", "/api/functions/creditCommission", { transaction_id: String(_id) }, { authorization: `Bearer ${adminToken}` });
  const made = await db.collection("commission_credits").find({ transaction_id: String(_id) }).sort({ level: 1 }).toArray();
  return { res, tx: await db.collection("funding_transactions").findOne({ _id }), got: made.map((c) => `L${c.level} ${c.recipient_name} ${c.commission_usd}`).join(", ") };
};

check("finance's secret only", (await post("stop", { recipient_id: String(stella._id), reason: "Under review" }, {})).status === 401
  && (await post("resume", { recipient_id: String(stella._id) }, {})).status === 401
  && (await post("adjustments/add", { kind: "bonus", period: thisMonth, recipient_id: String(stella._id), type: "addition", amount_minor: 100, currency: "AED", reason: "Extra" }, {})).status === 401
  && (await post("adjustments/remove", { id: String(new ObjectId()) }, {})).status === 401);
r = await post("stop", { recipient_id: String(stella._id) });
const short = await post("stop", { recipient_id: String(stella._id), reason: "no" });
check("a stop with no reason, or one under 3 characters: refused", r.status === 400 && short.status === 400 && !(await stops.countDocuments({})), show(r));
r = await post("stop", { recipient_id: String(new ObjectId()), reason: "Under review" });
check("…somebody unknown: 404", r.status === 404 && r.body?.error?.code === "NOT_FOUND", show(r));
let b = await bonus(stella);
check("before any stop: Stella 20, her Up Head Hugo 10", b.got === "L1 Staff Stella 20, L2 Head Hugo 10" && !b.tx?.commission_stopped, b.got);
r = await post("stop", { recipient_id: String(stella._id), reason: "Under review until the audit ends" });
const stoppedAt = r.body?.data?.stopped?.at;
check("Stella stopped: when, by whom, why", r.status === 200 && !isNaN(Date.parse(stoppedAt)) && r.body.data.stopped.by === "Mona Manager"
  && r.body.data.stopped.reason === "Under review until the audit ends" && r.body.data.already === undefined, show(r));
r = await post("stop", { recipient_id: String(stella._id), reason: "Pressed twice" });
const stopRows = await stops.find({ recipient_id: String(stella._id) }).toArray();
check("…stopped again: already, the stop that holds — no second one written", r.status === 200 && r.body.data.already === true && r.body.data.stopped.at === stoppedAt
  && r.body.data.stopped.reason === "Under review until the audit ends" && stopRows.length === 1 && stopRows[0].resumed_at === null && stopRows[0].resumed_by === "", show(r));
b = await bonus(stella);
check("a bonus she raises now: nothing for her — Hugo still gets his 10, and no more", b.got === "L2 Head Hugo 10" && b.res.body?.credited === 1, `${b.got} ${show(b.res)}`);
check("…the request keeps who was left out and what they would have had", b.tx?.commission_stopped?.length === 1 && b.tx.commission_stopped[0].recipient_id === String(stella._id)
  && b.tx.commission_stopped[0].commission_usd === 20, JSON.stringify(b.tx?.commission_stopped));
b = await bonus(tara);
check("a bonus Tara raises, Stella her Up Head: Tara her 20, Stella nothing as the up-line", b.got === "L1 Staff Tara 20", b.got);

const addAdj = (who: any, period: string, extra: Record<string, unknown> = {}, kind = "bonus") =>
  post("adjustments/add", { kind, period, recipient_id: String(who._id), type: "addition", amount_minor: 50000, currency: "AED", reason: "Festival allowance", ...extra });
const bad = await Promise.all([
  addAdj(stella, thisMonth, { type: "bonus" }), addAdj(stella, thisMonth, { amount_minor: 0 }), addAdj(stella, thisMonth, { amount_minor: 10.5 }),
  addAdj(stella, thisMonth, { amount_minor: 100_000_001 }), addAdj(stella, thisMonth, { amount_minor: "500" }), addAdj(stella, thisMonth, { currency: "USD" }),
  addAdj(stella, thisMonth, { reason: "x" }), addAdj(stella, "2026-Q4"), addAdj({ _id: "" }, thisMonth),
]);
check("an adjustment with a bad type, amount (0, 10.5, over 100,000,000, text), currency, reason, period or nobody: refused",
  bad.every((x) => x.status === 400 && x.body?.error?.code === "VALIDATION_ERROR") && !(await db.collection("commission_adjustments").countDocuments({})), bad.map((x) => x.status).join(","));
r = await addAdj(stella, thisMonth);
const adj1 = r.body?.data?.adjustment;
check("AED 500.00 added to Stella's running month: answered as stored", r.status === 200 && /^[0-9a-f]{24}$/.test(adj1?.id ?? "") && adj1.type === "addition" && adj1.amount_minor === 50000
  && adj1.currency === "AED" && adj1.reason === "Festival allowance" && adj1.by === "Mona Manager" && !isNaN(Date.parse(adj1.at)), show(r));
r = await list("bonus", thisMonth);
check("the running month's list: Hugo 20 from two credits, not stopped, no adjustments", r.body?.data?.ended === false && row(hugo)?.total_usd === 20 && row(hugo).credits.length === 2
  && row(hugo).stopped === null && Array.isArray(row(hugo).adjustments) && row(hugo).adjustments.length === 0, JSON.stringify(row(hugo)));
check("…Stella: her 20 from before the stop, the stop (when, by, why) and her adjustment", row(stella)?.total_usd === 20 && row(stella).stopped?.at === stoppedAt
  && row(stella).stopped.by === "Mona Manager" && /audit/.test(row(stella).stopped.reason) && row(stella).adjustments.length === 1 && row(stella).adjustments[0].id === adj1.id
  && Object.keys(row(stella).adjustments[0]).sort().join(",") === "amount_minor,at,by,currency,id,reason,type", JSON.stringify(row(stella)));
r = await addAdj(esha, "2026-09", { type: "deduction", amount_minor: 100_000_000, currency: "INR", reason: "Advance recovered" });
const adjEsha = r.body?.data?.adjustment;
r = await list("bonus", "2026-09");
check("someone with only an adjustment (the most allowed, in INR) is listed: 0, no credits", row(esha)?.total_usd === 0 && row(esha).credits.length === 0 && row(esha).pool_usd === 0
  && row(esha).name === "Mentor Esha" && row(esha).adjustments.length === 1 && row(esha).adjustments[0].type === "deduction" && row(esha).adjustments[0].amount_minor === 100_000_000
  && row(esha).adjustments[0].currency === "INR" && row(esha).stopped === null, JSON.stringify(row(esha)));
check("…and only in that month, of that kind", !(await list("bonus", "2026-08")).body.data.people.some((p: any) => p.recipient_id === String(esha._id))
  && !(await list("deposit", "2026-Q3")).body.data.people.some((p: any) => p.recipient_id === String(esha._id)));
r = await addAdj(csA, "2026-Q3", { reason: "Quarter top-up" }, "deposit");
check("a deposit quarter takes one too — Meera's Q3, not her (released) September", r.status === 200 && (await list("deposit", "2026-Q3")).body.data.people[0].adjustments.length === 1, show(r));
r = await addAdj(csA, "2026-09");
check("…her September, released: LOCKED — take the approval back first", r.status === 409 && r.body?.error?.code === "LOCKED" && /take the approval back first/.test(r.body.error.message), show(r));

r = await approve(String(stella._id), thisMonth);
check("Stella is stopped: her running month may be approved — as ever, not before the broker admin without force", r.status === 409 && r.body?.error?.code === "NOT_READY", show(r));
r = await approve(String(hugo._id), thisMonth);
check("Hugo is not: his running month refused — stop counting first", r.status === 409 && r.body?.error?.code === "PERIOD_OPEN" && /stop counting their commission first/.test(r.body.error.message), show(r));
r = await post("resume", { recipient_id: String(stella._id) });
const resumedRow = await stops.findOne({ recipient_id: String(stella._id) });
check("Stella resumed", r.status === 200 && r.body.data.resumed === true && !isNaN(Date.parse(resumedRow?.resumed_at)) && resumedRow?.resumed_by === "Mona Manager", show(r));
r = await post("resume", { recipient_id: String(stella._id) });
check("…resumed again: she was not stopped", r.status === 200 && r.body.data.resumed === false, show(r));
b = await bonus(stella);
check("a bonus she raises now: credited again — Stella 20, Hugo 10", b.got === "L1 Staff Stella 20, L2 Head Hugo 10" && !b.tx?.commission_stopped, b.got);
r = await call("POST", "/api/v1/integrations/finance/cs-commission/approve", { kind: "bonus", period: thisMonth, recipient_id: String(stella._id), by: "Mona Manager", force: true, reason: "Leaving" }, asFinance);
check("…and her running month refused again, even with force", r.status === 409 && r.body?.error?.code === "PERIOD_OPEN", show(r));
check("…nothing listed as stopped", (await list("bonus", thisMonth)).body.data.people.every((p: any) => p.stopped === null));
r = await post("stop", { recipient_id: String(stella._id), reason: "Leaving at the end of the week" });
const stoppedAgainAt = r.body?.data?.stopped?.at;
check("stopped once more: a new stop, the old one kept", r.status === 200 && r.body.data.already === undefined && (await stops.countDocuments({ recipient_id: String(stella._id) })) === 2, show(r));
r = await call("POST", "/api/v1/integrations/finance/cs-commission/approve", { kind: "bonus", period: thisMonth, recipient_id: String(stella._id), by: "Mona Manager", force: true, reason: "Paid with her settlement" }, asFinance);
check("her running month approved (early, with a reason): 40, two credits — with her adjustment and her stop", r.status === 200 && r.body.data.already === false && r.body.data.total_usd === 40
  && r.body.data.credit_ids.length === 2 && r.body.data.adjustments.length === 1 && r.body.data.adjustments[0].id === adj1.id && r.body.data.adjustments[0].amount_minor === 50000
  && r.body.data.stopped?.at === stoppedAgainAt && /Leaving/.test(r.body.data.stopped.reason), show(r));
r = await approve(String(csA._id));
check("…an approval of someone not stopped answers stopped null, adjustments none", r.status === 200 && r.body.data.stopped === null && Array.isArray(r.body.data.adjustments) && r.body.data.adjustments.length === 0, show(r));
r = await addAdj(stella, thisMonth, { type: "deduction", amount_minor: 1 });
const lockedRemove = await post("adjustments/remove", { id: adj1.id });
check("released: no more added, none taken off — LOCKED", r.status === 409 && r.body?.error?.code === "LOCKED" && lockedRemove.status === 409 && lockedRemove.body?.error?.code === "LOCKED", `${show(r)} ${show(lockedRemove)}`);
r = await unapprove(String(stella._id), thisMonth);
check("the approval taken back", r.status === 200 && r.body.data.undone === true, show(r));
r = await addAdj(stella, thisMonth, { type: "deduction", amount_minor: 12550, currency: "INR", reason: "Laptop damage" });
const adj2 = r.body?.data?.adjustment;
r = await post("adjustments/remove", { id: adj1.id });
const removedRow = await db.collection("commission_adjustments").findOne({ _id: new ObjectId(adj1.id) });
check("…then a deduction added and the addition taken off (kept, marked removed)", adj2?.type === "deduction" && r.status === 200 && r.body.data.removed === true
  && !isNaN(Date.parse(removedRow?.removed_at)) && removedRow?.removed_by === "Mona Manager", show(r));
check("…taken off again, or one that never was: 404", (await post("adjustments/remove", { id: adj1.id })).status === 404 && (await post("adjustments/remove", { id: String(new ObjectId()) })).status === 404
  && (await post("adjustments/remove", { id: "nonsense" })).status === 404);
r = await list("bonus", thisMonth);
check("…the list: only the deduction left", row(stella)?.adjustments.length === 1 && row(stella).adjustments[0].id === adj2.id && row(stella).adjustments[0].type === "deduction", JSON.stringify(row(stella)?.adjustments));

// A stopped member of a Senior/Junior pool ("stop counting from now"): what their position put in before the stop stays
// theirs; only what is written to the pool for them from the stop on goes to nobody.
const credits = db.collection("commission_credits");
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
// An accrual of the running month's pool, written at `written`.
const pooledNow = (who: any, usd: number, written: string) => ({ ...pooled(who, "bonus_with", usd, "2026-01-01"), requested_at: written, created_date: written });
// A past month's accrual written only now — its bonus credited late.
const pooledLate = (who: any, usd: number, day: string) => ({ ...pooled(who, "bonus_with", usd, day), created_date: new Date().toISOString() });
const poolShares = (who: any, period: string) => credits.find({ recipient_id: String(who._id), from_pool: true, pool_period: period }).toArray();
const accruals = (who: any, from: string, to: string) => credits.find({ recipient_id: String(who._id), is_pool: true, method: "bonus_with", requested_at: { $gte: from, $lt: to } }).sort({ commission_usd: -1 }).toArray();
const monthStart = minutesAgo(30), monthEnd = "9999";
const forceApprove = (who: any, period: string) =>
  call("POST", "/api/v1/integrations/finance/cs-commission/approve", { kind: "bonus", period, recipient_id: String(who._id), by: "Mona Manager", force: true, reason: "Paid with his settlement" }, asFinance);
await credits.insertMany([
  pooledNow(jay, 10, minutesAgo(5)), pooledNow(sam, 5, minutesAgo(5)),
  { ...credit(sam, "bonus_with", 7, "2026-01-01"), requested_at: minutesAgo(5), created_date: minutesAgo(5) },
]);
r = await post("stop", { recipient_id: String(sam._id), reason: "On notice" });
const samStoppedAt = r.body?.data?.stopped?.at;
await credits.insertMany([pooledNow(jay, 4, new Date().toISOString()), pooledNow(sam, 3, new Date().toISOString())]);
r = await list("bonus", thisMonth);
check("the running month's pool, Sam stopped part-way: his share is the 5 from before the stop — not 0, not 8; Jay's 14; the pool the whole 22",
  row(sam)?.total_usd === 7 && row(sam).pool_usd === 5 && row(sam).stopped?.at === samStoppedAt && row(sam).pool.length === 1 && row(sam).pool[0].total_usd === 22 && row(sam).pool[0].share_usd === 5
  && row(sam).pool[0].members.find((m: any) => m.name === "Senior Sam")?.share_usd === 5 && row(sam).pool[0].members.find((m: any) => m.name === "Junior Jay")?.share_usd === 14
  && row(jay)?.pool_usd === 14 && r.body.data.pools.length === 1 && r.body.data.pools[0].total_usd === 22
  && r.body.data.pools[0].members.map((m: any) => m.share_usd).sort((x: number, y: number) => x - y).join(",") === "5,14", JSON.stringify([row(sam), r.body?.data?.pools]));
r = await split({ period: thisMonth });
check("…the month still runs: its pool is not split, stop or no stop", r.status === 409 && r.body?.error?.code === "PERIOD_OPEN", show(r));
r = await forceApprove(sam, thisMonth);
let samPaid = await poolShares(sam, thisMonth);
let samRows = await accruals(sam, monthStart, monthEnd);
const jayRows = await accruals(jay, monthStart, monthEnd);
check("Sam approved in the running month: his own 7 and his 5 from the pool — 12, two credits", r.status === 200 && r.body.data.already === false && r.body.data.total_usd === 12
  && r.body.data.credit_ids.length === 2 && r.body.data.stopped?.at === samStoppedAt, show(r));
check("…the 5 paid out of the pool as his own credit, released by Delta finance", samPaid.length === 1 && samPaid[0].commission_usd === 5 && samPaid[0].status === "released"
  && samPaid[0].released_by_id === "delta-finance" && samPaid[0].is_pool === false && r.body.data.credit_ids.includes(String(samPaid[0]._id)), JSON.stringify(samPaid));
check("…only his accrual from before the stop taken out of the pool; the one after it (marked nobody's), and Jay's two, still pooled — nothing paid to Jay",
  samRows.length === 2 && samRows[0].commission_usd === 5 && samRows[0].status === "distributed" && samRows[0].distributed_by_id === "delta-finance" && !samRows[0].stopped_no_share
  && samRows[1].commission_usd === 3 && samRows[1].status === "pooled" && samRows[1].stopped_no_share === true
  && jayRows.length === 2 && jayRows.every((c) => c.status === "pooled" && !c.stopped_no_share)
  && !(await poolShares(jay, thisMonth)).length, JSON.stringify([samRows.map((c) => [c.commission_usd, c.status]), jayRows.map((c) => [c.commission_usd, c.status])]));
r = await list("bonus", thisMonth);
check("…the list: Sam 12 of his own, nothing more to come from the pool; Jay's 14 still to come; 17 left in it", row(sam)?.total_usd === 12 && row(sam).credits.some((c: any) => c.from_pool === true && c.amount_usd === 5)
  && row(sam).pool_usd === 0 && row(jay)?.pool_usd === 14 && r.body.data.pools[0].total_usd === 17, JSON.stringify([row(sam), r.body?.data?.pools]));
r = await forceApprove(sam, thisMonth);
check("approved again: already, 12 — no second pool share", r.status === 200 && r.body.data.already === true && r.body.data.total_usd === 12 && (await poolShares(sam, thisMonth)).length === 1, show(r));
r = await unapprove(String(sam._id), thisMonth);
samPaid = await poolShares(sam, thisMonth);
samRows = await accruals(sam, monthStart, monthEnd);
check("the approval taken back: both his credits accrued again — the pool share as any credit; it does not go back into the pool", r.status === 200 && r.body.data.undone === true && r.body.data.credits === 2
  && samPaid.length === 1 && samPaid[0].status === "accrued" && !samPaid[0].released_by_id && samRows[0].status === "distributed" && samRows[1].status === "pooled", show(r));
r = await forceApprove(sam, thisMonth);
check("…approved once more: 12 again, still the one pool share", r.status === 200 && r.body.data.already === false && r.body.data.total_usd === 12 && r.body.data.credit_ids.length === 2
  && (await poolShares(sam, thisMonth)).length === 1, show(r));

// A month that is over: Sam approved first, the pool split afterwards.
await credits.insertMany([pooled(jay, "bonus_with", 10, "2026-06-05"), pooled(sam, "bonus_with", 5, "2026-06-05"), pooledLate(sam, 3, "2026-06-20")]);
r = await list("bonus", "2026-06");
check("June's pool: Sam's share the 5 written before his stop, not the 3 written after; Jay's 10; the pool 18", row(sam)?.pool_usd === 5 && row(jay)?.pool_usd === 10 && r.body.data.pools[0].total_usd === 18, JSON.stringify([row(sam), row(jay)]));
r = await forceApprove(sam, "2026-06");
check("Sam approved: his 5 from the pool released; Jay's share left pooled", r.status === 200 && r.body.data.total_usd === 5 && r.body.data.credit_ids.length === 1
  && (await poolShares(sam, "2026-06")).length === 1 && !(await poolShares(jay, "2026-06")).length && (await accruals(jay, "2026-06", "2026-07"))[0].status === "pooled", show(r));
r = await split({ period: "2026-06" });
samPaid = await poolShares(sam, "2026-06");
samRows = await accruals(sam, "2026-06", "2026-07");
check("the split afterwards: Jay his 10 and nobody else — Sam's 3 from after the stop to nobody, his 5 not paid a second time",
  r.status === 200 && r.body.data.split.length === 1 && r.body.data.split[0].pool_total === 13 && r.body.data.split[0].members === 1 && r.body.data.split[0].shares.length === 1
  && r.body.data.split[0].shares[0].name === "Junior Jay" && r.body.data.split[0].shares[0].share_usd === 10 && r.body.data.split[0].stopped.length === 1
  && r.body.data.split[0].stopped[0].name === "Senior Sam" && r.body.data.split[0].stopped[0].share_usd === 3
  && samPaid.length === 1 && samPaid[0].commission_usd === 5 && samPaid[0].status === "released" && (await poolShares(jay, "2026-06")).length === 1, show(r));
check("…the pool is finished: every accrual distributed, only Sam's from after the stop marked as paying nobody", samRows.length === 2 && samRows.every((c) => c.status === "distributed")
  && !samRows[0].stopped_no_share && samRows[1].commission_usd === 3 && samRows[1].stopped_no_share === true && !(await accruals(jay, "2026-06", "2026-07"))[0].stopped_no_share,
  JSON.stringify(samRows.map((c) => [c.commission_usd, c.status, c.stopped_no_share])));
r = await split({ period: "2026-06" });
check("…split again: nothing left, nothing paid", r.status === 200 && r.body.data.split.length === 0 && (await poolShares(sam, "2026-06")).length === 1 && (await poolShares(jay, "2026-06")).length === 1, show(r));

// A split with no approval before it: the stopped member is paid what is his like anyone.
await credits.insertMany([pooled(jay, "bonus_with", 10, "2026-05-05"), pooled(sam, "bonus_with", 5, "2026-05-05"), pooledLate(sam, 3, "2026-05-20")]);
r = await dist({ pool_group_id: String(chief._id), period: "2026-05", method: "bonus_with" });
samPaid = await poolShares(sam, "2026-05");
samRows = await accruals(sam, "2026-05", "2026-06");
check("May's pool split by the CS Portal's Distribute: Jay 10, Sam the 5 from before his stop — his 3 from after it to nobody", r.status === 200 && r.body?.pool_total === 18 && r.body.members === 2
  && r.body.distributed === 2 && r.body.breakdown.map((x: any) => x.share).sort((x: number, y: number) => x - y).join(",") === "5,10"
  && samPaid.length === 1 && samPaid[0].commission_usd === 5 && samPaid[0].status === "accrued"
  && samRows.every((c) => c.status === "distributed") && !samRows[0].stopped_no_share && samRows[1].stopped_no_share === true, show(r));
r = await forceApprove(sam, "2026-05");
check("…approved afterwards: that 5, the one share — not paid again", r.status === 200 && r.body.data.total_usd === 5 && r.body.data.credit_ids.length === 1 && (await poolShares(sam, "2026-05")).length === 1, show(r));

// A pool holding nothing but what was written for a stopped member after the stop.
await credits.insertOne(pooledLate(sam, 2, "2026-04-10"));
r = await split({ period: "2026-04" });
const aprilPooled = () => credits.countDocuments({ is_pool: true, status: "pooled", method: "bonus_with", requested_at: { $regex: "^2026-04" } });
check("April's pool, only an accrual from after Sam's stop: left unsplit, nobody paid", r.status === 200 && r.body.data.split.length === 0 && (await aprilPooled()) === 1 && !(await poolShares(sam, "2026-04")).length, show(r));
r = await dist({ pool_group_id: String(chief._id), period: "2026-04", method: "bonus_with" });
check("…the CS Portal's Distribute the same, saying why", r.status === 200 && r.body?.distributed === 0 && /stopped/.test(r.body.reason ?? "") && (await aprilPooled()) === 1, show(r));
r = await list("bonus", "2026-04");
const noShare = await forceApprove(sam, "2026-04");
check("…listed with a share of 0, and nothing of his to approve", row(sam)?.pool_usd === 0 && row(sam).pool[0].total_usd === 2 && noShare.status === 409 && noShare.body?.error?.code === "NOTHING_TO_APPROVE"
  && (await aprilPooled()) === 1, `${JSON.stringify(row(sam))} ${show(noShare)}`);

// Resumed: what was written to a pool for him while he was stopped stays nobody's — as a credit left out is never made up.
const pause = () => new Promise((res) => setTimeout(res, 15));
await credits.insertMany([pooled(jay, "bonus_with", 10, "2026-03-05"), pooled(sam, "bonus_with", 5, "2026-03-05"), pooledLate(sam, 3, "2026-03-20")]);
await pause();
r = await post("resume", { recipient_id: String(sam._id) });
check("Sam resumed", r.status === 200 && r.body.data.resumed === true, show(r));
await pause();
await credits.insertOne(pooledLate(sam, 4, "2026-03-25"));
r = await list("bonus", "2026-03");
check("March's pool — 5 written before his stop, 3 during it, 4 after the resume: his share 9, not 12; Jay's 10; the pool the whole 22",
  row(sam)?.stopped === null && row(sam).pool_usd === 9 && row(sam).pool[0].total_usd === 22 && row(sam).pool[0].share_usd === 9
  && row(sam).pool[0].members.find((m: any) => m.name === "Senior Sam")?.share_usd === 9 && row(jay)?.pool_usd === 10
  && r.body.data.pools[0].members.map((m: any) => m.share_usd).sort((x: number, y: number) => x - y).join(",") === "9,10", JSON.stringify([row(sam), r.body?.data?.pools]));
r = await call("POST", "/api/functions/getCommissionReport", { period: "custom", from: "2026-03-01", to: "2026-03-31", cs: String(sam._id) }, { authorization: `Bearer ${adminToken}` });
check("…the Commission report the same: his pool share those two accruals, 9", r.status === 200 && r.body.people?.length === 1 && r.body.people[0].pool === 2 && r.body.people[0].pool_usd === 9
  && r.body.people[0].usd === 9, show(r));
r = await split({ period: "2026-03" });
samPaid = await poolShares(sam, "2026-03");
samRows = await accruals(sam, "2026-03", "2026-04");
check("…split: Jay 10, Sam 9 — the 3 written during the stop to nobody", r.status === 200 && r.body.data.split.length === 1 && r.body.data.split[0].pool_total === 22 && r.body.data.split[0].members === 2
  && r.body.data.split[0].shares.map((x: any) => x.share_usd).sort((x: number, y: number) => x - y).join(",") === "9,10" && r.body.data.split[0].stopped.length === 1
  && r.body.data.split[0].stopped[0].name === "Senior Sam" && r.body.data.split[0].stopped[0].share_usd === 3
  && samPaid.length === 1 && samPaid[0].commission_usd === 9 && samPaid[0].status === "accrued", show(r));
check("…every accrual distributed, only the one from during the stop marked as paying nobody", samRows.length === 3 && samRows.every((c) => c.status === "distributed")
  && samRows.map((c) => `${c.commission_usd}${c.stopped_no_share ? "x" : ""}`).join(",") === "5,4,3x", JSON.stringify(samRows.map((c) => [c.commission_usd, c.status, c.stopped_no_share])));
r = await split({ period: "2026-04" });
const stillNothing = await dist({ pool_group_id: String(chief._id), period: "2026-04", method: "bonus_with" });
check("April's pool, only an accrual from during his stop: still left unsplit now he is resumed, nobody paid", r.status === 200 && r.body.data.split.length === 0
  && stillNothing.body?.distributed === 0 && /stopped/.test(stillNothing.body?.reason ?? "") && (await aprilPooled()) === 1 && !(await poolShares(sam, "2026-04")).length, `${show(r)} ${show(stillNothing)}`);
r = await list("bonus", "2026-04");
const stillNoShare = await forceApprove(sam, "2026-04");
check("…listed with a share of 0, not stopped; nothing of his to approve", row(sam)?.stopped === null && row(sam).pool_usd === 0 && row(sam).pool[0].total_usd === 2
  && stillNoShare.status === 409 && stillNoShare.body?.error?.code === "NOTHING_TO_APPROVE" && (await aprilPooled()) === 1, `${JSON.stringify(row(sam))} ${show(stillNoShare)}`);
r = await list("bonus", thisMonth);
const openAgain = await forceApprove(sam, thisMonth);
check("the running month: the 3 written during his stop is not his after the resume either; approving him waits for the month to end again, no pool share paid out",
  row(sam)?.stopped === null && row(sam).pool_usd === 0 && row(jay)?.pool_usd === 14 && r.body.data.pools[0].total_usd === 17
  && openAgain.status === 409 && openAgain.body?.error?.code === "PERIOD_OPEN" && (await poolShares(sam, thisMonth)).length === 1, `${JSON.stringify(row(sam))} ${show(openAgain)}`);

// The person's own page: the Commission report (functions/reports.ts).
const report = async (u: any, body: Record<string, unknown> = { period: "month" }) =>
  call("POST", "/api/functions/getCommissionReport", body, { authorization: `Bearer ${u === admin ? adminToken : await login(u)}` });
await addAdj(hugo, thisMonth, { reason: "Team target met" });
r = await report(stella);
check("Stella's own Commission report: her figures as they were (40, two credits), her stop and her deduction — nobody else's",
  r.status === 200 && r.body.scope === "own" && r.body.total.usd === 40 && r.body.total.count === 2
  && r.body.stopped.length === 2 && r.body.stopped.every((s: any) => s.recipient_id === String(stella._id) && s.name === "Staff Stella")
  && r.body.stopped[0].at === stoppedAgainAt && r.body.stopped[0].resumed_at === null && /Leaving/.test(r.body.stopped[0].reason) && r.body.stopped[1].resumed_at
  && r.body.adjustments.length === 1 && r.body.adjustments[0].id === adj2.id && r.body.adjustments[0].kind === "bonus" && r.body.adjustments[0].period === thisMonth
  && r.body.adjustments[0].type === "deduction" && r.body.adjustments[0].amount_minor === 12550 && r.body.adjustments[0].currency === "INR" && r.body.adjustments[0].reason === "Laptop damage",
  show(r));
r = await report(stella, { period: "custom", from: "2026-09-01", to: "2026-09-30" });
check("…a month before the stop: neither", r.status === 200 && r.body.stopped.length === 0 && r.body.adjustments.length === 0, show(r));
r = await report(admin);
check("a Super Admin's: everyone's — Stella's stop, hers and Hugo's amounts for the month; not Esha's September deduction",
  r.status === 200 && r.body.stopped.some((s: any) => s.recipient_id === String(stella._id) && !s.resumed_at)
  && r.body.adjustments.some((a: any) => a.id === adj2.id) && r.body.adjustments.some((a: any) => a.recipient_id === String(hugo._id) && a.name === "Head Hugo")
  && !r.body.adjustments.some((a: any) => a.id === adjEsha.id) && !r.body.adjustments.some((a: any) => a.id === adj1.id), show(r));
r = await report(admin, { period: "all" });
check("…all time: Esha's too, and the deposit quarter's", r.body.adjustments.some((a: any) => a.id === adjEsha.id && a.period === "2026-09") && r.body.adjustments.some((a: any) => a.kind === "deposit" && a.period === "2026-Q3"), show(r));

// A bonus that pays only people who are stopped: nothing then, and nothing once they are counted again.
await post("stop", { recipient_id: String(hugo._id), reason: "Under review" });
b = await bonus(stella);
check("Stella and Hugo both stopped: a bonus she raises credits nobody", b.got === "" && b.res.body?.credited === 0 && b.tx?.commission_stopped?.length === 2, `${b.got} ${show(b.res)}`);
await post("resume", { recipient_id: String(hugo._id) });
await post("resume", { recipient_id: String(stella._id) });
r = await call("POST", "/api/functions/creditCommission", { transaction_id: String(b.tx?._id) }, { authorization: `Bearer ${adminToken}` });
check("…credited again once both are counted: still nothing — what a stop left out is not made up later", r.status === 200 && r.body?.skipped === true && /counting was stopped/.test(r.body.reason ?? "")
  && !(await db.collection("commission_credits").countDocuments({ transaction_id: String(b.tx?._id) })), show(r));

await client.close();
console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${pass}/${pass + fail} checks passed\x1b[0m`);
process.exit(fail ? 1 : 0);
