import { config } from "../config";
import { hrmsConfigured, hrmsGet } from "../lib/hrms";
import { CALENDAR_TZ, inDubai } from "./mentorHours";

/* ────────────────────────────────────────────────────────────────────────────
   The mentors' clock-ins and clock-outs on the Mentor Report, from the HRMS
   (the user, 2026-10-27: "show late clock in and clock out and actual from
   the HRMS"): each Dubai day, their shift and that day's record — first in,
   last out, worked minutes, late minutes and the status — as the HRMS judged
   it (GET /integrations/directory/attendance-day, one day a call, matched by
   email). Late is the HRMS's own lateMinutes (its grace period applied).

   A day a call: five at a time, kept five minutes. An HRMS that does not
   answer leaves the report as it was, with a line saying why. Read only.
──────────────────────────────────────────────────────────────────────────── */

const TTL_MS = 5 * 60_000;
const AT_ONCE = 5;
const DAY_MS = 86_400_000;

interface HrmsAttendanceRow {
  email: string;
  schedule: { name: string; timeZone: string; loginTime: string; logoutTime: string; workDays: number[]; halfDays: number[]; assigned: boolean };
  workDay: boolean;
  attendance: { status: string; firstIn: string | null; lastOut: string | null; sessions: { in: string; out: string | null }[]; workedMinutes: number; lateMinutes: number } | null;
  leave: { type: string; halfDay: boolean } | null;
  wfh: boolean;
}

/** One person's day, in Dubai time. */
export interface AttendanceDay {
  /** Their shift that day ("10:00"–"19:00"), and whether the HRMS has one assigned to them or used its default. */
  shift: { from: string; to: string; assigned: boolean } | null;
  workDay: boolean;
  status: string;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  sessions: { in: string; out: string | null }[];
  leave: { type: string; half: boolean } | null;
  wfh: boolean;
}
export interface MentorAttendance { configured: boolean; available: boolean; message?: string; byEmail: Map<string, Map<string, AttendanceDay>> }

const cache = new Map<string, { at: number; rows: HrmsAttendanceRow[] }>();
const todayInDubai = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
const addDay = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

async function oneDay(day: string, emails: string[]): Promise<HrmsAttendanceRow[]> {
  const key = `${day}|${emails.join(",")}`;
  const kept = cache.get(key);
  if (kept && kept.at > Date.now() - TTL_MS) return kept.rows;
  const rows: HrmsAttendanceRow[] = [];
  for (let i = 0; i < emails.length; i += 200) {
    rows.push(...((await hrmsGet<HrmsAttendanceRow[]>("/directory/attendance-day", {
      emails: emails.slice(i, i + 200).join(","), day,
      ...(config.hrms.orgId ? { organizationId: config.hrms.orgId } : {}),
    })) ?? []));
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

/** Each mentor's days from `from` to `to` (Dubai days, YYYY-MM-DD; none after today), by email (lowercase). Never throws. */
export async function mentorAttendance(emails: string[], from: string, to: string): Promise<MentorAttendance> {
  const byEmail = new Map<string, Map<string, AttendanceDay>>();
  if (!hrmsConfigured()) return { configured: false, available: false, message: "The HRMS isn't linked to this server", byEmail };
  const wanted = [...new Set(emails.map((e) => String(e ?? "").trim().toLowerCase()).filter((e) => e.includes("@")))].sort();
  const last = to < todayInDubai() ? to : todayInDubai();
  const days: string[] = [];
  for (let d = from; d <= last && days.length < 100; d = addDay(d, 1)) days.push(d);
  if (!wanted.length || !days.length) return { configured: true, available: true, byEmail };

  try {
    for (let i = 0; i < days.length; i += AT_ONCE) {
      const batch = days.slice(i, i + AT_ONCE);
      const answers = await Promise.all(batch.map((d) => oneDay(d, wanted)));
      batch.forEach((day, k) => {
        for (const r of answers[k] ?? []) {
          const email = String(r.email ?? "").toLowerCase();
          const shift = r.schedule?.loginTime ? inDubai({ ...r.schedule, timeZone: r.schedule.timeZone || CALENDAR_TZ, mode: "", requiredHours: null } as any, day) : null;
          const a = r.attendance;
          const row: AttendanceDay = {
            shift: shift ? { from: shift.from, to: shift.to, assigned: r.schedule.assigned !== false } : null,
            workDay: r.workDay === true,
            status: a?.status ?? (r.leave ? "on_leave" : r.workDay && day < todayInDubai() ? "absent" : ""),
            firstIn: a?.firstIn ?? null, lastOut: a?.lastOut ?? null,
            workedMinutes: Number(a?.workedMinutes) || 0, lateMinutes: Number(a?.lateMinutes) || 0,
            sessions: a?.sessions ?? [],
            leave: r.leave ? { type: r.leave.type, half: r.leave.halfDay === true } : null,
            wfh: r.wfh === true,
          };
          const mine = byEmail.get(email) ?? new Map<string, AttendanceDay>();
          mine.set(day, row);
          byEmail.set(email, mine);
        }
      });
    }
  } catch (err) {
    return { configured: true, available: false, message: err instanceof Error ? err.message : "The HRMS could not be asked", byEmail: new Map() };
  }
  return { configured: true, available: true, byEmail };
}

/** A person's days added up: late clock-ins (and their minutes), days present, absent, on leave, worked minutes. */
export function attendanceTotal(days: Iterable<AttendanceDay>) {
  const t = { lateClockIns: 0, lateClockInMinutes: 0, daysPresent: 0, daysAbsent: 0, daysLeave: 0, workedMinutes: 0 };
  for (const d of days) {
    if (d.lateMinutes > 0) { t.lateClockIns++; t.lateClockInMinutes += d.lateMinutes; }
    if (d.firstIn) t.daysPresent++;
    else if (d.leave || d.status === "on_leave") t.daysLeave++;
    else if (d.status === "absent") t.daysAbsent++;
    t.workedMinutes += d.workedMinutes;
  }
  return t;
}
