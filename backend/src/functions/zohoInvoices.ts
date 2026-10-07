import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import { allOf as and, escapeRe, pageOf } from "../lib/paging";
import { buildScopeFilter } from "../lib/scope";
import { isMentorRole } from "../lib/roles";
import { userCanListEntity } from "../entities/crud";
import type { AuthUser } from "../auth/middleware";

/* ────────────────────────────────────────────────────────────────────────────
   Zoho Books invoices, Jan 2024 – Jun 2026 (the user, 2026-10-07), as
   scripts/import-zoho-invoices.ts kept them in `zoho_invoices`, each linked to
   its student — or Not linked, for an admin to link by hand.

   Whose: the students this person may see on the Students page (lib/scope —
   a CS their own and Common ones, a leader their team, admins everyone), so a
   CS sees only their own students' invoices. Not linked ones: Super Admin and
   Admin only. Amounts and balances for everyone who sees one (the user).
──────────────────────────────────────────────────────────────────────────── */

const COLL = "zoho_invoices";
const LINKERS = ["super_admin", "admin"];
const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

/** Which students' invoices this person sees, as a students query — null for everyone. A mentor or CS never sees
 *  everyone's, whatever their role is set to: their own (and Common) students at least. */
async function studentScope(user: AuthUser): Promise<Record<string, any> | null> {
  const scope = await buildScopeFilter(user, "Student");
  if (scope || !isMentorRole(user.app_role)) return scope;
  return { $or: [{ primary_mentor_id: user.id }, { "common_cs.id": user.id }, { created_by: user.id }] };
}

/** The ids of the students this person may see, or null for everyone. */
async function visibleStudentIds(user: AuthUser): Promise<string[] | null> {
  const scope = await studentScope(user);
  if (!scope) return null;
  return (await col("students").distinct("_id", scope)).map(String);
}

const totals = (rows: any[]) => ({
  count: rows.length,
  total: Math.round(rows.reduce((s, r) => s + (Number(r.total) || 0), 0) * 100) / 100,
  paid: Math.round(rows.reduce((s, r) => s + (Number(r.paid) || 0), 0) * 100) / 100,
  balance: Math.round(rows.reduce((s, r) => s + (Number(r.balance) || 0), 0) * 100) / 100,
  overdue: rows.filter((r) => r.status === "Overdue").length,
});
const shown = (d: any) => { const { _id, ...rest } = d; return { id: String(_id), ...rest }; };

/**
 * POST /api/functions/getStudentZohoInvoices { studentId }
 * → { invoices (newest first), totals: { count, total, paid, balance, overdue } } — for whoever may see the student.
 */
export async function getStudentZohoInvoices(req: Request, user: AuthUser): Promise<Response> {
  if (!userCanListEntity(user, "Student")) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(str(body?.studentId, 40));
  if (!oid) return error("studentId is required", 400);
  const scope = await studentScope(user);
  if (!(await col("students").findOne(and(scope, { _id: oid }), { projection: { _id: 1 } }))) return notFound();
  const rows = (await col(COLL).find({ student_id: String(oid) }).sort({ date: -1, number: -1 }).toArray()) as any[];
  return json({ invoices: rows.map(shown), totals: totals(rows) });
}

/**
 * POST /api/functions/listZohoInvoices
 * Body: { tab: "linked" | "not_linked", page?, pageSize?, all?, search?, year?, status?, course?, cs? }
 * → { rows (with student_name, student_code, cs_name), total, page, page_size, totals, may_link }
 */
export async function listZohoInvoices(req: Request, user: AuthUser): Promise<Response> {
  if (!userCanListEntity(user, "Student")) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const mayLink = LINKERS.includes(user.app_role);
  const notLinked = body?.tab === "not_linked";
  if (notLinked && !mayLink) return forbidden("Only a Super Admin or an Admin sees the invoices not linked to a student");

  const parts: Record<string, any>[] = [];
  if (notLinked) parts.push({ student_id: null });
  else {
    let ids = await visibleStudentIds(user);
    const cs = str(body?.cs, 40);
    if (cs && cs !== "all") {
      const theirs = (await col("students").distinct("_id", { primary_mentor_id: cs })).map(String);
      ids = ids ? ids.filter((id) => theirs.includes(id)) : theirs;
    }
    parts.push(ids ? { student_id: { $in: ids } } : { student_id: { $nin: [null, ""] } });
  }
  const search = str(body?.search, 100);
  if (search) {
    const re = { $regex: escapeRe(search), $options: "i" };
    const students = notLinked ? [] : (await col("students").distinct("_id", { $or: [{ full_name: re }, { student_code: re }] })).map(String);
    parts.push({ $or: [{ number: re }, { "customer.name": re }, { "customer.email": re }, { "customer.phone": re }, ...(students.length ? [{ student_id: { $in: students } }] : [])] });
  }
  const year = str(body?.year, 4);
  if (/^\d{4}$/.test(year)) parts.push({ date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } });
  const status = str(body?.status, 20);
  if (status === "Overdue" || status === "Closed") parts.push({ status });
  const course = str(body?.course);
  if (course && course !== "all") parts.push({ "items.name": course });
  const query = and(...parts);

  const result = await pageOf(COLL, query, { date: -1, number: -1 } as any, body);
  // Who each one is for, as the Students page names them.
  const sids = [...new Set((result.rows as any[]).map((r) => r.student_id).filter(Boolean))];
  const students = new Map(((await col("students").find({ _id: { $in: sids.map((s) => toObjectId(s)).filter(Boolean) as any[] } }, { projection: { full_name: 1, student_code: 1, primary_mentor_name: 1 } }).toArray()) as any[]).map((s) => [String(s._id), s]));
  const rows = (result.rows as any[]).map((r) => {
    const s = students.get(String(r.student_id ?? ""));
    return { ...r, student_name: s?.full_name ?? "", student_code: s?.student_code ?? "", cs_name: s?.primary_mentor_name ?? "" };
  });
  const all = (await col(COLL).find(query, { projection: { total: 1, paid: 1, balance: 1, status: 1 } }).toArray()) as any[];
  return json({ ...result, rows, totals: totals(all), may_link: mayLink });
}

/**
 * POST /api/functions/getZohoInvoiceOptions → { years, courses, mentors: [{ id, name }], not_linked } — the filters'
 * choices, from the invoices this person may see.
 */
export async function getZohoInvoiceOptions(_req: Request, user: AuthUser): Promise<Response> {
  if (!userCanListEntity(user, "Student")) return forbidden();
  const ids = await visibleStudentIds(user);
  const mine = ids ? { student_id: { $in: ids } } : { student_id: { $nin: [null, ""] } };
  const [dates, courses, sids] = await Promise.all([
    col(COLL).distinct("date", mine), col(COLL).distinct("items.name", mine), col(COLL).distinct("student_id", mine),
  ]);
  const mentors = new Map<string, string>();
  for (const s of (await col("students").find({ _id: { $in: sids.map((s) => toObjectId(String(s))).filter(Boolean) as any[] } }, { projection: { primary_mentor_id: 1, primary_mentor_name: 1 } }).toArray()) as any[]) {
    if (s.primary_mentor_id) mentors.set(String(s.primary_mentor_id), String(s.primary_mentor_name || "—"));
  }
  return json({
    years: [...new Set(dates.map((d: any) => String(d).slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))].sort().reverse(),
    courses: courses.map(String).filter(Boolean).sort(),
    mentors: [...mentors].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    not_linked: LINKERS.includes(user.app_role) ? await col(COLL).countDocuments({ student_id: null }) : undefined,
  });
}

/**
 * POST /api/functions/linkZohoInvoice { invoiceId, studentId | null } — Super Admin / Admin: link an invoice to a
 * student by hand (kept when the import runs again), or take it off one (back to Not linked).
 */
export async function linkZohoInvoice(req: Request, user: AuthUser): Promise<Response> {
  if (!LINKERS.includes(user.app_role)) return forbidden("Only a Super Admin or an Admin links invoices to students");
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(str(body?.invoiceId, 40));
  if (!oid) return error("invoiceId is required", 400);
  const invoice: any = await col(COLL).findOne({ _id: oid });
  if (!invoice) return notFound("That invoice wasn't found");
  const by = { linked_by_id: user.id, linked_by_name: user.full_name || user.email, linked_at: new Date().toISOString() };
  if (body?.studentId == null || body?.studentId === "") {
    await col(COLL).updateOne({ _id: oid }, { $set: { student_id: null, match: "manual", not_linked_why: "taken off by hand", ...by } });
    return json({ ok: true, student_id: null });
  }
  const sid = toObjectId(str(body.studentId, 40));
  const student: any = sid ? await col("students").findOne({ _id: sid }, { projection: { full_name: 1 } }) : null;
  if (!student) return notFound("That student wasn't found");
  await col(COLL).updateOne({ _id: oid }, { $set: { student_id: String(sid), match: "manual", not_linked_why: "", ...by } });
  return json({ ok: true, student_id: String(sid), student_name: student.full_name ?? "" });
}
