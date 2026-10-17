import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { isAdmin, visibleMentorIds } from "../students/followups";
import { seesClosedOnly } from "../students/closedBy";
import { loadTeams, type TeamIndex } from "../students/teams";
import { notSentOf, stageWithPayment } from "../students/bonusPending";
import { owedSalesCredits } from "../students/salesBonusPaid";
import { csManagerReach } from "../lib/userLocation";

/* ────────────────────────────────────────────────────────────────────────────
   The Reports section (the user, 2026-10-11): each report added up here, for
   a period and the filters every report shares —

     period    month | quarter | year | all | custom (from, to: YYYY-MM-DD),
               UAE calendar days;
     location  dubai | bangalore — the team of the person it counts for;
     team      a team (its leader's id);
     cs        one person.

   Each row counts for a person — a funding request for whoever raised it
   (initiating_mentor_id, else the student's CS), as commission does — and so
   for their team and its location; someone on no team is "No team", Dubai.

   Who sees what: admin roles and every CS Manager everyone; a Chief Mentor
   (or anyone with people under them) their own and their people's; anyone
   else only their own. The Sales role none. Read-only.

   Reports so far: deposits, withdrawals, funding requests, bonuses.
──────────────────────────────────────────────────────────────────────────── */

const UAE_OFFSET_MS = 4 * 3_600_000;
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cents = (n: number) => Math.round(n * 100) / 100;
const usdOf = (t: any) => (Number.isFinite(Number(t?.amount_usd)) ? Number(t.amount_usd) : 0);
/** As Funding Requests shows a request (the user, 2026-10-13): a bonus its MT5 bonus — a course payment's bonus, not
 *  the payment — anything else its USD amount… */
const creditUsdOf = (t: any) => (t?.type === "BONUS" && t?.course_payment ? Number(t.course_payment.bonus_usd) || 0 : usdOf(t));
/** …and the AED the student paid with it: a course payment's AED received, a deposit's or withdrawal's AED; a bonus
 *  credit (sales close, course upgrade) none — its money came through finance. */
const paidAedOf = (t: any) => {
  if (t?.type === "BONUS" && t?.bonus_credit) return 0;
  return Number(t?.course_payment?.paid_today_aed) || Number(t?.amount_aed) || usdOf(t) * 3.67;
};
const when = (...vals: unknown[]): number => {
  for (const v of vals) {
    const t = v ? Date.parse(String(v)) : NaN;
    if (Number.isFinite(t)) return t;
  }
  return NaN;
};
/** "2026-10" in UAE time. */
const monthOf = (t: number) => new Date(t + UAE_OFFSET_MS).toISOString().slice(0, 7);

export interface ReportCtx {
  since: number;
  until: number;
  period: string;
  index: TeamIndex;
  /** Whose rows this person may see — null: everyone. */
  reach: Set<string> | null;
  location: "dubai" | "bangalore" | null;
  /** A CS Manager's own location — their reports never show the other one (2026-10-14). */
  lockedLocation: "dubai" | "bangalore" | null;
  team: string;
  cs: string;
}

/** The period asked for, as [since, until) in UTC ms — UAE calendar days. */
function rangeOf(body: any, now = Date.now()): { since: number; until: number; period: string } | string {
  const period = String(body?.period ?? "month");
  const uae = new Date(now + UAE_OFFSET_MS);
  const y = uae.getUTCFullYear(), m = uae.getUTCMonth();
  const at = (yy: number, mm: number, dd = 1) => Date.UTC(yy, mm, dd) - UAE_OFFSET_MS;
  if (period === "month") return { since: at(y, m), until: at(y, m + 1), period };
  if (period === "quarter") { const q = Math.floor(m / 3) * 3; return { since: at(y, q), until: at(y, q + 3), period }; }
  if (period === "year") return { since: at(y, 0), until: at(y + 1, 0), period };
  if (period === "all") return { since: 0, until: Number.MAX_SAFE_INTEGER, period };
  if (period === "custom") {
    const from = String(body?.from ?? ""), to = String(body?.to ?? "");
    if (!DATE.test(from) || !DATE.test(to) || from > to) return "Pick a from and a to date";
    return { since: Date.parse(`${from}T00:00:00+04:00`), until: Date.parse(`${to}T00:00:00+04:00`) + DAY_MS, period };
  }
  return "period is month, quarter, year, all or custom";
}

/** Who may see what, and the filters — or the refusal. */
export async function reportCtx(body: any, user: AuthUser): Promise<ReportCtx | Response> {
  if (await seesClosedOnly(user)) return forbidden();
  const range = rangeOf(body);
  if (typeof range === "string") return error(range, 400);
  // A CS Manager: everyone in their own location — Dubai or Bangalore, never both (the user, 2026-10-14).
  const manager = await csManagerReach(user);
  const reach = manager ? new Set(manager.ids) : isAdmin(user) ? null : await visibleMentorIds(user);
  return {
    ...range,
    index: await loadTeams(),
    reach,
    lockedLocation: manager?.location ?? null,
    location: manager ? manager.location : body?.location === "dubai" || body?.location === "bangalore" ? body.location : null,
    team: String(body?.team ?? "").slice(0, 40),
    cs: String(body?.cs ?? "").slice(0, 40),
  };
}

export interface Person { id: string; name: string; team_id: string; team: string; location: "dubai" | "bangalore" }

/** Who a person is for the reports: their name, team and its location. */
export function personOf(ctx: ReportCtx, id: string, fallbackName = ""): Person {
  const team = ctx.index.teamOf(id);
  const u = ctx.index.userById.get(id);
  return {
    id, name: String(u?.full_name || u?.email || fallbackName || (id ? "Someone removed" : "Nobody")),
    team_id: team?.id ?? "", team: team?.name ?? "No team", location: team?.location ?? "dubai",
  };
}

/** Whether a row counted for `p` is in this person's reach and the filters. */
export function counts(ctx: ReportCtx, p: Person): boolean {
  if (ctx.reach && !ctx.reach.has(p.id)) return false;
  if (ctx.location && p.location !== ctx.location) return false;
  if (ctx.team && p.team_id !== ctx.team) return false;
  if (ctx.cs && p.id !== ctx.cs) return false;
  return true;
}
const inRange = (ctx: ReportCtx, t: number) => Number.isFinite(t) && t >= ctx.since && t < ctx.until;
const raisedBy = (t: any) => String(t.initiating_mentor_id || t.primary_mentor_id || "");

/** Rows keyed by person, by team and by month, each with whatever `add` sums. */
function grouper<T extends Record<string, number>>(blank: () => T) {
  const people = new Map<string, Person & T>(), teams = new Map<string, { id: string; team: string; location: string } & T>(), months = new Map<string, { month: string } & T>();
  const total = blank();
  const sum = (into: T, add: Partial<T>) => { for (const [k, v] of Object.entries(add)) (into as any)[k] = cents(((into as any)[k] ?? 0) + (v as number)); };
  return {
    add(p: Person, t: number, add: Partial<T>) {
      const row = people.get(p.id) ?? { ...p, ...blank() };
      sum(row, add); people.set(p.id, row);
      const tk = p.team_id || "-";
      const tr = teams.get(tk) ?? { id: p.team_id, team: p.team, location: p.location, ...blank() };
      sum(tr, add); teams.set(tk, tr);
      if (Number.isFinite(t)) {
        const mk = monthOf(t);
        const mr = months.get(mk) ?? { month: mk, ...blank() };
        sum(mr, add); months.set(mk, mr);
      }
      sum(total, add);
    },
    out(sortKey: keyof T) {
      const by = (a: any, b: any) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0);
      return {
        total,
        people: [...people.values()].sort(by),
        teams: [...teams.values()].sort(by),
        months: [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
      };
    },
  };
}

const meta = (ctx: ReportCtx) => ({
  period: ctx.period,
  since: ctx.since ? new Date(ctx.since).toISOString() : null,
  until: ctx.until < Number.MAX_SAFE_INTEGER ? new Date(ctx.until).toISOString() : null,
  scope: ctx.lockedLocation ? "location" : ctx.reach ? (ctx.reach.size > 1 ? "team" : "own") : "all",
  locked_location: ctx.lockedLocation,
});

/**
 * POST /api/functions/getMoneyReport { kind: "deposit" | "withdrawal", period, from?, to?, location?, team?, cs? }
 * Approved deposits (or withdrawals) when approved: count and USD per person, team and month.
 */
export async function getMoneyReport(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const ctx = await reportCtx(body, user);
  if (ctx instanceof Response) return ctx;
  const type = body?.kind === "withdrawal" ? "WITHDRAWAL" : "DEPOSIT";
  const txs = (await col("funding_transactions")
    .find({ type, status: "APPROVED" }, { projection: { amount_usd: 1, initiating_mentor_id: 1, primary_mentor_id: 1, primary_mentor_name: 1, student_id: 1, approved_at: 1, requested_at: 1, created_date: 1 } })
    .toArray()) as any[];
  const g = grouper(() => ({ count: 0, usd: 0, students: 0 }));
  const studentsOf = new Map<string, Set<string>>();
  for (const t of txs) {
    const at = when(t.approved_at, t.requested_at, t.created_date);
    if (!inRange(ctx, at)) continue;
    const p = personOf(ctx, raisedBy(t), t.primary_mentor_name);
    if (!counts(ctx, p)) continue;
    const seen = studentsOf.get(p.id) ?? new Set<string>();
    const fresh = t.student_id && !seen.has(String(t.student_id)) ? 1 : 0;
    if (t.student_id) seen.add(String(t.student_id));
    studentsOf.set(p.id, seen);
    g.add(p, at, { count: 1, usd: usdOf(t), students: fresh });
  }
  return json({ kind: type === "DEPOSIT" ? "deposit" : "withdrawal", ...meta(ctx), ...g.out("usd") });
}

const TYPES = ["DEPOSIT", "WITHDRAWAL", "BONUS"] as const;
const STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

/**
 * POST /api/functions/getFundingRequestReport { period, … }
 * Every funding request raised in the period: how many of each type and where they stand, the amounts, and how long
 * a decision took (hours, on average) — per person, team and month.
 */
export async function getFundingRequestReport(req: Request, user: AuthUser): Promise<Response> {
  const ctx = await reportCtx(await req.json().catch(() => ({})), user);
  if (ctx instanceof Response) return ctx;
  const txs = (await col("funding_transactions")
    .find({ type: { $in: [...TYPES] } }, { projection: { type: 1, status: 1, amount_usd: 1, amount_aed: 1, course_payment: 1, bonus_credit: 1, initiating_mentor_id: 1, primary_mentor_id: 1, primary_mentor_name: 1, requested_at: 1, created_date: 1, approved_at: 1, updated_date: 1 } })
    .toArray()) as any[];
  const blank = () => ({
    count: 0, usd: 0, aed: 0, pending: 0, approved: 0, rejected: 0, deposit: 0, withdrawal: 0, bonus: 0, decided: 0, decide_hours: 0,
  });
  const g = grouper(blank);
  const grid: Record<string, Record<string, { count: number; usd: number; aed: number }>> = {};
  for (const ty of TYPES) { grid[ty] = {}; for (const st of STATUSES) grid[ty][st] = { count: 0, usd: 0, aed: 0 }; }
  for (const t of txs) {
    const at = when(t.requested_at, t.created_date);
    if (!inRange(ctx, at)) continue;
    const p = personOf(ctx, raisedBy(t), t.primary_mentor_name);
    if (!counts(ctx, p)) continue;
    const status = (STATUSES as readonly string[]).includes(t.status) ? t.status : "PENDING";
    const decidedAt = status === "PENDING" ? NaN : when(t.approved_at, t.updated_date);
    const hours = Number.isFinite(decidedAt) && decidedAt >= at ? (decidedAt - at) / 3_600_000 : NaN;
    g.add(p, at, {
      count: 1, usd: creditUsdOf(t), aed: paidAedOf(t),
      [status.toLowerCase()]: 1, [String(t.type).toLowerCase()]: 1,
      ...(Number.isFinite(hours) ? { decided: 1, decide_hours: hours } : {}),
    } as any);
    grid[t.type][status].count++;
    grid[t.type][status].usd = cents(grid[t.type][status].usd + creditUsdOf(t));
    grid[t.type][status].aed = cents(grid[t.type][status].aed + paidAedOf(t));
  }
  const out = g.out("count");
  const avg = (r: any) => ({ ...r, avg_decide_hours: r.decided ? cents(r.decide_hours / r.decided) : null });
  return json({
    ...meta(ctx), grid,
    total: avg(out.total), people: out.people.map(avg), teams: out.teams.map(avg), months: out.months.map(avg),
  });
}

/**
 * POST /api/functions/getBonusReport { period, … }
 * Bonuses raised in the period, by where they stand — needs a connected call + MT5 (promised at a sales close, not
 * sent yet; counted when the student came), with finance, waiting for a broker admin, approved, rejected — count and
 * USD per person, team and month.
 */
export async function getBonusReport(req: Request, user: AuthUser): Promise<Response> {
  const ctx = await reportCtx(await req.json().catch(() => ({})), user);
  if (ctx instanceof Response) return ctx;
  const txs = (await col("funding_transactions")
    .find({ type: "BONUS" }, { projection: { type: 1, course_payment: 1, status: 1, amount_usd: 1, initiating_mentor_id: 1, primary_mentor_id: 1, primary_mentor_name: 1, requested_at: 1, created_date: 1, finance_approval: 1, bonus_credit: 1, sales_close: 1, student_id: 1, amount_aed: 1 } })
    .toArray()) as any[];
  // A sales-close bonus whose course still owes waits for the full payment (2026-10-17).
  const owed = await owedSalesCredits(txs.filter((t) => t.status === "PENDING"));
  const blank = () => ({
    count: 0, usd: 0, aed: 0, approved_collected_aed: 0, after_payment: 0, after_payment_usd: 0, after_payment_aed: 0, needs_call: 0, needs_call_usd: 0, needs_call_aed: 0, with_finance: 0, with_finance_usd: 0, with_finance_aed: 0,
    waiting_broker: 0, waiting_broker_usd: 0, waiting_broker_aed: 0, approved: 0, approved_usd: 0, approved_aed: 0, rejected: 0, rejected_usd: 0, rejected_aed: 0,
  });
  const g = grouper(blank);
  for (const t of txs) {
    const at = when(t.requested_at, t.created_date);
    if (!inRange(ctx, at)) continue;
    const p = personOf(ctx, raisedBy(t), t.primary_mentor_name);
    if (!counts(ctx, p)) continue;
    // Sent back to correct still waits — counted with the broker admin's column in this report.
    const raw = t.status === "APPROVED" ? "approved" : t.status === "REJECTED" ? "rejected" : stageWithPayment(t, owed);
    const stage = raw === "sent_back" ? "waiting_broker" : raw;
    // The MT5 bonus and the AED the student paid, as Funding Requests shows them (2026-10-13).
    const usd = creditUsdOf(t), aedPaid = paidAedOf(t);
    // Approved: what the student paid, in AED (the user, 2026-10-12) — the course payment's paid today, else the
    // request's AED, else its USD at 3.67.
    const collected = stage !== "approved" ? 0
      : Number(t.course_payment?.paid_today_aed) > 0 ? Number(t.course_payment.paid_today_aed)
      : Number(t.amount_aed) > 0 ? Number(t.amount_aed) : usdOf(t) * 3.67;
    // Approved: the same AED as the Collected (approved) card.
    const paidHere = stage === "approved" ? collected : aedPaid;
    g.add(p, at, { count: 1, usd, aed: paidHere, [stage]: 1, [`${stage}_usd`]: usd, [`${stage}_aed`]: paidHere, ...(collected ? { approved_collected_aed: collected } : {}) } as any);
  }
  // Promised at a sales close and not sent to be credited yet — for the student's CS now.
  const students = await notSentOf({});
  if (students.size) {
    const docs = (await col("students").find({ _id: { $in: [...students.keys()].map((id) => toObjectId(id)).filter(Boolean) as any[] } }, { projection: { primary_mentor_id: 1, primary_mentor_name: 1 } }).toArray()) as any[];
    const csOf = new Map(docs.map((d) => [String(d._id), d]));
    for (const [sid, left] of students) {
      const s = csOf.get(sid);
      const p = personOf(ctx, String(s?.primary_mentor_id ?? ""), s?.primary_mentor_name);
      if (!counts(ctx, p)) continue;
      for (const x of left) {
        const at = when(x.since);
        if (!inRange(ctx, at)) continue;
        g.add(p, at, x.owed
          ? { count: 1, usd: x.usd, after_payment: 1, after_payment_usd: x.usd } as any
          : { count: 1, usd: x.usd, needs_call: 1, needs_call_usd: x.usd } as any);
      }
    }
  }
  return json({ ...meta(ctx), ...g.out("usd") });
}

/** POST /api/functions/getReportFilters — the teams and people this person can filter by. */
export async function getReportFilters(req: Request, user: AuthUser): Promise<Response> {
  const ctx = await reportCtx(await req.json().catch(() => ({})), user);
  if (ctx instanceof Response) return ctx;
  const people = [...ctx.index.userById.entries()]
    .filter(([id, u]) => (!ctx.reach || ctx.reach.has(id)) && u?.status !== "inactive" && /mentor|cs|assistance/.test(String(u?.app_role ?? "")))
    .map(([id, u]) => ({ id, name: String(u.full_name || u.email || ""), team_id: ctx.index.teamOf(id)?.id ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const teamIds = new Set(people.map((p) => p.team_id).filter(Boolean));
  const teams = ctx.index.teams.filter((t) => !ctx.reach || teamIds.has(t.id)).map((t) => ({ id: t.id, name: t.name, location: t.location }));
  return json({ scope: meta(ctx).scope, locked_location: ctx.lockedLocation, teams, people });
}
