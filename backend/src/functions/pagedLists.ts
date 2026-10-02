import { col } from "../db";
import { json, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { buildScopeFilter } from "../lib/scope";
import { isMentorRole } from "../lib/roles";
import { userCanListEntity } from "../entities/crud";
import { allOf, escapeRe, pageOf, textMatch } from "../lib/paging";

/* ────────────────────────────────────────────────────────────────────────────
   Student logs, their history, and Transactions — paged on the server, with
   the same rules the pages used to apply in the browser to the whole list.
   Body: { page, pageSize, all?, filters } → { rows, total, page, page_size }.
──────────────────────────────────────────────────────────────────────────── */

const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

/**
 * POST /api/functions/listStudentLogs { filters: { search } }
 * A mentor sees the logs of students they are the primary or senior mentor of (Assistance: also their assigned
 * mentor's); everyone else every log.
 */
export async function listStudentLogs(req: Request, user: AuthUser): Promise<Response> {
  if (!userCanListEntity(user, "StudentLog")) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  let mine: Record<string, any> | null = null;
  if (isMentorRole(user.app_role)) {
    const ids = [user.id];
    const assigned = user.app_role === "assistance" ? str(user.assigned_mentor_id, 40) : "";
    if (assigned) ids.push(assigned);
    const students = await col("students").distinct("_id", { $or: [{ primary_mentor_id: { $in: ids } }, { senior_mentor_id: { $in: ids } }] });
    mine = { student_id: { $in: students.map(String) } };
  }
  const query = allOf(
    await buildScopeFilter(user, "StudentLog"),
    mine,
    textMatch(["student_name", "student_code", "email", "phone_number"], str(body?.filters?.search, 100)),
  );
  return json(await pageOf("student_logs", query, { created_date: -1, _id: -1 }, body));
}

const HISTORY_ADMINS = ["super_admin", "academic_head", "academic_admin", "admin_supervisor"];

/**
 * POST /api/functions/listStudentLogHistory { filters: { search, student, staff, tab, role, from, to } }
 * Admins see every entry; anyone else the ones they made. → also `staff` (who made entries) for the admins' filter.
 */
export async function listStudentLogHistory(req: Request, user: AuthUser): Promise<Response> {
  if (!userCanListEntity(user, "StudentLogHistory")) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const f = body?.filters ?? {};
  const admin = HISTORY_ADMINS.includes(user.app_role);
  const parts: (Record<string, any> | null)[] = [await buildScopeFilter(user, "StudentLogHistory")];
  if (!admin) parts.push({ updated_by_id: user.id });
  parts.push(textMatch(["student_name", "student_code", "updated_by_name"], str(f.search, 100)));
  const student = str(f.student, 40);
  if (student) parts.push({ student_id: student });
  const staff = str(f.staff, 40);
  if (admin && staff && staff !== "all") parts.push({ updated_by_id: staff });
  const tab = str(f.tab, 60);
  if (tab && tab !== "all") parts.push({ tab_section: { $regex: escapeRe(tab) } });
  const role = str(f.role, 60);
  if (admin && role && role !== "all") parts.push({ updated_by_role: role });
  const from = str(f.from, 40), to = str(f.to, 40);
  if (from) parts.push({ entry_timestamp: { $gte: from } });
  if (to) parts.push({ entry_timestamp: { $lte: to } });
  const result = await pageOf("student_log_history", allOf(...parts), { created_date: -1, _id: -1 }, body);

  let staffList: { id: string; name: string }[] | undefined;
  if (admin && body?.withStaff) {
    const rows = await col("student_log_history").aggregate([
      { $match: { updated_by_id: { $nin: [null, ""] } } },
      { $group: { _id: "$updated_by_id", name: { $first: "$updated_by_name" } } },
    ]).toArray();
    staffList = rows.map((r: any) => ({ id: String(r._id), name: String(r.name ?? "") })).sort((a, b) => a.name.localeCompare(b.name));
  }
  return json({ ...result, ...(staffList ? { staff: staffList } : {}) });
}

/**
 * POST /api/functions/listTransactions { filters: { status: all | pending | approved | rejected } }
 * A mentor sees the transactions of their own students (primary mentor); everyone else every one they may see.
 */
export async function listTransactions(req: Request, user: AuthUser): Promise<Response> {
  if (!userCanListEntity(user, "FundingTransaction")) return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const status = str(body?.filters?.status, 20);
  const query = allOf(
    await buildScopeFilter(user, "FundingTransaction"),
    isMentorRole(user.app_role) ? { primary_mentor_id: user.id } : null,
    status && status !== "all" ? { status: { $regex: `^${escapeRe(status)}$`, $options: "i" } } : null,
  );
  return json(await pageOf("funding_transactions", query, { requested_at: -1, _id: -1 }, body));
}
