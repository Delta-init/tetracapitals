import { col } from "../db";
import { toObjectId } from "../lib/id";
import { withFinance } from "../finance/funding";
import { salesBonusOf } from "../functions/studentFollowups";

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

     needs_call      not a request yet (the user, 2026-10-10): a bonus finance
                     says was given at the sales close (course_fees) that has
                     not gone to be credited — it goes once a call that
                     connected is logged with their MT5 (functions/
                     studentFollowups.ts raiseSalesBonusCredits).

   Several pending: their count and total, and the earliest stage among them —
   needs a call before with finance, with finance before the broker admin.
   Read-only: nothing is changed.
──────────────────────────────────────────────────────────────────────────── */

export type BonusStage = "needs_call" | "with_finance" | "waiting_broker";
export const BONUS_STAGE_KEYS: BonusStage[] = ["needs_call", "with_finance", "waiting_broker"];
const RANK: Record<BonusStage, number> = { needs_call: 0, with_finance: 1, waiting_broker: 2 };
export interface BonusStageTotal { count: number; total_usd: number }
export interface BonusPending {
  count: number;
  total_usd: number;
  /** The earliest stage among them: with finance while any one is there. */
  stage: BonusStage;
  needs_call: BonusStageTotal;
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

const AED_PER_USD = 3.67;
type SalesBonus = { invoice_id: string; given: boolean; amount: number; currency: string };
/** A sales-close bonus in USD, as raiseSalesBonusCredits counts it: USD as it is, anything else as AED. */
const salesUsd = (b: { amount: number; currency: string }) => (b.currency === "USD" ? b.amount : cents(b.amount / AED_PER_USD));
/** Students who were given a bonus at a sales close (finance's course fees), with an amount. */
const GIVEN_AT_CLOSE = { course_fees: { $elemMatch: { bonus_given: true, bonus_minor: { $gt: 0 } } } };

/** Each one's sales-close bonuses not sent to be credited yet: [{ usd, since }] per student id. */
async function notSentOf(match: Record<string, any>): Promise<Map<string, { usd: number; since: string }[]>> {
  const students = (await col("students").find({ ...match, ...GIVEN_AT_CLOSE }, { projection: { course_fees: 1, created_date: 1 } }).toArray()) as any[];
  const out = new Map<string, { usd: number; since: string }[]>();
  if (!students.length) return out;
  const raised = new Set(((await col("funding_transactions")
    .find({ bonus_credit: "sales_close", student_id: { $in: students.map((x) => String(x._id)) } }, { projection: { student_id: 1, "sales_close.invoice_id": 1 } })
    .toArray()) as any[]).map((t) => `${t.student_id}|${t.sales_close?.invoice_id ?? ""}`));
  for (const st of students) {
    const sid = String(st._id);
    const fees = new Map((st.course_fees ?? []).map((f: any) => [String(f?.invoice_id ?? ""), f]));
    const left = salesBonusOf(st)
      .filter((b: SalesBonus) => b.given && b.amount > 0 && !raised.has(`${sid}|${b.invoice_id}`))
      .map((b: SalesBonus) => ({ usd: salesUsd(b), since: String((fees.get(b.invoice_id) as any)?.recorded_at || st.created_date || "") }));
    if (left.length) out.set(sid, left);
  }
  return out;
}

const blank = (since: string): BonusPending => ({
  count: 0, total_usd: 0, stage: "waiting_broker",
  needs_call: { count: 0, total_usd: 0 }, with_finance: { count: 0, total_usd: 0 }, waiting_broker: { count: 0, total_usd: 0 }, since,
});
function add(b: BonusPending, stage: BonusStage, usd: number, at: string) {
  b.count++;
  b.total_usd = cents(b.total_usd + usd);
  b[stage].count++;
  b[stage].total_usd = cents(b[stage].total_usd + usd);
  if (b.count === 1 || RANK[stage] < RANK[b.stage]) b.stage = stage;
  if (at && (!b.since || at < b.since)) b.since = at;
}

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
    const b = out.get(sid) ?? blank(at);
    add(b, bonusStageOf(t), usdOf(t), at);
    out.set(sid, b);
  }
  const oids = ids.map((id) => toObjectId(id)).filter(Boolean);
  for (const [sid, left] of await notSentOf({ _id: { $in: oids as any[] } })) {
    const b = out.get(sid) ?? blank(left[0].since);
    for (const x of left) add(b, "needs_call", x.usd, x.since);
    out.set(sid, b);
  }
  return out;
}

/**
 * Ids of every student with a pending bonus — for the Bonus filter (scope and tab come on top): "pending" any of
 * them, or only those with one at that stage ("needs_call" | "with_finance" | "waiting_broker").
 */
export async function idsWithBonusPending(stage: "pending" | BonusStage = "pending"): Promise<string[]> {
  const ids = new Set<string>();
  if (stage !== "needs_call") {
    const txs = (await col("funding_transactions")
      .find({ ...PENDING_BONUS, student_id: { $nin: [null, ""] } }, { projection: { student_id: 1, finance_approval: 1, bonus_credit: 1, status: 1 } })
      .toArray()) as any[];
    for (const t of txs) if (stage === "pending" || bonusStageOf(t) === stage) ids.add(String(t.student_id));
  }
  if (stage === "pending" || stage === "needs_call") for (const sid of (await notSentOf({})).keys()) ids.add(sid);
  return [...ids];
}
