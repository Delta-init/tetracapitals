import { col } from "../db";
import { withFinance } from "../finance/funding";

/* ────────────────────────────────────────────────────────────────────────────
   "Bonus pending" on the Students page and the student page (the user,
   2026-10-10): a student with a BONUS funding request still PENDING, its
   amount (USD), and where it waits —

     with_finance    Delta finance has it to decide: sent, or queued while the
                     link is on (finance/funding.ts withFinance);
     waiting_broker  a broker admin or a Super Admin decides it now: finance
                     approved it (awaitingBroker), a sales-close or course-
                     upgrade bonus credit (bonus_credit, which never goes to
                     finance), or any other pending bonus finance doesn't have
                     (never went, handed back, queued with the link off).

   Several pending: their count and total, and the earliest stage among them —
   with finance while any one is still there. Read-only: nothing is changed.
──────────────────────────────────────────────────────────────────────────── */

export type BonusStage = "with_finance" | "waiting_broker";
export interface BonusStageTotal { count: number; total_usd: number }
export interface BonusPending {
  count: number;
  total_usd: number;
  /** The earliest stage among them: with finance while any one is there. */
  stage: BonusStage;
  with_finance: BonusStageTotal;
  waiting_broker: BonusStageTotal;
  /** When the oldest of them was requested. */
  since: string;
}

/** A bonus not decided yet — what the Bonus filter and the badge count. */
export const PENDING_BONUS = { type: "BONUS", status: "PENDING" } as const;

/** Where one pending bonus waits. A bonus credit never goes to finance, whatever it carries. */
export const bonusStageOf = (tx: any): BonusStage => (!tx?.bonus_credit && withFinance(tx) ? "with_finance" : "waiting_broker");

const cents = (n: number) => Math.round(n * 100) / 100;
const usdOf = (tx: any) => (Number.isFinite(Number(tx?.amount_usd)) ? Number(tx.amount_usd) : 0);

/** Each of these students' pending bonuses, summed — one query for them all; a student with none is left out. */
export async function bonusPendingOf(studentIds: string[]): Promise<Map<string, BonusPending>> {
  const out = new Map<string, BonusPending>();
  const ids = [...new Set(studentIds.map(String).filter(Boolean))];
  if (!ids.length) return out;
  const txs = (await col("funding_transactions")
    .find({ ...PENDING_BONUS, student_id: { $in: ids } }, {
      projection: { student_id: 1, status: 1, amount_usd: 1, finance_approval: 1, bonus_credit: 1, requested_at: 1, created_date: 1 },
    })
    .toArray()) as any[];
  for (const t of txs) {
    const sid = String(t.student_id);
    const at = String(t.requested_at || t.created_date || "");
    const b = out.get(sid) ?? {
      count: 0, total_usd: 0, stage: "waiting_broker" as BonusStage,
      with_finance: { count: 0, total_usd: 0 }, waiting_broker: { count: 0, total_usd: 0 }, since: at,
    };
    const stage = bonusStageOf(t);
    b.count++;
    b.total_usd = cents(b.total_usd + usdOf(t));
    b[stage].count++;
    b[stage].total_usd = cents(b[stage].total_usd + usdOf(t));
    if (stage === "with_finance") b.stage = "with_finance";
    if (at && (!b.since || at < b.since)) b.since = at;
    out.set(sid, b);
  }
  return out;
}

/** Ids of every student with a pending bonus — for the "Bonus pending" filter (scope and tab come on top). */
export async function idsWithBonusPending(): Promise<string[]> {
  return ((await col("funding_transactions").distinct("student_id", { ...PENDING_BONUS, student_id: { $nin: [null, ""] } })) as unknown[])
    .map(String)
    .filter(Boolean);
}
