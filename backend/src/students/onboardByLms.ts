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
──────────────────────────────────────────────────────────────────────────── */

export const BY_LMS = "LMS enrolment (already on a course)";
const TEST_NAME = /\btest\b/i;

/** The not-onboarded students already on an LMS course — test records left out. */
export async function enrolledNotOnboarded(): Promise<any[]> {
  const rows = (await col("students").find({ ...notOnboardedFilter(), "lms_courses.0": { $exists: true } },
    { projection: { student_code: 1, full_name: 1, primary_mentor_name: 1, lms_courses: 1, created_date: 1 } }).toArray()) as any[];
  return rows.filter((s) => !TEST_NAME.test(String(s.full_name ?? "")));
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
      const r = await col("students").updateOne({ _id: s._id, onboarded: { $ne: true } }, {
        $set: { onboarded: true, onboarded_at: now, onboarded_by_id: null, onboarded_by_name: BY_LMS, onboarded_via: "lms_courses", updated_date: now },
      });
      if (!r.modifiedCount) continue;
      done++;
      await recordHistory([{ student_id: String(s._id), at: now, type: "onboarding_changed", by_id: null, by_name: BY_LMS, from: false, to: true,
        text: `Onboarded — already enrolled on LMS course${courses.includes(",") ? "s" : ""}${courses ? `: ${courses}` : ""}. Nothing was sent.`.slice(0, 400) } as any]);
    }
    return done;
  } catch (err) {
    console.error("[onboard by LMS]", err);
    return 0;
  }
}
