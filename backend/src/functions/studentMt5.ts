import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { isMentorRole } from "../lib/roles";
import { isAdmin, canWorkOn, visibleMentorIds, isStudentOf } from "../students/followups";
import { csManagerReach } from "../lib/userLocation";
import { recordHistory } from "../students/history";

/* ────────────────────────────────────────────────────────────────────────────
   Removing one of a student's MT5 accounts from their page (the user,
   2026-10-14: "edit and remove option for cs also") — a login typed wrong.
   Their CS (Common ones too), the leaders over them, a CS Manager, admins and
   broker admins; never the Sales role. When it was the primary one, their
   oldest left becomes primary. (Editing goes through MT5Account as before.)
──────────────────────────────────────────────────────────────────────────── */

/** May this person change a student's MT5 accounts — as adding them on the student's page. */
async function mayChangeMt5(user: AuthUser, student: any): Promise<boolean> {
  const reach = await csManagerReach(user);
  let allowed = isAdmin(user) || user.app_role === "broker_admin"
    || (!!reach && !!student && [student.primary_mentor_id, ...(student.common_cs ?? []).map((c: any) => c?.id)].some((id) => reach.ids.includes(String(id ?? ""))));
  if (!allowed && isMentorRole(user.app_role) && student) {
    const visible = await visibleMentorIds(user);
    allowed = canWorkOn(user, student) || (visible ? isStudentOf(student, visible) : false);
  }
  return allowed && (user as any).data_scope !== "closed";
}

/** POST /api/functions/removeStudentMt5 { id } → { ok, primary: the login now primary, or null } */
export async function removeStudentMt5(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.id ?? ""));
  if (!oid) return error("id is not valid", 400);
  const account: any = await col("mt5_accounts").findOne({ _id: oid as any });
  if (!account) return notFound();
  const sid = toObjectId(String(account.student_id ?? ""));
  const student: any = sid ? await col("students").findOne({ _id: sid as any }, { projection: { primary_mentor_id: 1, common_cs: 1, full_name: 1 } }) : null;

  if (!(await mayChangeMt5(user, student))) return forbidden();

  await col("mt5_accounts").deleteOne({ _id: oid as any });
  let primary: string | null = null;
  if (account.is_primary) {
    const next: any = await col("mt5_accounts").find({ student_id: account.student_id }).sort({ created_date: 1 }).limit(1).next();
    if (next) {
      await col("mt5_accounts").updateOne({ _id: next._id }, { $set: { is_primary: true, updated_date: new Date().toISOString() } });
      primary = String(next.mt5_login);
    }
  }
  const now = new Date().toISOString();
  try {
    await col("logs").insertOne({
      timestamp: now, user_id: user.id, user_email: user.email, user_name: user.full_name, user_role: user.app_role,
      action_type: "mt5_account_removed", entity_type: "MT5Account", entity_id: String(account._id),
      details: JSON.stringify({ message: `${user.full_name || user.email} removed MT5 ${account.mt5_login} from ${student?.full_name || account.student_name || "a student"}`, student_id: account.student_id, mt5_login: account.mt5_login }),
      old_value: JSON.stringify(account), new_value: null, ip_address: null, success: true, created_date: now, updated_date: now,
    } as any);
  } catch (err) {
    console.error("[mt5] could not write the activity log", err);
  }
  return json({ ok: true, primary });
}

/**
 * POST /api/functions/setPrimaryMt5 { id } (the user, 2026-10-14: "we can choose which one is primary") — this account
 * becomes the student's primary MT5, the one that was loses it; the same people who add and remove them.
 * → { ok, primary, was }
 */
export async function setPrimaryMt5(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.id ?? ""));
  if (!oid) return error("id is not valid", 400);
  const account: any = await col("mt5_accounts").findOne({ _id: oid as any });
  if (!account) return notFound();
  const sid = toObjectId(String(account.student_id ?? ""));
  const student: any = sid ? await col("students").findOne({ _id: sid as any }, { projection: { primary_mentor_id: 1, common_cs: 1, full_name: 1 } }) : null;
  if (!(await mayChangeMt5(user, student))) return forbidden();
  const was: any = await col("mt5_accounts").findOne({ student_id: account.student_id, is_primary: true, _id: { $ne: oid } }, { projection: { mt5_login: 1 } });
  if (account.is_primary && !was) return json({ ok: true, primary: String(account.mt5_login), was: null, unchanged: true });
  const now = new Date().toISOString();
  await col("mt5_accounts").updateMany({ student_id: account.student_id, _id: { $ne: oid } }, { $set: { is_primary: false, updated_date: now } });
  await col("mt5_accounts").updateOne({ _id: oid as any }, { $set: { is_primary: true, updated_date: now } });
  if (account.student_id) {
    await recordHistory([{ student_id: String(account.student_id), at: now, type: "mt5_primary", by_id: user.id, by_name: user.full_name || user.email || "somebody",
      text: `Primary MT5 is now ${account.mt5_login}${was ? ` (was ${was.mt5_login})` : ""}` } as any]);
  }
  return json({ ok: true, primary: String(account.mt5_login), was: was ? String(was.mt5_login) : null });
}
