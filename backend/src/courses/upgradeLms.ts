import { ObjectId } from "mongodb";
import { col } from "../db";
import { callLms, lmsConfigured, LmsError } from "../lib/lms";
import { notify } from "../lib/notify";
import { recordHistory } from "../students/history";
import { lmsTargetsOf, lmsTargetsOfProducts, productKey, sameTitle, type LmsTarget } from "./lmsMapping";
import { approvedAmounts } from "./coursePayments";
import { progressOf } from "./upgradeCalc";
import { DEFAULT_PRICE_LIST } from "./priceList";

/* ────────────────────────────────────────────────────────────────────────────
   An upgrade's LMS modules open by themselves as it is paid (the user,
   2026-10-12) — only for payments Delta Finance approved:

     each LMS course the upgrade opens (lmsMapping.ts) opens its first modules
     in proportion to what is paid — paid / due of its modules, rounded up
     (DSLP Offer counts its first 10 as the whole) — and all of them once paid
     in full. A course they are not on is given, its other modules locked. A
     module already open is never locked again.

   Run when finance approves a payment (coursePayments.ts), and every few
   minutes for any upgrade whose paid share is ahead of what was opened — so
   one the LMS refused or couldn't be reached for is tried again, and those
   approved before this existed are caught up. Done in the LMS from the shared
   support account, as "Delta Finance approval". The CS is told on the bell
   and their phone; their "Update LMS modules" button stays, to open more.
   COURSE_LMS_SYNC=off keeps a server out of it.

   A course paid through a Bonus funding request (its course_payment) opens the
   same way once a broker admin approves it — see syncCoursePaymentLms.
──────────────────────────────────────────────────────────────────────────── */

type LmsModule = { id: string; title: string; locked?: boolean };
type LmsAccess = {
  courses: { enrolmentId: string; courseId: string; title: string; modules: LmsModule[] }[];
  offered: { courseId: string; title: string; modules: LmsModule[] }[];
};

const BY = { byName: "Delta Finance approval", byEmail: "" };
const RETRY_MS = 15 * 60_000;
const TICK_MS = 5 * 60_000;

/** How many of a course's `n` modules a paid share opens: rounded up, all once paid in full, none before any payment. */
export const modulesFor = (share: number, n: number) => (share >= 1 ? n : share <= 0 ? 0 : Math.min(n, Math.ceil(share * n)));

/** The share of the upgrade paid, from finance's approved payments: 0 … 1. */
export async function paidShareOf(u: any): Promise<number> {
  const payments = (await col("course_payments").find({ upgrade_id: String(u._id) }).toArray()) as any[];
  const p = progressOf(u.quote, approvedAmounts(payments));
  if (p.done) return 1;
  const due = Number(u.quote?.dueAed) || 0;
  return due > 0 ? Math.min(1, Math.round((p.paidAed / due) * 10_000) / 10_000) : 1;
}

async function courseName(code: string): Promise<string> {
  const doc: any = await col("settings").findOne({ key: "cse_price_list" });
  const list = Array.isArray(doc?.courses) && doc.courses.length ? doc.courses : DEFAULT_PRICE_LIST;
  return list.find((c: any) => c.code === code)?.name ?? code;
}

/**
 * In the LMS, for the student with `email`: each target course opens its first modules for `share` — given first when
 * they aren't on it (the rest locked) — never locking one open. → what changed, e.g. ["DSLP (4 of 10 open)"]. Throws
 * the LMS's refusal.
 */
export async function openModules(email: string, targets: LmsTarget[], share: number): Promise<string[]> {
  const done: string[] = [];
  let access = await callLms<LmsAccess>("/students/course-access", { method: "POST", body: { email }, verb: "share their courses" });
  for (const t of targets) {
    const on = access.courses.find((c) => sameTitle(c.title, t.title));
    const offered = on ? null : access.offered.find((c) => sameTitle(c.title, t.title));
    const course = on ?? offered;
    if (!course) continue;   // not one of their academy's courses — nothing to open there
    const want = modulesFor(share, t.firstModules ?? course.modules.length);
    const open = new Set(course.modules.slice(0, want).map((m) => m.id));
    if (on) {
      const locked = on.modules.filter((m) => m.locked && !open.has(m.id)).map((m) => m.id);
      if (locked.length !== on.modules.filter((m) => m.locked).length) {
        access = await callLms(`/students/course-access/${on.enrolmentId}`, { method: "POST", body: { email, locked, ...BY }, verb: "open the modules" });
        done.push(`${on.title} (${on.modules.length - locked.length} of ${on.modules.length} open)`);
      }
    } else if (offered && want > 0) {
      const locked = offered.modules.filter((m) => !open.has(m.id)).map((m) => m.id);
      access = await callLms("/students/course-access/give", { method: "POST", body: { email, courses: [{ courseId: offered.courseId, locked }], ...BY }, verb: "give the course" });
      done.push(`${offered.title} — given, ${offered.modules.length - locked.length} of ${offered.modules.length} open`);
    }
  }
  return done;
}

/**
 * Opens what the upgrade's paid share opens. → { ok, courses: ["DSLP (4 of 10 open)"], share } or { ok: false, error }.
 * Nothing to do (nothing paid, no LMS courses) is ok with no courses.
 */
export async function syncUpgradeLms(upgradeId: string): Promise<{ ok: boolean; share?: number; courses?: string[]; error?: string }> {
  const u: any = await col("course_upgrades").findOne({ _id: new ObjectId(upgradeId) });
  if (!u || u.status === "cancelled") return { ok: true, courses: [] };
  const share = await paidShareOf(u);
  if (share <= 0) return { ok: true, share, courses: [] };
  const fail = async (why: string) => {
    await col("course_upgrades").updateOne({ _id: u._id }, { $set: { lms_sync: { ...(u.lms_sync ?? {}), error: why, failed_at: new Date().toISOString(), retry_at: new Date(Date.now() + RETRY_MS).toISOString() } } });
    return { ok: false, share, error: why };
  };
  if (!lmsConfigured()) return fail("The LMS isn't connected on this server");
  const student: any = await col("students").findOne({ _id: new ObjectId(String(u.student_id)) }, { projection: { email: 1, full_name: 1, primary_mentor_id: 1 } });
  const email = String(student?.email ?? "").trim().toLowerCase();
  if (!email) return fail("The student has no email here to find their LMS account by");

  let done: string[];
  try {
    done = await openModules(email, lmsTargetsOf(u.course).targets, share);
  } catch (err) {
    return fail(err instanceof LmsError ? err.message : "The LMS could not be asked");
  }

  const now = new Date().toISOString();
  await col("course_upgrades").updateOne({ _id: u._id }, {
    $set: {
      lms_sync: { share, at: now, courses: done },
      ...(done.length ? { lms: { done_at: now, done_by: null, done_by_name: "Delta Finance approval", courses: done } } : {}),
    },
  });
  if (done.length) {
    const pct = Math.round(share * 100);
    const name = await courseName(u.course);
    await recordHistory([{
      student_id: String(u.student_id), at: now, type: "course_upgrade", by_id: null, by_name: "Delta Finance approval",
      text: `LMS modules opened for the ${name} upgrade (${pct}% paid): ${done.join(", ")}`.slice(0, 400),
    } as any]);
    const cs = String(student?.primary_mentor_id ?? "");
    if (cs) {
      await notify([cs], {
        type: "upgrade_lms",
        title: `LMS modules opened: ${String(student?.full_name ?? "").trim() || "a student"}`,
        body: `${name} — ${pct}% paid: ${done.join(", ")}`.slice(0, 300),
        link: `/StudentDetail?id=${String(u.student_id)}`,
      });
    }
  }
  return { ok: true, share, courses: done };
}

/* ── Bonus course payments (the user, 2026-10-12): a course paid through a Bonus funding request (course_payment) opens
   its LMS modules the same way once approved — per student and product: the share is what the approved requests paid
   of the plan (a Full payment, or nothing left to pay: all). Kept on the student as course_lms_sync[<product key>]. ── */

const PAID_COURSE = { type: "BONUS", status: "APPROVED", "course_payment.product": { $exists: true } };

/** The paid share of one product for one student, from approved requests only, and the products it brings (tags). */
async function courseShareOf(studentId: string, product: string): Promise<{ share: number; products: string[] }> {
  const txs = (await col("funding_transactions")
    .find({ ...PAID_COURSE, student_id: studentId }, { projection: { course_payment: 1, tags: 1, requested_at: 1, created_date: 1 } })
    .toArray()) as any[];
  const mine = txs.filter((t) => productKey(t.course_payment?.product) === productKey(product));
  if (!mine.length) return { share: 0, products: [] };
  const products = [...new Set(mine.flatMap((t) => [t.course_payment.product, ...(Array.isArray(t.tags) ? t.tags : [])]).map(String))];
  if (mine.some((t) => t.course_payment.kind === "full")) return { share: 1, products };
  const latest = [...mine].sort((a, b) => String(b.requested_at ?? b.created_date ?? "").localeCompare(String(a.requested_at ?? a.created_date ?? "")))[0];
  const plan = Number(latest.course_payment.plan_aed) || 0;
  const paid = mine.reduce((sum, t) => sum + (Number(t.course_payment.paid_today_aed) || 0), 0);
  if (!plan || plan - paid <= 1) return { share: 1, products };
  return { share: Math.min(1, Math.round((paid / plan) * 10_000) / 10_000), products };
}

/** Opens what a student's approved payments for `product` open. Same answer as syncUpgradeLms. */
export async function syncCoursePaymentLms(studentId: string, product: string): Promise<{ ok: boolean; share?: number; courses?: string[]; error?: string }> {
  const key = productKey(product);
  const oid = toObjectIdSafe(studentId) as ObjectId;
  const student: any = oid ? await col("students").findOne({ _id: oid }, { projection: { email: 1, full_name: 1, primary_mentor_id: 1, course_lms_sync: 1 } }) : null;
  if (!student || !key) return { ok: true, courses: [] };
  const { share, products } = await courseShareOf(studentId, product);
  if (share <= 0) return { ok: true, share, courses: [] };
  const was = student.course_lms_sync?.[key] ?? {};
  const fail = async (why: string) => {
    await col("students").updateOne({ _id: oid }, { $set: { [`course_lms_sync.${key}`]: { ...was, product, error: why, failed_at: new Date().toISOString(), retry_at: new Date(Date.now() + RETRY_MS).toISOString() } } });
    return { ok: false, share, error: why };
  };
  const targets = lmsTargetsOfProducts(products);
  if (!targets.length) {
    await col("students").updateOne({ _id: oid }, { $set: { [`course_lms_sync.${key}`]: { product, share, at: new Date().toISOString(), courses: [], unmapped: true } } });
    return { ok: true, share, courses: [] };
  }
  if (!lmsConfigured()) return fail("The LMS isn't connected on this server");
  const email = String(student.email ?? "").trim().toLowerCase();
  if (!email) return fail("The student has no email here to find their LMS account by");
  let done: string[];
  try {
    done = await openModules(email, targets, share);
  } catch (err) {
    return fail(err instanceof LmsError ? err.message : "The LMS could not be asked");
  }
  const now = new Date().toISOString();
  await col("students").updateOne({ _id: oid }, { $set: { [`course_lms_sync.${key}`]: { product, share, at: now, courses: done } } });
  if (done.length) {
    const pct = Math.round(share * 100);
    await recordHistory([{
      student_id: studentId, at: now, type: "course_upgrade", by_id: null, by_name: "Delta Finance approval",
      text: `LMS modules opened for ${product} (${pct}% paid): ${done.join(", ")}`.slice(0, 400),
    } as any]);
    const cs = String(student.primary_mentor_id ?? "");
    if (cs) {
      await notify([cs], {
        type: "upgrade_lms",
        title: `LMS modules opened: ${String(student.full_name ?? "").trim() || "a student"}`,
        body: `${product} — ${pct}% paid: ${done.join(", ")}`.slice(0, 300),
        link: `/StudentDetail?id=${studentId}`,
      });
    }
  }
  return { ok: true, share, courses: done };
}

/** Student + product pairs whose approved share is ahead of what was opened (or whose failed try is due again). */
export async function coursePaymentsToSync(now = Date.now()): Promise<{ studentId: string; product: string }[]> {
  const txs = (await col("funding_transactions").find(PAID_COURSE, { projection: { student_id: 1, course_payment: 1 } }).toArray()) as any[];
  const pairs = new Map<string, { studentId: string; product: string }>();
  for (const t of txs) {
    const sid = String(t.student_id ?? ""), product = String(t.course_payment?.product ?? "");
    if (sid && productKey(product)) pairs.set(`${sid}|${productKey(product)}`, { studentId: sid, product });
  }
  if (!pairs.size) return [];
  const ids = [...new Set([...pairs.values()].map((p) => p.studentId))].map(toObjectIdSafe).filter(Boolean);
  const states = new Map(((await col("students").find({ _id: { $in: ids as any[] } }, { projection: { course_lms_sync: 1 } }).toArray()) as any[])
    .map((s) => [String(s._id), s.course_lms_sync ?? {}]));
  const out: { studentId: string; product: string }[] = [];
  for (const p of pairs.values()) {
    const st = states.get(p.studentId)?.[productKey(p.product)];
    if (st?.retry_at && Date.parse(st.retry_at) > now) continue;
    if ((await courseShareOf(p.studentId, p.product)).share > (Number(st?.share) || 0)) out.push(p);
  }
  return out;
}

const toObjectIdSafe = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

/** Upgrades whose paid share is ahead of what was opened (or whose last try failed and is due again). */
export async function upgradesToSync(now = Date.now()): Promise<string[]> {
  const paid = (await col("course_payments").distinct("upgrade_id", { status: "approved" })) as string[];
  if (!paid.length) return [];
  const ups = (await col("course_upgrades")
    .find({ _id: { $in: paid.map((id) => new ObjectId(id)) }, status: { $ne: "cancelled" } })
    .toArray()) as any[];
  const out: string[] = [];
  for (const u of ups) {
    const s = u.lms_sync;
    if (s?.retry_at && Date.parse(s.retry_at) > now) continue;
    if ((await paidShareOf(u)) > (Number(s?.share) || 0)) out.push(String(u._id));
  }
  return out;
}

export async function upgradeLmsTick(): Promise<number> {
  let n = 0;
  for (const id of await upgradesToSync()) {
    const r = await syncUpgradeLms(id);
    if (r.ok && r.courses?.length) n++;
  }
  for (const p of await coursePaymentsToSync()) {
    const r = await syncCoursePaymentLms(p.studentId, p.product);
    if (r.ok && r.courses?.length) n++;
  }
  return n;
}

export const upgradeLmsOn = () => !/^(off|false|0|no)$/i.test(process.env.COURSE_LMS_SYNC ?? "");

/** Every 5 minutes (and once 2 minutes after start), unless COURSE_LMS_SYNC=off. */
export function startUpgradeLmsWorker(): void {
  if (!upgradeLmsOn()) { console.log("[upgrade-lms] off on this server (COURSE_LMS_SYNC=off)"); return; }
  const tick = () => upgradeLmsTick().catch((err) => console.error("[upgrade-lms] run failed", err));
  setTimeout(() => void tick(), 120_000);
  setInterval(() => void tick(), TICK_MS);
}
