import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { isMentorRole } from "../lib/roles";
import { buildScopeFilter } from "../lib/scope";
import { isAdmin, canWorkOn, visibleMentorIds, studentsOf } from "../students/followups";
import { recordHistory } from "../students/history";
import { flagTheirRecords } from "../students/notStudent";

/* ────────────────────────────────────────────────────────────────────────────
   Not a student (the user, 2026-10-14) — students/notStudent.ts says what it
   hides. Marked by the student's own CS (Common ones too), a CS Manager who
   sees them, or an admin, with a reason; marked a student again by a CS
   Manager or an admin. Inactive students lists them: a CS their own, a
   leader their people's, a CS Manager theirs to see, admins everyone.
──────────────────────────────────────────────────────────────────────────── */

const str = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);
const who = (u: AuthUser) => u.full_name || u.email || "somebody";

/** Which students this person sees here, as a students query — null for everyone. */
async function scopeOf(user: AuthUser): Promise<Record<string, any> | null | "none"> {
  if (isAdmin(user) || user.app_role === "broker_admin") return null;
  if (user.app_role === "cs_manager") return await buildScopeFilter(user, "Student");
  if (!isMentorRole(user.app_role)) return "none";
  const visible = await visibleMentorIds(user);
  return visible ? studentsOf(visible) : null;
}

async function studentFor(body: any, user: AuthUser): Promise<any | Response> {
  const oid = toObjectId(str(body?.studentId, 40));
  if (!oid) return error("studentId is required", 400);
  const scope = await scopeOf(user);
  if (scope === "none") return forbidden();
  const s: any = await col("students").findOne(scope ? { $and: [{ _id: oid }, scope] } : { _id: oid });
  return s ?? (scope ? forbidden() : notFound());
}

/** POST /api/functions/markNotStudent { studentId, reason } */
export async function markNotStudent(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const s = await studentFor(body, user);
  if (s instanceof Response) return s;
  if (!(isAdmin(user) || user.app_role === "cs_manager" || canWorkOn(user, s)))
    return forbidden("Only the student's CS, a CS Manager or an admin marks someone not a student");
  const reason = str(body?.reason);
  if (!reason) return error("Say why they aren't a student", 400);
  if (s.not_student === true) return json({ ok: true, unchanged: true });
  const now = new Date().toISOString();
  await col("students").updateOne({ _id: s._id }, { $set: {
    not_student: true, not_student_at: now, not_student_by_id: user.id, not_student_by_name: who(user), not_student_reason: reason, updated_date: now,
  } });
  await flagTheirRecords(String(s._id), true);
  await recordHistory([{ student_id: String(s._id), at: now, type: "status_changed", text: `Marked not a student — ${reason}`, by_id: user.id, by_name: who(user), from: "student", to: "not a student" }]);
  return json({ ok: true });
}

/** POST /api/functions/unmarkNotStudent { studentId } — a student again, back on every list. */
export async function unmarkNotStudent(req: Request, user: AuthUser): Promise<Response> {
  if (!(isAdmin(user) || user.app_role === "cs_manager")) return forbidden("Only a CS Manager or an admin marks them a student again");
  const body: any = await req.json().catch(() => ({}));
  const s = await studentFor(body, user);
  if (s instanceof Response) return s;
  if (s.not_student !== true) return json({ ok: true, unchanged: true });
  const now = new Date().toISOString();
  await col("students").updateOne({ _id: s._id }, {
    $set: { updated_date: now },
    $unset: { not_student: "", not_student_at: "", not_student_by_id: "", not_student_by_name: "", not_student_reason: "" },
  });
  await flagTheirRecords(String(s._id), false);
  await recordHistory([{ student_id: String(s._id), at: now, type: "status_changed", text: "Marked a student again", by_id: user.id, by_name: who(user), from: "not a student", to: "student" }]);
  return json({ ok: true });
}

/**
 * POST /api/functions/listNotStudents { search?, page? }
 * → { rows: [{ id, full_name, student_code, email, phone, primary_mentor_name, team_name, current_location?, at, by, reason }], total, page, page_size, may_unmark }
 */
export async function listNotStudents(req: Request, user: AuthUser): Promise<Response> {
  const scope = await scopeOf(user);
  if (scope === "none") return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const page = Math.max(1, Math.floor(Number(body?.page) || 1));
  const size = 50;
  const parts: Record<string, any>[] = [{ not_student: true }];
  if (scope) parts.push(scope);
  const q = str(body?.search, 100);
  if (q) {
    const re = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    parts.push({ $or: [{ full_name: re }, { student_code: re }, { email: re }, { phone: re }, { not_student_reason: re }] });
  }
  const query = { $and: parts };
  const total = await col("students").countDocuments(query);
  const docs = (await col("students").find(query, {
    projection: { full_name: 1, student_code: 1, email: 1, phone: 1, primary_mentor_name: 1, team_name: 1, not_student_at: 1, not_student_by_name: 1, not_student_reason: 1 },
  }).sort({ not_student_at: -1 }).skip((page - 1) * size).limit(size).toArray()) as any[];
  return json({
    rows: docs.map((d) => ({
      id: String(d._id), full_name: d.full_name ?? "", student_code: d.student_code ?? "", email: d.email ?? "", phone: d.phone ?? "",
      primary_mentor_name: d.primary_mentor_name ?? "", team_name: d.team_name ?? "", at: d.not_student_at ?? "", by: d.not_student_by_name ?? "", reason: d.not_student_reason ?? "",
    })),
    total, page, page_size: size, may_unmark: isAdmin(user) || user.app_role === "cs_manager",
  });
}
