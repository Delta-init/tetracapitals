import { col } from "../db";
import { toObjectId } from "../lib/id";
import { businessToday, commonIds } from "../students/followups";
import { notOnboardedFilter, newFromFinanceFilter } from "../students/onboardingAlerts";
import { openFollowupsFilter, followupsDueTodayFilter, followupsOverdueFilter } from "../functions/navCounts";
import { owingFilter, owingFeesOf, dueStateOf, uaeDay } from "../finance/balanceDue";
import { bonusPendingOf, idsWithBonusPending, type BonusPending } from "../students/bonusPending";
import { AED_PER_USD, blankFunding, fundingFor, type FundingSummary } from "./csFunding";
import { loadTeams } from "../students/teams";
import { isAllTeamsCsManager } from "../lib/scope";

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
   students/bonusPending.ts. Course upgrades (2026-10-11) are the CS's who
   started them, else the student's CS: those started in the period, and the
   AED finance approved on any in the period. `from`/`to` are instants (Root
   cuts them in Gulf time) and bound only deposits, commission and upgrades.

   And (2026-10-14) funding requests — the period's and every one still
   waiting, where each is paused, USD and AED, the commission it earned
   (portal/csFunding.ts) — each CS's counts, and the recent course upgrades
   with who started them, for the CSEs page itself.

   Root shows it all in AED (the user, 2026-10-14) — and a Bangalore team's in
   INR, apart: each CS's `location` (their team's, as getMyCurrency decides it:
   a Bangalore team's CSs, CS Managers and mentors; the CS Manager over every
   team is Dubai), the team's figures for each location too (a student's by
   their CS's), and deposits in the AED they were recorded in (else USD at
   3.67). Read-only.
──────────────────────────────────────────────────────────────────────────── */

export const UPCOMING_DAYS = 7;

export interface Period { from?: string; to?: string }
type Money = Record<string, number>; // currency → amount (major units)

const cents = (n: number) => Math.round(n * 100) / 100;
const addMoney = (m: Money, currency: string, amount: number) => { m[currency] = cents((m[currency] ?? 0) + amount); };
const inPeriod = (at: string, p: Period) => !!at && (!p.from || at >= p.from) && (!p.to || at <= p.to);
const csOf = (s: any): string[] => [...new Set([String(s?.primary_mentor_id ?? ""), ...commonIds(s)].filter(Boolean))];
/** The whole team's bucket: each student, deposit, credit and upgrade once, however many CSs share it. */
const TEAM = "*";

interface Bucket {
  students: number;
  deposits: { count: number; usd: number; aed: number };
  commissionUsd: number;
  followupsToday: number;
  followupsOverdue: number;
  upcoming: { count: number; amount: Money };
  overdueDues: { count: number; amount: Money };
  balance: { students: number; amount: Money };
  bonus: { clients: number; usd: number; afterPayment: number; needsCall: number; withFinance: number; waitingBroker: number };
  notOnboarded: number;
  notOnboardedLate: number;
  upgrades: { count: number; paidAed: number; payments: number };
}
const blank = (): Bucket => ({
  students: 0, deposits: { count: 0, usd: 0, aed: 0 }, commissionUsd: 0, followupsToday: 0, followupsOverdue: 0,
  upcoming: { count: 0, amount: {} }, overdueDues: { count: 0, amount: {} }, balance: { students: 0, amount: {} },
  bonus: { clients: 0, usd: 0, afterPayment: 0, needsCall: 0, withFinance: 0, waitingBroker: 0 }, notOnboarded: 0, notOnboardedLate: 0,
  upgrades: { count: 0, paidAed: 0, payments: 0 },
});

/** A deposit's AED: as recorded, else its USD at 3.67. */
const depositAedOf = (t: any) => (Number(t?.amount_aed) > 0 ? Number(t.amount_aed) : cents((Number(t?.amount_usd) || 0) * AED_PER_USD));

export type Location = "dubai" | "bangalore";
export const LOCATIONS: Location[] = ["dubai", "bangalore"];
/** Where each person is, as getMyCurrency decides it: a Bangalore team's people Bangalore; everyone else Dubai. */
export async function locations(): Promise<(id: string) => Location> {
  const index = await loadTeams();
  return (id: string) => {
    const u = index.userById.get(String(id));
    if (!u || isAllTeamsCsManager(u)) return "dubai";
    return index.teamOf(id)?.location === "bangalore" ? "bangalore" : "dubai";
  };
}

/** Everything both views need, for one CS or for all. */
async function gather(period: Period, only?: string, now = Date.now()) {
  const today = businessToday();
  const dueToday = uaeDay(now);
  const mineFilter = only ? { $or: [{ primary_mentor_id: only }, { "common_cs.id": only }] } : {};
  const studentsCol = col("students");

  const [students, owing, notOnboarded, late, followups, deposits, credits, bonusIds, upgrades, upgradePayments] = await Promise.all([
    studentsCol.find(mineFilter, { projection: { primary_mentor_id: 1, common_cs: 1, full_name: 1, student_code: 1 } }).toArray(),
    studentsCol.find({ ...mineFilter, ...owingFilter() }, { projection: { primary_mentor_id: 1, common_cs: 1, course_fees: 1 } }).toArray(),
    studentsCol.find({ ...mineFilter, ...notOnboardedFilter() }, { projection: { primary_mentor_id: 1, common_cs: 1, created_date: 1 } }).toArray(),
    studentsCol.find({ ...mineFilter, ...newFromFinanceFilter(now) }, { projection: { _id: 1 } }).toArray(),
    col("student_followups").find({
      ...openFollowupsFilter(),
      $or: [followupsDueTodayFilter(today), followupsOverdueFilter(today)],
    }, { projection: { student_id: 1, stage: 1, next_followup_date: 1, title: 1, notes: 1 } }).toArray(),
    col("funding_transactions").find({ type: "DEPOSIT", status: "APPROVED", ...(only ? { $or: [{ initiating_mentor_id: only }, { primary_mentor_id: only }] } : {}) },
      { projection: { amount_usd: 1, amount_aed: 1, initiating_mentor_id: 1, primary_mentor_id: 1, approved_at: 1, requested_at: 1, created_date: 1, student_id: 1, student_name: 1 } }).toArray(),
    col("commission_credits").find({ is_pool: { $ne: true }, ...(only ? { recipient_id: only } : {}) },
      { projection: { recipient_id: 1, commission_usd: 1, requested_at: 1, created_date: 1, student_id: 1, level: 1, transaction_type: 1, status: 1 } }).toArray(),
    idsWithBonusPending("pending"),
    col("course_upgrades").find({ status: { $ne: "cancelled" } },
      { projection: { student_id: 1, course: 1, plan: 1, status: 1, created_by: 1, created_by_name: 1, created_at: 1, "quote.dueAed": 1 } }).toArray(),
    col("course_payments").find({ status: "approved" }, { projection: { upgrade_id: 1, amount_aed: 1, approved_amount_aed: 1, decided_at: 1 } }).toArray(),
  ]);

  const studentById = new Map((students as any[]).map((s) => [String(s._id), s]));
  const lateIds = new Set((late as any[]).map((s) => String(s._id)));
  const bonusOf: Map<string, BonusPending> = await bonusPendingOf(bonusIds.filter((id) => !only || studentById.has(id)));
  const buckets = new Map<string, Bucket>();
  const b = (id: string) => buckets.get(id) ?? buckets.set(id, blank()).get(id)!;
  /** A student's CSs, and the team once (not on one CS's page). */
  const locOf = await locations();
  /** A student's CSs, and the team once (not on one CS's page) — and their location's team, by their CS's. */
  const csAnd = (s: any) => {
    const ids = csOf(s);
    return ids.length && !only ? [...ids, TEAM, TEAM + locOf(String(s?.primary_mentor_id || ids[0]))] : ids;
  };
  const andTeam = (id: string) => (only ? [id] : [id, TEAM, TEAM + locOf(id)]);

  for (const s of students as any[]) for (const id of csAnd(s)) b(id).students++;
  for (const s of notOnboarded as any[]) for (const id of csAnd(s)) {
    b(id).notOnboarded++;
    if (lateIds.has(String(s._id))) b(id).notOnboardedLate++;
  }
  for (const f of followups as any[]) {
    const s = studentById.get(String(f.student_id));
    const isToday = f.next_followup_date === today;
    for (const id of s ? csAnd(s) : []) isToday ? b(id).followupsToday++ : b(id).followupsOverdue++;
  }
  for (const s of owing as any[]) {
    const fees = owingFeesOf(s);
    for (const id of csAnd(s)) {
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
    for (const id of s ? csAnd(s) : []) {
      const x = b(id).bonus;
      x.clients++; x.usd = cents(x.usd + p.total_usd);
      x.afterPayment += p.after_payment.count; x.needsCall += p.needs_call.count; x.withFinance += p.with_finance.count; x.waitingBroker += p.waiting_broker.count;
    }
  }
  const depositsIn = (deposits as any[]).filter((t) => inPeriod(String(t.approved_at || t.requested_at || t.created_date || ""), period));
  for (const t of depositsIn) {
    const id = String(t.initiating_mentor_id || t.primary_mentor_id || "");
    if (!id || (only && id !== only)) continue;
    const aed = depositAedOf(t);
    for (const k of andTeam(id)) { const x = b(k).deposits; x.count++; x.usd = cents(x.usd + (Number(t.amount_usd) || 0)); x.aed = cents(x.aed + aed); }
  }
  const creditsIn = (credits as any[]).filter((c) => inPeriod(String(c.requested_at || c.created_date || ""), period));
  for (const c of creditsIn) {
    const id = String(c.recipient_id || "");
    if (id) for (const k of andTeam(id)) b(k).commissionUsd = cents(b(k).commissionUsd + (Number(c.commission_usd) || 0));
  }
  // Upgrades: the CS who started one, else the student's CS (who may not be
  // in `students` when this is one CS's page — then it is not theirs).
  const upgradeOwner = new Map<string, string>();
  for (const u of upgrades as any[]) {
    const id = String(u.created_by || studentById.get(String(u.student_id))?.primary_mentor_id || "");
    if (id) upgradeOwner.set(String(u._id), id);
  }
  const mine = (id: string | undefined): id is string => !!id && (!only || id === only);
  const upgradesIn = (upgrades as any[]).filter((u) => inPeriod(String(u.created_at ?? ""), period) && mine(upgradeOwner.get(String(u._id))));
  for (const u of upgradesIn) for (const k of andTeam(upgradeOwner.get(String(u._id))!)) b(k).upgrades.count++;
  const upgradePaid = new Map<string, number>(); // upgrade id → AED approved in the period
  for (const p of upgradePayments as any[]) {
    const id = upgradeOwner.get(String(p.upgrade_id));
    if (!mine(id) || !inPeriod(String(p.decided_at ?? ""), period)) continue;
    const aed = Number(p.approved_amount_aed ?? p.amount_aed) || 0;
    for (const k of andTeam(id)) { const x = b(k).upgrades; x.payments++; x.paidAed = cents(x.paidAed + aed); }
    upgradePaid.set(String(p.upgrade_id), cents((upgradePaid.get(String(p.upgrade_id)) ?? 0) + aed));
  }
  return { locOf, today, dueToday, students: students as any[], studentById, owing: owing as any[], notOnboarded: notOnboarded as any[], lateIds,
    followups: followups as any[], depositsIn, creditsIn, bonusOf, buckets, upgrades: upgrades as any[], upgradesIn, upgradeOwner, upgradePaid };
}

const personOf = (u: any) => ({
  id: String(u._id), name: String(u.full_name || u.email || "Unknown"), email: String(u.email ?? "").toLowerCase(),
  role: String(u.app_role ?? ""), active: u.status !== "inactive", team: String(u.team_name ?? ""),
});

/** Every CS with anything: students, deposits or commission in the period, or anything waiting. */
export async function csOverview(period: Period) {
  const [g, funding] = await Promise.all([gather(period), fundingFor(period)]);
  // A CS with only a funding request waiting still has a row.
  for (const id of funding.byCs.keys()) if (!g.buckets.has(id)) g.buckets.set(id, blank());
  const ids = [...g.buckets.keys()].filter((id) => id !== TEAM);
  const users = (await col("users").find({ _id: { $in: ids.map((i) => toObjectId(i)).filter(Boolean) as any[] } },
    { projection: { full_name: 1, email: 1, app_role: 1, status: 1, team_name: 1 } }).toArray()) as any[];
  const userOf = new Map(users.map((u) => [String(u._id), u]));
  const rows = ids
    .filter((id) => userOf.has(id))
    .map((id) => ({ ...personOf(userOf.get(id)), location: g.locOf(id), ...g.buckets.get(id)!, funding: funding.byCs.get(id) ?? blankFunding() }))
    .sort((a, b) => b.students - a.students || a.name.localeCompare(b.name));
  // The period's course upgrades (started, or paid on), newest first, with who started them.
  const recentUpgrades = g.upgrades
    .filter((u) => g.upgradesIn.includes(u) || g.upgradePaid.has(String(u._id)))
    .map((u) => {
      const s = g.studentById.get(String(u.student_id));
      const owner = g.upgradeOwner.get(String(u._id)) ?? "";
      return {
        studentId: String(u.student_id ?? ""), student: String(s?.full_name ?? ""), code: String(s?.student_code ?? ""),
        course: String(u.course ?? ""), plan: String(u.plan ?? ""), status: String(u.status ?? ""),
        dueAed: Number(u.quote?.dueAed) || 0, paidAed: g.upgradePaid.get(String(u._id)) ?? 0, at: String(u.created_at ?? ""),
        csId: owner, cs: String(u.created_by_name || userOf.get(owner)?.full_name || ""), location: owner ? g.locOf(owner) : "dubai",
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 100);
  // The team's figures: each student once, however many CSs share them (rows added up would count those twice).
  return {
    today: g.today, upcomingDays: UPCOMING_DAYS, period, rows,
    totals: { ...(g.buckets.get(TEAM) ?? blank()), funding: funding.team as FundingSummary },
    // Each location's team figures apart — never adding AED to INR (Root shows Bangalore's in INR).
    totalsByLocation: Object.fromEntries(LOCATIONS.map((loc) => {
      const f = blankFunding();
      for (const [id, x] of funding.byCs) if (g.locOf(id) === loc) for (const k of Object.keys(f) as (keyof FundingSummary)[]) f[k] = Math.round((f[k] + x[k]) * 100) / 100;
      return [loc, { ...(g.buckets.get(TEAM + loc) ?? blank()), funding: f }];
    })),
    funding: { rows: funding.rows.map((r) => ({ ...r, location: r.csId ? g.locOf(r.csId) : "dubai" })), total: funding.total },
    recentUpgrades,
  };
}

/** One CS: the figures, and the lists behind them. Null for nobody here. */
export async function csDetail(userId: string, period: Period) {
  const oid = toObjectId(userId);
  if (!oid) return null;
  const u = await col("users").findOne({ _id: oid }, { projection: { full_name: 1, email: 1, app_role: 1, status: 1, team_name: 1 } });
  if (!u) return null;
  const [g, funding] = await Promise.all([gather(period, userId), fundingFor(period, userId)]);
  // Deposits and commission can be on another CS's student: their names too.
  // Upgrades started in the period, or paid on in it.
  const upgrades = g.upgrades.filter((u) => g.upgradesIn.includes(u) || g.upgradePaid.has(String(u._id)));
  const others = [...new Set([...g.depositsIn, ...g.creditsIn, ...upgrades].map((x) => String(x.student_id ?? "")).filter((sid) => sid && !g.studentById.has(sid)))];
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
    person: { ...personOf(u), location: g.locOf(userId) },
    today: g.today,
    upcomingDays: UPCOMING_DAYS,
    period,
    summary: { ...(g.buckets.get(userId) ?? blank()), funding: funding.byCs.get(userId) ?? blankFunding() },
    funding: { rows: funding.rows.map((r) => ({ ...r, location: g.locOf(userId) })), total: funding.total },
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
      .map((t) => ({ studentId: String(t.student_id ?? ""), student: String(t.student_name ?? nameOf(String(t.student_id)).student), usd: Number(t.amount_usd) || 0, aed: depositAedOf(t),
        at: String(t.approved_at || t.requested_at || t.created_date || "") }))
      .sort((a, b) => b.at.localeCompare(a.at)),
    commission: g.creditsIn.map((c) => ({ ...nameOf(String(c.student_id ?? "")), usd: Number(c.commission_usd) || 0, level: c.level ?? null,
      type: String(c.transaction_type ?? ""), status: String(c.status ?? ""), at: String(c.requested_at || c.created_date || "") }))
      .sort((a, b) => b.at.localeCompare(a.at)),
    upgrades: upgrades
      .map((u) => ({ ...nameOf(String(u.student_id)), course: String(u.course ?? ""), plan: String(u.plan ?? ""), status: String(u.status ?? ""),
        dueAed: Number(u.quote?.dueAed) || 0, paidAed: g.upgradePaid.get(String(u._id)) ?? 0, at: String(u.created_at ?? ""),
        startedBy: String(u.created_by_name ?? "") }))
      .sort((a, b) => b.at.localeCompare(a.at)),
  };
}
