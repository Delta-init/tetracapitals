/**
 * scripts/set-bonus-course.ts against a scratch database: a student's second course payment, raised under the wrong
 * course with nothing paid before, put on the course it pays towards — the course balance one course with what is
 * really left, the CSE courses one line, history and log written; the dry run changes nothing; undo puts it back.
 * Run through ./test-set-bonus-course.sh (throwaway mongod; nothing reads a .env).
 */
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "", dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+/.test(uri) || !/e2e/i.test(dbName)) { console.error(`Refusing: a scratch e2e database on 127.0.0.1 only (${uri} / ${dbName})`); process.exit(1); }
let failures = 0, checks = 0;
const check = (label: string, ok: boolean, detail = "") => { checks++; if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`); else { failures++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); } };
const j = (v: unknown) => JSON.stringify(v).slice(0, 500);

const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
await db.dropDatabase();
const home = mkdtempSync(join(tmpdir(), "set-bonus-course-e2e-"));
const sid = new ObjectId(), SID = String(sid);
await db.collection("students").insertOne({ _id: sid, student_code: "STU-4185", full_name: "Student One" });
const cp = (o: Record<string, unknown>) => ({ kind: "partial", price_currency: "AED", plan_aed: 20_000, hold_aed: 0, bonus_usd: 0, ...o });
const first = new ObjectId(), second = new ObjectId(), rejected = new ObjectId();
await db.collection("funding_transactions").insertMany([
  { _id: rejected, type: "BONUS", status: "REJECTED", student_id: SID, requested_at: "2026-10-09T10:10:00.000Z", course_payment: cp({ product: "DSLP Offer", price: 18_350, paid_today_aed: 12_830 }) },
  { _id: first, type: "BONUS", status: "APPROVED", transaction_id: "MB-000116", student_id: SID, requested_at: "2026-10-13T09:05:00.000Z",
    course_payment: cp({ product: "DSLP Offer", price: 18_350, paid_today_aed: 12_830, paid_before_aed: 0, paid_total_aed: 12_830, balance_aed: 7_170, hold_aed: 830, bonus_usd: 3_000 }) },
  { _id: second, type: "BONUS", status: "APPROVED", transaction_id: "MB-000697", student_id: SID, requested_at: "2026-11-12T12:21:57.078Z",
    course_invoice: { invoice_number: "IN-00301" },
    course_payment: cp({ product: "DSLP", price: 18_370, paid_today_aed: 6_560.87, paid_before_aed: 0, paid_total_aed: 6_560.87, balance_aed: 13_439.13, hold_aed: 560.87, bonus_usd: 1_500 }) },
]);
await db.collection("student_courses").insertOne({ student_id: SID, owned: [{ code: "DSLP_OFFER", plan: "installments", paid_aed: 12_830 }, { code: "DSLP_PRO", plan: "installments", paid_aed: 6_560.87 }], entered_by_name: "CS" });

const run = async (...args: string[]) => {
  const p = Bun.spawn(["bun", "--no-env-file", "src/scripts/set-bonus-course.ts", ...args], { env: { ...process.env, HOME: home, MONGO_URI: uri, MONGO_DB: dbName }, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out + err };
};
const tx = (id: ObjectId) => db.collection("funding_transactions").findOne({ _id: id }) as Promise<any>;
const balances = async () => {
  process.env.MONGO_URI = uri; process.env.MONGO_DB = dbName;
  const { connectDb, closeDb } = await import("../db");
  await connectDb();
  const { courseBalancesOf } = await import("../courses/courseBalance");
  const b = (await courseBalancesOf([SID])).get(SID) ?? [];
  await closeDb();
  return b;
};

console.log("\n\x1b[1mBefore\x1b[0m");
const b0 = await balances();
check("the portal counts two courses: AED 7,170 + AED 13,439.13 left", b0.length === 2 && b0.some((x) => x.course === "DSLP" && x.balanceAed === 13_439.13) && b0.some((x) => x.course === "DSLP Offer" && x.balanceAed === 7_170), j(b0));

console.log("\n\x1b[1mShown, not changed\x1b[0m");
const args = ["--txn=MB-000697", "--to=DSLP Offer", "--merge-course=DSLP_PRO"];
const dry = await run(...args);
check("it says what it would do: DSLP → DSLP Offer, paid before AED 12,830, AED 19,390.87 to date, AED 609.13 left, one CSE course line",
  dry.code === 0 && /course\s+DSLP → DSLP Offer/.test(dry.out) && /paid before\s+AED 0 → AED 12,830/.test(dry.out) && /paid to date\s+AED 6,560\.87 → AED 19,390\.87/.test(dry.out)
  && /balance\s+AED 13,439\.13 → AED 609\.13/.test(dry.out) && /CSE courses\s+DSLP Offer AED 12,830, DSLP PRO Full AED 6,560\.87 → DSLP Offer AED 19,390\.87/.test(dry.out), dry.out);
check("…the earlier one turned down is not counted", !/MB-000116 AED 12,830, /.test(dry.out) && /1 earlier request: MB-000116 AED 12,830/.test(dry.out), dry.out);
check("…and nothing changed", (await tx(second)).course_payment.product === "DSLP" && (await db.collection("student_courses").findOne({ student_id: SID }))!.owned.length === 2);
check("a course it has no earlier payment for: refused", (await run("--txn=MB-000697", "--to=DQMP")).code === 1);
check("no such request: refused", (await run("--txn=MB-999999", "--to=DSLP Offer")).code === 1);

console.log("\n\x1b[1m--apply\x1b[0m");
const done = await run(...args, "--apply");
const t2 = await tx(second);
check("the request: DSLP Offer at its price and plan, AED 12,830 before, 19,390.87 to date, 609.13 left",
  done.code === 0 && t2.course_payment.product === "DSLP Offer" && t2.course_payment.price === 18_350 && t2.course_payment.plan_aed === 20_000 && t2.course_payment.paid_before_aed === 12_830
  && t2.course_payment.paid_total_aed === 19_390.87 && t2.course_payment.balance_aed === 609.13 && t2.course_payment.short_aed === 609.13, j(t2.course_payment));
check("…what was paid now, on hold, the MT5 bonus, status and invoice untouched",
  t2.course_payment.paid_today_aed === 6_560.87 && t2.course_payment.hold_aed === 560.87 && t2.course_payment.bonus_usd === 1_500 && t2.status === "APPROVED" && t2.course_invoice.invoice_number === "IN-00301");
const b1 = await balances();
check("the portal's course balance: one course, AED 609.13 left of AED 20,000", b1.length === 1 && b1[0]!.course === "DSLP Offer" && b1[0]!.balanceAed === 609.13 && b1[0]!.paidAed === 19_390.87, j(b1));
const sc = await db.collection("student_courses").findOne({ student_id: SID });
check("the CSE courses: one line, DSLP Offer AED 19,390.87", sc!.owned.length === 1 && sc!.owned[0].code === "DSLP_OFFER" && sc!.owned[0].paid_aed === 19_390.87 && sc!.owned[0].plan === "installments", j(sc!.owned));
const hist = await db.collection("student_history").find({ student_id: SID }).toArray();
check("the student's history and the log say so", hist.length === 2 && hist.some((h: any) => /put on DSLP Offer \(was DSLP\)/.test(h.text)) && (await db.collection("logs").countDocuments({ action_type: "set_bonus_course" })) === 1, j(hist.map((h: any) => h.text)));
check("the first request untouched", (await tx(first)).course_payment.balance_aed === 7_170);

console.log("\n\x1b[1mUndo\x1b[0m");
const file = join(home, readdirSync(home).find((f) => f.startsWith("set-bonus-course-"))!);
const undone = await run(`--undo=${file}`, "--apply");
const t3 = await tx(second);
const sc3 = await db.collection("student_courses").findOne({ student_id: SID });
check("puts the request and the courses back as they were", undone.code === 0 && t3.course_payment.product === "DSLP" && t3.course_payment.balance_aed === 13_439.13 && sc3!.owned.length === 2, undone.out);

await client.close();
console.log(`\n${failures ? "\x1b[31m" : "\x1b[32m"}${checks - failures}/${checks} checks passed\x1b[0m`);
process.exit(failures ? 1 : 0);
