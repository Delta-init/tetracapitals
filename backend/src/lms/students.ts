import { col } from "../db";
import { config } from "../config";
import { ok, refuse, secretMatches, text, isEmail, answer, studentWithEmail, createStudent } from "../students/intake";

/* ────────────────────────────────────────────────────────────────────────────
   POST /api/v1/integrations/lms/students — a new student, from the Delta LMS.

   Every student the LMS makes that finance did not — website sign-ups once
   approved, invited students, store and manual purchases, admin enrolments —
   is sent here by the LMS's own job (services/commissionStudents.service.ts
   there). Finance's students come in through finance/students.ts instead.
   Server to server, with its own shared secret in `x-lms-secret`
   (LMS_S2S_SECRET here, COMMISSION_S2S_SECRET in the LMS). Unset means off,
   never open.

   The student goes to the next team in turn, in the same round as finance's
   students — see students/intake.ts.

   Safe to repeat. The same LMS account twice is the same student — including
   one finance already sent, which carries the same LMS id. An email that is
   already here is left exactly as it is, and does not use up a team's turn.
──────────────────────────────────────────────────────────────────────────── */

export async function handleLmsStudents(req: Request): Promise<Response> {
  if (!config.lmsS2sSecret) return refuse(503, "INTEGRATION_DISABLED", "The Delta LMS link is not configured on this server");
  if (!secretMatches(req.headers.get("x-lms-secret"), config.lmsS2sSecret)) return refuse(401, "UNAUTHORISED", "Bad secret");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse(400, "VALIDATION_ERROR", "Body must be a JSON object");

  const lmsUserId = text(body.lmsUserId, 64);
  const email = text(body.email).toLowerCase();
  if (!lmsUserId) return refuse(400, "VALIDATION_ERROR", "lmsUserId is required");
  if (!isEmail(email)) return refuse(400, "VALIDATION_ERROR", "A valid email is required");

  const name = text(body.name) || email.split("@")[0]!;
  const course = text(body.course);
  const academy = text(body.academy, 80);

  // The same LMS account again — the LMS retrying, or finance got there first.
  const already = await col("students").findOne({ lms_user_id: lmsUserId });
  if (already) return ok(answer(already, false, "lms", "This LMS student is already here"));

  const existing = await studentWithEmail(email);
  if (existing) return ok(answer(existing, false, "email", `${email} is already a student here — left as they are`));

  return ok(await createStudent({
    name,
    email,
    phone: text(body.phone, 40),
    country: text(body.country, 80),
    notes: `From Delta LMS${course ? ` — ${course}` : ""}${academy ? ` (${academy})` : ""}`,
    trace: {
      source: "delta_lms",
      lms_user_id: lmsUserId,
      lms_course: course,
      lms_academy: academy,
    },
    createdBy: "delta-lms",
    createdByName: "Delta LMS",
    unique: { field: "lms_user_id", value: lmsUserId, existing: "lms", detail: "This LMS student is already here" },
  }));
}
