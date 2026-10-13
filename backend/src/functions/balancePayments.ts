import { col } from "../db";
import { json, error } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { visibleMentorIds, studentsOf, canWorkOn } from "../students/followups";
import { theirStudents } from "../students/closedBy";
import { courseBalancesOf } from "../courses/courseBalance";
import { CLOSED_FEE_STATUSES } from "../finance/balanceDue";

/*
 * The Balance payments page (the user, 2026-10-11; changed 2026-10-13): every student in the viewer's scope who still
 * owes on a course paid in parts HERE — a CS their own (Common ones too), a Chief Mentor or CS Manager everyone under
 * them, admin roles everyone, the Sales role the ones they closed, as the Not onboarded page:
 *   - a course on the CS enrolment tracker part paid (course_fees, source "cs_tracker") — DSLP, DQMP…;
 *   - a Bonus course payment made in parts (FundingRequestForm), and a course upgrade still being paid
 *     (courses/courseBalance.ts).
 * A course a sales CRM closed is NOT here any more (the user, 2026-10-13: "only show the sales portal … remove the
 * data of the balance payments from the commission portal"): its balance, next due date and next payment are
 * followed up in that CRM, and Delta finance approves the payment there. Finance's fee updates still arrive on the
 * student's course_fees, for their page.
 */

const FILTERS = ["all", "tracker", "bonus", "upgrade"] as const;
type Filter = (typeof FILTERS)[number];
type Source = Exclude<Filter, "all">;

const SOURCE_LABEL: Record<Source, string> = {
  tracker: "CS enrolment tracker",
  bonus: "Bonus course payment",
  upgrade: "Course upgrade",
};

const PROJECTION = {
  full_name: 1, student_code: 1, phone: 1, email: 1, primary_mentor_id: 1, primary_mentor_name: 1, common_cs: 1, team_name: 1, course_fees: 1,
};

/** A course on the CS enrolment tracker still owing. */
const TRACKER_OWING = { source: "cs_tracker", balance_minor: { $gt: 0 }, status: { $nin: CLOSED_FEE_STATUSES } };
const trackerOwes = (f: any) =>
  !!f && f.source === "cs_tracker" && Number(f.balance_minor) > 0 && !CLOSED_FEE_STATUSES.includes(String(f.status ?? ""));

/** Students with a Bonus course payment made in parts, or an upgrade still open — their balance is worked out after. */
async function idsPayingInParts(): Promise<string[]> {
  return [
    ...new Set([
      ...((await col("funding_transactions").distinct("student_id", { type: "BONUS", status: { $nin: ["REJECTED", "CANCELLED"] }, "course_payment.kind": "partial" })) as unknown[]),
      ...((await col("course_upgrades").distinct("student_id", { status: "open" })) as unknown[]),
    ].map(String)),
  ];
}

const minor = (aed: number) => Math.round((Number(aed) || 0) * 100);

/**
 * POST /api/functions/getBalancePayments { filter?: "all" | "tracker" | "bonus" | "upgrade", q? }
 * → { counts: { all, tracker, bonus, upgrade }, rows: [{ key, source, source_label, student_id, full_name, student_code,
 *      phone, email, primary_mentor_id, primary_mentor_name, team_name, invoice_number, course, currency, total_minor,
 *      paid_minor, balance_minor, can_record }] }
 * Counts are of rows, before the filter and the search; the biggest balance first.
 */
export async function getBalancePayments(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const filter: Filter = FILTERS.includes(body?.filter) ? body.filter : "all";
  const needle = String(body?.q ?? "").trim().toLowerCase().slice(0, 100);

  const visible = await visibleMentorIds(user);
  const mine = visible ? await theirStudents(user, studentsOf(visible)) : null;
  const inParts = await idsPayingInParts();
  const owing = {
    $or: [
      { course_fees: { $elemMatch: TRACKER_OWING } },
      ...(inParts.length ? [{ _id: { $in: inParts.map(toObjectId).filter((id) => id !== null) } }] : []),
    ],
  };
  const students = (await col("students")
    .find(mine ? { $and: [owing, mine] } : owing, { projection: PROJECTION })
    .limit(5000)
    .toArray()) as any[];
  const balances = await courseBalancesOf(students.map((s) => String(s._id)));

  const all: any[] = [];
  for (const s of students) {
    const base = {
      student_id: String(s._id),
      full_name: String(s.full_name ?? ""),
      student_code: String(s.student_code ?? ""),
      phone: String(s.phone ?? "").replace(/^[\s'`"]+/, "").trim(),
      email: String(s.email ?? ""),
      primary_mentor_id: String(s.primary_mentor_id ?? ""),
      primary_mentor_name: String(s.primary_mentor_name ?? ""),
      team_name: String(s.team_name ?? ""),
      can_record: canWorkOn(user, s),
    };
    for (const f of (Array.isArray(s.course_fees) ? s.course_fees : []).filter(trackerOwes)) {
      all.push({
        ...base, key: `${s._id}|tracker|${f.invoice_id ?? f.course}`, source: "tracker", source_label: SOURCE_LABEL.tracker,
        invoice_number: String(f.invoice_number ?? ""), course: String(f.course ?? ""), currency: String(f.currency || "AED"),
        total_minor: Number(f.fee_minor) || 0, paid_minor: Number(f.paid_minor) || 0, balance_minor: Number(f.balance_minor) || 0,
      });
    }
    for (const b of balances.get(String(s._id)) ?? []) {
      if (!(b.balanceAed > 0)) continue;
      all.push({
        ...base, key: `${s._id}|${b.source}|${b.course}`, source: b.source, source_label: SOURCE_LABEL[b.source],
        invoice_number: "", course: b.course, currency: "AED",
        total_minor: minor(b.totalAed), paid_minor: minor(b.paidAed), balance_minor: minor(b.balanceAed),
      });
    }
  }
  const counts = {
    all: all.length,
    tracker: all.filter((r) => r.source === "tracker").length,
    bonus: all.filter((r) => r.source === "bonus").length,
    upgrade: all.filter((r) => r.source === "upgrade").length,
  };
  const rows = all
    .filter((r) => filter === "all" || r.source === filter)
    .filter((r) => !needle || [r.full_name, r.student_code, r.phone, r.email, r.course, r.invoice_number, r.primary_mentor_name].some((v: string) => v.toLowerCase().includes(needle)))
    .sort((a, b) => b.balance_minor - a.balance_minor || a.full_name.localeCompare(b.full_name));
  return json({ counts, rows });
}

/**
 * POST /api/functions/recordBalancePayment — no longer taken (2026-10-13). A course a sales CRM closed has its balance
 * payments recorded in that CRM, where its salesperson follows it up and Delta finance approves them; a course paid in
 * parts here takes its next payment where it always did (the student's Courses card, or Course Upgrades).
 */
export async function recordBalancePayment(_req: Request, _user: AuthUser): Promise<Response> {
  return error("Balance payments on a course a sales CRM closed are recorded in that CRM now — ask the salesperson who closed it", 410);
}
