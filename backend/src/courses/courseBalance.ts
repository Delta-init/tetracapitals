import { col } from "../db";
import { progressOf } from "./upgradeCalc";
import { approvedAmounts } from "./coursePayments";
import { DEFAULT_PRICE_LIST } from "./priceList";

/*
 * What a student still owes on their courses, from what is recorded here (the user, 2026-10-08) — beside finance's
 * course_fees balance, never added to it (the two may be the same money):
 *   - a Bonus course payment (FundingRequestForm): per course, the instalments' total less every payment not turned
 *     down — waiting ones count, as the Bonus form counts them; a full payment owes nothing;
 *   - a course upgrade in progress: its balance, from the payments Delta finance approved.
 */
export interface CourseBalance { course: string; balanceAed: number; paidAed: number; totalAed: number; source: "bonus" | "upgrade" }

const cents = (n: number) => Math.round(n * 100) / 100;

export async function courseBalancesOf(studentIds: string[]): Promise<Map<string, CourseBalance[]>> {
  const out = new Map<string, CourseBalance[]>();
  if (!studentIds.length) return out;
  const push = (id: string, b: CourseBalance) => { if (!out.has(id)) out.set(id, []); out.get(id)!.push(b); };

  const bonuses = (await col("funding_transactions")
    .find({ student_id: { $in: studentIds }, type: "BONUS", status: { $nin: ["REJECTED", "CANCELLED"] }, "course_payment.product": { $exists: true } },
      { projection: { student_id: 1, course_payment: 1, requested_at: 1, created_date: 1 } })
    .toArray()) as any[];
  const groups = new Map<string, any[]>();
  for (const t of bonuses) {
    const k = `${t.student_id}\u0000${t.course_payment.product}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }
  for (const [k, txs] of groups) {
    const [sid, course] = k.split("\u0000") as [string, string];
    if (txs.some((t) => t.course_payment.kind === "full")) continue;
    const latest = txs.sort((a, b) => String(b.requested_at ?? b.created_date ?? "").localeCompare(String(a.requested_at ?? a.created_date ?? "")))[0];
    const total = Number(latest.course_payment.plan_aed) || 0;
    if (!total) continue;
    const paid = cents(txs.reduce((s, t) => s + (Number(t.course_payment.paid_today_aed) || 0), 0));
    const balance = total - paid <= 1 ? 0 : cents(total - paid);
    push(sid, { course, balanceAed: balance, paidAed: paid, totalAed: total, source: "bonus" });
  }

  const ups = (await col("course_upgrades").find({ student_id: { $in: studentIds }, status: "open" }).toArray()) as any[];
  if (ups.length) {
    const pays = (await col("course_payments").find({ upgrade_id: { $in: ups.map((u) => String(u._id)) } }).toArray()) as any[];
    for (const u of ups) {
      const p = progressOf(u.quote, approvedAmounts(pays.filter((x) => x.upgrade_id === String(u._id))));
      const name = DEFAULT_PRICE_LIST.find((c) => c.code === u.course)?.name ?? u.course;
      push(u.student_id, { course: name, balanceAed: p.balanceAed, paidAed: p.paidAed, totalAed: u.quote.dueAed, source: "upgrade" });
    }
  }
  return out;
}

/** Ids of students (among `scope`) who owe something on a course recorded here — for the "Has balance" filter. */
export async function idsOwingOnCourses(): Promise<string[]> {
  const sids = [
    ...new Set([
      ...((await col("funding_transactions").distinct("student_id", { type: "BONUS", status: { $nin: ["REJECTED", "CANCELLED"] }, "course_payment.kind": "partial" })) as string[]),
      ...((await col("course_upgrades").distinct("student_id", { status: "open" })) as string[]),
    ].map(String)),
  ];
  const balances = await courseBalancesOf(sids);
  return [...balances].filter(([, list]) => list.some((b) => b.balanceAed > 0)).map(([id]) => id);
}
