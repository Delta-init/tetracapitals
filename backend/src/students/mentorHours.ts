import { config } from "../config";
import { hrmsConfigured, hrmsGet } from "../lib/hrms";

/* ────────────────────────────────────────────────────────────────────────────
   The mentors' working hours on the Mentor Calendar, from the HRMS (the
   user, 2026-10-04): each one's work schedule — their shift and the days they
   work, or the HRMS's default when nobody assigned one, said so — and their
   approved leave, matched by email (GET /integrations/directory/work-hours).

   In Dubai time, as everything on the calendar: a schedule set in another
   time zone is turned into Dubai's, day by day — a shift that crosses Dubai's
   midnight shows on both days, in two pieces. Leave is by date: the days the
   HRMS gives it for.

   Asked once per window and mentors, kept five minutes. An HRMS that does not
   answer leaves the calendar as it was, with a line saying why.
──────────────────────────────────────────────────────────────────────────── */

export const CALENDAR_TZ = "Asia/Dubai";
const DAY_MS = 86_400_000;
const TTL_MS = 5 * 60_000;

interface HrmsSchedule {
  name: string; timeZone: string; loginTime: string; logoutTime: string; workDays: number[]; halfDays: number[];
  mode: string; requiredHours: number | null; assigned: boolean;
}
interface HrmsRow { email: string; name: string; schedule: HrmsSchedule; leaves: { type: string; from: string; to: string; halfDay: boolean }[] }

export interface DayWork {
  /** Their shift this Dubai day, in Dubai time ("24:00" = to midnight) — two pieces when one crosses midnight. */
  shifts: { from: string; to: string }[];
  /** A half day by their schedule. */
  half: boolean;
  /** Approved leave this day. */
  leave: { type: string; half: boolean } | null;
}
export interface MentorWork {
  /** Their schedule, its times and days in Dubai time; `timeZone` is the one it is set in. */
  schedule: {
    name: string; assigned: boolean; timeZone: string; from: string; to: string; workDays: number[]; halfDays: number[];
    mode: string; requiredHours: number | null;
  };
  /** Each Dubai day of the window, YYYY-MM-DD. */
  days: Record<string, DayWork>;
}
export interface MentorHours { configured: boolean; available: boolean; message?: string; byEmail: Map<string, MentorWork> }

const dayIn = (instant: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
const timeIn = (instant: Date, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
/** A wall-clock date and time in `tz` → the instant (the HRMS's own zonedTimeToUtc). */
function zonedToUtc(date: string, time: string, tz: string): Date {
  const naive = new Date(`${date}T${time}:00.000Z`);
  const asTz = new Date(naive.toLocaleString("en-US", { timeZone: tz }));
  const asUtc = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(naive.getTime() - (asTz.getTime() - asUtc.getTime()));
}
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** The Dubai days a window touches, YYYY-MM-DD. */
export function calendarDays(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let d = dayIn(from, CALENDAR_TZ); out.length < 70 && zonedToUtc(d, "00:00", CALENDAR_TZ) < to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** One Dubai day: the pieces of their shifts in it (yesterday's overnight one too), half day, leave. */
export function dayWork(s: HrmsSchedule, leaves: HrmsRow["leaves"], day: string): DayWork {
  const tz = s.timeZone || CALENDAR_TZ;
  const dayStart = zonedToUtc(day, "00:00", CALENDAR_TZ).getTime();
  const dayEnd = dayStart + DAY_MS; // Dubai keeps no summer time
  const pieces: { at: number; from: string; to: string }[] = [];
  let half = false;
  for (const d of [addDays(day, -1), day, addDays(day, 1)]) {
    const wd = weekday(d);
    if (!s.workDays.includes(wd)) continue;
    const start = zonedToUtc(d, s.loginTime, tz).getTime();
    let end = zonedToUtc(d, s.logoutTime, tz).getTime();
    if (end <= start) end += DAY_MS; // an overnight shift
    const a = Math.max(start, dayStart);
    const b = Math.min(end, dayEnd);
    if (b <= a) continue;
    pieces.push({ at: a, from: timeIn(new Date(a), CALENDAR_TZ), to: b === dayEnd ? "24:00" : timeIn(new Date(b), CALENDAR_TZ) });
    if (s.halfDays.includes(wd)) half = true;
  }
  const leave = leaves.find((l) => l.from <= day && day <= l.to);
  return {
    shifts: pieces.sort((x, y) => x.at - y.at).map(({ from, to }) => ({ from, to })),
    half,
    leave: leave ? { type: leave.type, half: leave.halfDay === true } : null,
  };
}

/** The schedule in Dubai time, read on `ref`: its times, and its days moved when that crosses midnight. */
export function inDubai(s: HrmsSchedule, ref: string): { from: string; to: string; workDays: number[]; halfDays: number[] } {
  const tz = s.timeZone || CALENDAR_TZ;
  if (tz === CALENDAR_TZ) return { from: s.loginTime, to: s.logoutTime, workDays: [...s.workDays], halfDays: [...s.halfDays] };
  const start = zonedToUtc(ref, s.loginTime, tz);
  let end = zonedToUtc(ref, s.logoutTime, tz);
  if (end <= start) end = new Date(end.getTime() + DAY_MS);
  const moved = Math.round((Date.parse(`${dayIn(start, CALENDAR_TZ)}T12:00:00Z`) - Date.parse(`${ref}T12:00:00Z`)) / DAY_MS);
  const move = (days: number[]) => days.map((d) => (d + moved + 7) % 7).sort((a, b) => a - b);
  return { from: timeIn(start, CALENDAR_TZ), to: timeIn(end, CALENDAR_TZ), workDays: move(s.workDays), halfDays: move(s.halfDays) };
}

const cache = new Map<string, { at: number; rows: HrmsRow[] }>();

/** Each mentor's working hours in the window, by email (lowercase). Never throws. */
export async function mentorHours(emails: string[], from: Date, to: Date): Promise<MentorHours> {
  const byEmail = new Map<string, MentorWork>();
  if (!hrmsConfigured()) return { configured: false, available: false, byEmail };
  const wanted = [...new Set(emails.map((e) => String(e ?? "").trim().toLowerCase()).filter((e) => e.includes("@")))].sort();
  const days = calendarDays(from, to);
  if (!wanted.length || !days.length) return { configured: true, available: true, byEmail };

  const key = `${days[0]}|${days[days.length - 1]}|${wanted.join(",")}`;
  const kept = cache.get(key);
  let rows = kept && kept.at > Date.now() - TTL_MS ? kept.rows : null;
  if (!rows) {
    try {
      const got: HrmsRow[] = [];
      for (let i = 0; i < wanted.length; i += 200) {
        got.push(...((await hrmsGet<HrmsRow[]>("/directory/work-hours", {
          emails: wanted.slice(i, i + 200).join(","),
          from: days[0]!,
          to: days[days.length - 1]!,
          ...(config.hrms.orgId ? { organizationId: config.hrms.orgId } : {}),
        })) ?? []));
      }
      if (cache.size > 100) cache.clear();
      cache.set(key, { at: Date.now(), rows: got });
      rows = got;
    } catch (err) {
      return { configured: true, available: false, message: err instanceof Error ? err.message : "The HRMS could not be asked", byEmail };
    }
  }

  for (const r of rows) {
    const email = String(r.email ?? "").toLowerCase();
    if (!email || byEmail.has(email) || !r.schedule) continue;
    const s = r.schedule;
    byEmail.set(email, {
      schedule: { name: s.name, assigned: s.assigned !== false, timeZone: s.timeZone, ...inDubai(s, days[0]!), mode: s.mode, requiredHours: s.requiredHours ?? null },
      days: Object.fromEntries(days.map((d) => [d, dayWork(s, r.leaves ?? [], d)])),
    });
  }
  return { configured: true, available: true, byEmail };
}
