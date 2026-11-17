import { col } from "../db";
import { json, error } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { loadTeams } from "../students/teams";
import { hrmsPhotos } from "../lib/hrms";
import { BUILTIN_MENTOR_ROLES } from "../lib/roles";

/* ────────────────────────────────────────────────────────────────────────────
   The Mentors TV (the user, 2026-11-17: "a mentors revenue leaderboard … a
   separate link, the Mentors TV") — the open board behind Root's Mentors TV.

   A mentor's revenue is the course payments that name them as the meeting's
   mentor ("Meeting Conducted By", meeting_mentor_id): bonus requests with a
   course payment, approved, never a sales-close credit — the same link that
   earns them their Meeting commission. Counted in the month it was approved,
   in AED, as the CS TV counts its payments. Beside it, the meetings they held
   that month (from the LMS, via meetingRows — left out, not zero, when the LMS
   can't be asked).

   Shown: the mentors with a payment or a meeting in the month, of one location
   (their team's — Dubai or Bangalore). Names, roles, teams, photos and amounts
   only — never a student or an email. Kept 20 seconds; the meetings 5 minutes.
──────────────────────────────────────────────────────────────────────────── */

const CACHE_MS = 20_000;
const MEETINGS_MS = 5 * 60_000;
const round = (n: number) => Math.round(n * 100) / 100;
const dubaiDay = (ms = Date.now()) => new Date(ms + 4 * 3600_000).toISOString().slice(0, 10);
const dubaiStart = (day: string) => new Date(`${day}T00:00:00+04:00`).toISOString();
const nextMonth = (m: string) => { const [y, mm] = m.split("-").map(Number) as [number, number]; return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; };
const ROLE: Record<string, string> = { chief_mentor: "Chief Mentor", senior_mentor: "Senior Mentor", junior_mentor: "Junior Mentor", subjunior_mentor: "Sub-junior Mentor", assistance: "Assistance" };

type Location = "dubai" | "bangalore";

/** Each mentor's meetings in the month, by address — null when the LMS can't be asked. */
const meetingsCache = new Map<string, { at: number; data: Map<string, number> | null }>();
async function meetingsIn(month: string): Promise<Map<string, number> | null> {
  const had = meetingsCache.get(month);
  if (had && Date.now() - had.at < MEETINGS_MS) return had.data;
  let data: Map<string, number> | null = null;
  try {
    const { meetingRows } = await import("./meetingOutcomes");
    const last = new Date(new Date(`${nextMonth(month)}-01T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
    const rows = await meetingRows({ id: "", email: "", app_role: "super_admin" } as AuthUser, `${month}-01`, last);
    data = new Map();
    const counted = new Set<string>();
    for (const r of rows) {
      if (r.status === "cancelled" || counted.has(r.meeting_id)) continue;
      counted.add(r.meeting_id);
      const key = String(r.mentor?.email ?? "").trim().toLowerCase();
      if (key) data.set(key, (data.get(key) ?? 0) + 1);
    }
  } catch {
    data = null;
  }
  meetingsCache.set(month, { at: Date.now(), data });
  return data;
}

export async function mentorBoard(location: Location, month?: string) {
  const index = await loadTeams();
  const today = dubaiDay();
  const past = !!month && month !== today.slice(0, 7);
  const shownMonth = past ? month! : today.slice(0, 7);
  const monthStart = dubaiStart(`${shownMonth}-01`), monthEnd = dubaiStart(`${nextMonth(shownMonth)}-01`), todayStart = dubaiStart(today);

  const people = ((await col("users").find(
    { app_role: { $in: [...BUILTIN_MENTOR_ROLES] }, status: { $ne: "inactive" } },
    { projection: { full_name: 1, email: 1, app_role: 1 } },
  ).toArray()) as any[]).filter((u) => (index.teamOf(String(u._id))?.location ?? "dubai") === location);
  const row = new Map(people.map((u) => {
    const team = index.teamOf(String(u._id));
    return [String(u._id), {
      id: String(u._id), name: String(u.full_name ?? "").trim(), email: String(u.email ?? "").toLowerCase(), role: ROLE[String(u.app_role)] ?? "",
      team: team?.name ?? "", month_aed: 0, today_aed: 0, payments: 0, today_payments: 0, meetings: null as number | null,
    }];
  }));

  const txs = (await col("funding_transactions").find({
    type: "BONUS", status: "APPROVED", bonus_credit: { $in: [null, ""] }, "course_payment.product": { $exists: true },
    meeting_mentor_id: { $in: [...row.keys()] }, meeting_mentor_none: { $ne: true },
    approved_at: { $gte: monthStart, $lt: monthEnd },
  }, { projection: { meeting_mentor_id: 1, course_payment: 1, amount_aed: 1, approved_at: 1, tags: 1 } }).sort({ approved_at: -1 }).toArray()) as any[];

  const recent: any[] = [];
  for (const t of txs) {
    const r = row.get(String(t.meeting_mentor_id));
    if (!r) continue;
    const aed = Number(t.course_payment?.paid_today_aed) || Number(t.amount_aed) || 0;
    r.month_aed += aed; r.payments += 1;
    if (!past && String(t.approved_at) >= todayStart) { r.today_aed += aed; r.today_payments += 1; }
    if (!past && recent.length < 20) recent.push({ id: String(t._id), mentor: r.name, team: r.team, aed: round(aed), product: String(t.course_payment?.product ?? (t.tags ?? [])[0] ?? ""), at: String(t.approved_at) });
  }

  const meetings = await meetingsIn(shownMonth);
  if (meetings) for (const r of row.values()) r.meetings = meetings.get(r.email) ?? 0;

  // On the board: a payment or a meeting this month.
  const shown = [...row.values()].filter((r) => r.payments > 0 || (r.meetings ?? 0) > 0);
  const photos = await hrmsPhotos(shown.map((r) => ({ email: r.email, name: r.name })));
  const mentors = shown
    .map(({ email, ...r }) => ({ ...r, photo: photos.get(email) ?? null, month_aed: round(r.month_aed), today_aed: round(r.today_aed) }))
    .sort((a, b) => b.month_aed - a.month_aed || b.payments - a.payments || (b.meetings ?? 0) - (a.meetings ?? 0) || a.name.localeCompare(b.name))
    .map((r, i) => ({ ...r, rank: i + 1 }));
  return {
    location, month: shownMonth, past, generated_at: new Date().toISOString(),
    meetings_available: meetings !== null,
    mentors,
    totals: {
      month_aed: round(mentors.reduce((s, r) => s + r.month_aed, 0)), today_aed: round(mentors.reduce((s, r) => s + r.today_aed, 0)),
      payments: mentors.reduce((s, r) => s + r.payments, 0), meetings: meetings ? mentors.reduce((s, r) => s + (r.meetings ?? 0), 0) : null,
    },
    recent,
  };
}

const cache = new Map<string, { at: number; data: any }>();

/**
 * GET /api/public/mentor-tv?location=dubai|bangalore[&month=YYYY-MM] — the board, for Root's Mentors TV. Open like the
 * CS board (names, teams and amounts only); a month gone by is kept 5 minutes.
 */
export async function handleMentorTv(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const location: Location = url.searchParams.get("location") === "bangalore" ? "bangalore" : "dubai";
  const asked = url.searchParams.get("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked < dubaiDay().slice(0, 7) ? asked : undefined;
  const key = month ? `${location}:${month}` : location;
  const had = cache.get(key);
  if (had && Date.now() - had.at < (month ? 5 * 60_000 : CACHE_MS)) return json(had.data);
  try {
    const data = await mentorBoard(location, month);
    cache.set(key, { at: Date.now(), data });
    return json(data);
  } catch (err) {
    console.error("[mentor tv]", err);
    return error("The board couldn't be made — try again", 500);
  }
}

