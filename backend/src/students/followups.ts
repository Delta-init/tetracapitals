import { col } from "../db";
import type { AuthUser } from "../auth/middleware";
import { isAdminRole } from "../lib/roles";
import { getDownlineIds } from "../lib/scope";

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
export const TARGET_OUTCOMES = ["DSLP", "DQMP", "DGMP", "Additional Deposit / Top-up", "Onboarding call", "Other"] as const;
export const STAGES = ["New", "Contacted", "Qualified", "Session with CM", "Objection Stage", "Converted", "Lost"] as const;
export const LOST_REASONS = [
  "Not enough capital right now", "Trust / legitimacy concern", "Comparing with free content",
  "Price too high", "Needs more time to decide", "Not interested", "Other (see notes)",
] as const;
export const CLOSED_STAGES = new Set(["Converted", "Lost"]);
const PRODUCT_OUTCOMES = new Set(["DSLP", "DQMP", "DGMP"]);
const TOP_UP = "Additional Deposit / Top-up";

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
  if (user.app_role === "chief_mentor" || user.app_role === "cs_manager") return new Set(await getDownlineIds(user.id));
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
 * Auto-convert: an open follow-up whose student has an APPROVED DEPOSIT since
 * the follow-up was opened becomes Converted — for DSLP / DQMP / DGMP only
 * when the deposit is tagged with that product; for "Additional Deposit /
 * Top-up" any approved deposit. "Other" is never automatic. Converted date =
 * the deposit's approval date; deal value = its amount.
 */
export async function autoConvert(followups: any[]): Promise<number> {
  const open = followups.filter((f) => !CLOSED_STAGES.has(f.stage) && (PRODUCT_OUTCOMES.has(f.target_outcome) || f.target_outcome === TOP_UP));
  if (!open.length) return 0;
  const studentIds = [...new Set(open.map((f) => String(f.student_id)))];
  const deposits = (await col("funding_transactions")
    .find(
      { student_id: { $in: studentIds }, type: "DEPOSIT", status: "APPROVED" },
      { projection: { student_id: 1, approved_at: 1, requested_at: 1, created_date: 1, amount_usd: 1, tags: 1 } },
    )
    .sort({ approved_at: 1 })
    .toArray()) as any[];
  if (!deposits.length) return 0;

  let converted = 0;
  const now = new Date().toISOString();
  for (const f of open) {
    const opened = String(f.created_date || "");
    const match = deposits.find((d) => {
      if (String(d.student_id) !== String(f.student_id)) return false;
      const at = String(d.approved_at || d.requested_at || d.created_date || "");
      if (!at || at < opened) return false;
      if (f.target_outcome === TOP_UP) return true;
      const tags = Array.isArray(d.tags) ? d.tags : d.tags ? [d.tags] : [];
      return tags.map(String).includes(f.target_outcome);
    });
    if (!match) continue;
    const at = String(match.approved_at || match.requested_at || match.created_date);
    const fromStage = f.stage;
    const patch = {
      stage: "Converted",
      converted_date: businessDate(at),
      deal_value: Number(match.amount_usd) || 0,
      converted_by_deposit_id: String(match._id),
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
      text: `Converted automatically — approved deposit of $${patch.deal_value.toLocaleString("en-US")} on ${patch.converted_date}`,
    }]);
  }
  return converted;
}
