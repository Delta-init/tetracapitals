import { col } from "../db";
import { config } from "../config";
import { ok, refuse, secretMatches, text, isEmail, answer, studentWithEmail, createStudent } from "../students/intake";

/* ────────────────────────────────────────────────────────────────────────────
   POST /api/v1/integrations/finance/students — a new Delta LMS student.

   When accounts approve an enrolment the sales CRM raised, finance gives the
   student their LMS course; once the LMS has them, finance sends them here.
   Server to server, with a shared secret in `x-finance-secret`
   (FINANCE_S2S_SECRET here, COMMISSION_S2S_SECRET in finance). Unset means
   off, never open. Its own secret rather than the Root portal's: finance may
   add students, and nothing else.

   The student goes to the next team in turn, in the one round every intake
   shares — see students/intake.ts.

   Safe to repeat. The same invoice twice is the same student. An email that is
   already here — a mentor added them, or it is their second course — is left
   exactly as it is, and does not use up a team's turn.
──────────────────────────────────────────────────────────────────────────── */

export async function handleFinanceStudents(req: Request): Promise<Response> {
  if (!config.financeS2sSecret) return refuse(503, "INTEGRATION_DISABLED", "The Delta finance link is not configured on this server");
  if (!secretMatches(req.headers.get("x-finance-secret"), config.financeS2sSecret)) return refuse(401, "UNAUTHORISED", "Bad secret");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse(400, "VALIDATION_ERROR", "Body must be a JSON object");

  const invoiceId = text(body.invoiceId, 64);
  const email = text(body.email).toLowerCase();
  if (!invoiceId) return refuse(400, "VALIDATION_ERROR", "invoiceId is required");
  if (!isEmail(email)) return refuse(400, "VALIDATION_ERROR", "A valid email is required");

  const name = text(body.name) || email.split("@")[0]!;
  const invoiceNumber = text(body.invoiceNumber, 64);
  const course = text(body.course);

  // The same invoice again — finance retrying, or asked twice. One student.
  const already = await col("students").findOne({ finance_invoice_id: invoiceId });
  if (already) return ok(answer(already, false, "invoice", "This invoice's student is already here"));

  const existing = await studentWithEmail(email);
  if (existing) return ok(answer(existing, false, "email", `${email} is already a student here — left as they are`));

  return ok(await createStudent({
    name,
    email,
    phone: text(body.phone, 40),
    country: text(body.country, 80),
    notes: `From Delta LMS — ${course || "a course"}${invoiceNumber ? `, invoice ${invoiceNumber}` : ""}`,
    trace: {
      source: "delta_lms",
      finance_invoice_id: invoiceId,
      finance_invoice_number: invoiceNumber,
      lms_course: course,
      lms_user_id: text(body.lmsUserId, 64),
    },
    arrived: `Arrived from the Delta sales CRM, via finance — ${course || "a course"}${invoiceNumber ? `, invoice ${invoiceNumber}` : ""}`,
    createdBy: "delta-finance",
    createdByName: "Delta LMS (via finance)",
    unique: { field: "finance_invoice_id", value: invoiceId, existing: "invoice", detail: "This invoice's student is already here" },
  }));
}
