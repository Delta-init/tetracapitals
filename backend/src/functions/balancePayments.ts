import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { visibleMentorIds, studentsOf, canWorkOn } from "../students/followups";
import { theirStudents } from "../students/closedBy";
import { recordHistory } from "../students/history";
import { PAYMENT_METHODS } from "../courses/coursePayments";
import { financeFundingConfigured } from "../finance/funding";
import { ENROLMENT_PAYMENTS, queueEnrolmentPayment } from "../finance/enrolmentPayments";
import { owingFilter, owingFeesOf, owes, dueStateOf, uaeDay, isDay, moneyText, type DueState } from "../finance/balanceDue";

/*
 * The Balance payments page (the user, 2026-10-11): every student in the viewer's scope who still owes on a course
 * Delta finance sold them — a CS their own (Common ones too), a Chief Mentor or CS Manager everyone under them, admin
 * roles everyone, the Sales role the ones they closed, as the Not onboarded page — one row per invoice owing, with
 * the next due date finance worked out (finance/balanceDue.ts). The CS records the next payment from there; Delta
 * finance approves it (finance/enrolmentPayments.ts).
 */

const FILTERS = ["all", "soon", "overdue"] as const;
type Filter = (typeof FILTERS)[number];

const PROJECTION = {
  full_name: 1, student_code: 1, phone: 1, email: 1, primary_mentor_id: 1, primary_mentor_name: 1, common_cs: 1, team_name: 1, course_fees: 1,
};

/** Each owing invoice's latest balance payment recorded here: waiting for finance, or the last turned down. */
async function latestRequests(invoiceIds: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  if (!invoiceIds.length) return out;
  const list = (await col(ENROLMENT_PAYMENTS)
    .find({ invoice_id: { $in: invoiceIds } }, { projection: { invoice_id: 1, student_id: 1, amount_minor: 1, currency: 1, method: 1, paid_on: 1, status: 1, reason: 1, recorded_at: 1, recorded_by_name: 1, decided_at: 1, finance_approval: 1 } })
    .sort({ recorded_at: 1 })
    .toArray()) as any[];
  for (const p of list) out.set(`${p.student_id}|${p.invoice_id}`, p);
  // A pending one wins over a later decision on another — the CS must see what finance still has.
  for (const p of list) if (p.status === "pending") out.set(`${p.student_id}|${p.invoice_id}`, p);
  return out;
}

const requestView = (p: any) => (p ? {
  id: String(p._id), status: p.status, amount_minor: p.amount_minor, currency: p.currency, method: p.method, paid_on: p.paid_on,
  recorded_at: p.recorded_at, recorded_by_name: p.recorded_by_name ?? "", reason: p.reason ?? "", decided_at: p.decided_at ?? null,
  sent: p.finance_approval?.state === "sent" || p.finance_approval?.state === "decided",
  last_error: p.status === "pending" ? p.finance_approval?.last_error ?? null : null,
} : null);

/**
 * POST /api/functions/getBalancePayments { filter?: "all" | "soon" | "overdue", q? }
 * → { today, counts: { all, soon, overdue }, rows: [{ key, student_id, full_name, student_code, phone, email,
 *      primary_mentor_id, primary_mentor_name, team_name, invoice_id, invoice_number, course, currency, total_minor,
 *      paid_minor, balance_minor, last_paid_on, next_due_on, days_left, due_state, payments, request, can_record }] }
 * Counts are of rows (invoices), before the filter and the search; sorted by the next due date, the earliest first,
 * those with no date yet last.
 */
export async function getBalancePayments(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const filter: Filter = FILTERS.includes(body?.filter) ? body.filter : "all";
  const needle = String(body?.q ?? "").trim().toLowerCase().slice(0, 100);
  const today = uaeDay();

  const visible = await visibleMentorIds(user);
  const mine = visible ? await theirStudents(user, studentsOf(visible)) : null;
  const students = (await col("students")
    .find(mine ? { $and: [owingFilter(), mine] } : owingFilter(), { projection: PROJECTION })
    .limit(5000)
    .toArray()) as any[];

  const fees = students.flatMap((s) => owingFeesOf(s).map((f) => ({ s, f })));
  const requests = await latestRequests([...new Set(fees.map(({ f }) => String(f.invoice_id)))]);
  const all = fees.map(({ s, f }) => {
    const { state, daysLeft } = dueStateOf(f.next_due_on, today);
    const payments: any[] = Array.isArray(f.payments) ? f.payments : [];
    const lastPaid = payments.map((p) => String(p?.paid_on ?? "")).filter(isDay).sort().pop() ?? null;
    return {
      key: `${s._id}|${f.invoice_id}`,
      student_id: String(s._id),
      full_name: String(s.full_name ?? ""),
      student_code: String(s.student_code ?? ""),
      phone: String(s.phone ?? "").replace(/^[\s'`"]+/, "").trim(),
      email: String(s.email ?? ""),
      primary_mentor_id: String(s.primary_mentor_id ?? ""),
      primary_mentor_name: String(s.primary_mentor_name ?? ""),
      team_name: String(s.team_name ?? ""),
      invoice_id: String(f.invoice_id),
      invoice_number: String(f.invoice_number ?? ""),
      course: String(f.course ?? ""),
      currency: String(f.currency ?? ""),
      total_minor: Number(f.fee_minor) || 0,
      paid_minor: Number(f.paid_minor) || 0,
      balance_minor: Number(f.balance_minor) || 0,
      last_paid_on: lastPaid,
      next_due_on: isDay(f.next_due_on) ? f.next_due_on : null,
      days_left: daysLeft,
      due_state: state as DueState,
      payments: payments.slice(-20),
      updated_at: f.updated_at ?? null,
      request: requestView(requests.get(`${s._id}|${f.invoice_id}`)),
      can_record: canWorkOn(user, s),
    };
  });
  const counts = {
    all: all.length,
    soon: all.filter((r) => r.due_state === "soon").length,
    overdue: all.filter((r) => r.due_state === "overdue").length,
  };
  const rows = all
    .filter((r) => filter === "all" || r.due_state === filter)
    .filter((r) => !needle || [r.full_name, r.student_code, r.phone, r.email, r.course, r.invoice_number, r.primary_mentor_name].some((v) => v.toLowerCase().includes(needle)))
    .sort((a, b) => (a.next_due_on ?? "9999").localeCompare(b.next_due_on ?? "9999") || a.full_name.localeCompare(b.full_name));
  return json({ today, counts, rows, methods: PAYMENT_METHODS, finance_linked: financeFundingConfigured() });
}

/**
 * POST /api/functions/recordBalancePayment { studentId, invoiceId, amountMinor, method, paidOn, receiptUrl, receiptName?, note? }
 * Their CS (or a Common CS, Super Admin, Admin — canWorkOn) records the next payment on a course finance sold them,
 * up to what is left once payments waiting for finance are counted. Queued for Delta finance to approve; nothing is
 * counted here until finance's fee update arrives.
 */
export async function recordBalancePayment(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.studentId ?? ""));
  if (!oid) return error("studentId is required", 400);
  const invoiceId = String(body?.invoiceId ?? "").trim();
  if (!invoiceId) return error("invoiceId is required", 400);
  const s: any = await col("students").findOne({ _id: oid }, { projection: { ...PROJECTION } });
  if (!s) return notFound();
  if (!canWorkOn(user, s)) return forbidden("Only this student's CS, or a Super Admin or Admin, records their payments");
  const fee = (s.course_fees ?? []).find((f: any) => f?.invoice_id === invoiceId);
  if (!fee || fee.source === "cs_tracker") return error("This invoice is not one of Delta finance's for this student", 404);
  if (!owes(fee)) return error("Nothing is owed on this course", 409);
  if (!financeFundingConfigured()) return error("The Delta Finance link is not set up on this server — payments can't be sent for approval", 503);

  const amount = Number(body?.amountMinor);
  if (!Number.isSafeInteger(amount) || amount <= 0) return error("The amount must be above 0", 400);
  if (!(PAYMENT_METHODS as readonly string[]).includes(body?.method)) return error(`Method is one of ${PAYMENT_METHODS.join(", ")}`, 400);
  const paidOn = String(body?.paidOn ?? "");
  if (!isDay(paidOn)) return error("Paid on must be a date", 400);
  if (paidOn > uaeDay()) return error("Paid on can't be in the future", 400);
  const receipt = String(body?.receiptUrl ?? "").trim();
  if (!/^https?:\/\//i.test(receipt)) return error("Attach the receipt", 400);

  const pending = (await col(ENROLMENT_PAYMENTS).find({ student_id: String(oid), invoice_id: invoiceId, status: "pending" }, { projection: { amount_minor: 1 } }).toArray())
    .reduce((a, p: any) => a + (Number(p.amount_minor) || 0), 0);
  const room = Number(fee.balance_minor) - pending;
  if (amount > room) {
    return error(room > 0
      ? `Only ${moneyText(room, fee.currency)} is left to pay${pending ? " (counting payments waiting for Delta Finance)" : ""}`
      : "Nothing is left to pay — the rest is waiting for Delta Finance", 400);
  }
  const by = user.full_name || user.email || "somebody";
  const id = await queueEnrolmentPayment({
    student_id: String(oid), invoice_id: invoiceId, invoice_number: String(fee.invoice_number ?? ""), course: String(fee.course ?? ""),
    currency: String(fee.currency ?? ""), amount_minor: amount, method: body.method, paid_on: paidOn,
    receipt_url: receipt.slice(0, 1000), receipt_name: String(body?.receiptName ?? "").slice(0, 200),
    note: String(body?.note ?? "").trim().slice(0, 500), balance_minor_then: Number(fee.balance_minor) || 0,
    recorded_by: user.id, recorded_by_name: by, recorded_by_email: user.email ?? "",
  });
  await recordHistory([{
    student_id: String(oid), at: new Date().toISOString(), type: "course_fees", by_id: user.id, by_name: by,
    text: `Balance payment of ${moneyText(amount, fee.currency)} (${body.method}, paid ${paidOn}) recorded on ${fee.course || "a course"}${fee.invoice_number ? `, invoice ${fee.invoice_number}` : ""} — sent to Delta Finance for approval`,
  }]);
  return json({ id });
}
