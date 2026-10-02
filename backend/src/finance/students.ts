import { col } from "../db";
import { config } from "../config";
import { ok, refuse, secretMatches, text, isEmail, answer, studentWithEmail, createStudent } from "../students/intake";
import { lmsEnrolledFields } from "../students/lmsEnrolment";

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
   already here — a mentor added them, or it is their second course — keeps
   their mentor, team and record exactly as they are, and does not use up a
   team's turn.

   What the course cost comes too, when finance sends it: the fee, what was
   paid, the balance, whether a bonus was given at the close, and the receipt.
   Kept on the student as `course_fees`, one entry per invoice — so a second
   course adds its own — for the mentors to see. Information only: the bonus
   is what the counsellor promised, not a BONUS request; it credits nobody and
   creates nothing.
──────────────────────────────────────────────────────────────────────────── */

/** One course's money, as finance approved it. Minor units (cents / fils). */
type CourseFee = {
  invoice_id: string;
  invoice_number: string;
  course: string;
  currency: string;
  fee_minor: number;
  paid_minor: number;
  balance_minor: number;
  bonus_given: boolean | null;
  bonus_minor: number;
  receipt_url: string;
  receipt_name: string;
  recorded_at: string;
};

const minor = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/**
 * The course's money from finance's `feeSummary`, or null when it sent none
 * — or sent one that does not add up. A malformed summary is dropped rather
 * than refused: refusing would cost the student their team, and the money is
 * the part that can be looked up in finance.
 */
function courseFee(raw: unknown, invoiceId: string, invoiceNumber: string, course: string): CourseFee | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const f = raw as Record<string, unknown>;
  const fee = minor(f.feeMinor), paid = minor(f.paidMinor), balance = minor(f.balanceMinor);
  const currency = text(f.currency, 3).toUpperCase();
  if (fee === null || paid === null || balance === null || !/^[A-Z]{3}$/.test(currency)) {
    console.warn("[finance students] fee summary ignored — not in the expected shape", { invoiceId });
    return null;
  }
  const bonus = f.bonus && typeof f.bonus === "object" ? (f.bonus as Record<string, unknown>) : null;
  const receipt = f.receipt && typeof f.receipt === "object" ? (f.receipt as Record<string, unknown>) : null;
  const receiptUrl = text(receipt?.url, 2048);
  return {
    invoice_id: invoiceId,
    invoice_number: invoiceNumber,
    course,
    currency,
    fee_minor: fee,
    paid_minor: paid,
    balance_minor: balance,
    bonus_given: bonus ? bonus.given === true : null,
    bonus_minor: bonus?.given === true ? minor(bonus.amountMinor) ?? 0 : 0,
    // Only a link a browser can open — anything else would be a dead or hostile one.
    receipt_url: /^https?:\/\//i.test(receiptUrl) ? receiptUrl : "",
    receipt_name: text(receipt?.name, 200),
    recorded_at: new Date().toISOString(),
  };
}

/** Adds the course's fees to a student already here, once per invoice: a retry finds it there. */
async function recordCourseFee(student: { _id: unknown }, fee: CourseFee | null): Promise<void> {
  if (!fee) return;
  await col("students").updateOne(
    { _id: student._id as never, "course_fees.invoice_id": { $ne: fee.invoice_id } },
    { $push: { course_fees: fee } } as never,
  );
}

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

  const fee = courseFee(body.feeSummary, invoiceId, invoiceNumber, course);

  // The same invoice again — finance retrying, or asked twice. One student.
  const already = await col("students").findOne({ finance_invoice_id: invoiceId });
  if (already) {
    await recordCourseFee(already, fee);
    return ok(answer(already, false, "invoice", "This invoice's student is already here"));
  }

  const existing = await studentWithEmail(email);
  if (existing) {
    await recordCourseFee(existing, fee);
    return ok(answer(existing, false, "email", `${email} is already a student here — left as they are${fee ? ", with this course's fees added" : ""}`));
  }

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
      // Written with the student, so a new student never exists without the course they paid for.
      course_fees: fee ? [fee] : [],
      // With an LMS account: enrolled from the start (the hourly LMS check confirms it).
      ...(text(body.lmsUserId, 64) ? lmsEnrolledFields() : {}),
    },
    arrived: `Arrived from the Delta sales CRM, via finance — ${course || "a course"}${invoiceNumber ? `, invoice ${invoiceNumber}` : ""}`,
    createdBy: "delta-finance",
    createdByName: "Delta LMS (via finance)",
    unique: { field: "finance_invoice_id", value: invoiceId, existing: "invoice", detail: "This invoice's student is already here" },
  }));
}
