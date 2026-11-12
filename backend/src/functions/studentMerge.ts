import { ObjectId } from "mongodb";
import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import {
  MERGES, DISMISSALS, MERGE_ROLES, MergeError, countMoves, findDuplicates, loadPair, mayMerge, mergedFields, mergeStudents, undoMerge,
} from "../students/merge";

/* ────────────────────────────────────────────────────────────────────────────
   The Duplicates page (2026-11-12, students/merge.ts): students that look like
   one person, a preview of merging two, the merge — the CS chosen, the other
   kept as Common if wanted — and the merges done, each undoable. A Super Admin
   anywhere; a CS Manager for students in their reach.
──────────────────────────────────────────────────────────────────────────── */

const body = async (req: Request): Promise<any> => req.json().catch(() => ({}));
const fail = (err: unknown) => {
  if (err instanceof MergeError) return error(err.message, err.status);
  throw err;
};

/** POST findDuplicateStudents { includeDismissed? } → { groups } */
export async function findDuplicateStudents(req: Request, user: AuthUser): Promise<Response> {
  if (!MERGE_ROLES.has(user.app_role)) return forbidden("Only a Super Admin or a CS Manager merges students");
  const b = await body(req);
  return json({ groups: await findDuplicates(user, { includeDismissed: b?.includeDismissed === true }) });
}

/** What a student is, side by side with the other. */
async function summary(s: any) {
  const id = String(s._id);
  const [deposits, calls, followups, lastCall] = await Promise.all([
    col("funding_transactions").countDocuments({ student_id: id, type: "DEPOSIT", status: "APPROVED" }),
    col("student_calls").countDocuments({ student_id: id }),
    col("student_followups").countDocuments({ student_id: id }),
    col("student_calls").find({ student_id: id }, { projection: { started_at: 1 } }).sort({ started_at: -1 }).limit(1).next(),
  ]);
  return {
    id, code: s.student_code ?? "", name: String(s.full_name ?? "").trim(), email: s.email ?? "", phone: String(s.phone ?? ""),
    cs: { id: String(s.primary_mentor_id ?? ""), name: s.primary_mentor_name ?? "", team: s.team_name ?? "" },
    common: (Array.isArray(s.common_cs) ? s.common_cs : []).map((c: any) => c?.name).filter(Boolean),
    open: s.assignment_status === "open_pool",
    created: s.created_date ?? "", enrolment: s.enrolment_status ?? "", level: s.student_level ?? "",
    onboarded: !!s.onboarded, lms: !!s.lms_user_id, finance: s.finance_invoice_number ?? "",
    deposits, calls, followups, lastContact: (lastCall as any)?.started_at ?? null,
  };
}

/** POST previewStudentMerge { keepId, closeId } → both, what would move, what the kept one takes, a suggestion. Changes nothing. */
export async function previewStudentMerge(req: Request, user: AuthUser): Promise<Response> {
  const b = await body(req);
  try {
    const { k, c } = await loadPair(String(b?.keepId ?? ""), String(b?.closeId ?? ""));
    if (!(await mayMerge(user, [k, c]))) return forbidden("Only a Super Admin, or a CS Manager for their own students, merges students");
    const [kept, closed, moves] = await Promise.all([summary(k), summary(c), countMoves(c)]);
    const takes = Object.keys(mergedFields(k, c)).filter((f) => !["other_codes", "other_emails", "other_lms_user_ids", "other_finance_invoice_ids", "merged_from"].includes(f));
    // Which record to keep: the one with deposits, then the older; whose CS: the one who has worked them more.
    const keepScore = (x: any) => x.deposits * 1000 + (x.created ? -Date.parse(x.created) / 1e12 : 0);
    const work = (x: any) => x.deposits * 100 + x.calls + x.followups;
    return json({
      kept, closed, moves, takes,
      sameCs: kept.cs.id === closed.cs.id,
      suggestion: {
        keepId: keepScore(closed) > keepScore(kept) ? closed.id : kept.id,
        csFrom: closed.cs.id && work(closed) > work(kept) ? "closed" : "kept",
      },
    });
  } catch (err) { return fail(err); }
}

/** POST mergeStudents { keepId, closeId, csFrom, otherCsAsCommon, confirm } — `confirm` is the closed student's code, typed. */
export async function mergeStudentRecords(req: Request, user: AuthUser): Promise<Response> {
  const b = await body(req);
  try {
    const { c } = await loadPair(String(b?.keepId ?? ""), String(b?.closeId ?? ""));
    if (String(b?.confirm ?? "").trim().toUpperCase() !== String(c.student_code ?? "").toUpperCase()) {
      return error(`Type ${c.student_code} to confirm which record is closed`, 400);
    }
    const csFrom = b?.csFrom === "closed" ? "closed" : "kept";
    return json(await mergeStudents({ keepId: String(b.keepId), closeId: String(b.closeId), csFrom, otherCsAsCommon: b?.otherCsAsCommon !== false }, user));
  } catch (err) { return fail(err); }
}

/** POST getStudentMerges { page? } → the merges done, newest first: a Super Admin every one, a CS Manager their own. */
export async function getStudentMerges(req: Request, user: AuthUser): Promise<Response> {
  if (!MERGE_ROLES.has(user.app_role)) return forbidden();
  const b = await body(req);
  const page = Math.max(1, Number(b?.page) || 1), size = 25;
  const filter = user.app_role === "super_admin" ? {} : { "by.id": user.id };
  const [rows, total] = await Promise.all([
    col(MERGES).find(filter, { projection: { closed_doc: 0, changes: 0 } }).sort({ at: -1 }).skip((page - 1) * size).limit(size).toArray(),
    col(MERGES).countDocuments(filter),
  ]);
  return json({
    total, page, pages: Math.max(1, Math.ceil(total / size)),
    merges: rows.map((m: any) => ({
      id: String(m._id), status: m.status, at: m.at, by: m.by?.name ?? "", kept: m.kept, closed: m.closed,
      csFrom: m.choice?.csFrom, otherCsAsCommon: !!m.choice?.otherCsAsCommon, moved: m.moved ?? [], leftovers: m.leftovers ?? [],
      error: m.error ?? null, undoneAt: m.undone_at ?? null, undoneBy: m.undone_by?.name ?? null, leftAsIs: m.left_as_is ?? [],
      type: m.type ?? "merge", origin: m.origin ?? "cs_portal", relink: m.relink ?? null,
      lms: m.lms ? { state: m.lms.state, action: m.lms.action ?? null, error: m.lms.error ?? null } : null,
      lmsUndo: m.lms_undo ? { state: m.lms_undo.state, error: m.lms_undo.error ?? null } : null,
    })),
  });
}

/** POST undoStudentMerge { mergeId } */
export async function undoStudentMerge(req: Request, user: AuthUser): Promise<Response> {
  if (!MERGE_ROLES.has(user.app_role)) return forbidden();
  const b = await body(req);
  try {
    return json(await undoMerge(String(b?.mergeId ?? ""), user));
  } catch (err) { return fail(err); }
}

/** POST dismissDuplicateGroup { key, undo? } — "Not a duplicate": the group is hidden (a family on one phone). */
export async function dismissDuplicateGroup(req: Request, user: AuthUser): Promise<Response> {
  if (!MERGE_ROLES.has(user.app_role)) return forbidden();
  const b = await body(req);
  const key = String(b?.key ?? "");
  const ids = key.split(",").filter((x) => ObjectId.isValid(x));
  if (ids.length < 2) return error("Which group?", 400);
  if (b?.undo) {
    await col(DISMISSALS).deleteOne({ key });
    return json({ dismissed: false });
  }
  await col(DISMISSALS).updateOne({ key }, { $setOnInsert: { key, ids, by: { id: user.id, name: user.full_name || user.email }, at: new Date().toISOString() } }, { upsert: true });
  return json({ dismissed: true });
}
