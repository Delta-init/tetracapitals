import { col } from "../db";
import { json, error } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { CLOSED_STAGES, businessToday, visibleMentorIds, studentsOf } from "../students/followups";
import { notOnboardedFilter, newFromFinanceFilter } from "../students/onboardingAlerts";
import { theirStudents } from "../students/closedBy";
import { countCallNeeded } from "../students/classCompletions";
import { decidableMt5Filter } from "./bonusApprovals";
import { needsCorrectionFilter, NEEDS_CORRECTION_ALL } from "./fundingCorrections";
import { BONUS_APPROVERS } from "../finance/funding";
import { openCreditRequests } from "./creditRequests";
import { csManagerReach, fundingOfIds } from "../lib/userLocation";
import { IS_STUDENT, OF_A_STUDENT } from "../students/notStudent";

/* The filters behind each number — shared with the Root portal's Pending page (portal/pending.ts), so the two never
   drift apart. A `forId` narrows one to that person, as their own sidebar has it. */

/** Students given to someone and not opened by them yet — while they are still that student's CS. */
export const newStudentsFilter = (forId?: string): Record<string, any> =>
  forId
    ? { new_for_id: forId, primary_mentor_id: forId }
    : { new_for_id: { $type: "string", $ne: "" }, $expr: { $eq: ["$new_for_id", "$primary_mentor_id"] } };
/** Follow-ups still open (not Converted / Lost). */
// Not a student's (students/notStudent.ts) left out, as everywhere.
export const openFollowupsFilter = (): Record<string, any> => ({ stage: { $nin: [...CLOSED_STAGES] }, ...OF_A_STUDENT });
export const followupsDueTodayFilter = (today: string): Record<string, any> => ({ next_followup_date: today });
export const followupsOverdueFilter = (today: string): Record<string, any> => ({ next_followup_date: { $gt: "", $lt: today } });
/** Payment link requests waiting for a Super Admin. */
export const paymentLinksPendingFilter = (): Record<string, any> => ({ status: "pending" });
/** A CS's payment link requests, answered (approved / rejected), that they haven't seen yet. */
export const paymentLinksUnseenFilter = (status: "approved" | "rejected", forId?: string): Record<string, any> => ({
  ...(forId ? { requested_by_id: forId } : {}), status, cs_seen_at: { $exists: false },
});

/**
 * POST /api/functions/getNavCounts
 * Returns: { new_students, followups_today, followups_overdue, payment_links_pending, payment_links_ready, payment_links_turned_down,
 *            not_onboarded, not_onboarded_late, class_completions_open, bonus_approvals_pending, balance_due }
 *
 * The numbers on the sidebar. New students: given to you and not opened yet
 * (students.new_for_id — see notifyStudentsGiven). Follow-ups: what the
 * Follow-ups page's "Due today" tab and the Overdue follow-ups page show you —
 * your own students; Chief Mentor and CS Manager also everyone under them;
 * admin roles everyone. Payment links (paymentLinks.ts): for a Super Admin the
 * requests waiting for them; for a CS the links ready and the turn-downs, of
 * what they asked for, that they haven't seen yet. Not onboarded: students not
 * onboarded yet, whatever they came from, and how many new ones from finance
 * waited 6 hours or more (students/onboardingAlerts.ts) — whose, as the follow-ups. Class completions:
 * classes students attended, told to their CS, with no call logged since the
 * class ended (students/classCompletions.ts) — whose, as the follow-ups. MT5 bonuses: for a broker admin or a Super
 * Admin, the bonuses waiting for their approval (functions/bonusApprovals.ts). Balance payments due: always 0 since
 * 2026-10-13 (a sales close's instalments are followed up in its CRM).
 */
export async function getNavCounts(_req: Request, user: AuthUser): Promise<Response> {
  const today = businessToday();
  const visible = await visibleMentorIds(user);
  // A CS Manager's funding counts: their own location's (lib/userLocation.ts, 2026-10-14).
  const csReach = await csManagerReach(user);
  const open: Record<string, any> = openFollowupsFilter();
  let ids: string[] | null = null;
  if (visible) {
    ids = (await col("students").find(studentsOf(visible), { projection: { _id: 1 } }).toArray()).map((s) => String(s._id));
    open.student_id = { $in: ids };
  }
  const cs = user.app_role === "cs";
  const mine = (filter: Record<string, any>) => (visible ? { $and: [filter, studentsOf(visible)] } : filter);
  // As the Not onboarded and Balance payments pages: the Sales role the students they closed.
  const theirs = async (filter: Record<string, any>) => (visible ? { $and: [filter, await theirStudents(user, studentsOf(visible))] } : filter);
  const unseen = (status: "approved" | "rejected") => col("payment_link_requests").countDocuments(paymentLinksUnseenFilter(status, user.id));
  const [newStudents, dueToday, overdue, linksWaiting, linksReady, linksTurnedDown, notOnboarded, notOnboardedLate, classesToCall, bonusesWaiting, balanceDue, sentBack] = await Promise.all([
    col("students").countDocuments(newStudentsFilter(user.id)),
    col("student_followups").countDocuments({ ...open, ...followupsDueTodayFilter(today) }),
    col("student_followups").countDocuments({ ...open, ...followupsOverdueFilter(today) }),
    user.app_role === "super_admin" ? col("payment_link_requests").countDocuments(paymentLinksPendingFilter()) : 0,
    cs ? unseen("approved") : 0,
    cs ? unseen("rejected") : 0,
    col("students").countDocuments(mine(notOnboardedFilter())),
    col("students").countDocuments(mine(newFromFinanceFilter(Date.now()))),
    countCallNeeded(ids),
    // A broker admin: their location's bonuses, and every deposit and withdrawal (finance/bonusLocation.ts).
    BONUS_APPROVERS.includes(user.app_role)
      ? user.app_role === "broker_admin"
        ? col("funding_transactions").find(decidableMt5Filter(), { projection: { type: 1, student_id: 1 } }).limit(5000).toArray()
            .then(async (rows) => (await (await import("../finance/bonusLocation")).forBrokerLocation(rows as any[], user)).length)
        : col("funding_transactions").countDocuments(decidableMt5Filter())
      : 0,
    // Balance payments due (2026-10-13): none here now — a sales close's instalments are followed up in its CRM, and a
    // course paid in parts here has no due date. Kept at 0 so an older screen reads nothing due.
    Promise.resolve(0),
    // Funding requests a broker admin sent back to them to correct (fundingCorrections.ts).
    // …and by accounts, to correct and send again (2026-10-13).
    col("funding_transactions").countDocuments(user.app_role === "cs_manager" ? { $and: [NEEDS_CORRECTION_ALL, fundingOfIds(csReach?.ids ?? [])] } : needsCorrectionFilter(user.id)),
  ]);
  // Bonus not credited, waiting for a broker admin (creditRequests.ts).
  const creditOpen = BONUS_APPROVERS.includes(user.app_role) ? await openCreditRequests() : 0;
  // Funding Activities: requests not decided yet (2026-10-13) — a CS Manager every CS's, anyone else the ones they raised.
  const fundingPending = await col("funding_transactions").countDocuments(user.app_role === "cs_manager"
    ? { status: "PENDING", bonus_credit: { $in: [null, ""] }, ...fundingOfIds(csReach?.ids ?? []) }
    : { status: "PENDING", bonus_credit: { $in: [null, ""] }, $or: [{ requested_by_id: user.id }, { initiating_mentor_id: user.id }, { created_by: user.id }] });
  return json({
    credit_requests_open: creditOpen, funding_pending: fundingPending,
    today, new_students: newStudents, followups_today: dueToday, followups_overdue: overdue,
    payment_links_pending: linksWaiting, payment_links_ready: linksReady, payment_links_turned_down: linksTurnedDown,
    not_onboarded: notOnboarded, not_onboarded_late: notOnboardedLate, class_completions_open: classesToCall,
    bonus_approvals_pending: bonusesWaiting, balance_due: balanceDue, funding_sent_back: sentBack,
  });
}

/**
 * POST /api/functions/markStudentSeen
 * Body: { id }
 * The student's page was opened by the person they were given to: no longer
 * new for them (the sidebar stops counting it). Anyone else opening it changes nothing.
 */
export async function markStudentSeen(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.id ?? ""));
  if (!oid) return error("id is required", 400);
  const res = await col("students").updateOne({ _id: oid, new_for_id: user.id }, { $unset: { new_for_id: "", new_since: "" } });
  return json({ ok: true, cleared: res.modifiedCount === 1 });
}
