import { col } from "../db";
import { config } from "../config";
import { ok, refuse, secretMatches, text, isEmail, studentWithEmail } from "../students/intake";
import { csOf } from "../students/lmsCs";

/* ────────────────────────────────────────────────────────────────────────────
   POST /api/v1/integrations/lms/student-cs — the Delta LMS asking, now, who
   looks after one student (the user, 2026-10-10): its admin's "Recheck
   commission portal", and a student created or edited there — rather than
   waiting up to ten minutes for the push (students/lmsCs.ts).

   Body { lmsUserId?, email }. Found by their LMS id, else by email. Answers
   { found: true, cs, team, code, open } — what the push would say — or
   { found: false }. Read only, but what was told is noted as the push notes
   it, so the next push does not send the same again. The LMS's own secret in
   `x-lms-secret`, as for new students (lms/students.ts).
──────────────────────────────────────────────────────────────────────────── */

export async function handleLmsStudentCs(req: Request): Promise<Response> {
  if (!config.lmsS2sSecret) return refuse(503, "INTEGRATION_DISABLED", "The Delta LMS link is not configured on this server");
  if (!secretMatches(req.headers.get("x-lms-secret"), config.lmsS2sSecret)) return refuse(401, "UNAUTHORISED", "Bad secret");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse(400, "VALIDATION_ERROR", "Body must be a JSON object");
  const lmsUserId = text(body.lmsUserId, 64);
  const email = text(body.email).toLowerCase();
  if (!isEmail(email) && !/^[0-9a-f]{24}$/i.test(lmsUserId)) return refuse(400, "VALIDATION_ERROR", "A valid email or lmsUserId is required");

  const s: any = (/^[0-9a-f]{24}$/i.test(lmsUserId) ? await col("students").findOne({ lms_user_id: lmsUserId }) : null)
    ?? (isEmail(email) ? await studentWithEmail(email) : null);
  if (!s) return ok({ found: false });

  const now = csOf(s);
  await col("students").updateOne({ _id: s._id }, { $set: { lms_cs_sent: { ...now, at: new Date().toISOString() } } });
  return ok({ found: true, ...now });
}
