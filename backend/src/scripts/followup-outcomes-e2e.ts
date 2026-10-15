/**
 * Follow-up target outcomes from the Products page, and conversion by whichever way a course is paid for (the user,
 * 2026-10-16: "why target outcome is not showing the MSNR and other courses"), against a real API process:
 *
 *   - the list is each active course on the Products page, DGMP, then Top-up, Onboarding call, Other;
 *   - a follow-up may be opened for any of them (and the old sheet's DSLP / DQMP still), nothing else;
 *   - it converts on an approved bonus course payment for its course, an approved course upgrade payment to it, or a
 *     tagged deposit — not on money approved before it was opened, not on a sales-close bonus credit; Top-up on a
 *     deposit only; an Onboarding call never.
 *
 * Run through ./test-followup-outcomes.sh. Refuses anything but a scratch database on 127.0.0.1.
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
type Res = { status: number; body: any };
async function call(path: string, body: unknown, token: string): Promise<Res> {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const show = (r: Res) => `${r.status} ${JSON.stringify(r.body).slice(0, 260)}`;

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({});

step("Setting up: the Products page, a CS and their students");
const now = new Date().toISOString();
const hash = await bcrypt.hash("Password123!", 10);
const admin = { _id: new ObjectId(), email: "admin@e2e-fu.test", full_name: "Super Admin", app_role: "super_admin", password_hash: hash, created_date: now };
const cs = { _id: new ObjectId(), email: "cs@e2e-fu.test", full_name: "Cara CS", app_role: "junior_mentor", password_hash: hash, created_date: now };
await db.collection("users").insertMany([admin, cs]);
await db.collection("transaction_tags").insertMany(["MSNR", "DWT", "DSLP Offer", "DSLP Full", "DQMP"].map((name) => ({ _id: new ObjectId(), name, active: true, created_date: now }))
  .concat([{ _id: new ObjectId(), name: "Old Promo", active: false, created_date: now }]));
const students = Array.from({ length: 9 }, (_, i) => ({
  _id: new ObjectId(), full_name: `Student ${i + 1}`, student_code: `STU-90${i}`, email: `s${i}@e2e-fu.test`, status: "ACTIVE",
  primary_mentor_id: String(cs._id), primary_mentor_name: cs.full_name, created_date: now,
}));
await db.collection("students").insertMany(students);
const tAdmin = (await (await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: admin.email, password: "Password123!" }) })).json() as any)?.token;
check("signed in", !!tAdmin);

step("The list: the Products page's courses, DGMP, then the rest");
let r = await call("/api/functions/getFollowups", {}, tAdmin);
const outcomes: string[] = r.body?.lists?.outcomes ?? [];
check("MSNR, DWT, DSLP Offer, DSLP Full, DQMP from Products, and DGMP kept", ["MSNR", "DWT", "DSLP Offer", "DSLP Full", "DQMP", "DGMP"].every((o) => outcomes.includes(o)), JSON.stringify(outcomes));
check("Top-up, Onboarding call and Other last", JSON.stringify(outcomes.slice(-3)) === JSON.stringify(["Additional Deposit / Top-up", "Onboarding call", "Other"]), JSON.stringify(outcomes));
check("an inactive product is left out", !outcomes.includes("Old Promo"));

step("Opening follow-ups");
const open = async (i: number, targetOutcome: string) => call("/api/functions/createFollowup", { studentId: String(students[i]._id), targetOutcome, nextFollowupDate: "2026-12-01" }, tAdmin);
const ids: string[] = [];
for (const [i, o] of (["MSNR", "DSLP Full", "DSLP", "Additional Deposit / Top-up", "MSNR", "MSNR", "Onboarding call", "DWT"] as const).entries()) {
  r = await open(i, o);
  ids.push(String(r.body?.id ?? r.body?.followup?.id ?? ""));
  if (r.status !== 200) check(`opened ${o}`, false, show(r));
}
check("MSNR, DSLP Full, the old DSLP and the rest open", ids.every(Boolean), JSON.stringify(ids));
r = await open(8, "Nonsense");
check("anything else is refused", r.status === 400 && /target outcome/.test(JSON.stringify(r.body)), show(r));

step("Money approved after they were opened");
await Bun.sleep(1100);
const later = new Date(Date.now() + 1000).toISOString();
const earlier = "2020-01-01T00:00:00.000Z";
const sid = (i: number) => String(students[i]._id);
const tx = (i: number, over: Record<string, unknown>) => ({ _id: new ObjectId(), student_id: sid(i), status: "APPROVED", approved_at: later, created_date: later, ...over });
await db.collection("funding_transactions").insertMany([
  tx(0, { type: "BONUS", amount_usd: 1500, tags: ["MSNR"], course_payment: { product: "MSNR" } }),            // MSNR by a bonus course payment
  tx(2, { type: "BONUS", amount_usd: 5000, tags: ["DSLP Offer"], course_payment: { product: "DSLP Offer" } }),  // the old DSLP, by DSLP Offer
  tx(3, { type: "BONUS", amount_usd: 900, tags: ["MSNR"] }),                                                    // Top-up: a bonus is not a top-up…
  tx(3, { type: "DEPOSIT", amount_usd: 700, approved_at: new Date(Date.now() + 2000).toISOString() }),         // …a deposit is
  tx(4, { type: "BONUS", amount_usd: 500, tags: ["MSNR"], approved_at: earlier }),                              // before it was opened
  tx(5, { type: "BONUS", amount_usd: 500, tags: ["MSNR"], bonus_credit: "sales_close" }),                       // a sales-close credit
  tx(6, { type: "DEPOSIT", amount_usd: 300 }),                                                                  // Onboarding call: never
  tx(7, { type: "DEPOSIT", amount_usd: 1000, tags: ["DWT"] }),                                                  // DWT by a tagged deposit
]);
// DSLP Full by a course upgrade to DSLP PRO: one approved payment of AED 7,340, one still pending.
const up = new ObjectId();
await db.collection("course_upgrades").insertOne({ _id: up, student_id: sid(1), course: "DSLP_PRO", plan: "installments", status: "open", created_at: later });
await db.collection("course_payments").insertMany([
  { _id: new ObjectId(), upgrade_id: String(up), student_id: sid(1), amount_aed: 7340, approved_amount_aed: 7340, status: "approved", decided_at: later, recorded_at: later },
  { _id: new ObjectId(), upgrade_id: String(up), student_id: sid(1), amount_aed: 2000, status: "pending", recorded_at: later },
]);

r = await call("/api/functions/getFollowups", {}, tAdmin);
const rows: any[] = r.body?.followups ?? [];
const of = (i: number) => rows.find((f) => String(f.student_id) === sid(i));
check("MSNR: converted by its bonus course payment, $1,500", of(0)?.stage === "Converted" && of(0)?.deal_value === 1500, JSON.stringify(of(0)));
check("DSLP Full: converted by the DSLP PRO upgrade payment, $2,000 (AED 7,340)", of(1)?.stage === "Converted" && of(1)?.deal_value === 2000, JSON.stringify(of(1)));
check("the old DSLP: converted by DSLP Offer", of(2)?.stage === "Converted" && of(2)?.deal_value === 5000, JSON.stringify(of(2)));
check("Top-up: converted by the deposit, not the bonus ($700)", of(3)?.stage === "Converted" && of(3)?.deal_value === 700, JSON.stringify(of(3)));
check("money approved before it was opened: still open", of(4)?.stage !== "Converted", JSON.stringify(of(4)?.stage));
check("a sales-close bonus credit: still open", of(5)?.stage !== "Converted", JSON.stringify(of(5)?.stage));
check("an Onboarding call: never automatic", of(6)?.stage !== "Converted", JSON.stringify(of(6)?.stage));
check("DWT: converted by a deposit tagged DWT, as before", of(7)?.stage === "Converted" && of(7)?.deal_value === 1000, JSON.stringify(of(7)));
const ev = await db.collection("student_followup_events").findOne({ student_id: sid(1), kind: "auto_converted" });
check("its history says how", /approved course upgrade payment of \$2,000/.test(String(ev?.text ?? "")), String(ev?.text));

await client.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
