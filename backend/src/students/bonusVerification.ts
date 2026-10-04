import { col } from "../db";
import { salesBonusOf } from "../functions/studentFollowups";

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
  /** Who approved or rejected it, and when. */
  decided_at?: string;
  decided_by?: string;
  /** Why it was rejected. */
  reason?: string;
  /** How many times it was submitted again after a rejection. */
  resubmitted?: number;
}

/** For one student: none (no bonus promised), or where their bonuses stand together. */
export type Verification = "none" | "pending" | "rejected" | "approved";

const BONUS_FIELDS = {
  student_id: 1, status: 1, sales_close: 1, requested_at: 1, created_date: 1, approved_at: 1, approved_by_name: 1,
  rejected_at: 1, rejected_by_name: 1, rejection_reason: 1, updated_date: 1, resubmit_count: 1,
};

type Promised = { invoice_id: string; invoice_number: string; course: string; given: boolean; amount: number; currency: string };

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
  const byKey = new Map(txs.map((t) => [`${t.student_id}|${String(t.sales_close?.invoice_id ?? "")}`, t]));
  for (const p of promised) {
    out.set(p.id, p.given.map((b) => {
      const t = byKey.get(`${p.id}|${b.invoice_id}`);
      const status = String(t?.status ?? "").toUpperCase();
      const state: BonusState = !t ? "not_requested" : status === "APPROVED" ? "approved" : status === "REJECTED" ? "rejected" : "pending";
      const decided = state === "approved" || state === "rejected";
      return {
        invoice_id: b.invoice_id,
        invoice_number: b.invoice_number,
        course: b.course,
        amount: b.amount,
        currency: b.currency,
        state,
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
