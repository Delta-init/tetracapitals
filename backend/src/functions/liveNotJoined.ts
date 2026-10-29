import { col } from "../db";
import { json, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { callLms, lmsConfigured, LmsError } from "../lib/lms";
import { isAdmin, canEditAny, visibleMentorIds, isStudentOf } from "../students/followups";
import { csManagerReach } from "../lib/userLocation";

/* ────────────────────────────────────────────────────────────────────────────
   Booked but not joined (the user, 2026-10-28): while an LMS class runs, the
   students who booked it and haven't joined yet — a popup at class time and
   the "Not joined yet" page. Today's online classes that have started (LMS
   /service/live-not-joined: "joined" = the LMS room join or the join-link
   click); `live` while the timetable says it runs, a no-show after.

   Whose:
     Super Admin / Admin   every class
     CS                    their students (Common ones too)
     CS Manager            their location's CSs' students
     Chief Mentor          their team's students, and every student of a class
                           their team's mentors teach
     senior / junior / sub-junior mentor   the same, their team (as the follow-ups)
   Each student is matched to this portal's student by email, whatever its case.
   Read only.
──────────────────────────────────────────────────────────────────────────── */

export const LIVE_NOT_JOINED_ROLES = new Set(["cs", "cs_manager", "chief_mentor", "senior_mentor", "junior_mentor", "subjunior_mentor"]);
/** Super Admin / Admin and the roles above — not finance or the brokers. */
const may = (user: AuthUser) => canEditAny(user) || LIVE_NOT_JOINED_ROLES.has(user.app_role);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type LmsClass = {
  id: string; title: string; course: string; language: string; startsAt: string; endsAt: string; live: boolean;
  mentor: { name: string; email: string } | null; coMentors: { name: string; email: string }[];
  booked: number; joined: number;
  notJoined: { bookingId: string; name: string; email: string; phone: string; bookedAt: string | null }[];
};

/** Whose people: null = everyone; else these user ids (themselves included). */
async function reachOf(user: AuthUser): Promise<Set<string> | null> {
  if (isAdmin(user)) return null;
  const manager = await csManagerReach(user);
  if (manager) return new Set([user.id, ...manager.ids]);
  return (await visibleMentorIds(user)) ?? null;
}

export type LiveLoad = { day: string | null; classes: LmsClass[]; studentOf: Map<string, any>; userIdOf: Map<string, string> };

/** The LMS's answer and its students and mentors here, once — for the page and the push (students/liveNotJoinedPush.ts). Throws when the LMS doesn't answer. */
export async function loadLiveNotJoined(): Promise<LiveLoad> {
  const lms = (await callLms("/live-not-joined", { verb: "share who hasn't joined the live classes" })) as { day: string; classes: LmsClass[] };
  const classes = Array.isArray(lms?.classes) ? lms.classes : [];

  // Their portal student, by email.
  const emails = [...new Set(classes.flatMap((c) => c.notJoined.map((s) => s.email)).filter((e) => e.includes("@")))];
  const students = emails.length
    ? ((await col("students").find(
        { email: { $in: emails.map((e) => new RegExp(`^\\s*${esc(e)}\\s*$`, "i")) } },
        { projection: { full_name: 1, student_code: 1, phone: 1, email: 1, primary_mentor_id: 1, primary_mentor_name: 1, common_cs: 1, team_name: 1 } },
      ).toArray()) as any[])
    : [];
  const studentOf = new Map<string, any>();
  for (const s of students) {
    const e = String(s.email ?? "").trim().toLowerCase();
    if (!studentOf.has(e)) studentOf.set(e, s);
  }

  // The mentors here, by email — whose team a class is.
  const mentorEmails = [...new Set(classes.flatMap((c) => [c.mentor, ...c.coMentors]).map((m) => m?.email).filter(Boolean) as string[])];
  const mentors = mentorEmails.length
    ? ((await col("users").find({ email: { $in: mentorEmails.map((e) => new RegExp(`^\\s*${esc(e)}\\s*$`, "i")) } }, { projection: { email: 1 } }).toArray()) as any[])
    : [];
  const userIdOf = new Map(mentors.map((u) => [String(u.email ?? "").trim().toLowerCase(), String(u._id)]));
  return { day: lms?.day ?? null, classes, studentOf, userIdOf };
}

/** The classes as this person sees them: only their students (or all of a class their team teaches), classes with nobody missing left out. */
export async function liveNotJoinedFor(user: AuthUser, { classes, studentOf, userIdOf }: LiveLoad) {
  const reach = await reachOf(user);
  return classes.map((c) => {
    const teachers = [c.mentor, ...c.coMentors].map((m) => (m ? userIdOf.get(m.email) : undefined)).filter(Boolean) as string[];
    const ours = !reach || teachers.some((id) => reach.has(id));
    const rows = c.notJoined.map((s) => {
      const st = studentOf.get(s.email);
      return {
        ...s,
        student: st ? { id: String(st._id), code: st.student_code ?? "", name: st.full_name ?? "", phone: st.phone ?? "", cs_id: st.primary_mentor_id ?? "", cs_name: st.primary_mentor_name ?? "", team: st.team_name ?? "" } : null,
        mine: !!st && !!reach && isStudentOf(st, new Set([user.id])),
        _ok: ours || (!!st && !!reach && isStudentOf(st, reach)),
      };
    }).filter((r) => r._ok).map(({ _ok, ...r }) => r);
    return { ...c, teaches: teachers.includes(user.id), team_class: ours && !!reach, notJoined: rows };
  }).filter((c) => c.notJoined.length);
}

/** POST /api/functions/getLiveNotJoined → { available, day, classes, counts: { live, students, live_students } } */
export async function getLiveNotJoined(_req: Request, user: AuthUser): Promise<Response> {
  if (!may(user)) return forbidden("Only for CSs, CS Managers, mentors and Super Admins");
  const empty = { day: null, classes: [], counts: { live: 0, students: 0, live_students: 0 } };
  if (!lmsConfigured()) return json({ available: false, message: "The LMS isn't linked to this server", ...empty });
  let load: LiveLoad;
  try {
    load = await loadLiveNotJoined();
  } catch (err) {
    const message = err instanceof LmsError && /route \S+ \S+ not found|cannot get|not found/i.test(err.message) ? "This needs the LMS update" : err instanceof Error ? err.message : "The LMS did not answer";
    return json({ available: false, message, ...empty });
  }
  const out = await liveNotJoinedFor(user, load);
  const live = out.filter((c) => c.live);
  return json({
    available: true, day: load.day, generatedAt: new Date().toISOString(), classes: out,
    counts: { live: live.length, students: out.reduce((n, c) => n + c.notJoined.length, 0), live_students: live.reduce((n, c) => n + c.notJoined.length, 0) },
  });
}
