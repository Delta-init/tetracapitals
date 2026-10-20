import { col } from "../db";
import type { AuthUser } from "../auth/middleware";
import { isAdminRole } from "../lib/roles";
import { getDownlineIds, TEAM_WIDE_MENTORS } from "../lib/scope";

/* ────────────────────────────────────────────────────────────────────────────
   Student follow-ups — the CS follow-up tracker, per student.

   One record per student + target outcome (a student can have several open at
   once). A follow-up belongs to whoever is the student's primary mentor NOW,
   so it moves with the student — and a CS the student is Common with works on
   it too. Every logged follow-up is also kept as an
   event, so "what the client said" is never overwritten.

   Follow-up status is never stored: it is worked out from the stage and the
   next due date, in business time (UTC+5:30, as quarterRange.jsx).
──────────────────────────────────────────────────────────────────────────── */

// "Onboarding call": the call after a student is onboarded (the user, 2026-10-04) — never automatic, as "Other".
// The courses are the Products page's (transaction_tags, active), plus DGMP until it is one (the user, 2026-10-16:
// MSNR and the other courses were missing — the list was the old sheet's DSLP / DQMP / DGMP); targetOutcomes().
export const FIXED_OUTCOMES = ["Additional Deposit / Top-up", "Onboarding call", "Other"] as const;
/** The old sheet's courses: still valid on a follow-up that has one, and DGMP still offered. */
const LEGACY_COURSE_OUTCOMES = ["DSLP", "DQMP", "DGMP"];
const KEPT_COURSE_OUTCOMES = ["DGMP"];
/** @deprecated the fixed list from before 2026-10-16 — kept for anything still reading it; targetOutcomes() is the list. */
export const TARGET_OUTCOMES = ["DSLP", "DQMP", "DGMP", ...FIXED_OUTCOMES] as const;

/** The target outcomes offered: each course on the Products page (active), DGMP, then Top-up, Onboarding call, Other. */
export async function targetOutcomes(): Promise<string[]> {
  const products = ((await col("transaction_tags").find({ active: { $ne: false } }, { projection: { name: 1 } }).sort({ name: 1 }).toArray()) as any[])
    .map((t) => String(t.name ?? "").trim()).filter(Boolean);
  const courses = [...new Set([...products, ...KEPT_COURSE_OUTCOMES])].filter((n) => !(FIXED_OUTCOMES as readonly string[]).includes(n));
  return [...courses, ...FIXED_OUTCOMES];
}

/** Whether a follow-up may be about this: one offered now, or one of the old sheet's courses. */
export async function isTargetOutcome(outcome: string): Promise<boolean> {
  if (!outcome) return false;
  if (LEGACY_COURSE_OUTCOMES.includes(outcome)) return true;
  return (await targetOutcomes()).includes(outcome);
}

const words = (v: unknown) => String(v ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/**
 * Whether money paid for `course` (a product's name, an upgrade's code or name) is the course a follow-up is about:
 * every word of the outcome is in it — "MSNR" is MSNR, "DSLP Full" is "DSLP PRO Full", and the old "DSLP" any DSLP.
 */
export function outcomeMatches(outcome: string, course: unknown): boolean {
  const want = words(outcome);
  const have = new Set(words(course));
  return want.length > 0 && want.every((w) => have.has(w));
}
export const STAGES = ["New", "Contacted", "Qualified", "Session with CM", "Objection Stage", "Converted", "Lost"] as const;
export const LOST_REASONS = [
  "Not enough capital right now", "Trust / legitimacy concern", "Comparing with free content",
  "Price too high", "Needs more time to decide", "Not interested", "Other (see notes)",
] as const;
export const CLOSED_STAGES = new Set(["Converted", "Lost"]);
const TOP_UP = "Additional Deposit / Top-up";
/** A course outcome: anything but Top-up, Onboarding call and Other. */
const isCourseOutcome = (o: unknown) => !!o && !(FIXED_OUTCOMES as readonly string[]).includes(String(o));

const BUSINESS_OFFSET_MS = 330 * 60_000;
/** Today's date (YYYY-MM-DD) in business time. */
export const businessToday = () => new Date(Date.now() + BUSINESS_OFFSET_MS).toISOString().slice(0, 10);
const businessDate = (iso: string) => new Date(Date.parse(iso) + BUSINESS_OFFSET_MS).toISOString().slice(0, 10);

/** The sheet's formula: Closed / – / OVERDUE / DUE TODAY / On Track. */
export function followupStatus(f: { stage?: string; next_followup_date?: string }, today = businessToday()): string {
  if (CLOSED_STAGES.has(String(f.stage))) return "Closed";
  const due = String(f.next_followup_date || "");
  if (!due) return "-";
  if (due < today) return "OVERDUE";
  if (due === today) return "DUE TODAY";
  return "On Track";
}

export const isAdmin = (user: AuthUser) => user.app_role === "super_admin" || user.app_role === "admin" || isAdminRole(user.app_role);
export const canEditAny = (user: AuthUser) => user.app_role === "super_admin" || user.app_role === "admin";

/**
 * Whose students' follow-ups `user` may SEE: null = everyone (admin roles);
 * Chief Mentor and CS Manager — themselves and everyone under them (Up Head);
 * anyone else — only themselves.
 */
export async function visibleMentorIds(user: AuthUser): Promise<Set<string> | null> {
  if (isAdmin(user)) return null;
  // …and a senior / junior / sub-junior mentor their whole team (lib/scope TEAM_WIDE_MENTORS, 2026-10-20).
  if (user.app_role === "chief_mentor" || user.app_role === "cs_manager" || TEAM_WIDE_MENTORS.has(user.app_role)) return new Set(await getDownlineIds(user.id));
  return new Set([user.id]);
}

/**
 * The other CSs a student is Common with: on two CSs' own sheets, they stay with the first (their CS) and are also
 * with the other — both see and work on them (students.common_cs, set by the CS-sheet import).
 */
export const commonIds = (student: any): string[] =>
  (Array.isArray(student?.common_cs) ? student.common_cs : []).map((c: any) => String(c?.id ?? "")).filter(Boolean);

/** Is this one of `ids`' students — their CS, or a CS they are Common with? */
export const isStudentOf = (student: any, ids: Set<string>) =>
  ids.has(String(student?.primary_mentor_id ?? "")) || commonIds(student).some((id) => ids.has(id));

/** Filter for `ids`' students — their CS, or a CS they are Common with. */
export const studentsOf = (ids: Iterable<string>) => {
  const list = [...ids];
  return { $or: [{ primary_mentor_id: { $in: list } }, { "common_cs.id": { $in: list } }] };
};

/** May `user` create / log follow-ups for this student? Their own students (Common ones too), or Super Admin / Admin. */
export const canWorkOn = (user: AuthUser, student: any) =>
  canEditAny(user) || String(student?.primary_mentor_id ?? "") === user.id || commonIds(student).includes(user.id);

export interface FollowupEvent {
  followup_id: string;
  student_id: string;
  at: string;
  by_id: string | null;
  by_name: string;
  /** "note": a note written on its own, between calls (addFollowupNote). */
  kind: "created" | "logged" | "auto_converted" | "edited" | "note";
  stage_from?: string | null;
  stage_to?: string | null;
  /** What the client said, and the notes — as written this time (only then): every one is kept, none overwritten. */
  client_said?: string;
  notes?: string;
  /** Text the follow-up held from before every entry was kept, saved into the log when it was next written to. */
  earlier?: boolean;
  next_followup_date?: string;
  text: string;
}

export async function recordEvents(events: FollowupEvent[]) {
  if (events.length) await col("student_followup_events").insertMany(events as any[]);
}

/**
 * Auto-convert: an open follow-up whose student paid for what it is about since it was opened becomes Converted.
 * A course (the user, 2026-10-16: whichever way it is paid for now) — an approved bonus course payment for it (its
 * product), an approved payment of a course upgrade to it, or an approved deposit tagged with it; "Additional
 * Deposit / Top-up" — any approved deposit. "Onboarding call" and "Other" are never automatic. Converted date = when
 * that money was approved; deal value = its amount, in dollars.
 */
const AED_PER_USD = 3.67;
type Paid = { id: string; student: string; at: string; usd: number; courses: string[]; topUp: boolean; what: string };

async function paidFor(studentIds: string[]): Promise<Paid[]> {
  const out: Paid[] = [];
  const txs = (await col("funding_transactions")
    .find(
      { student_id: { $in: studentIds }, type: { $in: ["DEPOSIT", "BONUS"] }, status: "APPROVED" },
      { projection: { student_id: 1, type: 1, approved_at: 1, requested_at: 1, created_date: 1, amount_usd: 1, tags: 1, course_payment: 1, bonus_credit: 1 } },
    )
    .toArray()) as any[];
  for (const t of txs) {
    // A bonus credited at a sales close is the promised bonus, not money the student paid.
    if (t.type === "BONUS" && t.bonus_credit) continue;
    const tags = Array.isArray(t.tags) ? t.tags : t.tags ? [t.tags] : [];
    out.push({
      id: String(t._id), student: String(t.student_id), at: String(t.approved_at || t.requested_at || t.created_date || ""),
      usd: Number(t.amount_usd) || 0, courses: [...tags.map(String), ...(t.course_payment?.product ? [String(t.course_payment.product)] : [])],
      topUp: t.type === "DEPOSIT", what: t.type === "BONUS" ? "course payment" : "deposit",
    });
  }
  const upgrades = (await col("course_upgrades").find({ student_id: { $in: studentIds } }, { projection: { student_id: 1, course: 1, quote: 1 } }).toArray()) as any[];
  if (upgrades.length) {
    const byId = new Map(upgrades.map((u) => [String(u._id), u]));
    // The course's name as the price list has it ("DSLP PRO Full"), beside its code ("DSLP_PRO").
    const { DEFAULT_PRICE_LIST } = await import("../courses/priceList");
    const nameOf = new Map<string, string>(DEFAULT_PRICE_LIST.map((c) => [String(c.code), String(c.name)]));
    const pays = (await col("course_payments")
      .find({ upgrade_id: { $in: [...byId.keys()] }, status: "approved" }, { projection: { upgrade_id: 1, decided_at: 1, recorded_at: 1, amount_aed: 1, approved_amount_aed: 1 } })
      .toArray()) as any[];
    for (const p of pays) {
      const u = byId.get(String(p.upgrade_id));
      if (!u) continue;
      const aed = Number(p.approved_amount_aed ?? p.amount_aed) || 0;
      out.push({
        id: String(p._id), student: String(u.student_id), at: String(p.decided_at || p.recorded_at || ""),
        usd: Math.round((aed / AED_PER_USD) * 100) / 100, courses: [String(u.course ?? ""), nameOf.get(String(u.course ?? "")) ?? ""].filter(Boolean),
        topUp: false, what: "course upgrade payment",
      });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export async function autoConvert(followups: any[]): Promise<number> {
  const open = followups.filter((f) => !CLOSED_STAGES.has(f.stage) && f.target_outcome !== "Onboarding call" && f.target_outcome !== "Other"
    && (isCourseOutcome(f.target_outcome) || f.target_outcome === TOP_UP));
  if (!open.length) return 0;
  const studentIds = [...new Set(open.map((f) => String(f.student_id)))];
  const paid = await paidFor(studentIds);
  if (!paid.length) return 0;

  let converted = 0;
  const now = new Date().toISOString();
  for (const f of open) {
    const opened = String(f.created_date || "");
    const match = paid.find((d) => {
      if (d.student !== String(f.student_id)) return false;
      if (!d.at || d.at < opened) return false;
      if (f.target_outcome === TOP_UP) return d.topUp;
      return d.courses.some((c) => outcomeMatches(f.target_outcome, c));
    });
    if (!match) continue;
    const fromStage = f.stage;
    const patch = {
      stage: "Converted",
      converted_date: businessDate(match.at),
      deal_value: match.usd,
      converted_by_deposit_id: match.id,
      updated_date: now,
    };
    // Only if still open: two viewers at once can't convert it twice.
    const res = await col("student_followups").updateOne({ _id: f._id, stage: fromStage }, { $set: patch });
    if (res.modifiedCount !== 1) continue;
    Object.assign(f, patch);
    converted++;
    await recordEvents([{
      followup_id: String(f._id), student_id: String(f.student_id), at: now, by_id: null, by_name: "Automatic",
      kind: "auto_converted", stage_from: fromStage, stage_to: "Converted",
      text: `Converted automatically — approved ${match.what} of $${patch.deal_value.toLocaleString("en-US")} on ${patch.converted_date}`,
    }]);
  }
  return converted;
}
