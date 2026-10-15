import { col } from "../db";
import { toObjectId } from "../lib/id";
import { businessToday, commonIds } from "../students/followups";
import { notOnboardedFilter, newFromFinanceFilter } from "../students/onboardingAlerts";
import { callNeeded } from "../students/classCompletions";
import { decidableBonusFilter } from "../functions/bonusApprovals";
import { BONUS_APPROVERS } from "../finance/funding";
import {
  newStudentsFilter, openFollowupsFilter, followupsDueTodayFilter, followupsOverdueFilter,
  paymentLinksPendingFilter, paymentLinksUnseenFilter,
} from "../functions/navCounts";

/* ────────────────────────────────────────────────────────────────────────────
   GET /api/v1/service/pending — the Root portal's Pending page (the user,
   2026-10-11): every number this app's sidebar shows, for the whole
   organisation, and whom each is waiting on.

   The same filters as the sidebar (functions/navCounts.ts). A kind waiting on a
   named person — the student's CS (and any CS they are Common with), whoever
   asked for a payment link — counts against that person; one any holder of a
   role may clear — MT5 bonuses (broker admins and Super Admins), payment link
   requests (Super Admins) — is `shared`, and every active holder carries all of
   it. Staff only: students never appear.
──────────────────────────────────────────────────────────────────────────── */

export interface PendingKind { key: string; label: string; total: number; overdue?: number; shared?: true }
export interface PendingPerson { id: string; name: string; email: string; active: boolean; counts: Record<string, number>; total: number }

type Tally = Map<string, Map<string, number>>; // person id → kind key → count

const add = (tally: Tally, personId: string, key: string, n = 1) => {
  if (!personId || n <= 0) return;
  const counts = tally.get(personId) ?? tally.set(personId, new Map()).get(personId)!;
  counts.set(key, (counts.get(key) ?? 0) + n);
};

/** A student's CSs: their CS, and any CS they are Common with — whose sidebar counts them (followups.studentsOf). */
const csOf = (student: any): string[] =>
  [...new Set([String(student?.primary_mentor_id ?? ""), ...commonIds(student)].filter(Boolean))];

/** student id → their CSs, for these ids. */
async function csByStudent(studentIds: string[]): Promise<Map<string, string[]>> {
  const oids = [...new Set(studentIds)].map((id) => toObjectId(id)).filter((o): o is NonNullable<typeof o> => !!o);
  const out = new Map<string, string[]>();
  if (!oids.length) return out;
  const students = await col("students").find({ _id: { $in: oids } } as any, { projection: { primary_mentor_id: 1, common_cs: 1 } }).toArray();
  for (const s of students) out.set(String(s._id), csOf(s));
  return out;
}

/** Counts each record against its student's CSs. */
async function byStudentCs(tally: Tally, key: string, studentIds: string[]): Promise<void> {
  const cs = await csByStudent(studentIds);
  for (const sid of studentIds) for (const id of cs.get(String(sid)) ?? []) add(tally, id, key);
}

export async function pendingOverview(now = Date.now()): Promise<{ kinds: PendingKind[]; people: PendingPerson[] }> {
  const today = businessToday();
  const open = openFollowupsFilter();
  const students = col("students");
  const followups = col("student_followups");
  const links = col("payment_link_requests");

  const users = (await col("users")
    .find({}, { projection: { full_name: 1, email: 1, app_role: 1, status: 1, team_location: 1 } })
    .toArray()) as any[];
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const isActive = (u: any) => u?.status !== "inactive";
  const holders = (roles: string[]) => users.filter((u) => roles.includes(String(u.app_role)) && isActive(u)).map((u) => String(u._id));

  const [newStudents, notOnboarded, notOnboardedLate, dueToday, overdue, completions, bonuses, linksPending, linksReady, linksTurnedDown] = await Promise.all([
    students.find(newStudentsFilter(), { projection: { new_for_id: 1 } }).toArray(),
    students.find(notOnboardedFilter(), { projection: { primary_mentor_id: 1, common_cs: 1 } }).toArray(),
    students.find(newFromFinanceFilter(now), { projection: { primary_mentor_id: 1, common_cs: 1 } }).toArray(),
    followups.find({ ...open, ...followupsDueTodayFilter(today) }, { projection: { student_id: 1 } }).toArray(),
    followups.find({ ...open, ...followupsOverdueFilter(today) }, { projection: { student_id: 1 } }).toArray(),
    callNeeded(null),
    col("funding_transactions").find(decidableBonusFilter(), { projection: { student_id: 1 } }).limit(5000).toArray(),
    links.countDocuments(paymentLinksPendingFilter()),
    links.find(paymentLinksUnseenFilter("approved"), { projection: { requested_by_id: 1 } }).toArray(),
    links.find(paymentLinksUnseenFilter("rejected"), { projection: { requested_by_id: 1 } }).toArray(),
  ]);

  const tally: Tally = new Map();

  // Students: given to them and not opened yet — counts for whom it was given to.
  for (const s of newStudents) add(tally, String(s.new_for_id ?? ""), "new_students");

  // Not onboarded: the student's CSs; the ones from finance waiting 6 hours or more are its overdue (red on the sidebar).
  for (const s of notOnboarded) for (const id of csOf(s)) add(tally, id, "not_onboarded");
  for (const s of notOnboardedLate) for (const id of csOf(s)) add(tally, id, "not_onboarded_overdue");

  // Follow-ups due today, overdue follow-ups, class completions waiting for a call: the student's CSs.
  await Promise.all([
    byStudentCs(tally, "followups_today", dueToday.map((f) => String(f.student_id ?? ""))),
    byStudentCs(tally, "overdue_followups", overdue.map((f) => String(f.student_id ?? ""))),
    byStudentCs(tally, "class_completions_open", completions.map((c) => String(c.student_id ?? ""))),
  ]);

  // MT5 bonuses: a Super Admin may decide any — each carries them all; a broker admin their own location's (2026-10-15).
  const { studentLocations, brokerLocationOf } = await import("../finance/bonusLocation");
  const bonusWhere = await studentLocations(bonuses.map((b: any) => b.student_id));
  const bonusesIn = (loc: string) => bonuses.filter((b: any) => (bonusWhere.get(String(b.student_id ?? "")) ?? "dubai") === loc).length;
  for (const id of holders(BONUS_APPROVERS)) {
    const where = brokerLocationOf(userById.get(id));
    add(tally, id, "bonus_approvals_pending", where ? bonusesIn(where) : bonuses.length);
  }

  // Payment links: requests wait for any Super Admin; ready and turned down ones for the CS who asked — on a CS's
  // sidebar only, so only while they are a CS.
  for (const id of holders(["super_admin"])) add(tally, id, "payment_links_pending", linksPending);
  const askedByCs = (rows: any[]) => rows.map((r) => String(r.requested_by_id ?? "")).filter((id) => userById.get(id)?.app_role === "cs");
  const ready = askedByCs(linksReady), turnedDown = askedByCs(linksTurnedDown);
  for (const id of ready) add(tally, id, "payment_links_ready");
  for (const id of turnedDown) add(tally, id, "payment_links_turned_down");

  // In sidebar order: the Students section, then Funding (MT5 Bonus Approvals above Payment Links).
  // No kind's key ends in "_overdue" (hence overdue_followups): that suffix is an overdue count, left out of totals.
  const kinds: PendingKind[] = [
    { key: "new_students", label: "Students", total: newStudents.length },
    { key: "not_onboarded", label: "Not onboarded", total: notOnboarded.length, overdue: notOnboardedLate.length },
    { key: "followups_today", label: "Follow-ups", total: dueToday.length },
    { key: "overdue_followups", label: "Overdue follow-ups", total: overdue.length },
    { key: "class_completions_open", label: "Class Completions", total: completions.length },
    { key: "bonus_approvals_pending", label: "MT5 Bonus Approvals", total: bonuses.length, shared: true },
    { key: "payment_links_pending", label: "Payment Links — requests waiting", total: linksPending, shared: true },
    { key: "payment_links_ready", label: "Payment Links — ready, not seen", total: ready.length },
    { key: "payment_links_turned_down", label: "Payment Links — turned down, not seen", total: turnedDown.length },
  ];

  const people: PendingPerson[] = [];
  for (const [id, counts] of tally) {
    const u = userById.get(id);
    if (!u) continue; // not a staff account (or gone): nobody to show
    // Kinds in sidebar order, each overdue count after its kind; only the ones with something waiting.
    const obj: Record<string, number> = {};
    let total = 0;
    for (const k of kinds) {
      const n = counts.get(k.key) ?? 0, late = counts.get(`${k.key}_overdue`) ?? 0;
      if (n > 0) { obj[k.key] = n; total += n; }
      if (late > 0) obj[`${k.key}_overdue`] = late;
    }
    if (total <= 0) continue;
    people.push({
      id,
      name: String(u.full_name ?? ""),
      email: String(u.email ?? "").trim().toLowerCase(),
      active: isActive(u),
      counts: obj,
      total,
    });
  }
  people.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { kinds, people };
}
