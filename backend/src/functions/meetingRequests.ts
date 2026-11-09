import { json, error, forbidden, notFound } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { callLms, LmsError } from "../lib/lms";
import { col } from "../db";
import { toObjectId } from "../lib/id";
import { notify } from "../lib/notify";
import { csManagerReach, locationOfUser } from "../lib/userLocation";
import { IS_STUDENT } from "../students/notStudent";

/* ────────────────────────────────────────────────────────────────────────────
   Meeting requests (the user, 2026-11-09): a Senior, Junior or Sub-junior
   Mentor doesn't book a student meeting — they ask for one, and the student's
   CS decides. The mentor names the student (any team), what it's for (the
   category, and the course for a Course Upgradation), online or in person, how
   long, and a note; never the time. The CS — or a CS Manager, or a Super
   Admin — picks the date and time and approves: only then is it booked in the
   LMS (its Meet link and emails), with the mentor; or rejects it, with a
   reason. Chiefs, CSs and CS Managers book straight away, as before.

   Who decides: the student's CS (and a CS they are Common with); any CS
   Manager of that location; Super Admins. A student with no CS: the CS
   Managers. A request waiting 4 hours reminds them once
   (MEETING_REQUEST_REMINDERS=off to keep a server out of it).
──────────────────────────────────────────────────────────────────────────── */

/** Who asks rather than books. */
export const ASKS_FOR_MEETINGS = new Set(["senior_mentor", "junior_mentor", "subjunior_mentor"]);
const ADMINS = new Set(["super_admin", "admin"]);
const CATEGORIES = new Set(["course_pitch", "overview", "other", "course_upgrade"]);
const REMIND_AFTER_MS = 4 * 3600_000;
const str = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);
const nowIso = () => new Date().toISOString();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Requests this person may decide: null = every one; else the filter. */
async function decidesFilter(user: AuthUser): Promise<Record<string, unknown> | false> {
  if (ADMINS.has(user.app_role)) return {};
  if (user.app_role === "cs_manager") {
    const reach = await csManagerReach(user);
    return { $or: [{ cs_ids: { $in: reach?.ids ?? [] } }, { cs_ids: { $size: 0 }, location: reach?.location ?? "dubai" }] };
  }
  if (user.app_role === "cs") return { cs_ids: user.id };
  return false;
}
async function mayDecide(user: AuthUser, r: any): Promise<boolean> {
  const f = await decidesFilter(user);
  if (f === false) return false;
  return (await col("meeting_requests").countDocuments({ _id: r._id, ...f })) === 1;
}

const out = (r: any) => ({
  id: String(r._id), number: r.number ?? `MR-${String(r._id).slice(-5).toUpperCase()}`, status: r.status,
  blocked: r.blocked ?? null, override_reason: r.override_reason ?? "", override_by_name: r.override_by_name ?? "", student: { id: r.student_id, name: r.student_name, code: r.student_code ?? "", cs_name: r.cs_name ?? "" },
  mentor: { id: r.mentor_id, name: r.mentor_name, email: r.mentor_email }, category: r.category ?? "", course: r.course ?? "",
  duration_mins: r.duration_mins, in_person: !!r.in_person, location: r.location_text ?? "", notes: r.notes ?? "",
  // "cs": the mentor left online or in person to the CS, to confirm with the student (2026-11-09).
  mode: r.booked_mode ?? r.mode ?? (r.in_person ? "offline" : "online"),
  requested_at: r.requested_at, scheduled_start: r.scheduled_start ?? null, decided_at: r.decided_at ?? null, decided_by_name: r.decided_by_name ?? "",
  reason: r.reason ?? "", lms_meeting_id: r.lms_meeting_id ?? null, title: r.title ?? "",
});

/** Who decides a student's requests: their CS and the CSs they are Common with. */
function csIdsOf(s: any): string[] {
  const ids = [String(s?.primary_mentor_id ?? ""), ...(Array.isArray(s?.common_cs) ? s.common_cs.map((c: any) => String(c?.id ?? "")) : [])];
  return [...new Set(ids.filter(Boolean))];
}
/** The CS Managers of a location — told when a request has no CS, and reminded with the CS. */
async function csManagersOf(location: string): Promise<string[]> {
  const managers = (await col("users").find({ app_role: "cs_manager", status: { $ne: "inactive" } }, { projection: { _id: 1 } }).toArray()) as any[];
  const ids: string[] = [];
  for (const m of managers) if ((await locationOfUser(String(m._id))) === location) ids.push(String(m._id));
  return ids;
}

/* ── The 7-day rule (the user, 2026-11-09): a meeting with the student by ANOTHER mentor — held, or booked ahead — in
   the last 7 days blocks a new request; it can be asked for 7 days after that meeting. The same mentor may ask again.
   The meetings: the LMS's student meetings booked from this portal (by the student's email — the CS's and Chiefs'
   direct bookings too), the outcomes mentors filled in, and the requests approved here. ── */
const WEEK_MS = 7 * 864e5;
const isManager = (user: AuthUser) => ADMINS.has(user.app_role) || user.app_role === "cs_manager";
interface StudentMeeting { id: string; mentor_email: string; mentor_name: string; at: string; status: string; outcome: string }

async function studentMeetings(studentId: string, email: string): Promise<{ meetings: StudentMeeting[]; lms: boolean }> {
  const byId = new Map<string, StudentMeeting>();
  let lms = false;
  if (email.includes("@")) {
    try {
      const d: any = await callLms("/meeting-outcomes/meetings", { query: { emails: email.toLowerCase() }, verb: "list the student's meetings" });
      lms = true;
      for (const m of d?.meetings ?? []) {
        if (m.status === "cancelled") continue;
        byId.set(String(m.id), { id: String(m.id), mentor_email: String(m.mentor?.email ?? "").toLowerCase(), mentor_name: m.mentor?.name ?? "", at: m.startsAt, status: m.status === "upcoming" ? "upcoming" : "held", outcome: m.outcome?.stage ?? "" });
      }
    } catch { /* the LMS is down: what this portal knows still counts */ }
  }
  const [outcomes, approved] = await Promise.all([
    col("meeting_outcomes").find({ student_ids: studentId }, { projection: { meeting: 1, mentor: 1, outcome: 1 } }).toArray(),
    col("meeting_requests").find({ student_id: studentId, status: "approved" }, { projection: { lms_meeting_id: 1, mentor_email: 1, mentor_name: 1, scheduled_start: 1 } }).toArray(),
  ]);
  for (const o of outcomes as any[]) {
    const id = String(o.meeting?.id ?? o._id);
    if (!byId.has(id) && o.meeting?.starts_at) byId.set(id, { id, mentor_email: String(o.mentor?.email ?? "").toLowerCase(), mentor_name: o.mentor?.name ?? "", at: o.meeting.starts_at, status: "held", outcome: o.outcome?.stage ?? "" });
  }
  for (const a of approved as any[]) {
    const id = String(a.lms_meeting_id || a._id);
    if (!byId.has(id) && a.scheduled_start) byId.set(id, { id, mentor_email: String(a.mentor_email ?? "").toLowerCase(), mentor_name: a.mentor_name ?? "", at: a.scheduled_start, status: new Date(a.scheduled_start).getTime() > Date.now() ? "upcoming" : "held", outcome: "" });
  }
  return { meetings: [...byId.values()].sort((x, y) => String(y.at).localeCompare(String(x.at))), lms };
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dubai" });
export async function eligibilityOf(studentId: string, email: string, mentorEmail: string, now = Date.now()) {
  const { meetings, lms } = await studentMeetings(studentId, email);
  const me = mentorEmail.trim().toLowerCase();
  const conflict = meetings.filter((m) => m.mentor_email !== me && new Date(m.at).getTime() >= now - WEEK_MS)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] ?? null;
  const last = meetings.find((m) => new Date(m.at).getTime() <= now) ?? null;
  const allowedFrom = conflict ? new Date(new Date(conflict.at).getTime() + WEEK_MS).toISOString() : null;
  return {
    blocked: !!conflict, lms_checked: lms, allowed_from: allowedFrom,
    conflict: conflict ? { mentor: conflict.mentor_name || conflict.mentor_email, at: conflict.at, status: conflict.status } : null,
    last: last ? { mentor: last.mentor_name || last.mentor_email, at: last.at, days_ago: Math.floor((now - new Date(last.at).getTime()) / 864e5), outcome: last.outcome } : null,
    upcoming: meetings.filter((m) => new Date(m.at).getTime() > now).map((m) => ({ mentor: m.mentor_name || m.mentor_email, at: m.at })),
    message: conflict
      ? `${conflict.mentor_name || "Another mentor"} ${conflict.status === "upcoming" ? "has a meeting booked" : "met the student"} on ${day(conflict.at)} — another mentor can ask from ${day(allowedFrom!)}.`
      : "No other mentor's meeting with this student in the last 7 days.",
  };
}
async function nextNumber(): Promise<string> {
  const c: any = await col("counters").findOneAndUpdate({ _id: "meeting_request" as any }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  const seq = Number((c?.value ?? c)?.seq) || 1;
  return `MR-${String(1000 + seq)}`;
}

/**
 * POST /api/functions/createMeetingRequest { studentId, category, course?, durationMins, mode: "online" | "offline" | "cs",
 *   location? (offline), notes (the reason for the meeting — required) }
 * A Senior / Junior / Sub-junior Mentor asks for a meeting with a student — any team's; the mentor is themselves.
 */
export async function createMeetingRequest(req: Request, user: AuthUser): Promise<Response> {
  if (!ASKS_FOR_MEETINGS.has(user.app_role)) return error("You book meetings straight away — no request needed", 400);
  const body: any = await req.json().catch(() => ({}));
  const sid = toObjectId(str(body?.studentId, 40));
  const s: any = sid ? await col("students").findOne({ _id: sid }, { projection: { full_name: 1, student_code: 1, email: 1, primary_mentor_id: 1, primary_mentor_name: 1, common_cs: 1 } }) : null;
  if (!s) return error("Pick the student", 400);
  const category = str(body?.category, 30);
  if (!CATEGORIES.has(category)) return error("Pick what the meeting is for", 400);
  const course = category === "course_upgrade" ? str(body?.course, 60) : "";
  if (category === "course_upgrade" && !course) return error("Pick the course for a Course Upgradation meeting", 400);
  const duration = Math.round(Number(body?.durationMins) || 30);
  if (duration < 15 || duration > 180) return error("A meeting is 15 minutes to 3 hours", 400);
  // Online, in person, or left to the CS to confirm with the student (2026-11-09).
  const mode = ["online", "offline", "cs"].includes(str(body?.mode, 10)) ? str(body?.mode, 10) : body?.inPerson === true ? "offline" : "online";
  const inPerson = mode === "offline";
  const location = inPerson ? str(body?.location, 300) : "";
  if (inPerson && !location) return error("Say where, for an in-person meeting", 400);
  const reason = str(body?.notes, 1000);
  if (reason.length < 3) return error("Give the reason for the meeting request", 400);
  const me: any = await col("users").findOne({ _id: toObjectId(user.id) as any }, { projection: { full_name: 1, email: 1 } });
  const already = await col("meeting_requests").countDocuments({ student_id: String(s._id), mentor_id: user.id, status: "pending" });
  if (already) return error("You already have a request waiting for this student", 409);

  const csIds = csIdsOf(s);
  const where = csIds.length ? await locationOfUser(csIds[0]) : await locationOfUser(user.id);
  const now = nowIso();
  const myEmail = String(me?.email ?? user.email ?? "");
  const elig = await eligibilityOf(String(s._id), String(s.email ?? ""), myEmail);
  const doc: any = {
    student_id: String(s._id), student_name: s.full_name ?? "", student_code: s.student_code ?? "", student_email: s.email ?? "",
    cs_ids: csIds, cs_name: s.primary_mentor_name ?? "", location: where,
    mentor_id: user.id, mentor_name: me?.full_name ?? user.full_name ?? "", mentor_email: String(me?.email ?? user.email ?? ""),
    title: `Session with ${String(s.full_name ?? "").trim() || "a student"}`,
    category, course, duration_mins: duration, mode, in_person: inPerson, location_text: location, notes: reason,
    status: elig.blocked ? "blocked" : "pending", number: await nextNumber(), requested_at: now, created_date: now, updated_date: now,
    ...(elig.blocked ? { blocked: { reason: elig.message, conflict: elig.conflict, allowed_from: elig.allowed_from, at: now }, decided_at: now } : {}),
  };
  const ins = await col("meeting_requests").insertOne(doc);
  // Blocked by the 7-day rule: rejected at once — the mentor is told why; the CS isn't troubled.
  if (elig.blocked) {
    await notify([user.id], { type: "meeting_request", title: `Meeting request blocked — ${doc.student_name}`, body: elig.message, link: "/MeetingRequests", tag: `meeting-request-${ins.insertedId}` });
    return json({ ok: true, blocked: true, message: elig.message, request: out({ ...doc, _id: ins.insertedId }) });
  }
  const to = csIds.length ? csIds : await csManagersOf(where);
  await notify(to, {
    type: "meeting_request", title: `Meeting request — ${doc.student_name}`,
    body: `${doc.mentor_name} asks for a meeting with ${doc.student_name} — ${labelOf(category, course)}. Pick the time and approve.`,
    link: "/MeetingRequests", tag: `meeting-request-${ins.insertedId}`, renotify: true,
  });
  return json({ ok: true, request: out({ ...doc, _id: ins.insertedId }) });
}

const LABEL: Record<string, string> = { course_pitch: "Course Pitch", overview: "Overview", other: "Other", course_upgrade: "Course Upgradation" };
const labelOf = (c: string, course = "") => (c === "course_upgrade" && course ? `Course Upgradation (${course})` : LABEL[c] ?? c);

/**
 * POST /api/functions/listMeetingRequests { box: "mine" | "to_decide", status?: "pending" | "decided" | "all" }
 * mine: the requests this mentor sent; to_decide: the ones this person decides.
 */
export async function listMeetingRequests(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const box = body?.box === "to_decide" ? "to_decide" : "mine";
  let filter: Record<string, unknown>;
  if (box === "mine") filter = { mentor_id: user.id };
  else {
    const f = await decidesFilter(user);
    if (f === false) return json({ requests: [] });
    filter = f;
  }
  const status = body?.status === "decided" ? { status: { $in: ["approved", "rejected", "cancelled", "blocked"] } } : body?.status === "pending" ? { status: { $in: ["pending", "booking"] } } : {};
  const list = (await col("meeting_requests").find({ ...filter, ...status }).sort({ requested_at: -1 }).limit(500).toArray()) as any[];
  const views = await viewsOf(list);
  const requests = list.map((r) => ({ ...out(r), view: views.get(String(r._id)) ?? r.status }));
  const counts: Record<string, number> = { all: requests.length };
  for (const q of requests) counts[q.view] = (counts[q.view] ?? 0) + 1;
  return json({ requests, counts });
}

/**
 * Where each request stands, for the inbox's tabs: needs_review, scheduled (approved, still to come), held, follow_up
 * (held; the mentor's outcome says follow up), converted (an approved course payment after it — for a Course
 * Upgradation, that course), blocked, rejected, cancelled.
 */
async function viewsOf(list: any[]): Promise<Map<string, string>> {
  const views = new Map<string, string>();
  const approved = list.filter((r) => r.status === "approved");
  const outcomes = new Map<string, string>();
  const emails = [...new Set(approved.map((r) => String(r.student_email ?? "").toLowerCase()).filter((e) => e.includes("@")))].slice(0, 200);
  if (emails.length) {
    try {
      const d: any = await callLms("/meeting-outcomes/meetings", { query: { emails: emails.join(",") }, verb: "list the meetings" });
      for (const m of d?.meetings ?? []) outcomes.set(String(m.id), m.outcome?.stage ?? "");
    } catch { /* outcomes from the portal's own copy below */ }
  }
  if (approved.length) {
    const ids = approved.map((r) => String(r.lms_meeting_id ?? "")).filter(Boolean);
    for (const o of (await col("meeting_outcomes").find({ "meeting.id": { $in: ids } }, { projection: { meeting: 1, outcome: 1 } }).toArray()) as any[]) {
      if (!outcomes.get(String(o.meeting?.id))) outcomes.set(String(o.meeting?.id), o.outcome?.stage ?? "");
    }
  }
  const paid = approved.length ? ((await col("funding_transactions").find(
    { type: "BONUS", status: "APPROVED", "course_payment.product": { $exists: true }, student_id: { $in: [...new Set(approved.map((r) => r.student_id))] } },
    { projection: { student_id: 1, approved_at: 1, requested_at: 1, "course_payment.product": 1 } },
  ).toArray()) as any[]) : [];
  for (const r of list) {
    if (r.status === "pending" || r.status === "booking") { views.set(String(r._id), "needs_review"); continue; }
    if (r.status !== "approved") { views.set(String(r._id), r.status); continue; }
    const at = String(r.scheduled_start ?? "");
    const converted = paid.some((t) => String(t.student_id) === String(r.student_id) && String(t.approved_at ?? t.requested_at ?? "") > at
      && (r.category !== "course_upgrade" || String(t.course_payment?.product ?? "").trim().toUpperCase() === String(r.course ?? "").trim().toUpperCase()));
    const stage = outcomes.get(String(r.lms_meeting_id ?? "")) ?? "";
    views.set(String(r._id), converted ? "converted" : new Date(at).getTime() > Date.now() ? "scheduled" : stage === "follow_up" ? "follow_up" : "held");
  }
  return views;
}

/**
 * POST /api/functions/getMeetingRequestReview { id } → { request, eligibility, may_decide, may_override } — the
 * request with the 7-day check worked out now. The mentor who asked, or whoever decides it.
 */
export async function getMeetingRequestReview(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(str(body?.id, 40));
  const r: any = oid ? await col("meeting_requests").findOne({ _id: oid }) : null;
  if (!r) return notFound("No such request");
  const decides = await mayDecide(user, r);
  if (!decides && r.mentor_id !== user.id) return forbidden();
  const eligibility = await eligibilityOf(r.student_id, String(r.student_email ?? ""), String(r.mentor_email ?? ""));
  const [view] = [...(await viewsOf([r])).values()];
  return json({ request: { ...out(r), view }, eligibility, may_decide: decides, may_override: decides && isManager(user) });
}

/** POST /api/functions/getMeetingRequestsWaiting → { count, latest } — the sidebar, the banner and the popup. */
export async function getMeetingRequestsWaiting(_req: Request, user: AuthUser): Promise<Response> {
  const f = await decidesFilter(user);
  if (f === false) return json({ count: 0, latest: [] });
  const q = { ...f, status: "pending" };
  const [count, latest] = await Promise.all([
    col("meeting_requests").countDocuments(q),
    col("meeting_requests").find(q).sort({ requested_at: -1 }).limit(10).toArray(),
  ]);
  return json({ count, latest: (latest as any[]).map(out) });
}

/**
 * POST /api/functions/decideMeetingRequest { id, action: "approve", scheduledStart, mode?: "online" | "offline", location? }
 *   | { id, action: "reject", reason } — the CS may set online or in person (must, when the mentor left it to them).
 * Approve books it in the LMS at that time (a clash comes back as the LMS says, nothing decided).
 */
export async function decideMeetingRequest(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(str(body?.id, 40));
  const r: any = oid ? await col("meeting_requests").findOne({ _id: oid }) : null;
  if (!r) return notFound("No such request");
  if (!(await mayDecide(user, r))) return forbidden("This request is for the student's CS");
  // A blocked one: only a CS Manager or Super Admin, approving it anyway with a reason (an exception, kept).
  const override = body?.override === true && isManager(user);
  const overrideReason = str(body?.overrideReason, 500);
  if (r.status === "blocked" && !(override && body?.action === "approve")) return error("Blocked by the 7-day rule — only a CS Manager can approve it anyway", 409);
  if (!["pending", "blocked"].includes(r.status)) return error(`This request is ${r.status} already`, 409);
  if (override && overrideReason.length < 3) return error("Say why it's approved anyway — it's kept", 400);
  const me: any = await col("users").findOne({ _id: toObjectId(user.id) as any }, { projection: { full_name: 1, email: 1 } });
  const by = { decided_by_id: user.id, decided_by_name: me?.full_name ?? user.full_name ?? "" };

  if (body?.action === "reject") {
    const reason = str(body?.reason, 500);
    if (!reason) return error("Say why — the mentor sees it", 400);
    const done = await col("meeting_requests").updateOne({ _id: oid as any, status: "pending" }, { $set: { status: "rejected", reason, ...by, decided_at: nowIso(), updated_date: nowIso() } });
    if (!done.modifiedCount) return error("Someone decided it just now", 409);
    await notify([r.mentor_id], { type: "meeting_request", title: `Meeting request rejected — ${r.student_name}`, body: `${by.decided_by_name}: ${reason}`, link: "/MentorCalendar?tab=requests", tag: `meeting-request-${r._id}` });
    return json({ ok: true });
  }
  if (body?.action !== "approve") return error("approve or reject", 400);
  const start = new Date(str(body?.scheduledStart, 40));
  if (Number.isNaN(start.getTime())) return error("Pick the date and time", 400);
  if (start.getTime() < Date.now() - 60_000) return error("That time has passed — pick a later one", 400);
  // Online or in person: as the CS sets it now, else as the mentor asked; left to the CS, they must say.
  const asked = str(body?.mode, 10);
  if (!asked && (r.mode === "cs")) return error("Say whether it's online or in person — the mentor left it to you", 400);
  const inPerson = asked ? asked === "offline" : !!r.in_person;
  const place = inPerson ? (asked ? str(body?.location, 300) : String(r.location_text ?? "")) : "";
  if (inPerson && !place) return error("Say where, for an in-person meeting", 400);
  // The 7-day rule again, now — another mentor may have met them since it was asked.
  if (!override) {
    const elig = await eligibilityOf(r.student_id, String(r.student_email ?? ""), String(r.mentor_email ?? ""));
    if (elig.blocked) return error(`${elig.message}${isManager(user) ? " Approve it anyway, with the reason, if it must go ahead." : " A CS Manager can approve an exception."}`, 409);
  }

  // Claimed first, so two people approving at once book it once.
  const was = r.status;
  const claim = await col("meeting_requests").updateOne({ _id: oid as any, status: was }, { $set: { status: "booking", updated_date: nowIso() } });
  if (!claim.modifiedCount) return error("Someone decided it just now", 409);
  try {
    const booked: any = await callLms("/mentor-meetings", {
      method: "POST", verb: "book that meeting",
      body: {
        mentorEmail: r.mentor_email, title: r.title, kind: "student", category: r.category, course: r.course || undefined,
        scheduledStart: start.toISOString(), durationMins: r.duration_mins, inPerson,
        location: inPerson ? place : undefined,
        attendees: [{ name: r.student_name, email: r.student_email || undefined }],
        allAcademies: true, notes: r.notes || undefined, bookedByEmail: me?.email ?? user.email, askOutcome: true,
      },
    });
    const meetingId = String(booked?.meeting?.id ?? "");
    await col("meeting_requests").updateOne({ _id: oid as any }, { $set: { status: "approved", scheduled_start: start.toISOString(), lms_meeting_id: meetingId, in_person: inPerson, location_text: place, booked_mode: inPerson ? "offline" : "online", ...by, decided_at: nowIso(), updated_date: nowIso(),
      ...(override ? { override_reason: overrideReason, override_by_id: user.id, override_by_name: by.decided_by_name, override_at: nowIso() } : {}) } });
    const when = start.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Dubai" });
    await notify([r.mentor_id], { type: "meeting_request", title: `Meeting approved — ${r.student_name}`, body: `${when} (Dubai), ${r.duration_mins} min, ${inPerson ? `in person — ${place}` : "online"} · set by ${by.decided_by_name}`, link: "/MentorCalendar?tab=meetings", tag: `meeting-request-${r._id}`, renotify: true });
    return json({ ok: true, meeting: booked?.meeting ?? null });
  } catch (err) {
    await col("meeting_requests").updateOne({ _id: oid as any, status: "booking" }, { $set: { status: was, updated_date: nowIso() } });
    if (err instanceof LmsError) return error(err.message, err.status);
    throw err;
  }
}

/** POST /api/functions/cancelMeetingRequest { id } — the mentor takes back a request still waiting. */
export async function cancelMeetingRequest(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(str(body?.id, 40));
  if (!oid) return notFound("No such request");
  const done = await col("meeting_requests").updateOne({ _id: oid as any, mentor_id: user.id, status: "pending" }, { $set: { status: "cancelled", decided_at: nowIso(), updated_date: nowIso() } });
  if (!done.modifiedCount) return error("Only a request of yours that is still waiting can be taken back", 409);
  return json({ ok: true });
}

/**
 * POST /api/functions/searchMeetingStudents { q } — a student from any team, for a meeting (name, code, email or phone).
 * Only who they are and their CS — not their page.
 */
export async function searchMeetingStudents(req: Request, _user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const q = str(body?.q, 80);
  if (q.length < 2) return json({ students: [] });
  const rx = new RegExp(esc(q), "i");
  const digits = q.replace(/\D/g, "");
  const or: any[] = [{ full_name: rx }, { student_code: rx }, { email: rx }];
  if (digits.length >= 4) or.push({ phone: new RegExp(esc(digits)) });
  const list = (await col("students").find({ $or: or, ...IS_STUDENT },
    { projection: { full_name: 1, student_code: 1, email: 1, primary_mentor_name: 1 } }).limit(20).toArray()) as any[];
  return json({ students: list.map((s) => ({ id: String(s._id), name: s.full_name ?? "", code: s.student_code ?? "", email: s.email ?? "", cs_name: s.primary_mentor_name ?? "" })) });
}

/**
 * POST /api/functions/getStudentMeetingHistory { studentId } — their earlier meetings: how each went (meeting
 * outcomes) and the meeting requests for them.
 */
export async function getStudentMeetingHistory(req: Request, _user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const sid = str(body?.studentId, 40);
  if (!sid) return json({ meetings: [] });
  const [outcomes, requests] = await Promise.all([
    col("meeting_outcomes").find({ student_ids: sid }, { projection: { meeting: 1, mentor: 1, outcome: 1 } }).sort({ "meeting.starts_at": -1 }).limit(30).toArray(),
    col("meeting_requests").find({ student_id: sid }).sort({ requested_at: -1 }).limit(30).toArray(),
  ]);
  const held = new Set((outcomes as any[]).map((o) => String(o.meeting?.id ?? o._id)));
  const meetings = [
    ...(outcomes as any[]).map((o) => ({
      kind: "held", at: o.meeting?.starts_at ?? null, mentor: o.mentor?.name ?? "", category: o.meeting?.category ?? "", course: o.meeting?.course ?? "",
      outcome: o.outcome?.stage ?? "", remark: o.outcome?.remark ?? "",
    })),
    ...(requests as any[]).filter((r) => !held.has(String(r.lms_meeting_id ?? ""))).map((r) => ({
      kind: "request", at: r.scheduled_start ?? r.requested_at, mentor: r.mentor_name ?? "", category: r.category ?? "", course: r.course ?? "",
      status: r.status, reason: r.reason ?? "",
    })),
  ].sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  return json({ meetings });
}

/** A request waiting 4 hours: its CS (or the CS Managers) and the location's CS Managers reminded, once. */
async function remindTick(): Promise<void> {
  const before = new Date(Date.now() - REMIND_AFTER_MS).toISOString();
  const late = (await col("meeting_requests").find({ status: "pending", requested_at: { $lt: before }, reminded_at: { $exists: false } }).limit(50).toArray()) as any[];
  for (const r of late) {
    const claimed = await col("meeting_requests").updateOne({ _id: r._id, reminded_at: { $exists: false } }, { $set: { reminded_at: nowIso() } });
    if (!claimed.modifiedCount) continue;
    const to = [...(r.cs_ids ?? []), ...(await csManagersOf(r.location ?? "dubai"))];
    await notify(to, {
      type: "meeting_request", title: `Meeting request waiting 4 hours — ${r.student_name}`,
      body: `${r.mentor_name} asked for a meeting with ${r.student_name} — ${labelOf(r.category, r.course)}. Pick the time and approve, or reject.`,
      link: "/MeetingRequests", tag: `meeting-request-${r._id}`, renotify: true,
    });
  }
}
export function startMeetingRequestWorker(): void {
  if (/^(off|false|0|no)$/i.test(process.env.MEETING_REQUEST_REMINDERS ?? "")) return;
  setInterval(() => void remindTick().catch((err) => console.error("[meeting-requests] reminder run failed", err)), 10 * 60_000);
}
