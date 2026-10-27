import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { canWorkOn } from "../students/followups";
import { recordHistory } from "../students/history";
import { MT5_LOGIN, mt5LoginOf, mt5Of, mt5Owner, keepMt5 } from "../students/mt5";
import { salesBonusOf, raiseSalesBonusCredits } from "./studentFollowups";
import { csManagerReach } from "../lib/userLocation";
import { owedText, halfOf } from "../students/salesBonusPaid";

/* ────────────────────────────────────────────────────────────────────────────
   Send a sales-close bonus for credit from its badge (the user, 2026-10-12).

   "Bonus pending · Needs call + MT5": finance marked a bonus given at the
   sales close and nobody sent it to be credited yet — until now only a
   connected call log with the MT5 did. The badge opens a window: the bonus,
   what finance sent for its invoice (receipts, what the counsellor collected),
   the student's MT5 logins. Send raises the very request the call log raises
   (raiseSalesBonusCredits — once per invoice, straight to the broker admin on
   MT5 Approvals). An invoice finance sent no receipt for needs one uploaded
   here, kept on the request. No call needed. The student's CS, CS Managers and
   admins.
──────────────────────────────────────────────────────────────────────────── */

const AED_PER_USD = 3.67;
const usdOf = (amount: number, currency: string) => (currency === "USD" ? amount : Math.round((amount / AED_PER_USD) * 100) / 100);
const who = (u: AuthUser) => u.full_name || u.email || "somebody";
const isLink = (v: unknown) => /^https?:\/\//i.test(String(v ?? ""));
// A CS Manager: their own location's students (2026-10-14).
const mayFor = async (user: AuthUser, student: any) => {
  const reach = await csManagerReach(user);
  if (reach) return [student?.primary_mentor_id, ...(student?.common_cs ?? []).map((c: any) => c?.id)].some((id) => reach.ids.includes(String(id ?? "")));
  return canWorkOn(user, student);
};

/** The bonuses given at the close and not sent yet, each with what finance sent for its invoice. */
async function waiting(student: any) {
  const raised = new Set(((await col("funding_transactions")
    .find({ bonus_credit: "sales_close", student_id: String(student._id) }, { projection: { "sales_close.invoice_id": 1 } })
    .toArray()) as any[]).map((t) => String(t.sales_close?.invoice_id ?? "")));
  const fees = new Map((student.course_fees ?? []).map((f: any) => [String(f?.invoice_id ?? ""), f]));
  return salesBonusOf(student)
    // Its course owing under AED 2,000 paid: held until it is paid in full (afterPayment — the user, 2026-10-17).
    .filter((b: any) => b.given && b.amount > 0 && !raised.has(b.invoice_id) && b.stage !== "held")
    .map((b: any) => {
      const f: any = fees.get(b.invoice_id) ?? {};
      const receipts: { url: string; name: string; label: string }[] = [];
      const seen = new Set<string>();
      const add = (url: unknown, name: unknown, label: string) => {
        if (!isLink(url) || seen.has(String(url))) return;
        seen.add(String(url));
        receipts.push({ url: String(url), name: String(name ?? ""), label });
      };
      add(f.receipt_url, f.receipt_name, "Salesperson's receipt");
      (Array.isArray(f.declared_payments) ? f.declared_payments : []).forEach((p: any, i: number) =>
        add(p?.receipt_url, p?.receipt_name, `Payment ${i + 1}${p?.method ? ` · ${p.method}` : ""}`));
      // And every payment finance recorded since, with its own receipt (2026-10-27) — the same one only once.
      (Array.isArray(f.payments) ? f.payments : []).forEach((p: any) =>
        add(p?.receipt_url, p?.receipt_name, `Recorded ${p?.method || "payment"}${p?.paid_on ? ` · ${p.paid_on}` : ""}`));
      const minor = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) / 100 : null);
      return {
        invoice_id: b.invoice_id, invoice_number: b.invoice_number, course: b.course,
        amount: b.amount, currency: b.currency,
        // Part paid (AED 2,000+): half of it goes now, the rest once the course is paid in full (2026-10-27).
        ...(b.stage === "half" ? { half: true, now: halfOf(b.amount), owed: owedText(b.owed_minor, b.fee_currency) } : {}),
        usd: usdOf(b.stage === "half" ? halfOf(b.amount) : b.amount, b.currency),
        aed: b.currency === "USD" ? Math.round(b.amount * AED_PER_USD * 100) / 100 : b.amount,
        fee_currency: String(f.currency ?? ""),
        collected: minor(f.collected_minor), collected_method: String(f.collected_method ?? ""),
        paid: minor(f.paid_minor), total: minor(f.total_minor),
        payments: (Array.isArray(f.declared_payments) ? f.declared_payments : []).map((p: any) => ({
          method: String(p?.method ?? ""), amount: minor(p?.amount_minor), paid_on: String(p?.paid_on ?? ""),
        })),
        receipts,
      };
    });
}

/** The bonuses given at the close and not sent, held because their course still owes — what is left to pay on each. */
async function afterPayment(student: any) {
  const raised = new Set(((await col("funding_transactions")
    .find({ bonus_credit: "sales_close", student_id: String(student._id) }, { projection: { "sales_close.invoice_id": 1 } })
    .toArray()) as any[]).map((t) => String(t.sales_close?.invoice_id ?? "")));
  return salesBonusOf(student)
    .filter((b: any) => b.given && b.amount > 0 && !raised.has(b.invoice_id) && b.stage === "held")
    .map((b: any) => ({
      invoice_id: b.invoice_id, invoice_number: b.invoice_number, course: b.course, amount: b.amount, currency: b.currency,
      owed_minor: b.owed_minor, owed: owedText(b.owed_minor, b.fee_currency),
    }));
}

async function studentFor(body: any, user: AuthUser): Promise<any | Response> {
  const oid = toObjectId(String(body?.studentId ?? ""));
  if (!oid) return error("studentId is required", 400);
  const student: any = await col("students").findOne({ _id: oid });
  if (!student) return notFound();
  if (!(await mayFor(user, student))) return forbidden("Only the student's CS, a CS Manager or an admin sends their bonus");
  return student;
}

/**
 * POST /api/functions/getSalesBonusToSend { studentId }
 * → { bonuses: [{ invoice_id, invoice_number, course, amount, currency, usd, aed, collected, payments, receipts }], mt5: [logins] }
 */
export async function getSalesBonusToSend(req: Request, user: AuthUser): Promise<Response> {
  const student = await studentFor(await req.json().catch(() => ({})), user);
  if (student instanceof Response) return student;
  return json({ bonuses: await waiting(student), after_payment: await afterPayment(student), mt5: await mt5Of(String(student._id)) });
}

/**
 * POST /api/functions/sendSalesBonusCredit { studentId, mt5Login, receipts?: { [invoiceId]: { url, name } } }
 * Every bonus waiting goes to MT5 Approvals to be credited in that login. → { sent, mt5 }
 */
export async function sendSalesBonusCredit(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const student = await studentFor(body, user);
  if (student instanceof Response) return student;
  const login = mt5LoginOf(body?.mt5Login);
  if (!MT5_LOGIN.test(login)) return error("The MT5 login is its number — digits only", 400);
  const owner = await mt5Owner(login);
  if (owner !== null && owner !== String(student._id)) return error("That MT5 login is saved for another student — check the number", 409);

  const list = await waiting(student);
  if (!list.length) {
    const held = await afterPayment(student);
    if (held.length) return error(`${held.map((b: any) => `${b.owed} is still owed on ${b.invoice_number || b.course || "the course"}`).join("; ")} — the sales bonus is sent once the course is paid in full, or half of it once AED 2,000 is paid`, 409);
    return error("Nothing is waiting — this student's bonus was sent already", 409);
  }
  // An invoice finance sent no receipt for: one uploaded here, or nothing goes.
  const given = body?.receipts && typeof body.receipts === "object" ? body.receipts : {};
  const receipts = new Map<string, { url: string; name: string }>();
  for (const b of list) {
    if (b.receipts.length) continue;
    const r = given[b.invoice_id];
    if (!isLink(r?.url)) return error(`Upload the payment receipt for ${b.course || "the course"}${b.invoice_number ? ` (${b.invoice_number})` : ""} — finance sent none`, 400);
    receipts.set(b.invoice_id, { url: String(r.url).slice(0, 2048), name: String(r?.name ?? "").slice(0, 200) });
  }

  const kept = await keepMt5(student, login, { email: user.email, name: who(user) }, "bonus pending");
  const sent = await raiseSalesBonusCredits(student, login, user, {
    receipts, only: new Set(list.map((b: any) => String(b.invoice_id))), via: `Sent from the Bonus pending badge by ${who(user)}.`,
  });
  if (sent) {
    await recordHistory([{
      student_id: String(student._id), at: new Date().toISOString(), type: "bonus_sent", by_id: user.id, by_name: who(user),
      text: `Sales-close bonus sent for credit in MT5 ${login} from the Bonus pending badge — ${list.map((b: any) => `${b.course || "course"} ${b.currency === "USD" ? `$${b.half ? b.now : b.amount}` : `${b.currency} ${b.half ? b.now : b.amount}`}${b.half ? " (first half, the course part paid)" : ""}`).join(", ")}${receipts.size ? ` (receipt uploaded for ${receipts.size})` : ""}`.slice(0, 400),
    } as any]);
  }
  return json({ sent, mt5: kept });
}
