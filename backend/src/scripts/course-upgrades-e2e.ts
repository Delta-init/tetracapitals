/**
 * CSE course upgrades, phase 2 (functions/courseUpgrades.ts), end to end against the API:
 *   - the price list, and a Super Admin changing it (and nobody else);
 *   - a CS entering a student's current courses, then the upgrades offered with what each costs and earns;
 *   - starting one: the quote kept, one at a time, the courses locked; cancelling before any payment;
 *   - who may: the student's CS and admins, not another CS; the Upgrades list scoped the same way;
 *   - phase 4: each approved payment's new $500 steps raised in MT5 Bonus Approvals, once, never commission;
 *   - phase 3: recording payments (queued for Delta finance), finance's decision coming back, the upgrade done when paid.
 * Run through ./test-course-upgrades.sh (throwaway mongod, the API — no .env). Scratch database only.
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
const show = (v: unknown) => JSON.stringify(v).slice(0, 300);
async function fn(name: string, body: unknown, token?: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`${API}/api/functions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
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
const admin = person("Super Admin", "admin@e2e-upg.test", "super_admin");
const cs = person("Cee Ess", "cs@e2e-upg.test", "junior_mentor");
const other = person("Other Cs", "other@e2e-upg.test", "junior_mentor");
await db.collection("users").insertMany([admin, cs, other] as any[]);
const stu = (code: string, mentor: any) => ({ _id: new ObjectId(), student_code: code, full_name: `Student ${code}`, primary_mentor_id: String(mentor._id), primary_mentor_name: mentor.full_name, status: "ACTIVE", created_date: now });
const s1 = stu("STU-1", cs), s2 = stu("STU-2", other);
await db.collection("students").insertMany([s1, s2] as any[]);
const tAdmin = await login(admin.email), tCs = await login(cs.email), tOther = await login(other.email);
const S1 = String(s1._id);

step("Case 1 — the price list, and the upgrades a student is offered");
let r = await fn("getCoursePriceList", {}, tCs);
check("anyone signed in reads the price list; only a Super Admin may change it", r.status === 200 && r.body.courses?.length === 6 && r.body.canEdit === false && (await fn("getCoursePriceList", {}, tAdmin)).body.canEdit === true);
r = await fn("getStudentCourses", { studentId: S1 }, tCs);
check("before the courses are entered: nothing owned, and starting is refused", r.status === 200 && r.body.entered === false
  && (await fn("startCourseUpgrade", { studentId: S1, course: "DSLP_OFFER", plan: "full" }, tCs)).status === 409, show(r.body));
r = await fn("setStudentCourses", { studentId: S1, courses: [{ code: "MBT", plan: "full", paidAed: 2250 }, { code: "DWT", plan: "full", paidAed: 3250 }] }, tCs);
check("their CS enters MBT and DWT", r.status === 200, show(r.body));
r = await fn("getStudentCourses", { studentId: S1 }, tCs);
const opt = (code: string) => r.body.options?.find((o: any) => o.code === code);
check("offered DSLP Offer as the chart says: full 15,100 +$4,000, installments 2,750 + 7 × 2,000 +$4,000",
  opt("DSLP_OFFER")?.full?.dueAed === 15100 && opt("DSLP_OFFER")?.full?.bonusUsd === 4000
  && opt("DSLP_OFFER")?.installments?.schedule?.[0] === 2750 && opt("DSLP_OFFER")?.installments?.schedule?.length === 8, show(opt("DSLP_OFFER")));
check("…DSLP PRO 22,440 / 24,750 +$6,000; nothing they already have offered", opt("DSLP_PRO")?.full?.dueAed === 22440 && opt("DSLP_PRO")?.installments?.dueAed === 24750
  && !opt("DWT") && !opt("MBT"), show(r.body.options?.map((o: any) => o.code)));

step("Case 2 — starting an upgrade, one at a time, and cancelling it");
r = await fn("startCourseUpgrade", { studentId: S1, course: "DSLP_OFFER", plan: "installments" }, tCs);
const upId = r.body.upgrade?.id;
check("started: the quote kept, first payment 2,750", r.status === 200 && r.body.upgrade?.quote?.dueAed === 16750 && r.body.upgrade?.nextPaymentAed === 2750 && r.body.upgrade?.progress?.balanceAed === 16750, show(r.body));
check("a second at the same time is refused", (await fn("startCourseUpgrade", { studentId: S1, course: "MSNR", plan: "full" }, tCs)).status === 409);
check("the courses entered can no longer be changed", (await fn("setStudentCourses", { studentId: S1, courses: [] }, tCs)).status === 409);
r = await fn("getStudentCourses", { studentId: S1 }, tCs);
check("the student page shows it in progress, and no longer offers DSLP Offer", r.body.active?.course === "DSLP_OFFER" && !r.body.options?.some((o: any) => o.code === "DSLP_OFFER"));
await db.collection("settings").updateOne({ key: "cse_price_list" }, { $set: { key: "cse_price_list", courses: (await fn("getCoursePriceList", {}, tAdmin)).body.courses.map((c: any) => c.code === "DSLP_OFFER" ? { ...c, planAed: 22000 } : c) } }, { upsert: true });
r = await fn("getStudentCourses", { studentId: S1 }, tCs);
check("a price changed later leaves the started upgrade as quoted", r.body.active?.quote?.dueAed === 16750);
await db.collection("settings").deleteMany({ key: "cse_price_list" });
check("another CS cannot cancel it", (await fn("cancelCourseUpgrade", { upgradeId: upId }, tOther)).status === 403);
r = await fn("cancelCourseUpgrade", { upgradeId: upId }, tCs);
check("its CS cancels it before any payment", r.status === 200 && (await fn("getStudentCourses", { studentId: S1 }, tCs)).body.active === null);
await db.collection("course_upgrades").insertOne({ student_id: S1, course: "MSNR", plan: "full", status: "open", quote: { dueAed: 11010, schedule: [11010], plan: "full", noBonusAed: 0, steps: 6, bonusUsd: 3000 }, created_at: now } as any);
const withPay: any = await db.collection("course_upgrades").findOne({ course: "MSNR", student_id: S1 });
await db.collection("course_payments").insertOne({ upgrade_id: String(withPay._id), student_id: S1, amount_aed: 5000, status: "pending" } as any);
check("…but not once a payment is recorded on it", (await fn("cancelCourseUpgrade", { upgradeId: String(withPay._id) }, tCs)).status === 409);
await db.collection("course_upgrades").deleteOne({ _id: withPay._id });
await db.collection("course_payments").deleteMany({});

step("Case 3 — bad input");
check("an unknown course", (await fn("startCourseUpgrade", { studentId: S1, course: "DGMP", plan: "full" }, tCs)).status === 400);
check("MBT is not an upgrade", (await fn("startCourseUpgrade", { studentId: S1, course: "MBT", plan: "full" }, tCs)).status === 400);
check("DWT in installments", (await fn("startCourseUpgrade", { studentId: S1, course: "DWT", plan: "installments" }, tCs)).status === 400);
check("a plan that is not full or installments", (await fn("startCourseUpgrade", { studentId: S1, course: "MSNR", plan: "weekly" }, tCs)).status === 400);
check("a course they already have", (await fn("startCourseUpgrade", { studentId: S1, course: "DWT", plan: "full" }, tCs)).status === 400);
check("no student, a student that does not exist", (await fn("getStudentCourses", {}, tCs)).status === 400 && (await fn("getStudentCourses", { studentId: String(new ObjectId()) }, tCs)).status === 404);
check("an installment total that is not 2,000s", (await fn("saveCoursePriceList", { courses: [{ code: "MSNR", fullAed: 11010, planAed: 12500 }] }, tAdmin)).status === 400);

step("Case 4 — who may");
check("another CS cannot see or change this student's courses", (await fn("getStudentCourses", { studentId: S1 }, tOther)).status === 403
  && (await fn("setStudentCourses", { studentId: S1, courses: [] }, tOther)).status === 403);
check("a CS cannot change the price list", (await fn("saveCoursePriceList", { courses: [{ code: "MSNR", fullAed: 1, planAed: 2000 }] }, tCs)).status === 403);
r = await fn("saveCoursePriceList", { courses: [{ code: "MSNR", fullAed: 11500, planAed: 14000 }] }, tAdmin);
check("a Super Admin changes MSNR's prices", r.status === 200 && r.body.courses.find((c: any) => c.code === "MSNR")?.planAed === 14000);
await fn("startCourseUpgrade", { studentId: S1, course: "MSNR", plan: "installments" }, tCs);
await fn("setStudentCourses", { studentId: String(s2._id), courses: [{ code: "MBT", plan: "full", paidAed: 2250 }] }, tOther);
await fn("startCourseUpgrade", { studentId: String(s2._id), course: "DQMP", plan: "full" }, tOther);
const mine = (await fn("listCourseUpgrades", {}, tCs)).body.rows ?? [];
const all = (await fn("listCourseUpgrades", {}, tAdmin)).body.rows ?? [];
check("the Upgrades list: a CS sees their own students' only, the Super Admin all", mine.length === 1 && mine[0].student.code === "STU-1" && mine[0].quote.dueAed === 14000 && all.length === 2, show([mine.length, all.length]));
check("no session: 401", (await fn("listCourseUpgrades", {})).status === 401);

step("Case 5 — payments: recorded by the CS, decided by Delta finance");
await db.collection("course_upgrades").deleteMany({});
await db.collection("settings").deleteMany({ key: "cse_price_list" });
r = await fn("startCourseUpgrade", { studentId: S1, course: "DSLP_OFFER", plan: "installments" }, tCs);
const up = r.body.upgrade?.id;
const RECEIPT = "https://files.example.test/receipt.png";
await db.collection("mt5_accounts").insertMany([
  { student_id: S1, mt5_login: "5550001", created_date: now },
  { student_id: S1, mt5_login: "5550002", is_primary: true, created_date: now },
] as any[]);
const pay = (body: any, t = tCs) => fn("recordCoursePayment", { upgradeId: up, method: "Card", receiptUrl: RECEIPT, ...body }, t);
check("no receipt, a bad method, 0, or more than the balance: refused",
  (await pay({ amountAed: 2750, receiptUrl: "" })).status === 400 && (await pay({ amountAed: 2750, method: "Gold" })).status === 400
  && (await pay({ amountAed: 0 })).status === 400 && (await pay({ amountAed: 16751 })).status === 400);
check("another CS cannot record one", (await pay({ amountAed: 2750 }, tOther)).status === 403);
r = await pay({ amountAed: 4500, paidOn: "2026-10-07" });
const p1 = r.body.id;
check("its CS records 4,500: queued for finance", r.status === 200 && ((await db.collection("course_payments").findOne({ _id: new ObjectId(p1) })) as any)?.finance_approval?.state === "queued", show(r.body));
r = await fn("getStudentCourses", { studentId: S1 }, tCs);
check("…shown with finance, nothing counted yet", r.body.active?.payments?.[0]?.status === "pending" && r.body.active?.progress?.paidAed === 0 && r.body.active?.pendingAed === 4500, show(r.body.active));
check("…and the upgrade can no longer be cancelled", (await fn("cancelCourseUpgrade", { upgradeId: up }, tCs)).status === 409);
check("more than what is left after the one waiting is refused", (await pay({ amountAed: 12251 })).status === 400 && (await pay({ amountAed: 12250 })).status === 200);
const decide = async (body: any, secret = process.env.FINANCE_S2S_SECRET!) => {
  const res = await fetch(`${API}/api/v1/integrations/finance/funding-decisions`, { method: "POST", headers: { "content-type": "application/json", "x-finance-secret": secret }, body: JSON.stringify(body) });
  const j: any = await res.json().catch(() => ({})); return { status: res.status, body: j.data ?? j };
};
const approve = (id: string, aed: number) => decide({ fundingId: id, decision: "approved", amountMinor: aed * 100, transactionId: "TXN-1", decidedBy: { name: "Acc Ountant", email: "acc@finance.test" }, decidedAt: now });
check("a wrong secret is refused", (await decide({ fundingId: p1, decision: "approved" }, "nope")).status === 401);
r = await approve(p1, 4500);
check("finance approves the 4,500", r.status === 200 && r.body.status === "approved", show(r.body));
r = await fn("getStudentCourses", { studentId: S1 }, tCs);
check("…it counts: paid 4,500, one step (+$500), 1,750 on hold", r.body.active?.progress?.paidAed === 4500 && r.body.active?.progress?.bonusEarnedUsd === 500 && r.body.active?.progress?.onHoldAed === 1750, show(r.body.active?.progress));
const bonusRows = () => db.collection("funding_transactions").find({ bonus_credit: "course_upgrade" }).toArray() as Promise<any[]>;
let bs = await bonusRows();
check("phase 4: one step completed → $500 raised in MT5 Bonus Approvals, on the primary MT5", bs.length === 1 && bs[0].amount_usd === 500 && bs[0].status === "PENDING"
  && bs[0].type === "BONUS" && bs[0].mt5_login === "5550002" && bs[0].course_upgrade?.payment_id === p1, JSON.stringify(bs).slice(0, 300));
r = await fn("getBonusApprovals", {}, tAdmin);
check("…on the approvals page as a course upgrade bonus", r.body.pending?.some((t: any) => t.source === "course_upgrade" && t.course === "DSLP Offer"), show(r.body.pending));
check("…and no commission from it", (await fn("creditCommission", { transaction_id: String(bs[0]._id) }, tAdmin)).body?.skipped === true);
check("the same approval again is fine; a rejection now is 409", (await approve(p1, 4500)).body.already === true
  && (await decide({ fundingId: p1, decision: "rejected", reason: "wrong" })).status === 409);
const p2: any = await db.collection("course_payments").findOne({ amount_aed: 12250 });
r = await decide({ fundingId: String(p2._id), decision: "rejected", reason: "Receipt unreadable" });
check("finance approving again raises no second bonus", (await bonusRows()).length === 1);
check("finance rejects the 12,250 with a reason", r.status === 200 && r.body.status === "rejected");
r = await fn("getStudentCourses", { studentId: S1 }, tCs);
check("…shown rejected with the reason, the balance unchanged", r.body.active?.payments?.find((x: any) => x.id === String(p2._id))?.reason === "Receipt unreadable" && r.body.active?.progress?.balanceAed === 12250);
const p3 = (await pay({ amountAed: 12250 })).body.id;
r = await approve(p3, 12250);
check("the rest approved: the upgrade is done", r.status === 200 && r.body.upgradeDone === true, show(r.body));
r = await fn("getStudentCourses", { studentId: S1 }, tCs);
bs = await bonusRows();
check("the last payment's 7 steps → $3,500 more; nothing for the rejected one", bs.length === 2 && bs.some((b) => b.amount_usd === 3500 && b.course_upgrade?.payment_id === p3)
  && bs.reduce((t, b) => t + b.amount_usd, 0) === 4000, JSON.stringify(bs.map((b) => b.amount_usd)));
check("the card shows each payment's bonus", r.body.past?.[0]?.payments?.find((x: any) => x.id === p3)?.bonus?.usd === 3500, show(r.body.past?.[0]?.payments));
check("…DSLP Offer now theirs, at 16,750, all $4,000 earned", !r.body.active && r.body.owned?.some((o: any) => o.code === "DSLP_OFFER" && o.paidAed === 16750)
  && r.body.past?.[0]?.progress?.bonusEarnedUsd === 4000, show(r.body.owned));
check("no more payments on a done upgrade", (await pay({ amountAed: 1 })).status === 409);
check("an unknown id: 410", (await approve(String(new ObjectId()), 1)).status === 410);
const hist = await db.collection("student_history").find({ student_id: S1, type: "course_upgrade" }).toArray();
check("history: payments recorded, approved, rejected", hist.some((h: any) => /approved by Delta Finance/.test(h.text)) && hist.some((h: any) => /rejected by Delta Finance/.test(h.text)) && hist.some((h: any) => /recorded/.test(h.text)), String(hist.length));

await client.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
