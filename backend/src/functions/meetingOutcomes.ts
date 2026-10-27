import { json, error, forbidden, notFound } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { callLms, lmsConfigured, LmsError } from "../lib/lms";
import { col } from "../db";
import { toObjectId } from "../lib/id";
import { userCanReadDoc } from "../entities/crud";
import { OUTCOMES, syncMeetingOutcomes } from "../students/meetingOutcomes";

/* ────────────────────────────────────────────────────────────────────────────
   The meeting-outcome pop-up (students/meetingOutcomes.ts): the signed-in
   mentor's meetings waiting for one (the LMS knows them by this person's
   email — nobody else has any), the form's lists, filling one, and a
   student's outcomes for their page.
──────────────────────────────────────────────────────────────────────────── */

const str = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);

/** POST /api/functions/getPendingMeetingOutcomes → { meetings } — never an error: a pop-up must not break a page. */
export async function getPendingMeetingOutcomes(_req: Request, user: AuthUser): Promise<Response> {
  if (!lmsConfigured() || !user.email) return json({ meetings: [] });
  try {
    const data = await callLms<{ meetings: unknown[] }>("/meeting-outcomes/pending", { query: { mentorEmail: user.email }, verb: "list the meetings waiting" });
    return json({ meetings: data.meetings ?? [] });
  } catch (err) {
    return json({ meetings: [], unavailable: String((err as Error)?.message ?? err) });
  }
}

/** POST /api/functions/getMeetingOutcomeOptions → { stages, followUpKinds, paymentModes, notInterestedReasons, courses, mentors } */
export async function getMeetingOutcomeOptions(_req: Request, _user: AuthUser): Promise<Response> {
  try {
    return json(await callLms("/meeting-outcomes/options", { verb: "share the form's lists" }));
  } catch (err) {
    if (err instanceof LmsError) return error(err.message, err.status);
    throw err;
  }
}

/**
 * POST /api/functions/saveMeetingOutcome { meetingId, stage, remark, courseId?, paymentDate?, paymentMode?, followUpKind?,
 *   followUpDate?, withMentorEmail?, moduleId?, reason? } — as the signed-in mentor (the LMS checks it is theirs). Then
 * it is put on the student at once.
 */
export async function saveMeetingOutcome(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const meetingId = str(body?.meetingId, 100);
  if (!meetingId) return error("meetingId is required", 400);
  const fields: Record<string, string> = {};
  for (const k of ["stage", "remark", "courseId", "paymentDate", "paymentMode", "followUpKind", "followUpDate", "withMentorEmail", "moduleId", "reason"]) {
    if (body?.[k] !== undefined) fields[k] = str(body[k], k === "remark" ? 2000 : 200);
  }
  try {
    const saved = await callLms(`/mentor-meetings/${encodeURIComponent(meetingId)}/outcome`, { method: "POST", body: { ...fields, mentorEmail: user.email }, verb: "save the outcome" });
    void syncMeetingOutcomes().catch(() => {});
    return json(saved);
  } catch (err) {
    // The LMS says why (filled already, not over yet, missing a field) — a 409 here, so the page can tell.
    if (err instanceof LmsError) return error(err.message, err.status);
    throw err;
  }
}

/** POST /api/functions/getStudentMeetingOutcomes { studentId } → { outcomes } newest first, for whoever may see the student. */
export async function getStudentMeetingOutcomes(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(str(body?.studentId, 40));
  if (!oid) return error("studentId is required", 400);
  const s: any = await col("students").findOne({ _id: oid });
  if (!s) return notFound("No such student");
  if (!(await userCanReadDoc(user, "Student", s))) return forbidden();
  const rows = (await col(OUTCOMES).find({ student_ids: String(s._id) }).sort({ filled_at: -1 }).limit(100).toArray()) as any[];
  return json({
    outcomes: rows.map((r) => ({
      id: String(r._id), meeting: r.meeting, mentor: r.mentor, outcome: r.outcome, stage: r.stage, filled_at: r.filled_at,
      reminder: (r.reminders ?? []).find((x: any) => x.student_id === String(s._id)) ?? null,
    })),
  });
}
