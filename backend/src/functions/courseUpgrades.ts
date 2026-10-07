import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { visibleMentorIds, isStudentOf, studentsOf, canWorkOn } from "../students/followups";
import { recordHistory } from "../students/history";
import { DEFAULT_PRICE_LIST, type CourseCode, type CoursePrice } from "../courses/priceList";
import { quoteUpgrade, progressOf, UpgradeError, type OwnedCourse, type PlanType, type UpgradeQuote } from "../courses/upgradeCalc";

/*
 * CSE course upgrades (the user, 2026-10-07) — phase 2: the price list, each
 * student's courses, and starting an upgrade. Payments (approved by Delta
 * finance), the MT5 bonus they raise and the LMS modules follow in later
 * phases; until then an upgrade waits for its first payment.
 *
 * Collections:
 *   settings            { key: "cse_price_list", courses, updated_by, updated_at }
 *   student_courses     { student_id, owned: [{ code, plan, paid_aed }], entered_by, entered_at }
 *                       — the courses a student already had, entered once by their CS
 *   course_upgrades     { student_id, course, plan, quote, payments: [], status: open | done | cancelled, … }
 *
 * Who: the student's CS (and Common CSs), the people above them, and admins
 * (canWorkOn / visibleMentorIds, as follow-ups); the price list is a Super
 * Admin's to change.
 */

const PRICE_KEY = "cse_price_list";
const CODES = new Set<CourseCode>(DEFAULT_PRICE_LIST.map((c) => c.code));

export async function priceList(): Promise<CoursePrice[]> {
  const doc: any = await col("settings").findOne({ key: PRICE_KEY });
  return Array.isArray(doc?.courses) && doc.courses.length ? (doc.courses as CoursePrice[]) : DEFAULT_PRICE_LIST;
}

/** What the student has: entered by their CS, plus every upgrade finished since. */
async function ownedOf(studentId: string): Promise<{ owned: OwnedCourse[]; entered: boolean }> {
  const [doc, done] = await Promise.all([
    col("student_courses").findOne({ student_id: studentId }) as Promise<any>,
    col("course_upgrades").find({ student_id: studentId, status: "done" }).toArray() as Promise<any[]>,
  ]);
  const owned: OwnedCourse[] = (doc?.owned ?? []).map((o: any) => ({ code: o.code, paidAed: Number(o.paid_aed) || 0 }));
  for (const u of done) owned.push({ code: u.course, paidAed: progressOf(u.quote, paymentsOf(u)).paidAed });
  return { owned, entered: !!doc };
}

const paymentsOf = (u: any): number[] =>
  (u.payments ?? []).filter((p: any) => p.status === "approved").map((p: any) => Number(p.amount_aed) || 0);

async function studentFor(user: AuthUser, studentId: unknown, write: boolean) {
  const oid = toObjectId(String(studentId ?? ""));
  if (!oid) return { err: error("studentId is required", 400) };
  const s: any = await col("students").findOne({ _id: oid }, { projection: { full_name: 1, student_code: 1, primary_mentor_id: 1, primary_mentor_name: 1, common_cs: 1 } });
  if (!s) return { err: notFound() };
  if (write ? !canWorkOn(user, s) : !(await mayRead(user, s))) {
    return { err: forbidden("Only this student's CS, the people above them and admins can see or change their courses") };
  }
  return { s, id: String(s._id) };
}

async function mayRead(user: AuthUser, s: any) {
  const visible = await visibleMentorIds(user);
  return !visible || isStudentOf(s, visible);
}

const who = (user: AuthUser) => user.full_name || user.email || "somebody";
const nameOf = (list: CoursePrice[], code: string) => list.find((c) => c.code === code)?.name ?? code;

function upgradeView(u: any, list: CoursePrice[]) {
  const quote: UpgradeQuote = u.quote;
  const progress = progressOf(quote, paymentsOf(u));
  const paidCount = (u.payments ?? []).filter((p: any) => p.status === "approved").length;
  return {
    id: String(u._id),
    course: u.course,
    courseName: nameOf(list, u.course),
    plan: u.plan,
    status: u.status,
    quote,
    progress,
    nextPaymentAed: progress.done ? 0 : Math.min(progress.balanceAed, quote.schedule[paidCount] ?? quote.schedule[quote.schedule.length - 1] ?? progress.balanceAed),
    createdAt: u.created_at,
    createdBy: u.created_by_name,
  };
}

// ─── The price list ───────────────────────────────────────────────────────────

/** POST /api/functions/getCoursePriceList → { courses, canEdit, updatedAt, updatedBy } */
export async function getCoursePriceList(_req: Request, user: AuthUser): Promise<Response> {
  const doc: any = await col("settings").findOne({ key: PRICE_KEY });
  return json({
    courses: await priceList(),
    canEdit: user.app_role === "super_admin",
    updatedAt: doc?.updated_at ?? null,
    updatedBy: doc?.updated_by_name ?? null,
  });
}

/**
 * POST /api/functions/saveCoursePriceList { courses: [{ code, fullAed, planAed }] }
 * A Super Admin's: the full price and the installment total of each course (a
 * multiple of 2,000). Which courses exist and what each takes off stay as set.
 * An upgrade already started keeps the prices it was quoted at.
 */
export async function saveCoursePriceList(req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden("Only a Super Admin can change the price list");
  const body: any = await req.json().catch(() => ({}));
  const rows: any[] = Array.isArray(body?.courses) ? body.courses : [];
  const current = await priceList();
  const next: CoursePrice[] = [];
  for (const c of current) {
    const r = rows.find((x) => x?.code === c.code);
    if (!r) { next.push(c); continue; }
    const full = Number(r.fullAed);
    if (!Number.isFinite(full) || full <= 0 || full > 1_000_000) return error(`${c.name}: the full price must be above 0`, 400);
    let plan: number | null = c.planAed;
    if (c.planAed !== null) {
      plan = Number(r.planAed);
      if (!Number.isFinite(plan) || plan <= 0 || plan % 2_000 !== 0) return error(`${c.name}: the installment total must be a multiple of 2,000`, 400);
    }
    next.push({ ...c, fullAed: full, planAed: plan });
  }
  await col("settings").updateOne(
    { key: PRICE_KEY },
    { $set: { key: PRICE_KEY, courses: next, updated_by: user.id, updated_by_name: who(user), updated_at: new Date().toISOString() } },
    { upsert: true },
  );
  return json({ courses: next });
}

// ─── A student's courses ──────────────────────────────────────────────────────

/**
 * POST /api/functions/getStudentCourses { studentId }
 * → { entered, owned, active, past, options: [{ code, name, full, installments }], canWork }
 */
export async function getStudentCourses(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const found = await studentFor(user, body?.studentId, false);
  if (found.err) return found.err;
  const list = await priceList();
  const { owned, entered } = await ownedOf(found.id);
  const upgrades = (await col("course_upgrades").find({ student_id: found.id }).sort({ created_at: -1 }).toArray()) as any[];
  const active = upgrades.find((u) => u.status === "open");
  const ownedCodes = new Set(owned.map((o) => o.code));
  const options = list
    .filter((c) => c.code !== "MBT" && !ownedCodes.has(c.code) && c.code !== active?.course)
    .map((c) => {
      const q = (plan: PlanType) => {
        try { return quoteUpgrade(c.code, plan, owned, list); } catch { return null; }
      };
      return { code: c.code, name: c.name, full: q("full"), installments: c.planAed === null ? null : q("installments") };
    });
  return json({
    entered,
    owned: owned.map((o) => ({ code: o.code, name: nameOf(list, o.code), paidAed: o.paidAed })),
    active: active ? upgradeView(active, list) : null,
    past: upgrades.filter((u) => u.status !== "open").map((u) => upgradeView(u, list)),
    options,
    canWork: canWorkOn(user, found.s),
  });
}

/**
 * POST /api/functions/setStudentCourses { studentId, courses: [{ code, plan, paidAed }] }
 * The courses a student already had before upgrades were tracked here, and
 * what they paid — entered once by their CS. Changeable until an upgrade is
 * started; after that the record is what the upgrades were quoted against.
 */
export async function setStudentCourses(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const found = await studentFor(user, body?.studentId, true);
  if (found.err) return found.err;
  if (await col("course_upgrades").countDocuments({ student_id: found.id, status: { $ne: "cancelled" } })) {
    return error("An upgrade has been started for this student — their courses can no longer be changed here", 409);
  }
  const list = await priceList();
  const rows: any[] = Array.isArray(body?.courses) ? body.courses : [];
  const owned: { code: CourseCode; plan: PlanType; paid_aed: number }[] = [];
  for (const r of rows) {
    if (!CODES.has(r?.code)) return error(`Unknown course ${String(r?.code)}`, 400);
    if (owned.some((o) => o.code === r.code)) return error(`${nameOf(list, r.code)} is listed twice`, 400);
    const paid = Number(r.paidAed);
    if (!Number.isFinite(paid) || paid < 0 || paid > 1_000_000) return error(`${nameOf(list, r.code)}: what was paid must be 0 or more`, 400);
    owned.push({ code: r.code, plan: r.plan === "installments" ? "installments" : "full", paid_aed: paid });
  }
  const now = new Date().toISOString();
  await col("student_courses").updateOne(
    { student_id: found.id },
    { $set: { student_id: found.id, owned, entered_by: user.id, entered_by_name: who(user), entered_at: now } },
    { upsert: true },
  );
  await recordHistory([{
    student_id: found.id, at: now, type: "course_upgrade", by_id: user.id, by_name: who(user),
    text: `Courses entered: ${owned.map((o) => `${nameOf(list, o.code)} (AED ${o.paid_aed.toLocaleString("en-US")})`).join(", ") || "none"}`,
  }]);
  return json({ ok: true });
}

/**
 * POST /api/functions/startCourseUpgrade { studentId, course, plan: "full" | "installments" }
 * Quotes it on today's price list and keeps that quote: what the student pays,
 * the schedule and the bonus. One open upgrade a student at a time.
 */
export async function startCourseUpgrade(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const found = await studentFor(user, body?.studentId, true);
  if (found.err) return found.err;
  const code = body?.course as CourseCode;
  if (!CODES.has(code) || code === "MBT") return error("Pick a course to upgrade to", 400);
  const plan: PlanType = body?.plan === "installments" ? "installments" : body?.plan === "full" ? "full" : (null as any);
  if (!plan) return error('plan is "full" or "installments"', 400);
  const { owned, entered } = await ownedOf(found.id);
  if (!entered) return error("Enter the student's current courses first", 409);
  if (await col("course_upgrades").findOne({ student_id: found.id, status: "open" })) {
    return error("This student already has an upgrade in progress — finish or cancel it first", 409);
  }
  const list = await priceList();
  let quote: UpgradeQuote;
  try {
    quote = quoteUpgrade(code, plan, owned, list);
  } catch (e) {
    if (e instanceof UpgradeError) return error(e.message, 400);
    throw e;
  }
  const now = new Date().toISOString();
  const doc = {
    student_id: found.id, course: code, plan: quote.plan, quote, payments: [], status: "open",
    created_by: user.id, created_by_name: who(user), created_at: now,
  };
  const ins = await col("course_upgrades").insertOne(doc as any);
  await recordHistory([{
    student_id: found.id, at: now, type: "course_upgrade", by_id: user.id, by_name: who(user),
    text: `Upgrade to ${nameOf(list, code)} started (${quote.plan === "full" ? "full payment" : `${quote.schedule.length} installments`}): AED ${quote.dueAed.toLocaleString("en-US")}, MT5 bonus +$${quote.bonusUsd.toLocaleString("en-US")}`,
  }]);
  return json({ upgrade: upgradeView({ ...doc, _id: ins.insertedId }, list) });
}

/** POST /api/functions/cancelCourseUpgrade { upgradeId } — only before any payment. */
export async function cancelCourseUpgrade(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.upgradeId ?? ""));
  if (!oid) return error("upgradeId is required", 400);
  const u: any = await col("course_upgrades").findOne({ _id: oid });
  if (!u) return notFound();
  const found = await studentFor(user, u.student_id, true);
  if (found.err) return found.err;
  if (u.status !== "open") return error("Only an upgrade in progress can be cancelled", 409);
  if ((u.payments ?? []).length) return error("Payments have been recorded on it — it can no longer be cancelled", 409);
  const now = new Date().toISOString();
  await col("course_upgrades").updateOne({ _id: oid, status: "open" }, { $set: { status: "cancelled", cancelled_by: user.id, cancelled_by_name: who(user), cancelled_at: now } });
  const list = await priceList();
  await recordHistory([{ student_id: found.id, at: now, type: "course_upgrade", by_id: user.id, by_name: who(user), text: `Upgrade to ${nameOf(list, u.course)} cancelled` }]);
  return json({ ok: true });
}

/**
 * POST /api/functions/listCourseUpgrades { status?: "open" | "done" | "all" }
 * The Upgrades page: each CS their own students' (Common ones too), the people
 * above them their team's, admins everyone's.
 */
export async function listCourseUpgrades(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const status = ["open", "done", "all"].includes(body?.status) ? body.status : "open";
  const visible = await visibleMentorIds(user);
  let studentIds: string[] | null = null;
  if (visible) {
    const mine = (await col("students").find(studentsOf(visible), { projection: { _id: 1 } }).toArray()) as any[];
    studentIds = mine.map((s) => String(s._id));
  }
  const filter: Record<string, unknown> = status === "all" ? { status: { $ne: "cancelled" } } : { status };
  if (studentIds) filter.student_id = { $in: studentIds };
  const ups = (await col("course_upgrades").find(filter).sort({ created_at: -1 }).limit(2000).toArray()) as any[];
  const students = (await col("students")
    .find({ _id: { $in: ups.map((u) => toObjectId(u.student_id)).filter(Boolean) as any[] } }, { projection: { full_name: 1, student_code: 1, primary_mentor_name: 1 } })
    .toArray()) as any[];
  const sOf = new Map(students.map((s) => [String(s._id), s]));
  const list = await priceList();
  return json({
    rows: ups.map((u) => {
      const s = sOf.get(u.student_id);
      return { ...upgradeView(u, list), student: { id: u.student_id, name: s?.full_name ?? "", code: s?.student_code ?? "", cs: s?.primary_mentor_name ?? "" } };
    }),
  });
}
