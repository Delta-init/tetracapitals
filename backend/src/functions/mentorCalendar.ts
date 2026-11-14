import { json, error } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { callLms, LmsError } from "../lib/lms";
import { mentorHours } from "../students/mentorHours";
import { col } from "../db";
import { toObjectId } from "../lib/id";
import { getDownlineIds } from "../lib/scope";
import { isAdmin } from "../students/followups";
import { ASKS_FOR_MEETINGS } from "./meetingRequests";

/* ────────────────────────────────────────────────────────────────────────────
   The Mentor Calendar — the Sales CRM's, ported: the academy's mentors, when
   they are free and what is booked, and booking time with one. The LMS is the
   only record; this passes through, so a booking made here, in the CRM or in
   the Root portal is the same booking. Open to everyone signed in.

   Who booked a meeting, or who is asking, is always the signed-in person —
   never taken from the request. Super Admins may change anyone's, as the
   CRM's super admin can; everyone else only their own (the LMS checks).

   Time off (the user, 2026-10-23): a mentor marks when they're not available
   and nobody books them then — here, in the LMS or the CRMs (the LMS refuses
   it). Marked for themselves, by a chief mentor for their team, by an admin
   for anyone. The reason is shown to the same people; everyone else sees
   "Not available".
──────────────────────────────────────────────────────────────────────────── */

/** Longest window the LMS answers for. */
const MAX_WINDOW_DAYS = 62;
const str = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);
const isRootAdmin = (user: AuthUser) => user.app_role === "super_admin";

/** The people on a meeting: rows with a name (a half-typed row is not somebody to invite). */
const attendeesOf = (v: unknown) =>
  (Array.isArray(v) ? v : [])
    .map((a: any) => ({ name: str(a?.name, 200), email: str(a?.email, 200) }))
    .filter((a) => a.name.length > 0);

async function lms(run: () => Promise<unknown>): Promise<Response> {
  try {
    return json(await run());
  } catch (err) {
    if (err instanceof LmsError) return error(err.message, err.status);
    throw err;
  }
}

/**
 * Whose time off this person marks — and reads the reason of: null for anyone (an admin), else these addresses —
 * their own, and a chief mentor's team too.
 */
async function timeOffReach(user: AuthUser): Promise<Set<string> | null> {
  if (isAdmin(user)) return null;
  const mine = new Set([String(user.email ?? "").trim().toLowerCase()].filter(Boolean));
  if (user.app_role !== "chief_mentor") return mine;
  const ids = (await getDownlineIds(user.id)).map(toObjectId).filter(Boolean) as any[];
  const team = (await col("users").find({ _id: { $in: ids } }, { projection: { email: 1 } }).toArray()) as any[];
  for (const u of team) if (u.email) mine.add(String(u.email).trim().toLowerCase());
  return mine;
}
const reaches = (reach: Set<string> | null, email: unknown) => reach === null || reach.has(String(email ?? "").trim().toLowerCase());

/* ── Staff meetings (the user, 2026-11-14) ───────────────────────────────────
   "An option in meeting with: staff meeting, only for the Chief… staff can be
   selected; if they have a meeting at that time it shows the specific mentor."
   A Chief Mentor books one meeting with several mentors of their team in it;
   an admin, with anyone. The LMS keeps them on the meeting, checks each one's
   diary (refusing with whoever is in the way, by name), shows it on each
   calendar and tells each. Who may name whom is decided here — the same reach
   as marking time off: one's own team. */
const mayBookStaffMeeting = (user: AuthUser) => user.app_role === "chief_mentor" || isAdmin(user);
const emailsOf = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((e) => str(e, 200).toLowerCase()).filter(Boolean))].slice(0, 30);

/**
 * The mentors named for a staff meeting, once this person may book one with them: a sentence when they may not.
 * `mentorEmail`: whose meeting it is — one of the team too, unless it is the person's own.
 */
async function staffFor(user: AuthUser, staffEmails: string[], mentorEmail: string, kind: string): Promise<string | null> {
  if (!staffEmails.length) return null;
  if (!mayBookStaffMeeting(user)) return "Only a Chief Mentor books a staff meeting";
  if (kind !== "staff") return "A staff meeting is a meeting with staff";
  const reach = await timeOffReach(user);
  const outside = [mentorEmail, ...staffEmails].filter((e) => e && !reaches(reach, e));
  return outside.length ? `Not in your team: ${outside.join(", ")}` : null;
}

/**
 * POST /api/functions/getMentorSchedule { from?, to? } → { timezone, from, to, hrms, mentors }
 * Each mentor with `work` — their HRMS working hours and leave in Dubai time (students/mentorHours.ts), or null when
 * the HRMS does not know their email; `hrms` says whether it was asked and answered.
 */
export async function getMentorSchedule(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const from = body?.from ? new Date(body.from) : new Date();
  if (Number.isNaN(from.getTime())) return error("from is not a date", 400);
  const to = body?.to ? new Date(body.to) : new Date(from.getTime() + 7 * 864e5);
  if (Number.isNaN(to.getTime())) return error("to is not a date", 400);
  if (to <= from) return error("to must be after from", 400);
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 864e5) return error(`At most ${MAX_WINDOW_DAYS} days at a time`, 400);
  return lms(async () => {
    // Both academies' mentors — Dubai's and Bangalore's (the user, 2026-10-15); an LMS before that sends its own only.
    const data: any = await callLms("/mentors", { query: { from: from.toISOString(), to: to.toISOString(), allAcademies: "1", timeOffReasons: "all" }, verb: "list its mentors" });
    // Time off with its reason only for whom it's theirs to mark; may_mark_time_off says so to the page.
    const reach = await timeOffReach(user);
    // A staff meeting (2026-11-14): whether this person books one, and with which of the mentors (their team's).
    const staffMeetings = mayBookStaffMeeting(user);
    const mentors = (data?.mentors ?? []).map((m: any) => {
      const mine = reaches(reach, m.email);
      return {
        ...m, slots: m.slots ?? [], classes: m.classes ?? [], meetings: m.meetings ?? [],
        timeOff: (m.timeOff ?? []).map((t: any) => ({ ...t, reason: mine ? t.reason ?? "" : null })),
        may_mark_time_off: mine,
        may_invite: staffMeetings && mine,
      };
    });
    const hours = await mentorHours(mentors.map((m: any) => m.email), from, to);
    return {
      timezone: data?.timezone || "",
      from: data?.from || from.toISOString(),
      to: data?.to || to.toISOString(),
      hrms: { configured: hours.configured, available: hours.available, ...(hours.message ? { message: hours.message } : {}) },
      may_staff_meeting: staffMeetings,
      mentors: mentors.map((m: any) => ({ ...m, work: hours.byEmail.get(String(m.email ?? "").trim().toLowerCase()) ?? null })),
    };
  });
}

/** POST /api/functions/getMentorClass { classId } — one of this academy's live classes, read-only. */
export async function getMentorClass(req: Request, _user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const classId = str(body?.classId, 100);
  if (!classId) return error("classId is required", 400);
  // contacts=1: each student's booking and address — the card's "Send join link" (2026-10-29).
  return lms(() => callLms(`/classes/${encodeURIComponent(classId)}`, { query: { contacts: "1" }, verb: "describe that class" }));
}

/**
 * POST /api/functions/bookMentorMeeting { mentorEmail, title, kind, scheduledStart, durationMins, attendees,
 *   inPerson?, location? (where, when in person), meetingUrl? (online only), notes?,
 *   staffEmails? (a staff meeting's other mentors — a Chief Mentor's team, an admin anyone) }
 */
export async function bookMentorMeeting(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const mentorEmail = str(body?.mentorEmail, 200);
  if (!mentorEmail) return error("Choose a mentor", 400);
  // A Senior / Junior / Sub-junior Mentor asks for a student meeting; its CS picks the time (meetingRequests.ts, 2026-11-09).
  if (ASKS_FOR_MEETINGS.has(user.app_role) && str(body?.kind, 20) === "student") {
    return error("Send a meeting request — the student's CS picks the time and approves it", 403);
  }
  // A staff meeting (2026-11-14): the other mentors in it, once this person may book one with them.
  const staffEmails = emailsOf(body?.staffEmails).filter((e) => e !== mentorEmail.toLowerCase());
  const refused = await staffFor(user, staffEmails, mentorEmail.toLowerCase(), str(body?.kind, 20));
  if (refused) return error(refused, 403);
  const inPerson = body?.inPerson === true;
  return lms(() =>
    callLms("/mentor-meetings", {
      method: "POST",
      verb: "book that meeting",
      body: {
        mentorEmail,
        title: str(body?.title, 200),
        kind: str(body?.kind, 20),
        // What it's for (2026-10-25): course_pitch | overview | other, or none.
        category: str(body?.category, 20),
        // A Course Upgradation meeting's course (2026-11-09).
        course: str(body?.category, 20) === "course_upgrade" ? str(body?.course, 60) : undefined,
        scheduledStart: str(body?.scheduledStart, 40),
        durationMins: Number(body?.durationMins ?? 0),
        // In person: a place, and no link (the LMS makes no Google Meet for it).
        inPerson,
        location: inPerson ? str(body?.location, 300) : undefined,
        meetingUrl: !inPerson && body?.meetingUrl ? str(body.meetingUrl, 500) : undefined,
        attendees: attendeesOf(body?.attendees),
        ...(staffEmails.length ? { staffEmails } : {}),
        // Either academy's mentor (2026-10-15) — the calendar lists both.
        allAcademies: true,
        notes: body?.notes ? str(body.notes) : undefined,
        bookedByEmail: user.email,
        // A student meeting booked here: its mentor says how it went once it is over (students/meetingOutcomes.ts).
        askOutcome: true,
      },
    }),
  );
}

/** POST /api/functions/getMentorMeeting { meetingId } — in full, for whoever may change it (the LMS decides). */
export async function getMentorMeeting(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const meetingId = str(body?.meetingId, 100);
  if (!meetingId) return error("meetingId is required", 400);
  return lms(() =>
    callLms(`/mentor-meetings/${encodeURIComponent(meetingId)}`, {
      query: { actorEmail: user.email, actorIsRootAdmin: String(isRootAdmin(user)) },
      verb: "describe that meeting",
    }),
  );
}

/** POST /api/functions/updateMentorMeeting { meetingId, …what changes } — move it, or change who is on it. */
export async function updateMentorMeeting(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const meetingId = str(body?.meetingId, 100);
  if (!meetingId) return error("meetingId is required", 400);
  const has = (k: string) => body?.[k] !== undefined;
  // A staff meeting's mentors changed (2026-11-14): who is in it now — all of them reachable by this person. An empty
  // list takes everybody off, which anybody who may change the meeting may do.
  const staffEmails = Array.isArray(body?.staffEmails) ? emailsOf(body.staffEmails) : null;
  if (staffEmails?.length) {
    const refused = await staffFor(user, staffEmails, "", "staff");
    if (refused) return error(refused, 403);
  }
  return lms(() =>
    callLms(`/mentor-meetings/${encodeURIComponent(meetingId)}`, {
      method: "PATCH",
      verb: "change that meeting",
      body: {
        ...(staffEmails ? { staffEmails, allAcademies: true } : {}),
        ...(has("title") ? { title: str(body.title, 200) } : {}),
        ...(has("kind") ? { kind: str(body.kind, 20) } : {}),
        ...(has("category") ? { category: str(body.category, 20) } : {}),
        ...(has("course") ? { course: str(body.course, 60) } : {}),
        ...(has("scheduledStart") ? { scheduledStart: str(body.scheduledStart, 40) } : {}),
        ...(has("durationMins") ? { durationMins: Number(body.durationMins) } : {}),
        ...(has("inPerson") ? { inPerson: body.inPerson === true } : {}),
        ...(has("location") ? { location: str(body.location, 300) } : {}),
        ...(has("meetingUrl") ? { meetingUrl: str(body.meetingUrl, 500) } : {}),
        ...(has("notes") ? { notes: str(body.notes) } : {}),
        ...(Array.isArray(body?.attendees) ? { attendees: attendeesOf(body.attendees) } : {}),
        actorEmail: user.email,
        actorIsRootAdmin: isRootAdmin(user),
      },
    }),
  );
}

/** POST /api/functions/cancelMentorMeeting { meetingId } — the LMS marks it cancelled and emails everybody. */
export async function cancelMentorMeeting(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const meetingId = str(body?.meetingId, 100);
  if (!meetingId) return error("meetingId is required", 400);
  return lms(() =>
    callLms(`/mentor-meetings/${encodeURIComponent(meetingId)}/cancel`, {
      method: "POST",
      verb: "cancel that meeting",
      body: { actorEmail: user.email, actorIsRootAdmin: isRootAdmin(user) },
    }),
  );
}

/**
 * POST /api/functions/markMentorTimeOff { mentorEmail, startsAt, endsAt, allDay?, reason? }
 *   → { timeOff, mentor, alreadyBooked } — what was already booked inside it stays; the page shows it.
 * Their own; a chief mentor their team's; an admin anyone's.
 */
export async function markMentorTimeOff(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const mentorEmail = str(body?.mentorEmail, 200).toLowerCase();
  if (!mentorEmail) return error("Choose a mentor", 400);
  if (!reaches(await timeOffReach(user), mentorEmail)) return error("You can mark only your own time off — or your team's, as their chief mentor", 403);
  return lms(() =>
    callLms("/mentor-time-off", {
      method: "POST",
      verb: "mark that time off",
      body: {
        mentorEmail,
        startsAt: str(body?.startsAt, 40),
        endsAt: str(body?.endsAt, 40),
        allDay: body?.allDay === true,
        reason: str(body?.reason, 300),
        byEmail: user.email,
        byName: user.full_name || user.email,
      },
    }),
  );
}

/** POST /api/functions/removeMentorTimeOff { mentorEmail, timeOffId } — the same people as marking it. */
export async function removeMentorTimeOff(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const mentorEmail = str(body?.mentorEmail, 200).toLowerCase();
  const timeOffId = str(body?.timeOffId, 100);
  if (!mentorEmail || !timeOffId) return error("mentorEmail and timeOffId are required", 400);
  if (!reaches(await timeOffReach(user), mentorEmail)) return error("You can take away only your own time off — or your team's, as their chief mentor", 403);
  return lms(() =>
    callLms(`/mentor-time-off/${encodeURIComponent(timeOffId)}/remove`, { method: "POST", verb: "take that time off away", body: { mentorEmail } }),
  );
}
