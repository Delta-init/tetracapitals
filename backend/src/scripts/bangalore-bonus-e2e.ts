/**
 * A Bangalore team's bonus stays with Bangalore (the user, 2026-10-15), end to end against a real API process and a
 * stand-in finance served here:
 *
 *   - its payment goes to finance's Bangalore organization (FINANCE_ORG_ID_BANGALORE), in rupees — the rupees as typed,
 *     with the rate finance turns the course's AED figures into rupees at — never to Delta HQ; a Dubai bonus goes to
 *     Delta HQ in dollars as before;
 *   - finance's decision comes back in rupees: the same rupees change nothing, other rupees are turned back into
 *     dollars at the request's rate;
 *   - only Bangalore's broker admins (and Super Admins) are told of it, list it, count it and may decide or send it
 *     back — a Dubai broker admin gets a 403, and the other way round;
 *   - once finance approved the payment, its amount can't be changed here (J Vijay's $1,500 was typed over with the
 *     $1,000 bonus), though the broker admin still approves it;
 *   - with FINANCE_ORG_ID_BANGALORE unset (E2E_PHASE=no-bangalore-org), a Bangalore bonus waits, saying why, and a
 *     Dubai one still goes.
 *
 * Run through ./test-bangalore-bonus.sh. Refuses anything but a scratch database on 127.0.0.1.
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
const DECISION_SECRET = process.env.FINANCE_S2S_SECRET ?? "";
const HQ = process.env.FINANCE_ORG_ID ?? "";
const BLR = "64b000000000000000000099";
const noBangaloreOrg = process.env.E2E_PHASE === "no-bangalore-org";

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
const show = (r: Res) => `${r.status} ${JSON.stringify(r.body).slice(0, 260)}`;
async function until(fn: () => Promise<boolean>, ms = 6000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await Bun.sleep(100); }
  return false;
}

/* ── A stand-in finance: takes every request, and remembers the organization it was sent to. ── */
const received: { body: any; org: string | null }[] = [];
const finance = Bun.serve({
  port: Number(process.env.E2E_FAKE_FINANCE_PORT),
  async fetch(req) {
    const body: any = await req.json().catch(() => ({}));
    received.push({ body, org: req.headers.get("x-delta-org") });
    return Response.json({ data: { id: `fin-${received.length}`, status: "pending", externalId: body.externalId } });
  },
});

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});
const txs = db.collection("funding_transactions");
const txOf = async (id: string) => (await txs.findOne({ _id: new ObjectId(id) })) as any;

step("Setting up: a Dubai team and a Bangalore team, a broker admin for each");
const hash = await bcrypt.hash("Password123!", 10);
const now = new Date().toISOString();
const person = (full_name: string, app_role: string, extra: Record<string, unknown> = {}) => ({
  _id: new ObjectId(), email: `${full_name.toLowerCase().replace(/\s+/g, ".")}@e2e-blr.test`, full_name, app_role,
  password_hash: hash, created_date: now, updated_date: now, ...extra,
});
const admin = person("Super Admin", "super_admin");
const brokerDxb = person("Broker Dubai", "broker_admin");
const brokerBlr = person("Broker Bangalore", "broker_admin", { team_location: "bangalore" });
const leadDxb = person("Lead Dubai", "chief_mentor", { team_name: "Team Dubai" });
const leadBlr = person("Lead Blr", "chief_mentor", { team_name: "Banglore Team", team_location: "bangalore" });
const csDxb = person("Cs Dubai", "junior_mentor", { up_head_id: String(leadDxb._id), up_head_name: leadDxb.full_name });
const csBlr = person("Glorita E2e", "junior_mentor", { up_head_id: String(leadBlr._id), up_head_name: leadBlr.full_name });
await db.collection("users").insertMany([admin, brokerDxb, brokerBlr, leadDxb, leadBlr, csDxb, csBlr]);
const studentOf = (full_name: string, code: string, cs: any, extra: Record<string, unknown>) => ({
  _id: new ObjectId(), full_name, email: `${code.toLowerCase()}@e2e-blr.test`, student_code: code, student_level: "LEVEL_1", status: "ACTIVE",
  primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, created_date: now, ...extra,
});
// On the Bangalore team (its leader's location), and one only arrived for Bangalore — both Bangalore's.
const vijay = studentOf("J Vijay", "STU-5000", csBlr, { team_id: String(leadBlr._id), team_name: "Banglore Team" });
const asha = studentOf("Asha Arrived", "STU-5001", csBlr, { location: "bangalore" });
const dina = studentOf("Dina Dubai", "STU-5002", csDxb, { team_id: String(leadDxb._id), team_name: "Team Dubai" });
await db.collection("students").insertMany([vijay, asha, dina]);
await db.collection("mt5_accounts").insertMany([vijay, asha, dina].map((s, i) => ({ _id: new ObjectId(), student_id: String(s._id), mt5_login: `92289${i}`, platform: "MT5", created_date: now })));

const login = async (u: any) => (await call("POST", "/api/auth/login", { email: u.email, password: "Password123!" })).body?.token as string;
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const [tAdmin, tDxb, tBlr, tCsBlr, tCsDxb] = await Promise.all([admin, brokerDxb, brokerBlr, csBlr, csDxb].map(login));
check("everyone signs in", [tAdmin, tDxb, tBlr, tCsBlr, tCsDxb].every(Boolean));

/** J Vijay's: INR 150,000 by bank transfer, MSNR part payment, $1,000 bonus — as the bonus form saves it. */
const raise = (token: string, cs: any, s: any, over: Record<string, unknown> = {}) => call("POST", "/api/entities/FundingTransaction", {
  type: "BONUS", status: "PENDING", student_id: String(s._id), student_name: s.full_name, student_code: s.student_code,
  amount_currency: "INR", amount_original: 150000, amount_aed: 5505, amount_usd: 1500, fx_rate_aed_per_usd: 3.67, fx_rate_usd_per_inr: 0.01,
  payment_method: "Bank Transfer", mt5_login: "922890", screenshot_url: "http://127.0.0.1/uploads/proof.jpeg", tags: ["MSNR"],
  payments: [{ method: "Bank Transfer", amount: 150000, currency: "INR", collected_on: "2026-10-14", receipt_url: "http://127.0.0.1/uploads/proof.jpeg", receipt_name: "proof.jpeg" }],
  course_payment: {
    product: "MSNR", price: 3000, price_currency: "USD", bonus_full_usd: 3000, instalments: 6, plan_aed: 12000, with_bonus: true, kind: "partial",
    paid_before_aed: 0, paid_today_aed: 5505, paid_total_aed: 5505, bonus_usd: 1000, hold_aed: 1505, balance_aed: 6495, short_aed: 0, over_aed: 0,
  },
  primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, requested_by_id: String(cs._id), requested_by_name: cs.full_name,
  requested_at: new Date().toISOString(), initiating_mentor_id: String(cs._id), initiating_mentor_name: cs.full_name,
  ...over,
}, as(token));
const decide = (body: Record<string, unknown>) =>
  call("POST", "/api/v1/integrations/finance/funding-decisions", body, { "x-finance-secret": DECISION_SECRET });
const approve = (fundingId: string, amountMinor: number, currency: string, txn: string) => decide({
  fundingId, financeId: "fin-x", decision: "approved", amountMinor, currency, transactionId: txn, paymentMethod: "Bank Transfer",
  decidedBy: { name: "Asha Accountant", email: "asha@delta.test" }, decidedAt: new Date().toISOString(),
});
const patchAs = (token: string, id: string, data: Record<string, unknown>) => call("PATCH", `/api/entities/FundingTransaction/${id}`, data, as(token));
const sentFor = (id: string) => received.find((r) => r.body?.externalId === id);

if (noBangaloreOrg) {
  step("FINANCE_ORG_ID_BANGALORE unset: a Bangalore bonus waits, a Dubai one goes");
  const b = String((await raise(tCsBlr, csBlr, vijay)).body?.id ?? "");
  const d = String((await raise(tCsDxb, csDxb, dina, { amount_currency: "USD", amount_original: 1500, fx_rate_usd_per_inr: undefined })).body?.id ?? "");
  await until(async () => !!sentFor(d));
  await Bun.sleep(800);
  check("the Dubai bonus went to Delta HQ", sentFor(d)?.org === HQ, JSON.stringify(sentFor(d)?.org));
  check("the Bangalore bonus was not sent anywhere — never Delta HQ", !sentFor(b), JSON.stringify(received.map((r) => r.org)));
  const t = await txOf(b);
  check("it waits, still queued, saying why", t?.finance_approval?.state === "queued" && /FINANCE_ORG_ID_BANGALORE/.test(String(t?.finance_approval?.last_error ?? "")), JSON.stringify(t?.finance_approval));
  check("and stays PENDING here", t?.status === "PENDING");
} else {
  step("A Bangalore team's bonus goes to Bangalore's finance, in rupees");
  let r = await raise(tCsBlr, csBlr, vijay);
  const b1 = String(r.body?.id ?? "");
  check("raised by its CS", r.status === 200 && !!b1, show(r));
  await until(async () => !!sentFor(b1));
  const s1 = sentFor(b1);
  check("sent to the Bangalore organization, not Delta HQ", s1?.org === BLR, JSON.stringify(s1?.org));
  check("in rupees: INR 150,000 as typed", s1?.body?.currency === "INR" && s1?.body?.amountMinor === 15_000_000, JSON.stringify({ c: s1?.body?.currency, a: s1?.body?.amountMinor }));
  check("said to be Bangalore's", s1?.body?.academy === "bangalore");
  check("with the rate the AED figures were worked at (₹27.248 per AED)", Math.abs(Number(s1?.body?.coursePayment?.inrPerAed) - 27.247956) < 0.0001, String(s1?.body?.coursePayment?.inrPerAed));
  check("and its $1,000 MT5 bonus, apart from the payment", s1?.body?.coursePayment?.bonusUsd === 1000);
  const fa1 = (await txOf(b1))?.finance_approval;
  check("TC remembers it was sent in rupees to Bangalore", fa1?.state === "sent" && fa1?.org === "bangalore" && fa1?.currency === "INR" && fa1?.amount_minor === 15_000_000, JSON.stringify(fa1));

  step("A Dubai team's bonus still goes to Delta HQ, in dollars");
  r = await raise(tCsDxb, csDxb, dina, { amount_currency: "USD", amount_original: 1500 });
  const d1 = String(r.body?.id ?? "");
  await until(async () => !!sentFor(d1));
  const sd = sentFor(d1);
  check("to Delta HQ, USD 1,500, no rupee rate", sd?.org === HQ && sd?.body?.currency === "USD" && sd?.body?.amountMinor === 150_000 && sd?.body?.coursePayment?.inrPerAed === undefined && !sd?.body?.academy, JSON.stringify({ org: sd?.org, c: sd?.body?.currency, a: sd?.body?.amountMinor }));

  step("Finance approves the rupees: the same rupees change nothing");
  r = await approve(b1, 15_000_000, "INR", "Y2M1326212121443999654912");
  let t = await txOf(b1);
  check("taken — the first of two approvals", r.status === 200 && t?.status === "PENDING" && t?.finance_approval?.decision === "approved", show(r));
  check("still $1,500 paid (not 150,000 dollars), nothing marked corrected", t?.amount_usd === 1500 && t?.requested_amount_usd === undefined && t?.amount_original === 150000, JSON.stringify({ usd: t?.amount_usd, req: t?.requested_amount_usd }));
  const told = await db.collection("notifications").find({ type: "bonus_to_approve" }).toArray();
  const toldIds = new Set(told.map((n: any) => String(n.user_id)));
  check("the Bangalore broker admin and the Super Admin are told", toldIds.has(String(brokerBlr._id)) && toldIds.has(String(admin._id)), JSON.stringify([...toldIds]));
  check("the Dubai broker admin is not", !toldIds.has(String(brokerDxb._id)));

  step("Finance corrects the rupees: turned back into dollars at the request's rate");
  r = await raise(tCsBlr, csBlr, asha);
  const b2 = String(r.body?.id ?? "");
  await until(async () => !!sentFor(b2));
  check("Asha (arrived for Bangalore, on no team) goes to Bangalore too", sentFor(b2)?.org === BLR);
  r = await approve(b2, 14_000_000, "INR", "TXN-BLR-2");
  t = await txOf(b2);
  check("INR 140,000 approved → $1,400, AED 5,138, typed rupees 140,000, the $1,500 asked kept",
    r.status === 200 && t?.amount_usd === 1400 && t?.amount_aed === 5138 && t?.amount_original === 140000 && t?.requested_amount_usd === 1500,
    JSON.stringify({ usd: t?.amount_usd, aed: t?.amount_aed, orig: t?.amount_original, req: t?.requested_amount_usd }));
  r = await approve(d1, 150_000, "USD", "TXN-DXB-1");
  t = await txOf(d1);
  check("a Dubai one in dollars, as before", r.status === 200 && t?.amount_usd === 1500 && t?.requested_amount_usd === undefined, JSON.stringify({ usd: t?.amount_usd }));

  step("Only Bangalore's broker admins see, count and decide Bangalore's bonuses");
  const listed = async (token: string) => ((await call("POST", "/api/functions/getBonusApprovals", {}, as(token))).body?.pending ?? []).map((x: any) => String(x.id));
  const [lDxb, lBlr, lAdmin] = [await listed(tDxb), await listed(tBlr), await listed(tAdmin)];
  check("the Bangalore broker admin lists Bangalore's, not Dubai's", lBlr.includes(b1) && lBlr.includes(b2) && !lBlr.includes(d1), JSON.stringify(lBlr));
  check("the Dubai broker admin lists Dubai's, not Bangalore's", lDxb.includes(d1) && !lDxb.includes(b1) && !lDxb.includes(b2), JSON.stringify(lDxb));
  check("a Super Admin lists all three", [b1, b2, d1].every((id) => lAdmin.includes(id)), JSON.stringify(lAdmin));
  const count = async (token: string) => (await call("POST", "/api/functions/getNavCounts", {}, as(token))).body?.bonus_approvals_pending;
  const [cDxb, cBlr, cAdmin] = [await count(tDxb), await count(tBlr), await count(tAdmin)];
  check("sidebar counts: Bangalore 2, Dubai 1, Super Admin 3", cBlr === 2 && cDxb === 1 && cAdmin === 3, JSON.stringify({ cBlr, cDxb, cAdmin }));

  r = await patchAs(tDxb, b1, { status: "APPROVED", approved_by_name: "Broker Dubai", transaction_id: "MB-1" });
  check("the Dubai broker admin can't approve a Bangalore bonus", r.status === 403 && /Bangalore broker admin/.test(JSON.stringify(r.body)), show(r));
  r = await patchAs(tDxb, b1, { status: "REJECTED", rejection_reason: "no" });
  check("nor reject it", r.status === 403, show(r));
  r = await call("POST", "/api/functions/sendFundingBack", { id: b1, fields: ["other"], note: "check" }, as(tDxb));
  check("nor send it back", r.status === 403, show(r));
  r = await patchAs(tBlr, d1, { status: "APPROVED", approved_by_name: "Broker Bangalore", transaction_id: "MB-2" });
  check("nor the Bangalore broker admin a Dubai one", r.status === 403 && /Dubai broker admin/.test(JSON.stringify(r.body)), show(r));

  step("The payment finance approved can't be retyped — the bonus is credited, the amount stays");
  r = await patchAs(tBlr, b1, { amount_usd: 1000 });
  check("changing $1,500 to the $1,000 bonus is refused", r.status === 409 && /Delta Finance approved this payment/.test(JSON.stringify(r.body)), show(r));
  check("and it is still $1,500", (await txOf(b1))?.amount_usd === 1500);
  r = await patchAs(tBlr, b1, { status: "APPROVED", amount_usd: 1500, approved_by_name: "Broker Bangalore", transaction_id: "MB-000152" });
  check("the Bangalore broker admin approves it at the same amount", r.status === 200 && r.body?.status === "APPROVED" && r.body?.amount_usd === 1500, show(r));
  r = await patchAs(tAdmin, d1, { status: "APPROVED", amount_usd: 1500, approved_by_name: "Super Admin", transaction_id: "MB-3" });
  check("a Super Admin approves any location's", r.status === 200 && r.body?.status === "APPROVED", show(r));

  step("The scripts: J Vijay's payment put back, and the Bangalore bonuses finance has in Delta HQ listed");
  const { planPaidFixes, applyPaidFixes, undoPaidFixes, bangaloreBonusesInHq } = await import("./bonus-paid-amounts");
  // As it was before: finance (Delta HQ) approved $1,500, and the broker admin typed it over with the $1,000 bonus.
  const old = new ObjectId();
  await txs.insertOne({ _id: old, type: "BONUS", status: "APPROVED", student_id: String(vijay._id), student_name: vijay.full_name, student_code: "STU-5000",
    amount_usd: 1000, amount_aed: 5505, amount_currency: "INR", amount_original: 150000, course_payment: { bonus_usd: 1000, paid_today_aed: 5505 },
    finance_approval: { state: "decided", decision: "approved" } });
  // What finance approved, as the audit line written then kept it.
  const approvedLine = (id: ObjectId, usd: number) => ({ entity_id: String(id), action_type: "accounts_approve_bonus", new_value: JSON.stringify({ finance_approval: "approved", amount_usd: usd }) });
  // Praveen's (STU-2991): $500 typed in dollars, approved at $500, carrying AED 2,000 — right as it is.
  const praveen = new ObjectId();
  await txs.insertOne({ _id: praveen, type: "BONUS", status: "APPROVED", student_id: String(dina._id), student_code: "STU-2991", amount_usd: 500, amount_aed: 2000, amount_currency: "USD", amount_original: 500, finance_approval: { state: "decided", decision: "approved" } });
  // One with no record of what finance approved: left alone.
  const unknown = new ObjectId();
  await txs.insertOne({ _id: unknown, type: "BONUS", status: "APPROVED", student_id: String(dina._id), student_code: "STU-NOLOG", amount_usd: 900, amount_aed: 5505, finance_approval: { state: "decided", decision: "approved" } });
  await db.collection("logs").insertMany([approvedLine(old, 1500), approvedLine(praveen, 500)]);
  // One finance corrected to $1,400 is right as it is.
  await txs.insertOne({ _id: new ObjectId(), type: "BONUS", status: "APPROVED", student_id: String(dina._id), amount_usd: 1400, amount_aed: 5505, requested_amount_usd: 1500, finance_approval: { state: "decided", decision: "approved" } });
  const planned = await planPaidFixes(db);
  let fixes = planned.fixes;
  check("the dry run finds J Vijay's: $1,000 → $1,500, and nothing else", fixes.length === 1 && fixes[0].id === String(old) && fixes[0].amountUsd === 1000 && fixes[0].paidUsd === 1500, JSON.stringify(fixes));
  check("…not Praveen's ($500 approved, $500 now, though its AED reads 2,000)", !fixes.some((f) => f.id === String(praveen)));
  check("…and lists the one with no record of finance's amount, leaving it alone", planned.noRecord.some((f) => f.id === String(unknown)) && !fixes.some((f) => f.id === String(unknown)), JSON.stringify(planned.noRecord));
  check("…and changes nothing", (await txOf(String(old)))?.amount_usd === 1000);
  check("written: it is $1,500 again, with an audit line", (await applyPaidFixes(db, fixes)) === 1 && (await txOf(String(old)))?.amount_usd === 1500 && (await db.collection("logs").countDocuments({ entity_id: String(old), action_type: "restore_bonus_paid_amount" })) === 1);
  check("run again: nothing to put back", (await planPaidFixes(db)).fixes.length === 0);
  check("the undo puts it back as it was", (await undoPaidFixes(db, fixes)) === 1 && (await txOf(String(old)))?.amount_usd === 1000);
  await applyPaidFixes(db, fixes);
  const inHq = (await bangaloreBonusesInHq(db)).map((x) => x.id);
  check("--list-bangalore lists J Vijay's old one (sent to Delta HQ), not the ones sent to Bangalore, nor Dubai's",
    inHq.includes(String(old)) && !inHq.includes(b1) && !inHq.includes(d1), JSON.stringify(inHq));
  await txs.updateOne({ _id: old }, { $set: { "finance_approval.state": "decided" } });
  await txs.insertOne({ _id: new ObjectId(), type: "BONUS", status: "PENDING", student_id: String(asha._id), finance_approval: { state: "sent" } });
  const inHq2 = await bangaloreBonusesInHq(db);
  check("…a Bangalore student's sent before (no org kept) is listed", inHq2.some((x) => x.code === "" && x.status === "PENDING") && inHq2.every((x) => x.id !== d1), JSON.stringify(inHq2));
}

finance.stop(true);
await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
