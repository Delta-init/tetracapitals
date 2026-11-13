import { json, error, forbidden, notFound } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { callLms, LmsError, lmsConfigured } from "../lib/lms";
import { col } from "../db";
import { toObjectId } from "../lib/id";
import { notify } from "../lib/notify";
import { locationOfUser } from "../lib/userLocation";
import { addressRe } from "./meetingOutcomes";

/* ────────────────────────────────────────────────────────────────────────────
   Meeting status checks (the user, 2026-11-09): 10 minutes after a student
   meeting booked here starts, its student's CS (else whoever booked it) says
   what became of it — a window that cannot be closed until answered:
     Ongoing    asked again at its end + 10 minutes (Completed or Cancelled);
     Completed  the mentor's "how did it go" window comes as before;
     Cancelled  a reason (required) and, if given, a new date and time — a new
                meeting is booked then with the same mentor (the LMS invites);
                this one is cancelled in the LMS silently, so its mentor gets no
                "meeting done" window. The mentor is told here, in the bell.
   Only the CS answers (2026-11-13): an unanswered one stays with them — CS
   Managers no longer get other CSs' checks — and nobody viewing as a CS gets
   theirs. Only meetings that start after this first ran are asked about. MEETING_STATUS_CHECKS=off keeps a server out of it.
──────────────────────────────────────────────────────────────────────────── */

const C = "meeting_status_checks";
const ASK_AFTER_MS = 10 * 60_000;
const OPEN = ["asked", "asked_again"];
const ADMINS = new Set(["super_admin", "admin"]);
const str = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);
const nowIso = () => new Date().toISOString();
const dubaiDay = (t: number) => new Date(t + 4 * 3600_000).toISOString().slice(0, 10);
const timeText = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Dubai" });

/** Meetings that started 10+ minutes ago and aren't asked about yet: asked now. Ongoing ones whose end + 10 has come: asked again. */
async function tick(): Promise<void> {
  if (!lmsConfigured()) return;
  const now = Date.now();
  const since: any = await col("app_settings").findOneAndUpdate({ _id: "meeting_status_since" as any }, { $setOnInsert: { value: nowIso() } }, { upsert: true, returnDocument: "after" });
  const sinceAt = String((since?.value?.value ?? since?.value) || nowIso());
  const data: any = await callLms("/meeting-outcomes/meetings", { query: { from: dubaiDay(now - 864e5), to: dubaiDay(now) }, verb: "list the meetings" });
  const due = ((data?.meetings ?? []) as any[]).filter((m) => m.status !== "cancelled" && m.startsAt >= sinceAt && new Date(m.startsAt).getTime() <= now - ASK_AFTER_MS);
  if (due.length) {
    const asked = new Set(((await col(C).find({ _id: { $in: due.map((m) => String(m.id)) } } as any, { projection: { _id: 1 } }).toArray()) as any[]).map((d) => String(d._id)));
    for (const m of due.filter((x) => !asked.has(String(x.id)))) {
      const emails = (m.attendees ?? []).map((a: any) => String(a.email ?? "").toLowerCase()).filter((e: string) => e.includes("@"));
      const s: any = emails.length ? await col("students").findOne({ email: { $in: emails.map(addressRe) } }, { projection: { full_name: 1, student_code: 1, email: 1, primary_mentor_id: 1, primary_mentor_name: 1 } }) : null;
      let assignee = String(s?.primary_mentor_id ?? "");
      if (!assignee && m.bookedByEmail) {
        const b: any = await col("users").findOne({ email: { $regex: `^${String(m.bookedByEmail).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }, { projection: { _id: 1 } });
        assignee = b ? String(b._id) : "";
      }
      if (!assignee) continue;
      const doc: any = {
        _id: String(m.id), meeting_id: String(m.id), title: m.title ?? "", category: m.category ?? "", starts_at: m.startsAt, ends_at: m.endsAt,
        duration_mins: m.durationMins ?? 0, in_person: !!m.inPerson, location_text: m.location ?? "", mentor: m.mentor ?? {}, booked_by: m.bookedByEmail ?? "",
        attendees: (m.attendees ?? []).map((a: any) => a.name).filter(Boolean),
        student: s ? { id: String(s._id), name: String(s.full_name ?? "").trim(), code: s.student_code ?? "", cs_name: s.primary_mentor_name ?? "" } : null,
        assignee_ids: [assignee], area: await locationOfUser(assignee), status: "asked", asked_at: nowIso(), history: [], created_date: nowIso(),
      };
      const ins = await col(C).insertOne(doc).catch(() => null);
      if (!ins) continue;
      await notify([assignee], {
        type: "meeting_status", title: `Meeting status — ${doc.student?.name || doc.attendees.join(", ") || doc.title}`,
        body: `With ${m.mentor?.name || "the mentor"} at ${timeText(m.startsAt)}. Is it on, done or cancelled?`, link: "/", tag: `meeting-status-${m.id}`, renotify: true,
      });
    }
  }
  // Ongoing: asked again once its end + 10 minutes has come.
  for (const d of (await col(C).find({ status: "ongoing", re_ask_at: { $lte: nowIso() } }).limit(100).toArray()) as any[]) {
    const r = await col(C).updateOne({ _id: d._id, status: "ongoing" }, { $set: { status: "asked_again", asked_at: nowIso(), manager_told_at: null } });
    if (r.modifiedCount) await notify(d.assignee_ids ?? [], { type: "meeting_status", title: `Meeting over? — ${d.student?.name || d.title}`, body: `Was the meeting with ${d.mentor?.name || "the mentor"} completed or cancelled?`, link: "/", tag: `meeting-status-${d._id}`, renotify: true });
  }
}

export function startMeetingStatusWorker(): void {
  if (/^(off|false|0|no)$/i.test(process.env.MEETING_STATUS_CHECKS ?? "")) return;
  setInterval(() => void tick().catch((err) => console.error("[meeting-status] run failed", err instanceof Error ? err.message : err)), 60_000);
}

/** Whose open checks this person answers: only their own (a CS Manager too — only where they are the CS). */
const mineFilter = (user: AuthUser): Record<string, unknown> => ({ assignee_ids: user.id });
const out = (d: any) => ({
  id: String(d._id), status: d.status, title: d.title, category: d.category, starts_at: d.starts_at, ends_at: d.ends_at, duration_mins: d.duration_mins,
  in_person: d.in_person, location: d.location_text, mentor: d.mentor, student: d.student, attendees: d.attendees, asked_at: d.asked_at,
  again: d.status === "asked_again", reason: d.reason ?? "", rescheduled_to: d.rescheduled_to ?? null, answered_by_name: d.answered_by_name ?? "",
});

/** POST /api/functions/getMeetingStatusChecks → { pending } — the window's: oldest first. */
export async function getMeetingStatusChecks(_req: Request, user: AuthUser): Promise<Response> {
  // Viewing as a CS (a Chief, CS Manager or Super Admin): their checks are theirs to answer, not shown to the viewer.
  if ((user as any)._impersonatedBy) return json({ pending: [] });
  const list = (await col(C).find({ ...mineFilter(user), status: { $in: OPEN } }).sort({ starts_at: 1 }).limit(20).toArray()) as any[];
  return json({ pending: list.map(out) });
}

/**
 * POST /api/functions/answerMeetingStatus { id, status: "ongoing" | "completed" | "cancelled", reason?, rescheduleAt? (ISO) }
 * Cancelled needs the reason; with rescheduleAt a new meeting is booked then first (a clash comes back, nothing done).
 */
export async function answerMeetingStatus(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const id = str(body?.id, 60);
  const d: any = id ? await col(C).findOne({ _id: id } as any) : null;
  if (!d) return notFound("No such meeting check");
  const mine = (d.assignee_ids ?? []).includes(user.id) || ADMINS.has(user.app_role);
  if (!mine) return forbidden("This meeting's status is for its student's CS");
  if (!OPEN.includes(d.status)) return error(`Already answered — ${d.status}`, 409);
  const status = str(body?.status, 20);
  if (!["ongoing", "completed", "cancelled"].includes(status)) return error("Ongoing, completed or cancelled", 400);
  const me: any = await col("users").findOne({ _id: toObjectId(user.id) as any }, { projection: { full_name: 1, email: 1 } });
  const by = { answered_by_id: user.id, answered_by_name: me?.full_name ?? user.full_name ?? "", answered_at: nowIso() };
  const history = { status, at: by.answered_at, by: by.answered_by_name };

  if (status === "ongoing") {
    const reAsk = new Date(Math.max(new Date(d.ends_at).getTime() + ASK_AFTER_MS, Date.now() + 15 * 60_000)).toISOString();
    await col(C).updateOne({ _id: d._id }, { $set: { status: "ongoing", re_ask_at: reAsk, ...by }, $push: { history } as any });
    return json({ ok: true, re_ask_at: reAsk });
  }
  if (status === "completed") {
    await col(C).updateOne({ _id: d._id }, { $set: { status: "completed", ...by }, $push: { history } as any });
    return json({ ok: true });
  }

  const reason = str(body?.reason, 500);
  if (reason.length < 3) return error("Say why it was cancelled", 400);
  // Who called it off (2026-11-09): only the mentor's own count against them in Root's mentor KPIs.
  const cancelledBy = str(body?.cancelledBy, 10);
  if (!["student", "mentor", "cs", "other"].includes(cancelledBy)) return error("Say who called it off: the student, the mentor, the CS or something else", 400);
  const re = str(body?.rescheduleAt, 40);
  const reAt = re ? new Date(re) : null;
  if (reAt && (Number.isNaN(reAt.getTime()) || reAt.getTime() < Date.now())) return error("The new date and time must be ahead", 400);
  // Claimed, so two answers at once cancel once.
  const claim = await col(C).updateOne({ _id: d._id, status: d.status }, { $set: { status: "cancelling" } });
  if (!claim.modifiedCount) return error("Someone answered it just now", 409);
  try {
    let newMeeting: any = null;
    if (reAt) {
      const m: any = await callLms(`/mentor-meetings/${encodeURIComponent(d._id)}`, { query: { actorEmail: me?.email ?? user.email, actorIsRootAdmin: "true" }, verb: "read the meeting" });
      const booked: any = await callLms("/mentor-meetings", {
        method: "POST", verb: "book the new meeting",
        body: {
          mentorEmail: d.mentor?.email || m?.mentorEmail, title: m?.title || d.title, kind: "student", category: m?.category || d.category || "",
          course: m?.course || undefined, scheduledStart: reAt.toISOString(), durationMins: m?.durationMins || d.duration_mins || 30,
          inPerson: !!m?.inPerson, location: m?.inPerson ? m?.location : undefined, attendees: m?.attendees ?? [], allAcademies: true,
          notes: m?.notes || undefined, bookedByEmail: me?.email ?? user.email, askOutcome: true,
        },
      });
      newMeeting = booked?.meeting ?? null;
    }
    await callLms(`/mentor-meetings/${encodeURIComponent(d._id)}/cancel`, { method: "POST", verb: "cancel the meeting", body: { actorEmail: me?.email ?? user.email, actorIsRootAdmin: true, silent: true, reason, cancelledBy, allAcademies: true } });
    await col(C).updateOne({ _id: d._id }, { $set: { status: "cancelled", reason, cancelled_by: cancelledBy, rescheduled_to: reAt ? reAt.toISOString() : null, new_meeting_id: newMeeting?.id ?? null, ...by }, $push: { history } as any });
    // A meeting request's meeting: it follows (the new one, or cancelled).
    await col("meeting_requests").updateOne({ lms_meeting_id: d._id }, { $set: newMeeting ? { lms_meeting_id: newMeeting.id, scheduled_start: reAt!.toISOString() } : { meeting_cancelled: { reason, at: nowIso(), by: by.answered_by_name } } });
    const mentor: any = d.mentor?.email ? await col("users").findOne({ email: { $regex: `^${String(d.mentor.email).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } }, { projection: { _id: 1 } }) : null;
    if (mentor) await notify([String(mentor._id)], {
      type: "meeting_status", title: `Meeting cancelled — ${d.student?.name || d.title}`,
      body: `${by.answered_by_name}: ${reason}${reAt ? ` · moved to ${timeText(reAt.toISOString())}` : ""}`, link: "/MentorCalendar", tag: `meeting-status-${d._id}`,
    });
    return json({ ok: true, new_meeting: newMeeting });
  } catch (err) {
    await col(C).updateOne({ _id: d._id, status: "cancelling" }, { $set: { status: d.status } });
    if (err instanceof LmsError) return error(err.message, err.status);
    throw err;
  }
}

/** The CS's answers for these meetings, by meeting id — Meetings done's column. */
export async function statusesOf(ids: string[]): Promise<Map<string, any>> {
  if (!ids.length) return new Map();
  const docs = (await col(C).find({ _id: { $in: ids } } as any, { projection: { status: 1, reason: 1, rescheduled_to: 1, answered_by_name: 1 } }).toArray()) as any[];
  return new Map(docs.map((d) => [String(d._id), { status: d.status, reason: d.reason ?? "", rescheduled_to: d.rescheduled_to ?? null, by: d.answered_by_name ?? "" }]));
}
