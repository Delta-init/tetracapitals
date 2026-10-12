/**
 * Course upgrades open their LMS modules as Delta Finance approves payments (courses/upgradeLms.ts, the user
 * 2026-10-12), against a stand-in LMS:
 *   - a payment approved: each course the upgrade opens gets its first modules in proportion to what is paid —
 *     a course they aren't on is given, the rest locked; the CS is told; the history says so;
 *   - the next approved payment opens more; paid in full opens all; a module open already is never locked again;
 *   - a rejected payment, or nothing paid, opens nothing;
 *   - the LMS refusing: noted, not tried again until it is due, then tried again and done;
 *   - an upgrade approved before this existed is caught up; COURSE_LMS_SYNC=off keeps a server out of it.
 * Run through ./test-upgrade-lms.sh. Refuses anything but a scratch database on 127.0.0.1.
 */
import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGO_URI ?? "", dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) { console.error("Refusing to run"); process.exit(1); }
let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); } else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const client = await new MongoClient(uri).connect();
const db = client.db(dbName);
await db.dropDatabase();

/* ── A stand-in LMS: DSLP (10 modules, not on it), DWT (5, on it, all locked), MMC (4, not on it) ── */
const mods = (p: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: new ObjectId().toHexString(), title: `${p} ${i + 1}` }));
const COURSES = [
  { courseId: new ObjectId().toHexString(), title: "DSLP - Delta Structure & Liquidity Programme", modules: mods("DSLP", 10) },
  { courseId: new ObjectId().toHexString(), title: "DELTA WAVE THEORY TRADING PROGRAMME", modules: mods("DWT", 5) },
  { courseId: new ObjectId().toHexString(), title: "MMC (MARKET MAKING CYCLE)", modules: mods("MMC", 4) },
];
const [DSLP, DWT, MMC] = COURSES as [any, any, any];
const enrolled = new Map<string, { enrolmentId: string; courseId: string; locked: Set<string> }>([
  [DWT.courseId, { enrolmentId: new ObjectId().toHexString(), courseId: DWT.courseId, locked: new Set(DWT.modules.map((m: any) => m.id)) }],
]);
let refuse = false;
const bys: string[] = [];
const access = () => ({
  student: { id: "lms-1", name: "Sara", email: "sara@upg.test", academy: "Dubai", approved: true, active: true },
  courses: [...enrolled.values()].map((e) => {
    const c = COURSES.find((x) => x.courseId === e.courseId)!;
    return { enrolmentId: e.enrolmentId, courseId: c.courseId, title: c.title, modules: c.modules.map((m: any) => ({ ...m, locked: e.locked.has(m.id) })) };
  }),
  offered: COURSES.filter((c) => !enrolled.has(c.courseId)),
});
const lms = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    if (req.headers.get("x-portal-secret") !== "upgrade-lms-e2e-secret") return Response.json({ message: "bad secret" }, { status: 401 });
    if (refuse) return Response.json({ error: { message: "The LMS is down for a moment" } }, { status: 503 });
    const path = new URL(req.url).pathname.replace("/api/v1/service", "");
    const b: any = await req.json().catch(() => ({}));
    if (b.byName) bys.push(`${b.byName}|${b.byEmail}`);
    if (path === "/students/course-access") return Response.json({ data: access() });
    if (path === "/students/course-access/give") {
      for (const c of b.courses) enrolled.set(c.courseId, { enrolmentId: new ObjectId().toHexString(), courseId: c.courseId, locked: new Set(c.locked) });
      return Response.json({ data: access() });
    }
    const m = path.match(/^\/students\/course-access\/([a-f\d]{24})$/);
    const e = m ? [...enrolled.values()].find((x) => x.enrolmentId === m[1]) : null;
    if (e) { e.locked = new Set(b.locked); return Response.json({ data: access() }); }
    return Response.json({ error: { message: `Route POST ${path} not found` } }, { status: 404 });
  },
});
Object.assign(process.env, { LMS_API_URL: `http://127.0.0.1:${lms.port}`, LMS_SERVICE_SECRET: "upgrade-lms-e2e-secret" });

const { connectDb, closeDb } = await import("../db");
const { decideCoursePayment } = await import("../courses/coursePayments");
const U = await import("../courses/upgradeLms");
await connectDb();

const cs = new ObjectId();
await db.collection("users").insertOne({ _id: cs, full_name: "Cee", email: "cee@e2e.test", app_role: "cs", status: "active" } as any);
const sid = new ObjectId();
await db.collection("students").insertOne({ _id: sid, full_name: "Sara", email: "Sara@upg.test", primary_mentor_id: String(cs) } as any);
const quote = { course: "DSLP_PRO", plan: "installments", priceAed: 10000, deductions: [], dueAed: 10000, schedule: [3000, 5000, 2000], noBonusAed: 10000, steps: 0, bonusUsd: 0 };
const up = new ObjectId();
await db.collection("course_upgrades").insertOne({ _id: up, student_id: String(sid), course: "DSLP_PRO", plan: "installments", quote, status: "open", created_at: new Date().toISOString() } as any);
const pay = async (aed: number, upgrade = up, student = sid) => (await db.collection("course_payments").insertOne({ upgrade_id: String(upgrade), student_id: String(student), amount_aed: aed, status: "pending", recorded_at: new Date().toISOString() } as any)).insertedId;
const decide = async (id: ObjectId, decision: "approved" | "rejected", aed: number) => {
  await decideCoursePayment(id, { decision, byName: "Fin", byEmail: "fin@e2e.test", at: new Date().toISOString(), note: "", reason: decision === "rejected" ? "No receipt" : "", transactionId: `TX-${aed}`, amountMinor: aed * 100 });
  await new Promise((r) => setTimeout(r, 400));   // the opening runs just after finance's answer
};
const openCount = (c: any) => { const e = enrolled.get(c.courseId); return e ? c.modules.filter((m: any) => !e.locked.has(m.id)).length : null; };
const firstOpen = (c: any, n: number) => { const e = enrolled.get(c.courseId)!; return c.modules.every((m: any, i: number) => (i < n) === !e.locked.has(m.id)); };

step("Nothing paid, or a payment rejected: nothing opens");
check("nothing paid: share 0, nothing done", (await U.syncUpgradeLms(String(up))).courses?.length === 0 && openCount(DSLP) === null);
await decide(await pay(1500), "rejected", 1500);
check("a rejected payment opens nothing", openCount(DSLP) === null && openCount(DWT) === 0);

step("Approved payments open modules in proportion");
await decide(await pay(3000), "approved", 3000);
check("30% paid: DSLP given with its first 3 of 10 open, the rest locked", openCount(DSLP) === 3 && firstOpen(DSLP, 3), String(openCount(DSLP)));
check("…DWT (on it) its first 2 of 5 (rounded up), MMC given with 2 of 4", openCount(DWT) === 2 && firstOpen(DWT, 2) && openCount(MMC) === 2, `${openCount(DWT)} ${openCount(MMC)}`);
check("done from the shared support account, as Delta Finance approval", bys.length > 0 && bys.every((b) => b === "Delta Finance approval|"), bys.join(","));
const n1 = await db.collection("notifications").find({ user_id: String(cs), type: "upgrade_lms" }).toArray();
check("the CS is told", n1.length === 1 && /30% paid/.test(n1[0]!.message) && /StudentDetail/.test(n1[0]!.link), JSON.stringify(n1));
check("the history says so", (await db.collection("student_history").find({ student_id: String(sid), text: /LMS modules opened .*30% paid/ }).toArray()).length === 1);
let u: any = await db.collection("course_upgrades").findOne({ _id: up });
check("the upgrade notes it: share 0.3, done by Delta Finance approval", u.lms_sync?.share === 0.3 && u.lms?.done_by_name === "Delta Finance approval", JSON.stringify(u.lms_sync));
check("nothing more to do until more is paid", !(await U.upgradesToSync()).includes(String(up)));

// Their CS opens all of DWT by hand in between.
enrolled.get(DWT.courseId)!.locked = new Set();
await decide(await pay(5000), "approved", 5000);
check("80% paid: DSLP 8 of 10, MMC 4 of 4 (3.2 rounded up)", openCount(DSLP) === 8 && firstOpen(DSLP, 8) && openCount(MMC) === 4, `${openCount(DSLP)} ${openCount(MMC)}`);
check("DWT opened by hand stays all open — never locked again", openCount(DWT) === 5);
await decide(await pay(2000), "approved", 2000);
u = await db.collection("course_upgrades").findOne({ _id: up });
check("paid in full: everything open, the upgrade done", openCount(DSLP) === 10 && openCount(DWT) === 5 && openCount(MMC) === 4 && u.status === "done" && u.lms_sync?.share === 1, `${openCount(DSLP)} ${u.status}`);

step("The LMS refusing, then taking it");
const s2 = new ObjectId(), up2 = new ObjectId();
await db.collection("students").insertOne({ _id: s2, full_name: "Omar", email: "sara@upg.test", primary_mentor_id: String(cs) } as any);
await db.collection("course_upgrades").insertOne({ _id: up2, student_id: String(s2), course: "MSNR", plan: "installments", quote: { ...quote, course: "MSNR", dueAed: 4000 }, status: "open" } as any);
enrolled.delete(MMC.courseId);
refuse = true;
await decide(await pay(2000, up2, s2), "approved", 2000);
u = await db.collection("course_upgrades").findOne({ _id: up2 });
check("refused: the reason noted, retry set, nothing opened", /down for a moment/.test(u.lms_sync?.error ?? "") && !!u.lms_sync?.retry_at && !enrolled.has(MMC.courseId), JSON.stringify(u.lms_sync));
check("not tried again before it is due", !(await U.upgradesToSync()).includes(String(up2)));
refuse = false;
await db.collection("course_upgrades").updateOne({ _id: up2 }, { $set: { "lms_sync.retry_at": new Date(Date.now() - 1000).toISOString() } });
check("due again: the worker opens it (MMC 2 of 4 at 50%)", (await U.upgradeLmsTick()) === 1 && openCount(MMC) === 2, String(openCount(MMC)));
u = await db.collection("course_upgrades").findOne({ _id: up2 });
check("…and the error cleared", !u.lms_sync?.error && u.lms_sync?.share === 0.5, JSON.stringify(u.lms_sync));

step("Caught up, and switched off");
const s3 = new ObjectId(), up3 = new ObjectId();
await db.collection("students").insertOne({ _id: s3, full_name: "Old One", email: "sara@upg.test", primary_mentor_id: String(cs) } as any);
await db.collection("course_upgrades").insertOne({ _id: up3, student_id: String(s3), course: "MBT", plan: "installments", quote: { ...quote, course: "MBT", dueAed: 1000 }, status: "done" } as any);
await db.collection("course_payments").insertOne({ upgrade_id: String(up3), student_id: String(s3), amount_aed: 1000, approved_amount_aed: 1000, status: "approved" } as any);
check("approved before this existed: on the list to catch up", (await U.upgradesToSync()).includes(String(up3)));
await U.upgradeLmsTick();
check("…caught up (no MBT course in this academy: nothing to open, not asked again)", !(await U.upgradesToSync()).includes(String(up3)));
check("COURSE_LMS_SYNC=off keeps a server out of it", (process.env.COURSE_LMS_SYNC = "off", !U.upgradeLmsOn()) && (delete process.env.COURSE_LMS_SYNC, U.upgradeLmsOn()));
check("modulesFor: 0 → none, 0.01 → 1, 1 → all", U.modulesFor(0, 10) === 0 && U.modulesFor(0.01, 10) === 1 && U.modulesFor(0.999, 10) === 10 && U.modulesFor(1, 10) === 10);

step("A course paid through a Bonus request (course_payment)");
// A fresh student in the stand-in LMS: on nothing yet.
enrolled.clear();
const s4 = new ObjectId();
await db.collection("students").insertOne({ _id: s4, full_name: "Nora", email: "nora@upg.test", primary_mentor_id: String(cs) } as any);
const bonusPay = (status: string, product: string, kind: string, plan: number, paid: number, tags: string[] = [product], at = new Date().toISOString()) => ({
  type: "BONUS", status, student_id: String(s4), amount_usd: paid / 3.67, requested_at: at, tags,
  course_payment: { product, kind, plan_aed: plan, paid_today_aed: paid, balance_aed: plan - paid },
});
await db.collection("funding_transactions").insertOne(bonusPay("PENDING", "DSLP", "partial", 20000, 3670) as any);
check("waiting for approval: nothing to open", !(await U.coursePaymentsToSync()).some((p) => p.studentId === String(s4)));
await db.collection("funding_transactions").updateOne({ student_id: String(s4) }, { $set: { status: "APPROVED" } });
check("approved: on the list", (await U.coursePaymentsToSync()).some((p) => p.studentId === String(s4) && p.product === "DSLP"));
let c = await U.syncCoursePaymentLms(String(s4), "DSLP");
check("DSLP 3,670 of 20,000 paid: given, its first 2 of 10 open (18% rounded up)", c.ok && openCount(DSLP) === 2 && firstOpen(DSLP, 2), JSON.stringify(c));
let st: any = (await db.collection("students").findOne({ _id: s4 }))?.course_lms_sync?.DSLP;
check("…noted on the student, not asked again", st?.share === 0.1835 && !(await U.coursePaymentsToSync()).some((p) => p.studentId === String(s4)), JSON.stringify(st));
check("…the CS told, the history says so", (await db.collection("notifications").find({ user_id: String(cs) }).toArray()).filter((n: any) => String(n.message).startsWith("DSLP") && String(n.message).includes("18% paid")).length === 1
  && (await db.collection("student_history").find({ student_id: String(s4) }).toArray()).filter((h: any) => String(h.text).includes("LMS modules opened for DSLP (18% paid)")).length === 1);
await db.collection("funding_transactions").insertOne(bonusPay("APPROVED", "DSLP", "partial", 20000, 6330, ["DSLP", "DWT"]) as any);
c = (await U.upgradeLmsTick(), { ok: true });
check("the next approved payment (50% now), by the worker: DSLP 5 of 10; a bundled DWT given too, 3 of 5", openCount(DSLP) === 5 && openCount(DWT) === 3, `${openCount(DSLP)} ${openCount(DWT)}`);
await db.collection("funding_transactions").insertOne(bonusPay("APPROVED", "DSLP", "partial", 20000, 10000) as any);
await U.syncCoursePaymentLms(String(s4), "DSLP");
check("nothing left to pay: all of DSLP and DWT", openCount(DSLP) === 10 && openCount(DWT) === 5);

enrolled.clear();
const s5 = new ObjectId();
await db.collection("students").insertOne({ _id: s5, full_name: "Ola", email: "ola@upg.test", primary_mentor_id: String(cs) } as any);
await db.collection("funding_transactions").insertMany([
  { ...bonusPay("APPROVED", "DSLP — Offer Price", "full", 18350, 18350), student_id: String(s5) },
  { ...bonusPay("APPROVED", "HADC", "full", 1000, 1000), student_id: String(s5) },
] as any);
await U.syncCoursePaymentLms(String(s5), "DSLP — Offer Price");
check("a Full payment for DSLP Offer: its first 10 of DSLP (here all 10)", openCount(DSLP) === 10);
const h = await U.syncCoursePaymentLms(String(s5), "HADC");
st = (await db.collection("students").findOne({ _id: s5 }))?.course_lms_sync?.HADC;
check("a product with no LMS course (HADC): nothing opened, noted, not asked again", h.ok && h.courses?.length === 0 && st?.unmapped === true
  && !(await U.coursePaymentsToSync()).some((p) => p.studentId === String(s5)), JSON.stringify(st));

refuse = true;
const s6 = new ObjectId();
await db.collection("students").insertOne({ _id: s6, full_name: "Pia", email: "pia@upg.test", primary_mentor_id: String(cs) } as any);
await db.collection("funding_transactions").insertOne({ ...bonusPay("APPROVED", "MSNR", "full", 4000, 4000), student_id: String(s6) } as any);
const bad = await U.syncCoursePaymentLms(String(s6), "MSNR");
check("the LMS refusing: noted, tried again later", !bad.ok && !(await U.coursePaymentsToSync()).some((p) => p.studentId === String(s6)));
refuse = false;
await db.collection("students").updateOne({ _id: s6 }, { $set: { "course_lms_sync.MSNR.retry_at": new Date(Date.now() - 1000).toISOString() } });
await U.upgradeLmsTick();
check("…and done when due: MMC all open", openCount(MMC) === 4, String(openCount(MMC)));

lms.stop(true);
console.log(`\n${pass} passed, ${fail} failed`);
await closeDb();
await client.close();
process.exit(fail ? 1 : 0);
