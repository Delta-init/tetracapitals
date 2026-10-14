import { col } from "../db";

/* ────────────────────────────────────────────────────────────────────────────
   "Not a student" (the user, 2026-10-14): someone in the list who isn't
   one — marked, with who, when and why, they never show on the Students page
   or the work lists (Not onboarded, Follow-ups, Class completions, Balance
   payments, the counts and the reminders); only on Inactive students, where
   they can be marked a student again. Nothing is deleted; their funding
   requests and payments stay where they are.

   students.not_student: true (+ not_student_at / _by_id / _by_name / _reason).
   Their follow-ups and class completions carry student_not_student: true so
   the lists that read those collections leave them out without a lookup.
──────────────────────────────────────────────────────────────────────────── */

/** Students who are students — what every list goes by. */
export const IS_STUDENT = { not_student: { $ne: true } };
/** Follow-ups and class completions of students who are students. */
export const OF_A_STUDENT = { student_not_student: { $ne: true } };

/** Marks (or unmarks) what hangs off a student, so the lists over those collections follow. */
export async function flagTheirRecords(studentId: string, on: boolean): Promise<void> {
  const set = on ? { $set: { student_not_student: true } } : { $unset: { student_not_student: "" } };
  await col("student_followups").updateMany({ student_id: studentId }, set as any);
  await col("class_completions").updateMany({ student_id: studentId }, set as any);
}
