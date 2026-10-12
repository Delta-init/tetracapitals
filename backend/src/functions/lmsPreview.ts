import { ObjectId } from "mongodb";
import { col } from "../db";
import { json, error } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { callLms, lmsConfigured } from "../lib/lms";
import { lmsTargetsOf, lmsTargetsOfProducts, productKey, sameTitle, type LmsTarget } from "../courses/lmsMapping";
import { modulesFor } from "../courses/upgradeLms";
import { approvedAmounts } from "../courses/coursePayments";
import { progressOf } from "../courses/upgradeCalc";
import { lmsStudentFor, lmsLacksRoute } from "./lmsEnrolmentRequests";

/* ────────────────────────────────────────────────────────────────────────────
   What a course payment will open in the LMS — shown while it is being
   recorded (the user, 2026-10-12): the New Funding Request form's Bonus course
   payment, and a Course Upgrade's "Record payment". For each LMS course the
   product (or upgrade) opens: the modules open now, and how many will be open
   once this payment is approved — by the same rule as the automatic opening
   (courses/upgradeLms.ts): in proportion to what is paid, counting finance-
   approved payments and this one; all on a full payment or when nothing is
   left. Read only: nothing changes until the payment is approved.
──────────────────────────────────────────────────────────────────────────── */

type LmsModule = { id: string; title: string; locked?: boolean };
type LmsAccess = {
  courses: { courseId: string; title: string; modules: LmsModule[] }[];
  offered: { courseId: string; title: string; modules: LmsModule[] }[];
};
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * POST /api/functions/previewCourseLms
 *   { studentId, products: [name], kind: "full" | "partial", planAed, todayAed }   a Bonus course payment
 *   { upgradeId, payAed }                                                          a Course Upgrade payment
 * → { configured, account, share, paidAed, totalAed, pendingAed, courses: [{ title, onCourse, total, openNow, openAfter,
 *     unlock: [title], firstModules? }], unmapped }
 */
export async function previewCourseLms(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  let studentId = String(body?.studentId ?? "");
  let targets: LmsTarget[] = [];
  let share = 0, paidAed = 0, totalAed = 0, pendingAed = 0;

  if (body?.upgradeId) {
    if (!ObjectId.isValid(String(body.upgradeId))) return error("upgradeId is not valid", 400);
    const u: any = await col("course_upgrades").findOne({ _id: new ObjectId(String(body.upgradeId)) });
    if (!u) return error("No such upgrade", 404);
    studentId = String(u.student_id);
    targets = lmsTargetsOf(u.course).targets;
    const payments = (await col("course_payments").find({ upgrade_id: String(u._id) }).toArray()) as any[];
    const approved = approvedAmounts(payments).reduce((s, n) => s + n, 0);
    pendingAed = cents(payments.filter((p) => p.status === "pending").reduce((s, p) => s + (Number(p.amount_aed) || 0), 0));
    totalAed = Number(u.quote?.dueAed) || 0;
    paidAed = cents(approved + Math.max(0, Number(body.payAed) || 0));
    share = progressOf(u.quote, [paidAed]).done || !totalAed ? 1 : Math.min(1, paidAed / totalAed);
  } else {
    const products: string[] = (Array.isArray(body?.products) ? body.products : []).map(String).filter(Boolean);
    if (!products.length) return error("Pick the product", 400);
    targets = lmsTargetsOfProducts(products);
    const key = productKey(products[0]);
    const txs = ObjectId.isValid(studentId)
      ? ((await col("funding_transactions").find({ student_id: studentId, type: "BONUS", "course_payment.product": { $exists: true } }, { projection: { status: 1, course_payment: 1 } }).toArray()) as any[])
        .filter((t) => productKey(t.course_payment?.product) === key)
      : [];
    const sum = (status: string) => txs.filter((t) => t.status === status).reduce((s, t) => s + (Number(t.course_payment?.paid_today_aed) || 0), 0);
    pendingAed = cents(sum("PENDING"));
    totalAed = Number(body?.planAed) || 0;
    paidAed = cents(sum("APPROVED") + Math.max(0, Number(body?.todayAed) || 0));
    const fullBefore = txs.some((t) => t.status === "APPROVED" && t.course_payment?.kind === "full");
    share = body?.kind === "full" || fullBefore || !totalAed || totalAed - paidAed <= 1 ? 1 : Math.min(1, paidAed / totalAed);
  }

  // Who may see it: whoever may act for the student in the LMS (as LMS Requests).
  const found = await lmsStudentFor({ studentId }, user);
  if (found instanceof Response) return found;
  const base = { share: Math.round(share * 10_000) / 10_000, paidAed, totalAed, pendingAed, unmapped: !targets.length };
  if (!targets.length) return json({ configured: lmsConfigured(), account: null, courses: [], ...base });
  if (!lmsConfigured()) return json({ configured: false, courses: [], ...base });

  let access: LmsAccess;
  try {
    access = await callLms<LmsAccess>("/students/course-access", { method: "POST", body: { email: found.email }, verb: "share their courses" });
  } catch (err) {
    if (lmsLacksRoute(err)) return error("The LMS can't share course access yet", 409);
    // No LMS account yet (or the LMS can't be reached): said, not an error for the form.
    return json({ configured: true, account: false, why: String((err as Error)?.message ?? "").replace(/^The LMS would not [^:]+: /, ""), courses: [], ...base });
  }
  const courses = targets.map((t) => {
    const on = access.courses.find((c) => sameTitle(c.title, t.title));
    const course = on ?? access.offered.find((c) => sameTitle(c.title, t.title));
    if (!course) return { title: t.title, missing: true };
    const total = course.modules.length;
    const want = modulesFor(share, t.firstModules ?? total);
    const openNowIds = new Set(on ? on.modules.filter((m) => !m.locked).map((m) => m.id) : []);
    const after = new Set([...openNowIds, ...course.modules.slice(0, want).map((m) => m.id)]);
    return {
      title: course.title, onCourse: !!on, total, firstModules: t.firstModules ?? null,
      openNow: openNowIds.size, openAfter: after.size,
      unlock: course.modules.filter((m) => after.has(m.id) && !openNowIds.has(m.id)).map((m) => m.title),
      stillLocked: total - after.size,
    };
  });
  return json({ configured: true, account: true, courses, ...base });
}
