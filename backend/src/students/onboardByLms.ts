import { col } from "../db";
import { notOnboardedFilter } from "./onboardingAlerts";
import { recordHistory } from "./history";

/* ────────────────────────────────────────────────────────────────────────────
   Onboarded by their LMS courses (the user, 2026-10-13): a student still on
   the Not onboarded list who is already on an LMS course (lms_courses, from the
   hourly LMS check — students/lmsEnrolment.ts) is onboarded — marked as the
   Onboarded switch marks "without sending": nothing is emailed or sent on
   WhatsApp. The reason is kept (onboarded_via "lms_courses") and in their
   history. A test record (a name saying "test") is left alone.

   And a student with no "closed by" — no sales close behind them: the CS
   sheets, the DATA sheet, the enrolment tracker, one added by hand — is
   onboarded the same way (the user, 2026-10-13; onboarded_via "no_closer"):
   the Not onboarded list is for students a salesperson closed.

   For the data as it was that day only (the user, 2026-10-13: "only for the
   current data, the newer will be the same as before") — scripts/
   onboard-lms-enrolled.ts; nothing runs it by itself.
──────────────────────────────────────────────────────────────────────────── */

export const BY_LMS = "LMS enrolment (already on a course)";
export const BY_NO_CLOSER = "No sales closer";
const TEST_NAME = /\btest\b/i;

/** Why a not-onboarded student is onboarded here: on an LMS course, or no sales closer — or null. */
export const reasonOf = (s: any): "lms_courses" | "no_closer" | null =>
  Array.isArray(s?.lms_courses) && s.lms_courses.length ? "lms_courses"
    : !Array.isArray(s?.closed_by) || !s.closed_by.length ? "no_closer" : null;

/** The not-onboarded students already on an LMS course, or with no sales closer — test records left out. */
export async function enrolledNotOnboarded(): Promise<any[]> {
  const rows = (await col("students").find({ ...notOnboardedFilter(),
    $or: [{ "lms_courses.0": { $exists: true } }, { closed_by: { $exists: false } }, { closed_by: { $size: 0 } }, { closed_by: null }] },
    { projection: { student_code: 1, full_name: 1, primary_mentor_name: 1, lms_courses: 1, closed_by: 1, created_date: 1, source: 1 } }).toArray()) as any[];
  return rows.filter((s) => !TEST_NAME.test(String(s.full_name ?? "")) && reasonOf(s));
}

/** Marks them onboarded; how many. Never throws — the LMS check goes on either way. */
export async function onboardEnrolledStudents(list?: any[]): Promise<number> {
  try {
    const rows = list ?? (await enrolledNotOnboarded());
    if (!rows.length) return 0;
    const now = new Date().toISOString();
    let done = 0;
    for (const s of rows) {
      const courses = [...new Set((s.lms_courses ?? []).map((c: any) => String(c.title ?? "")).filter(Boolean))].join(", ");
      const why = reasonOf(s) ?? "lms_courses";
      const by = why === "lms_courses" ? BY_LMS : BY_NO_CLOSER;
      const r = await col("students").updateOne({ _id: s._id, onboarded: { $ne: true } }, {
        $set: { onboarded: true, onboarded_at: now, onboarded_by_id: null, onboarded_by_name: by, onboarded_via: why, updated_date: now },
      });
      if (!r.modifiedCount) continue;
      done++;
      await recordHistory([{ student_id: String(s._id), at: now, type: "onboarding_changed", by_id: null, by_name: by, from: false, to: true,
        text: (why === "lms_courses"
          ? `Onboarded — already enrolled on LMS course${courses.includes(",") ? "s" : ""}${courses ? `: ${courses}` : ""}. Nothing was sent.`
          : "Onboarded — no sales close behind them (no \"closed by\"). Nothing was sent.").slice(0, 400) } as any]);
    }
    return done;
  } catch (err) {
    console.error("[onboard by LMS]", err);
    return 0;
  }
}
