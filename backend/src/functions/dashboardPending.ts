import { json, error, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { isAdmin, visibleMentorIds } from "../students/followups";
import { csManagerReach } from "../lib/userLocation";
import { callLms, lmsConfigured, LmsError } from "../lib/lms";
import { csPending, NO_CS } from "../portal/csPending";
import { csReportForPortal } from "../portal/csReport";

/* ────────────────────────────────────────────────────────────────────────────
   The Root portal's CS pending and CS report on this portal's Dashboard, and
   what waits on the mentors (the user, 2026-10-28) — for those who look after
   CSs, each their own CSs only:

     Super Admin (admin roles)  every CS · Dubai and Bangalore
     CS Manager                 their location's CSs
     Chief Mentor               their own team's CSs

   CS pending is Root's (portal/csPending.ts), worked out for everyone once a
   minute and cut to the viewer's CSs — their rows, their students' lists, and
   totals from those lists (a student shared by two of them counted once). The
   CS report is Root's (portal/csReport.ts) with the viewer's reach. Mentors
   pending (Super Admins and Chief Mentors — every mentor, as the Mentor
   Report): the LMS's /service/mentor-pending. Read only.
──────────────────────────────────────────────────────────────────────────── */

type Reach = { kind: "all" } | { kind: "some"; ids: Set<string>; location: "dubai" | "bangalore" | null } | { kind: "none" };

/** Whose CSs: everyone's, these people's, or nobody's (anyone who doesn't look after CSs). */
async function reachOf(user: AuthUser): Promise<Reach> {
  if (isAdmin(user)) return { kind: "all" };
  const manager = await csManagerReach(user);
  if (manager) return { kind: "some", ids: new Set(manager.ids), location: manager.location };
  if (user.app_role !== "chief_mentor") return { kind: "none" };
  const visible = await visibleMentorIds(user);
  return visible ? { kind: "some", ids: visible, location: null } : { kind: "all" };
}
const seesMentors = (user: AuthUser) => isAdmin(user) || user.app_role === "chief_mentor";

let kept: { at: number; data: Awaited<ReturnType<typeof csPending>> } | null = null;
async function everyonesPending() {
  if (kept && kept.at > Date.now() - 60_000) return kept.data;
  const data = await csPending();
  kept = { at: Date.now(), data };
  return data;
}

/** POST /api/functions/getDashboardCsPending → Root's CS pending, the viewer's CSs only; { scope } says whose. */
export async function getDashboardCsPending(_req: Request, user: AuthUser): Promise<Response> {
  const reach = await reachOf(user);
  if (reach.kind === "none") return forbidden("Only for those who look after CSs");
  const all = await everyonesPending();
  if (reach.kind === "all") return json({ ...all, scope: "all", sees_mentors: seesMentors(user) });

  const mine = (row: { csIds: string[] }) => row.csIds.some((id) => id !== NO_CS && reach.ids.has(id));
  const items = Object.fromEntries(Object.entries(all.items).map(([k, rows]) => [k, (rows as any[]).filter(mine)])) as typeof all.items;
  const people = all.people.filter((p) => reach.ids.has(p.id));
  // The totals from the lists: each student once, however many of these CSs share them.
  const t = {
    onboarding: items.onboarding.length, onboarding_late: items.onboarding.filter((r: any) => r.late).length,
    bonus: items.bonus.reduce((n: number, r: any) => n + r.count, 0), bonus_usd: Math.round(items.bonus.reduce((n: number, r: any) => n + (r.usd || 0), 0) * 100) / 100,
    bonus_sent_back: 0, bonus_after_payment: 0, bonus_needs_call: 0, bonus_with_finance: 0, bonus_waiting_broker: 0,
    tickets_open: items.tickets.filter((r: any) => r.status !== "waiting_on_student").length, tickets_waiting: items.tickets.filter((r: any) => r.status === "waiting_on_student").length,
    followups_today: items.followups.filter((r: any) => !r.overdue).length, followups_overdue: items.followups.filter((r: any) => r.overdue).length,
    completions: items.completions.length,
  } as Record<string, number>;
  for (const r of items.bonus as any[]) for (const [k, v] of Object.entries(r.stages ?? {})) t[`bonus_${k}`] = (t[`bonus_${k}`] ?? 0) + ((v as any)?.count ?? 0);
  const total = t.onboarding! + t.bonus! + t.tickets_open! + t.tickets_waiting! + t.followups_today! + t.followups_overdue! + t.completions!;
  return json({
    today: all.today, generatedAt: all.generatedAt, tickets: all.tickets,
    totals: { ...t, total }, totalsByLocation: null, people, noCs: null, items,
    scope: reach.location ? "location" : "team", location: reach.location, sees_mentors: seesMentors(user),
  });
}

/** POST /api/functions/getDashboardCsReport { period | from, to, location?, team?, cs? } → Root's CS report, the viewer's CSs. */
export async function getDashboardCsReport(req: Request, user: AuthUser): Promise<Response> {
  const reach = await reachOf(user);
  if (reach.kind === "none") return forbidden("Only for those who look after CSs");
  const body: any = await req.json().catch(() => ({}));
  const q: Record<string, string | undefined> = {};
  for (const k of ["period", "from", "to", "location", "team", "cs"]) if (body?.[k]) q[k] = String(body[k]).slice(0, 40);
  const report = await csReportForPortal(q, reach.kind === "all" ? { reach: null, lockedLocation: null } : { reach: reach.ids, lockedLocation: reach.location });
  return typeof report === "string" ? error(report, 400) : json(report);
}

/** POST /api/functions/getDashboardMentorPending → every mentor's outcome forms, classes to verify and unread messages (LMS). */
export async function getDashboardMentorPending(_req: Request, user: AuthUser): Promise<Response> {
  if (!seesMentors(user)) return forbidden("Only for Super Admins and Chief Mentors");
  if (!lmsConfigured()) return json({ available: false, message: "The LMS isn't linked to this server", mentors: [] });
  try {
    const r = (await callLms("/mentor-pending", { verb: "share what waits on the mentors" })) as any;
    return json({ available: true, generatedAt: r?.generatedAt ?? null, mentors: Array.isArray(r?.mentors) ? r.mentors : [] });
  } catch (err) {
    const message = err instanceof LmsError && /route \S+ \S+ not found|cannot get|not found/i.test(err.message) ? "Mentors pending needs the LMS update" : err instanceof Error ? err.message : "The LMS did not answer";
    return json({ available: false, message, mentors: [] });
  }
}
