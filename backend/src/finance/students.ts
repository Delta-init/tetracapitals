import { col } from "../db";
import { config } from "../config";
import { ok, refuse, secretMatches, text, isEmail, answer, studentWithEmail, createStudent } from "../students/intake";
import { lmsEnrolledFields } from "../students/lmsEnrolment";
import { languageOf } from "../students/language";
import { salesCrmOf, salesCrmName } from "../students/salesCrm";
import { closedByEntry, type ClosedBy } from "../students/closedBy";
import { recordHistory } from "../students/history";
import { leadersOf } from "../students/followupReminders";
import { loadTeams } from "../students/teams";
import { notify } from "../lib/notify";
import { toObjectId } from "../lib/id";

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

   And the language they study in, as the sales CRM asked it at the close
   (students/language.ts): on the course's fees, and on the student — the
   language of their latest close, so a new close for a student already here
   sets theirs, said in their history. The same invoice again does not.

   And which sales CRM sold it (students/salesCrm.ts): on the course's fees,
   and on the student — the CRM they first came through, so a later course
   from another CRM is tagged on its own fees and leaves the student's alone.

   And who closed it — the sales person in that CRM (students/closedBy.ts): on
   the student's closed_by, once each; a later course can add another.

   A new student is told at once: their CS gets "New student" (intake.ts),
   their CS's leaders and the Super Admins a notice of their own (tellLeaders).
──────────────────────────────────────────────────────────────────────────── */

/** One course's money, as finance approved it. Minor units (cents / fils). */
type CourseFee = {
  invoice_id: string;
  invoice_number: string;
  course: string;
  /** What this course is studied in, from the close; "" when the CRM did not say. */
  language: string;
  /** Which sales CRM sold it ("delta", "remote", "draw"); "" when finance did not say. */
  sales_crm: string;
  currency: string;
  fee_minor: number;
  paid_minor: number;
  balance_minor: number;
  bonus_given: boolean | null;
  bonus_minor: number;
  /** The bonus's own currency — USD from the sales CRMs since 2026-10-09; absent, the fee's (`currency`). */
  bonus_currency?: string;
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
function courseFee(raw: unknown, invoiceId: string, invoiceNumber: string, course: string, language: string, salesCrm: string): CourseFee | null {
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
    language,
    sales_crm: salesCrm,
    currency,
    fee_minor: fee,
    paid_minor: paid,
    balance_minor: balance,
    bonus_given: bonus ? bonus.given === true : null,
    bonus_minor: bonus?.given === true ? minor(bonus.amountMinor) ?? 0 : 0,
    ...(/^[A-Z]{3}$/.test(text(bonus?.currency, 3).toUpperCase()) ? { bonus_currency: text(bonus?.currency, 3).toUpperCase() } : {}),
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

/** The language of their latest close, on a student already here — in their history when it changes. */
async function recordCloseLanguage(student: { _id: unknown; language?: unknown }, language: string, invoiceNumber: string): Promise<void> {
  const was = String(student.language ?? "");
  if (!language || was === language) return;
  const now = new Date().toISOString();
  await col("students").updateOne({ _id: student._id as never }, { $set: { language, updated_date: now } });
  await recordHistory([{
    student_id: String(student._id), at: now, type: "details_changed",
    text: `Details changed — Language: ${was || "none"} → ${language} (the sales close${invoiceNumber ? `, invoice ${invoiceNumber}` : ""})`,
    by_id: null, by_name: "Delta finance", from: { language: was }, to: { language }, via: "finance",
  }]);
}

/**
 * The CRM a student already here first came through, where they have none yet
 * — one from before finance said. A later course from another CRM is tagged on
 * its own fees, and leaves this alone.
 */
async function recordSalesCrm(student: { _id: unknown; sales_crm?: unknown }, salesCrm: string): Promise<void> {
  if (!salesCrm || student.sales_crm) return;
  await col("students").updateOne({ _id: student._id as never, sales_crm: { $in: [null, ""] } }, { $set: { sales_crm: salesCrm } });
}

/** Who closed this course, on the student's list — once each: the same invoice again, or another course of theirs, adds nobody twice. */
async function recordClosedBy(student: { _id: unknown }, closer: ClosedBy | null): Promise<void> {
  if (!closer) return;
  await col("students").updateOne({ _id: student._id as never, "closed_by.email": { $ne: closer.email } }, { $push: { closed_by: closer } as never });
}

const TEST_EMAIL = /@deltatest\.dev$/i;

/**
 * A new student from finance, told at once to their CS's leaders — the team's Chief Mentor and any CS Manager above
 * the CS, as the follow-up and onboarding alerts — and to every Super Admin: the bell and a push to their devices,
 * no email (the user, 2026-10-03). The CS has their own "New student". A test CS's student tells nobody; test and
 * inactive accounts are never told. Never throws: the student is what matters.
 */
async function tellLeaders(studentId: string, course: string): Promise<void> {
  try {
    const s: any = await col("students").findOne(
      { _id: toObjectId(studentId) as any },
      { projection: { full_name: 1, student_code: 1, primary_mentor_id: 1, primary_mentor_name: 1, team_name: 1 } },
    );
    if (!s) return;
    const teams = await loadTeams();
    const cs = String(s.primary_mentor_id ?? "");
    if (cs && TEST_EMAIL.test(String(teams.userById.get(cs)?.email ?? ""))) return;
    const superAdmins = [...teams.userById.values()].filter((u) => u.app_role === "super_admin").map((u) => String(u._id));
    const ids = [...new Set([...(cs ? leadersOf(cs, teams) : []), ...superAdmins])].filter((id) => id !== cs);
    if (!ids.length) return;
    const people = (await col("users")
      .find({ _id: { $in: ids.map(toObjectId).filter(Boolean) as any[] } }, { projection: { email: 1, status: 1, is_test: 1 } })
      .toArray()) as any[];
    const told = people.filter((u) => u.status !== "inactive" && !u.is_test && !TEST_EMAIL.test(String(u.email ?? ""))).map((u) => String(u._id));
    const name = String(s.full_name ?? "").trim() || s.student_code || "A student";
    const where = cs ? `Given to ${s.primary_mentor_name || "their CS"}${s.team_name ? `, ${s.team_name}` : ""}` : "No CS to give them to — in Delta Open Students";
    await notify(told, {
      type: "student_arrived",
      title: `New student from finance: ${name}`,
      body: `${name}${s.student_code ? ` (${s.student_code})` : ""}${course ? ` — ${course}` : ""}. ${where}; not onboarded yet.`,
      link: `/StudentDetail?id=${String(s._id)}`,
      tag: `arrived-${String(s._id)}`,
      renotify: true,
    });
  } catch (err) {
    console.error("[finance students] could not tell the leaders", err instanceof Error ? err.message : err);
  }
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
  const language = languageOf(body.language);
  const salesCrm = salesCrmOf(body.crm);
  const closer = closedByEntry(body.closedBy);

  const fee = courseFee(body.feeSummary, invoiceId, invoiceNumber, course, language, salesCrm);

  // The same invoice again — finance retrying, or asked twice. One student.
  const already = await col("students").findOne({ finance_invoice_id: invoiceId });
  if (already) {
    // Not the language: this close's was set when it first came, and a later close may have set another since.
    await recordCourseFee(already, fee);
    await recordClosedBy(already, closer);
    return ok(answer(already, false, "invoice", "This invoice's student is already here"));
  }

  const existing = await studentWithEmail(email);
  if (existing) {
    await recordCourseFee(existing, fee);
    await recordCloseLanguage(existing, language, invoiceNumber);
    await recordSalesCrm(existing, salesCrm);
    await recordClosedBy(existing, closer);
    return ok(answer(existing, false, "email", `${email} is already a student here — left as they are${fee ? ", with this course's fees added" : ""}`));
  }

  const created = await createStudent({
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
      ...(language ? { language } : {}),
      ...(salesCrm ? { sales_crm: salesCrm } : {}),
      ...(closer ? { closed_by: [closer] } : {}),
      // Written with the student, so a new student never exists without the course they paid for.
      course_fees: fee ? [fee] : [],
      // With an LMS account: enrolled from the start (the hourly LMS check confirms it).
      ...(text(body.lmsUserId, 64) ? lmsEnrolledFields() : {}),
    },
    arrived: `Arrived from ${salesCrm === "draw" ? "" : "the "}${salesCrmName(salesCrm)}, via finance — ${course || "a course"}${invoiceNumber ? `, invoice ${invoiceNumber}` : ""}`,
    createdBy: "delta-finance",
    createdByName: "Delta LMS (via finance)",
    unique: { field: "finance_invoice_id", value: invoiceId, existing: "invoice", detail: "This invoice's student is already here" },
  });
  if (created.created) void tellLeaders(created.studentId, course);
  return ok(created);
}
