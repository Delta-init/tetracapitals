import { col } from "../db";
import { toObjectId } from "../lib/id";
import { businessToday, commonIds } from "../students/followups";
import { notOnboardedFilter, newFromFinanceFilter } from "../students/onboardingAlerts";
import { openFollowupsFilter, followupsDueTodayFilter, followupsOverdueFilter } from "../functions/navCounts";
import { owingFilter, owingFeesOf, dueStateOf, uaeDay } from "../finance/balanceDue";
import { bonusPendingOf, idsWithBonusPending, type BonusPending } from "../students/bonusPending";

/* ────────────────────────────────────────────────────────────────────────────
   GET /api/v1/service/cs-overview[?from&to]  and  /service/cs-overview/:userId
   — the Root portal's CSEs page (the user, 2026-10-11): each CS with their
   students, the period's deposits and commission, and where things stand now —
   today's and overdue follow-ups, instalments due in the next 7 days or past
   due, what their students still owe, bonuses waiting (clients and $), and
   students not onboarded.

   This app's own rules: a student is their CS's and any Common CS's
   (followups.studentsOf); a deposit is the CS's who initiated it, else the
   student's CS (creditCommission); commission is what was credited to them —
   commission_credits, pool rows aside (dashboardTotals); balances and dues from
   finance/balanceDue.ts, never adding one currency to another; bonuses from
   students/bonusPending.ts. `from`/`to` are instants (Root cuts them in Gulf
   time) and bound only deposits and commission. Read-only.
──────────────────────────────────────────────────────────────────────────── */

export const UPCOMING_DAYS = 7;

export interface Period { from?: string; to?: string }
type Money = Record<string, number>; // currency → amount (major units)

const cents = (n: number) => Math.round(n * 100) / 100;
const addMoney = (m: Money, currency: string, amount: number) => { m[currency] = cents((m[currency] ?? 0) + amount); };
const inPeriod = (at: string, p: Period) => !!at && (!p.from || at >= p.from) && (!p.to || at <= p.to);
const csOf = (s: any): string[] => [...new Set([String(s?.primary_mentor_id ?? ""), ...commonIds(s)].filter(Boolean))];

interface Bucket {
  students: number;
  deposits: { count: number; usd: number };
  commissionUsd: number;
  followupsToday: number;
  followupsOverdue: number;
  upcoming: { count: number; amount: Money };
  overdueDues: { count: number; amount: Money };
  balance: { students: number; amount: Money };
  bonus: { clients: number; usd: number; needsCall: number; withFinance: number; waitingBroker: number };
  notOnboarded: number;
  notOnboardedLate: number;
}
const blank = (): Bucket => ({
  students: 0, deposits: { count: 0, usd: 0 }, commissionUsd: 0, followupsToday: 0, followupsOverdue: 0,
  upcoming: { count: 0, amount: {} }, overdueDues: { count: 0, amount: {} }, balance: { students: 0, amount: {} },
  bonus: { clients: 0, usd: 0, needsCall: 0, withFinance: 0, waitingBroker: 0 }, notOnboarded: 0, notOnboardedLate: 0,
});

/** Everything both views need, for one CS or for all. */
async function gather(period: Period, only?: string, now = Date.now()) {
  const today = businessToday();
  const dueToday = uaeDay(now);
  const mineFilter = only ? { $or: [{ primary_mentor_id: only }, { "common_cs.id": only }] } : {};
  const studentsCol = col("students");

  const [students, owing, notOnboarded, late, followups, deposits, credits, bonusIds] = await Promise.all([
    studentsCol.find(mineFilter, { projection: { primary_mentor_id: 1, common_cs: 1, full_name: 1, student_code: 1 } }).toArray(),
    studentsCol.find({ ...mineFilter, ...owingFilter() }, { projection: { primary_mentor_id: 1, common_cs: 1, course_fees: 1 } }).toArray(),
    studentsCol.find({ ...mineFilter, ...notOnboardedFilter() }, { projection: { primary_mentor_id: 1, common_cs: 1, created_date: 1 } }).toArray(),
    studentsCol.find({ ...mineFilter, ...newFromFinanceFilter(now) }, { projection: { _id: 1 } }).toArray(),
    col("student_followups").find({
      ...openFollowupsFilter(),
      $or: [followupsDueTodayFilter(today), followupsOverdueFilter(today)],
    }, { projection: { student_id: 1, stage: 1, next_followup_date: 1, title: 1, notes: 1 } }).toArray(),
    col("funding_transactions").find({ type: "DEPOSIT", status: "APPROVED", ...(only ? { $or: [{ initiating_mentor_id: only }, { primary_mentor_id: only }] } : {}) },
      { projection: { amount_usd: 1, initiating_mentor_id: 1, primary_mentor_id: 1, approved_at: 1, requested_at: 1, created_date: 1, student_id: 1, student_name: 1 } }).toArray(),
    col("commission_credits").find({ is_pool: { $ne: true }, ...(only ? { recipient_id: only } : {}) },
      { projection: { recipient_id: 1, commission_usd: 1, requested_at: 1, created_date: 1, student_id: 1, level: 1, transaction_type: 1, status: 1 } }).toArray(),
    idsWithBonusPending("pending"),
  ]);

  const studentById = new Map((students as any[]).map((s) => [String(s._id), s]));
  const lateIds = new Set((late as any[]).map((s) => String(s._id)));
  const bonusOf: Map<string, BonusPending> = await bonusPendingOf(bonusIds.filter((id) => !only || studentById.has(id)));
  const buckets = new Map<string, Bucket>();
  const b = (id: string) => buckets.get(id) ?? buckets.set(id, blank()).get(id)!;

  for (const s of students as any[]) for (const id of csOf(s)) b(id).students++;
  for (const s of notOnboarded as any[]) for (const id of csOf(s)) {
    b(id).notOnboarded++;
    if (lateIds.has(String(s._id))) b(id).notOnboardedLate++;
  }
  for (const f of followups as any[]) {
    const s = studentById.get(String(f.student_id));
    const isToday = f.next_followup_date === today;
    for (const id of s ? csOf(s) : []) isToday ? b(id).followupsToday++ : b(id).followupsOverdue++;
  }
  for (const s of owing as any[]) {
    const fees = owingFeesOf(s);
    for (const id of csOf(s)) {
      const x = b(id);
      x.balance.students++;
      for (const f of fees) {
        const cur = String(f.currency || "AED");
        addMoney(x.balance.amount, cur, (Number(f.balance_minor) || 0) / 100);
        const due = dueStateOf(f.next_due_on, dueToday);
        if (due.state === "overdue") { x.overdueDues.count++; addMoney(x.overdueDues.amount, cur, (Number(f.balance_minor) || 0) / 100); }
        else if (due.daysLeft !== null && due.daysLeft <= UPCOMING_DAYS) { x.upcoming.count++; addMoney(x.upcoming.amount, cur, (Number(f.balance_minor) || 0) / 100); }
      }
    }
  }
  for (const [sid, p] of bonusOf) {
    const s = studentById.get(sid);
    for (const id of s ? csOf(s) : []) {
      const x = b(id).bonus;
      x.clients++; x.usd = cents(x.usd + p.total_usd);
      x.needsCall += p.needs_call.count; x.withFinance += p.with_finance.count; x.waitingBroker += p.waiting_broker.count;
    }
  }
  const depositsIn = (deposits as any[]).filter((t) => inPeriod(String(t.approved_at || t.requested_at || t.created_date || ""), period));
  for (const t of depositsIn) {
    const id = String(t.initiating_mentor_id || t.primary_mentor_id || "");
    if (!id || (only && id !== only)) continue;
    b(id).deposits.count++; b(id).deposits.usd = cents(b(id).deposits.usd + (Number(t.amount_usd) || 0));
  }
  const creditsIn = (credits as any[]).filter((c) => inPeriod(String(c.requested_at || c.created_date || ""), period));
  for (const c of creditsIn) {
    const id = String(c.recipient_id || "");
    if (id) b(id).commissionUsd = cents(b(id).commissionUsd + (Number(c.commission_usd) || 0));
  }
  return { today, dueToday, students: students as any[], studentById, owing: owing as any[], notOnboarded: notOnboarded as any[], lateIds,
    followups: followups as any[], depositsIn, creditsIn, bonusOf, buckets };
}

const personOf = (u: any) => ({
  id: String(u._id), name: String(u.full_name || u.email || "Unknown"), email: String(u.email ?? "").toLowerCase(),
  role: String(u.app_role ?? ""), active: u.status !== "inactive", team: String(u.team_name ?? ""),
});

/** Every CS with anything: students, deposits or commission in the period, or anything waiting. */
export async function csOverview(period: Period) {
  const g = await gather(period);
  const ids = [...g.buckets.keys()];
  const users = (await col("users").find({ _id: { $in: ids.map((i) => toObjectId(i)).filter(Boolean) as any[] } },
    { projection: { full_name: 1, email: 1, app_role: 1, status: 1, team_name: 1 } }).toArray()) as any[];
  const userOf = new Map(users.map((u) => [String(u._id), u]));
  const rows = ids
    .filter((id) => userOf.has(id))
    .map((id) => ({ ...personOf(userOf.get(id)), ...g.buckets.get(id)! }))
    .sort((a, b) => b.students - a.students || a.name.localeCompare(b.name));
  return { today: g.today, upcomingDays: UPCOMING_DAYS, period, rows };
}

/** One CS: the figures, and the lists behind them. Null for nobody here. */
export async function csDetail(userId: string, period: Period) {
  const oid = toObjectId(userId);
  if (!oid) return null;
  const u = await col("users").findOne({ _id: oid }, { projection: { full_name: 1, email: 1, app_role: 1, status: 1, team_name: 1 } });
  if (!u) return null;
  const g = await gather(period, userId);
  // Deposits and commission can be on another CS's student: their names too.
  const others = [...new Set([...g.depositsIn, ...g.creditsIn].map((x) => String(x.student_id ?? "")).filter((sid) => sid && !g.studentById.has(sid)))];
  const extra = others.length
    ? ((await col("students").find({ _id: { $in: others.map((x) => toObjectId(x)).filter(Boolean) as any[] } }, { projection: { full_name: 1, student_code: 1 } }).toArray()) as any[])
    : [];
  const named = new Map<string, any>([...g.studentById, ...extra.map((x) => [String(x._id), x] as [string, any])]);
  const nameOf = (sid: string) => {
    const s = named.get(String(sid));
    return { studentId: String(sid), student: String(s?.full_name ?? ""), code: String(s?.student_code ?? "") };
  };
  const dues: any[] = [];
  for (const s of g.owing) for (const f of owingFeesOf(s)) {
    const due = dueStateOf(f.next_due_on, g.dueToday);
    dues.push({
      ...nameOf(String(s._id)), course: String(f.course ?? ""), currency: String(f.currency || "AED"),
      balance: (Number(f.balance_minor) || 0) / 100, nextDueOn: f.next_due_on ?? null, state: due.state, daysLeft: due.daysLeft,
    });
  }
  dues.sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
  return {
    person: personOf(u),
    today: g.today,
    upcomingDays: UPCOMING_DAYS,
    period,
    summary: g.buckets.get(userId) ?? blank(),
    followups: g.followups
      .filter((f) => g.studentById.has(String(f.student_id)))
      .map((f) => ({ ...nameOf(String(f.student_id)), stage: String(f.stage ?? ""), title: String(f.title ?? ""), due: String(f.next_followup_date ?? ""),
        overdue: String(f.next_followup_date ?? "") < g.today }))
      .sort((a, b) => a.due.localeCompare(b.due)),
    dues,
    bonus: [...g.bonusOf].filter(([sid]) => g.studentById.has(sid)).map(([sid, p]) => ({
      ...nameOf(sid), count: p.count, usd: p.total_usd, stage: p.stage, since: p.since ?? null,
    })),
    notOnboarded: g.notOnboarded.map((s) => ({ ...nameOf(String(s._id)), since: String(s.created_date ?? ""), late: g.lateIds.has(String(s._id)) }))
      .sort((a, b) => a.since.localeCompare(b.since)),
    deposits: g.depositsIn
      .filter((t) => String(t.initiating_mentor_id || t.primary_mentor_id || "") === userId)
      .map((t) => ({ studentId: String(t.student_id ?? ""), student: String(t.student_name ?? nameOf(String(t.student_id)).student), usd: Number(t.amount_usd) || 0,
        at: String(t.approved_at || t.requested_at || t.created_date || "") }))
      .sort((a, b) => b.at.localeCompare(a.at)),
    commission: g.creditsIn.map((c) => ({ ...nameOf(String(c.student_id ?? "")), usd: Number(c.commission_usd) || 0, level: c.level ?? null,
      type: String(c.transaction_type ?? ""), status: String(c.status ?? ""), at: String(c.requested_at || c.created_date || "") }))
      .sort((a, b) => b.at.localeCompare(a.at)),
  };
}
