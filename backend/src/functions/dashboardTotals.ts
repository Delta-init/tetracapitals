import { col } from "../db";
import { json, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { loadTeams } from "../students/teams";
import { currentLocationOf, type Location } from "../lib/location";

/* ────────────────────────────────────────────────────────────────────────────
   The Super Admin's dashboard (the user, 2026-10-10): for a period, three
   figures, each in all and for Dubai and Bangalore —
     deposits    approved deposits (USD), with withdrawals and the net —
                 by the student's location (their team's, else the academy
                 they came for; as the Students list's Location filter);
     course      course-upgrade payments Delta finance approved (AED, and USD
                 at the fixed 3.67) — by the student's location;
     commission  every commission credit (USD) — by the team of the person
                 paid, a pool by its Chief's team, as the commission reports;
                 a pool counts until it is shared out, then its payouts do.
   Someone on no team counts as Dubai, as an unset location does.
──────────────────────────────────────────────────────────────────────────── */

const AED_PER_USD = 3.67;
const UAE_OFFSET_MS = 4 * 3_600_000;
const PERIODS = ["month", "quarter", "year", "all"] as const;
type Period = (typeof PERIODS)[number];

/** When the period started, in UTC ms (UAE calendar); 0 for all time. */
function periodStart(period: Period, now = Date.now()): number {
  if (period === "all") return 0;
  const uae = new Date(now + UAE_OFFSET_MS);
  const y = uae.getUTCFullYear();
  const m = period === "year" ? 0 : period === "quarter" ? Math.floor(uae.getUTCMonth() / 3) * 3 : uae.getUTCMonth();
  return Date.UTC(y, m, 1) - UAE_OFFSET_MS;
}

const when = (...vals: unknown[]): number => {
  for (const v of vals) {
    const t = v ? Date.parse(String(v)) : NaN;
    if (Number.isFinite(t)) return t;
  }
  return NaN;
};
const blank = () => ({ dubai: 0, bangalore: 0 });
const round = (n: number) => Math.round(n * 100) / 100;
const withTotal = (o: { dubai: number; bangalore: number }) => ({ total: round(o.dubai + o.bangalore), dubai: round(o.dubai), bangalore: round(o.bangalore) });

/** POST /api/functions/getDashboardTotals { period?: "month" | "quarter" | "year" | "all" } — Super Admin only. */
export async function getDashboardTotals(req: Request, user: AuthUser): Promise<Response> {
  if (user.app_role !== "super_admin") return forbidden();
  const body: any = await req.json().catch(() => ({}));
  const period: Period = (PERIODS as readonly string[]).includes(body?.period) ? body.period : "month";
  const since = periodStart(period);
  const inPeriod = (t: number) => Number.isFinite(t) && t >= since;

  const index = await loadTeams();
  const teamLocation = new Map(index.teams.map((t) => [t.id, t.location]));
  const personLocation = (id: unknown): Location => index.teamOf(String(id ?? ""))?.location ?? "dubai";

  const [funding, payments, credits] = await Promise.all([
    col("funding_transactions")
      .find({ status: "APPROVED", type: { $in: ["DEPOSIT", "WITHDRAWAL"] } }, { projection: { type: 1, amount_usd: 1, student_id: 1, approved_at: 1, requested_at: 1, created_date: 1 } })
      .toArray() as Promise<any[]>,
    col("course_payments")
      .find({ status: "approved" }, { projection: { student_id: 1, amount_aed: 1, approved_amount_aed: 1, decided_at: 1, paid_on: 1, recorded_at: 1 } })
      .toArray() as Promise<any[]>,
    col("commission_credits")
      .find({ $or: [{ is_pool: { $ne: true } }, { status: "pooled" }] }, { projection: { recipient_id: 1, pool_group_id: 1, is_pool: 1, commission_usd: 1, requested_at: 1, created_date: 1 } })
      .toArray() as Promise<any[]>,
  ]);

  const fundingNow = funding.filter((t) => inPeriod(when(t.approved_at, t.requested_at, t.created_date)));
  const paymentsNow = payments.filter((p) => inPeriod(when(p.decided_at, p.paid_on, p.recorded_at)));
  const ids = [...new Set([...fundingNow, ...paymentsNow].map((x) => String(x.student_id ?? "")).filter(Boolean))].map(toObjectId).filter(Boolean);
  const students = ids.length
    ? ((await col("students").find({ _id: { $in: ids as any[] } }, { projection: { team_id: 1, location: 1 } }).toArray()) as any[])
    : [];
  const studentLocation = new Map(students.map((s) => [String(s._id), currentLocationOf(s, (id) => teamLocation.get(id))]));
  const locOfStudent = (id: unknown): Location => studentLocation.get(String(id ?? "")) ?? "dubai";

  const deposits = blank(), withdrawals = blank();
  let depositCount = 0;
  for (const t of fundingNow) {
    const loc = locOfStudent(t.student_id);
    const amount = Number(t.amount_usd) || 0;
    if (t.type === "DEPOSIT") { deposits[loc] += amount; depositCount++; } else withdrawals[loc] += amount;
  }

  const courseAed = blank();
  for (const p of paymentsNow) courseAed[locOfStudent(p.student_id)] += Number(p.approved_amount_aed ?? p.amount_aed) || 0;

  const commission = blank();
  for (const c of credits) {
    if (!inPeriod(when(c.requested_at, c.created_date))) continue;
    commission[personLocation(c.is_pool ? c.pool_group_id : c.recipient_id)] += Number(c.commission_usd) || 0;
  }

  const net = { dubai: deposits.dubai - withdrawals.dubai, bangalore: deposits.bangalore - withdrawals.bangalore };
  const usd = { dubai: courseAed.dubai / AED_PER_USD, bangalore: courseAed.bangalore / AED_PER_USD };
  return json({
    period,
    since: since ? new Date(since).toISOString() : null,
    deposits: { ...withTotal(deposits), count: depositCount, withdrawals: withTotal(withdrawals), net: withTotal(net) },
    course: { aed: withTotal(courseAed), usd: withTotal(usd), count: paymentsNow.length },
    commission: withTotal(commission),
    bangalore_teams: index.teams.filter((t) => t.location === "bangalore").length,
  });
}
