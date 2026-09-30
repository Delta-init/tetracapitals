import { json, error } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { callLms, LmsError } from "../lib/lms";

/* ────────────────────────────────────────────────────────────────────────────
   The Mentor Calendar — the Sales CRM's, ported: the academy's mentors, when
   they are free and what is booked, and booking time with one. The LMS is the
   only record; this passes through, so a booking made here, in the CRM or in
   the Root portal is the same booking. Open to everyone signed in.

   Who booked a meeting, or who is asking, is always the signed-in person —
   never taken from the request. Super Admins may change anyone's, as the
   CRM's super admin can; everyone else only their own (the LMS checks).
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

/** POST /api/functions/getMentorSchedule { from?, to? } → { timezone, from, to, mentors } */
export async function getMentorSchedule(req: Request, _user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const from = body?.from ? new Date(body.from) : new Date();
  if (Number.isNaN(from.getTime())) return error("from is not a date", 400);
  const to = body?.to ? new Date(body.to) : new Date(from.getTime() + 7 * 864e5);
  if (Number.isNaN(to.getTime())) return error("to is not a date", 400);
  if (to <= from) return error("to must be after from", 400);
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 864e5) return error(`At most ${MAX_WINDOW_DAYS} days at a time`, 400);
  return lms(async () => {
    const data: any = await callLms("/mentors", { query: { from: from.toISOString(), to: to.toISOString() }, verb: "list its mentors" });
    return {
      timezone: data?.timezone || "",
      from: data?.from || from.toISOString(),
      to: data?.to || to.toISOString(),
      mentors: (data?.mentors ?? []).map((m: any) => ({ ...m, slots: m.slots ?? [], classes: m.classes ?? [], meetings: m.meetings ?? [] })),
    };
  });
}

/** POST /api/functions/getMentorClass { classId } — one of this academy's live classes, read-only. */
export async function getMentorClass(req: Request, _user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const classId = str(body?.classId, 100);
  if (!classId) return error("classId is required", 400);
  return lms(() => callLms(`/classes/${encodeURIComponent(classId)}`, { verb: "describe that class" }));
}

/** POST /api/functions/bookMentorMeeting { mentorEmail, title, kind, scheduledStart, durationMins, attendees, meetingUrl?, notes? } */
export async function bookMentorMeeting(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const mentorEmail = str(body?.mentorEmail, 200);
  if (!mentorEmail) return error("Choose a mentor", 400);
  return lms(() =>
    callLms("/mentor-meetings", {
      method: "POST",
      verb: "book that meeting",
      body: {
        mentorEmail,
        title: str(body?.title, 200),
        kind: str(body?.kind, 20),
        scheduledStart: str(body?.scheduledStart, 40),
        durationMins: Number(body?.durationMins ?? 0),
        meetingUrl: body?.meetingUrl ? str(body.meetingUrl, 500) : undefined,
        attendees: attendeesOf(body?.attendees),
        notes: body?.notes ? str(body.notes) : undefined,
        bookedByEmail: user.email,
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
  return lms(() =>
    callLms(`/mentor-meetings/${encodeURIComponent(meetingId)}`, {
      method: "PATCH",
      verb: "change that meeting",
      body: {
        ...(has("title") ? { title: str(body.title, 200) } : {}),
        ...(has("kind") ? { kind: str(body.kind, 20) } : {}),
        ...(has("scheduledStart") ? { scheduledStart: str(body.scheduledStart, 40) } : {}),
        ...(has("durationMins") ? { durationMins: Number(body.durationMins) } : {}),
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
