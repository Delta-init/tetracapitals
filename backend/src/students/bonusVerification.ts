import { col } from "../db";
import { salesBonusOf } from "../functions/studentFollowups";
import { owedText } from "./salesBonusPaid";

/* ────────────────────────────────────────────────────────────────────────────
   Onboarding verification: the MT5 bonus promised at a sales close, checked
   by a broker admin (the user, 2026-10-04).

   A student promised a bonus at the close (finance's course fees, given and
   above 0) is not onboarded until a broker admin or a Super Admin approves
   that bonus — the sales-close bonus credit the call log raises once the
   student's MT5 is known (functions/studentFollowups.ts). Until then they are
   "onboarding verification pending" on the Not onboarded page; a rejected one
   can be submitted again (functions/salesBonus.ts). A student promised no
   bonus needs no verification: their welcome onboards them, as before.

   `onboarded` itself still means the welcome went (functions/studentOnboarding
   .ts) — everything that reads it reads what it always did. The verification is
   worked out from the bonus requests, here, wherever it is shown or asked for:
   the Not onboarded page, and finance's lookup (finance/studentLookup.ts), which
   the sales CRMs show as the last step before their commission counts.
──────────────────────────────────────────────────────────────────────────── */

export type BonusState = "not_requested" | "pending" | "approved" | "rejected";

export interface BonusCheck {
  invoice_id: string;
  invoice_number: string;
  course: string;
  amount: number;
  currency: string;
  state: BonusState;
  request_id?: string;
  requested_at?: string;
  /**
   * Credited in halves (2026-10-27): "first_half" — this request is half of `amount`; onboarding passes once it is
   * approved. `rest`: the other half's request, once the course is paid in full.
   */
  part?: "first_half";
  rest?: { state: BonusState; amount: number; request_id: string };
  /** Who approved or rejected it, and when. */
  decided_at?: string;
  decided_by?: string;
  /** Why it was rejected. */
  reason?: string;
  /** How many times it was submitted again after a rejection. */
  resubmitted?: number;
  /**
   * Its course still owes (2026-10-17): the bonus waits for the full payment — not sent, or not approved, until then —
   * and with it the onboarding verification. What is left, in the course's currency.
   */
  after_payment?: boolean;
  owed?: string;
}

/** For one student: none (no bonus promised), or where their bonuses stand together. */
export type Verification = "none" | "pending" | "rejected" | "approved";

const BONUS_FIELDS = {
  student_id: 1, status: 1, sales_close: 1, bonus_part: 1, amount_original: 1, requested_at: 1, created_date: 1, approved_at: 1, approved_by_name: 1,
  rejected_at: 1, rejected_by_name: 1, rejection_reason: 1, updated_date: 1, resubmit_count: 1,
};

type Promised = { invoice_id: string; invoice_number: string; course: string; given: boolean; amount: number; currency: string; owed_minor: number; fee_currency: string; stage: string };

/** Every bonus promised at these students' sales closes, with where its request stands — by student id. */
export async function bonusChecksFor(students: any[]): Promise<Map<string, BonusCheck[]>> {
  const out = new Map<string, BonusCheck[]>();
  const promised = students.map((s) => ({ id: String(s._id), given: (salesBonusOf(s) as Promised[]).filter((b) => b.given && b.amount > 0) }));
  const ids = promised.filter((p) => p.given.length).map((p) => p.id);
  const txs = ids.length
    ? ((await col("funding_transactions")
        .find({ student_id: { $in: ids }, bonus_credit: "sales_close" }, { projection: BONUS_FIELDS })
        .toArray()) as any[])
    : [];
  // The whole bonus's request, or its first half's — what onboarding waits for; the rest kept beside it.
  const byKey = new Map(txs.filter((t) => t.bonus_part !== "rest").map((t) => [`${t.student_id}|${String(t.sales_close?.invoice_id ?? "")}`, t]));
  const restOf = new Map(txs.filter((t) => t.bonus_part === "rest").map((t) => [`${t.student_id}|${String(t.sales_close?.invoice_id ?? "")}`, t]));
  const stateOf = (t: any): BonusState => {
    const status = String(t?.status ?? "").toUpperCase();
    return !t ? "not_requested" : status === "APPROVED" ? "approved" : status === "REJECTED" ? "rejected" : "pending";
  };
  for (const p of promised) {
    out.set(p.id, p.given.map((b) => {
      const t = byKey.get(`${p.id}|${b.invoice_id}`);
      const rest = restOf.get(`${p.id}|${b.invoice_id}`);
      const state = stateOf(t);
      const decided = state === "approved" || state === "rejected";
      return {
        invoice_id: b.invoice_id,
        invoice_number: b.invoice_number,
        course: b.course,
        amount: b.amount,
        currency: b.currency,
        state,
        ...(t?.bonus_part === "first_half" ? { part: "first_half" as const } : {}),
        ...(rest ? { rest: { state: stateOf(rest), amount: Number(rest.amount_original) || 0, request_id: String(rest._id) } } : {}),
        ...(t ? { request_id: String(t._id), requested_at: String(t.requested_at ?? t.created_date ?? "") } : {}),
        // The approval screens write approved_by / approved_at for a rejection too.
        ...(decided
          ? {
              decided_at: String((state === "rejected" ? t.rejected_at : null) ?? t.approved_at ?? t.updated_date ?? ""),
              decided_by: String((state === "rejected" ? t.rejected_by_name : null) ?? t.approved_by_name ?? ""),
            }
          : {}),
        ...(state === "rejected" && t.rejection_reason ? { reason: String(t.rejection_reason) } : {}),
        ...(Number(t?.resubmit_count) > 0 ? { resubmitted: Number(t.resubmit_count) } : {}),
        // Owing under AED 2,000 paid (2026-10-27: from there half of it goes now) — or a pending request for all of it.
        ...(state !== "approved" && b.owed_minor > 0 && (b.stage === "held" || (t && !t.bonus_part)) ? { after_payment: true, owed: owedText(b.owed_minor, b.fee_currency) } : {}),
      };
    }));
  }
  return out;
}

export function verificationOf(checks: BonusCheck[]): Verification {
  if (!checks.length) return "none";
  if (checks.some((c) => c.state === "rejected")) return "rejected";
  if (checks.some((c) => c.state !== "approved")) return "pending";
  return "approved";
}

/** When the last of their bonuses was approved — the moment onboarding verification passed. */
export function verifiedAt(checks: BonusCheck[]): string {
  return checks.map((c) => c.decided_at ?? "").sort().at(-1) ?? "";
}
