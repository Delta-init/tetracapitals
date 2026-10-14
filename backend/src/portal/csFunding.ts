import { ObjectId } from "mongodb";
import { col } from "../db";
import { withFinance } from "../finance/funding";
import { bonusStageOf, isSentBack } from "../students/bonusPending";
import type { Period } from "./csOverview";

/* ────────────────────────────────────────────────────────────────────────────
   Funding requests on the Root portal's CSEs page (the user, 2026-10-14):
   every request raised in the period, and every one still waiting from any
   date — with where it is paused now, its amount in USD and AED, and the
   commission it earned.

   Where a request waits, by this app's own rules:
     sent_back       sent back to its CS to correct (by a broker admin, or by
                     accounts) and not sent again yet (bonusPending.isSentBack);
     with_finance    Delta finance has it to decide (finance/funding.ts
                     withFinance) — a deposit or withdrawal still there is from
                     before they were decided here (2026-10-10);
     waiting_broker  a broker admin or a Super Admin decides it here now;
   or it was decided: approved, rejected.

   A request is its CS's who raised it, else the student's CS (as deposits
   are). Amounts: a bonus's MT5 bonus in USD (a course payment's bonus, not the
   payment — as Funding Requests shows it), with what the student paid with it
   in AED; AED beside every dollar at the portal's fixed 3.67. Commission: what
   was credited for it, pool rows aside. Read-only.
──────────────────────────────────────────────────────────────────────────── */

export const AED_PER_USD = 3.67;
const cents = (n: number) => Math.round(n * 100) / 100;
export const aedOf = (usd: number) => cents(usd * AED_PER_USD);

export type FundingStage = "sent_back" | "with_finance" | "waiting_broker" | "approved" | "rejected";
const WAITING: FundingStage[] = ["sent_back", "with_finance", "waiting_broker"];

export interface FundingSummary {
  pending: number;
  pendingUsd: number;
  pendingAed: number;
  sentBack: number;
  withFinance: number;
  waitingBroker: number;
  /** Raised in the period, whatever became of them. */
  raised: number;
}
export const blankFunding = (): FundingSummary => ({ pending: 0, pendingUsd: 0, pendingAed: 0, sentBack: 0, withFinance: 0, waitingBroker: 0, raised: 0 });

const usdOf = (t: any) => (t.type === "BONUS" && t.course_payment ? Number(t.course_payment.bonus_usd) || 0 : Number(t.amount_usd) || 0);
const labelOf = (t: any) => {
  if (t.type === "DEPOSIT") return "Deposit";
  if (t.type === "WITHDRAWAL") return "Withdrawal";
  if (t.bonus_credit === "sales_close") return "Sales-close bonus credit";
  if (t.bonus_credit === "course_upgrade" || t.course_upgrade) return "Course upgrade bonus";
  if (t.course_payment) return `Course payment bonus${t.course_payment.product ? ` · ${t.course_payment.product}` : ""}`;
  return "MT5 bonus";
};
/** What the student paid with it, in AED (a course payment, or a bonus raised with a payment). */
const receivedAedOf = (t: any): number => {
  if (t.type !== "BONUS" || t.bonus_credit) return 0;
  if (Number(t.course_payment?.paid_today_aed) > 0) return cents(Number(t.course_payment.paid_today_aed));
  if (Number(t.amount_original) > 0) return t.amount_currency === "USD" ? aedOf(Number(t.amount_original)) : cents(Number(t.amount_original));
  return 0;
};

export function stageOf(t: any): { stage: FundingStage; reason: string } {
  if (isSentBack(t)) return { stage: "sent_back", reason: String(t.returned?.note || t.finance_approval?.reason || t.rejection_reason || "") };
  if (t.status === "PENDING") {
    if (t.type === "BONUS") return { stage: bonusStageOf(t) === "with_finance" ? "with_finance" : "waiting_broker", reason: "" };
    return { stage: withFinance(t) ? "with_finance" : "waiting_broker", reason: "" };
  }
  if (t.status === "APPROVED") return { stage: "approved", reason: "" };
  return { stage: "rejected", reason: String(t.rejection_reason || t.finance_approval?.reason || "") };
}

const ownerOf = (t: any) => String(t.initiating_mentor_id || t.primary_mentor_id || "");
const atOf = (t: any) => String(t.requested_at || t.created_date || "");
const inPeriod = (at: string, p: Period) => !!at && (!p.from || at >= p.from) && (!p.to || at <= p.to);
const MAX_ROWS = 300;

/**
 * The period's requests and every one still waiting — for everyone, or for one
 * CS (`only`: theirs, with their own share of the commission) — and each CS's
 * counts. `andTeam` gives the bucket keys a CS's figures go under (theirs and
 * the team's, as the rest of the overview counts).
 */
export async function fundingFor(period: Period, only?: string) {
  const waitingQuery = {
    $or: [
      { status: "PENDING" },
      { status: "REJECTED", "finance_approval.sent_back": true, resubmitted_as: { $in: [null, ""] } },
    ],
  };
  const range: Record<string, string> = {};
  if (period.from) range.$gte = period.from;
  if (period.to) range.$lte = period.to;
  // No period: only what is waiting (never every request there has been).
  const inRange = Object.keys(range).length ? [{ requested_at: range }, { requested_at: { $in: [null, ""] }, created_date: range }] : [];
  const mine = only ? { $or: [{ initiating_mentor_id: only }, { initiating_mentor_id: { $in: [null, ""] }, primary_mentor_id: only }] } : {};
  const txs = (await col("funding_transactions").find(
    { $and: [{ $or: [waitingQuery, ...inRange] }, mine] },
    {
      projection: {
        type: 1, status: 1, amount_usd: 1, amount_original: 1, amount_currency: 1, course_payment: 1, bonus_credit: 1, course_upgrade: 1,
        student_id: 1, student_name: 1, student_code: 1, initiating_mentor_id: 1, initiating_mentor_name: 1, primary_mentor_id: 1, primary_mentor_name: 1,
        requested_at: 1, created_date: 1, approved_at: 1, rejected_at: 1, updated_date: 1, finance_approval: 1, returned: 1, resubmitted_as: 1, rejection_reason: 1,
      },
    },
  ).toArray()) as any[];

  const ids = txs.map((t) => String(t._id));
  const credits = ids.length
    ? ((await col("commission_credits").find(
        { is_pool: { $ne: true }, transaction_id: { $in: [...ids, ...ids.map((i) => new ObjectId(i))] } },
        { projection: { transaction_id: 1, recipient_id: 1, commission_usd: 1 } },
      ).toArray()) as any[])
    : [];
  const earned = new Map<string, number>(), mineEarned = new Map<string, number>();
  for (const c of credits) {
    const k = String(c.transaction_id);
    const v = Number(c.commission_usd) || 0;
    earned.set(k, cents((earned.get(k) ?? 0) + v));
    if (only && String(c.recipient_id) === only) mineEarned.set(k, cents((mineEarned.get(k) ?? 0) + v));
  }

  const byCs = new Map<string, FundingSummary>();
  const team = blankFunding();
  const sum = (key: string) => byCs.get(key) ?? byCs.set(key, blankFunding()).get(key)!;
  const rows = txs.map((t) => {
    const { stage, reason } = stageOf(t);
    const usd = usdOf(t);
    const owner = ownerOf(t);
    const raisedIn = inPeriod(atOf(t), period);
    for (const s of [team, ...(owner ? [sum(owner)] : [])]) {
      if (raisedIn) s.raised++;
      if (WAITING.includes(stage)) {
        s.pending++; s.pendingUsd = cents(s.pendingUsd + usd); s.pendingAed = aedOf(s.pendingUsd);
        if (stage === "sent_back") s.sentBack++;
        else if (stage === "with_finance") s.withFinance++;
        else s.waitingBroker++;
      }
    }
    return {
      id: String(t._id),
      type: String(t.type ?? ""),
      label: labelOf(t),
      stage,
      reason,
      studentId: String(t.student_id ?? ""),
      student: String(t.student_name ?? ""),
      code: String(t.student_code ?? ""),
      csId: owner,
      cs: String((t.initiating_mentor_id ? t.initiating_mentor_name : t.primary_mentor_name) ?? ""),
      usd,
      aed: aedOf(usd),
      receivedAed: receivedAedOf(t),
      requestedAt: atOf(t),
      decidedAt: WAITING.includes(stage) ? "" : String(t.approved_at || t.rejected_at || t.finance_approval?.decided_at || t.updated_date || ""),
      commissionUsd: earned.get(String(t._id)) ?? 0,
      ...(only ? { mineUsd: mineEarned.get(String(t._id)) ?? 0 } : {}),
    };
  });
  // Waiting first (sent back, with finance, the broker admin), the oldest first; then the period's, the newest first.
  const rank = (s: FundingStage) => (WAITING.includes(s) ? WAITING.indexOf(s) : 9);
  rows.sort((a, b) => rank(a.stage) - rank(b.stage) || (rank(a.stage) < 9 ? a.requestedAt.localeCompare(b.requestedAt) : b.requestedAt.localeCompare(a.requestedAt)));
  return { rows: rows.slice(0, MAX_ROWS), total: rows.length, byCs, team };
}
