import { col } from "../db";
import { callLms, lmsConfigured } from "../lib/lms";
import { notify } from "../lib/notify";
import { toObjectId } from "../lib/id";
import { CLOSED_STAGES, followupCategoryFor, outcomeMatches, recordEvents, targetOutcomes } from "./followups";

/* ────────────────────────────────────────────────────────────────────────────
   How a student meeting went (the user, 2026-10-27): once a meeting booked
   here (Mentor Calendar, askOutcome) is over, its mentor fills a form — in the
   LMS or here, a pop-up that stays until it is filled — saying where the client
   stands: interested (course, payment date, payment mode), follow-up (the CSE's
   or a revision, and when), a meeting with another mentor, a revision (course,
   module, preferred mentor) or not interested (why), with a remark. The LMS
   keeps it on the meeting; the first fill counts.

   Every 2 minutes (and at once after a fill here) the outcomes filled since the
   last look come in and land on the students on the meeting (by email):
   students.meeting_stage (the latest — the Students page's Stage column and
   filter), meeting_outcomes (each one — the student page's history), a
   reminder for their CS on the date for interested / follow-up (their open
   follow-up's next date, else a new follow-up), and the bell for the CS.

   meeting_outcomes: _id (LMS meeting id) · student_ids · meeting {title,
   starts_at, category, attendees, booked_by_email} · mentor {name, email} ·
   outcome {…as the LMS says} · stage · filled_at · reminder · applied_at
──────────────────────────────────────────────────────────────────────────── */

export const OUTCOMES = "meeting_outcomes";
const CURSOR = { coll: "sync_cursors", id: "meeting_outcomes" };
const EVERY_MS = 2 * 60_000;

export const MEETING_STAGES = ["interested", "follow_up", "meeting_with", "revision", "not_interested"] as const;
export const STAGE_LABEL: Record<string, string> = {
  interested: "Interested", follow_up: "Follow-up", meeting_with: "Meeting with mentor", revision: "Revision", not_interested: "Not interested",
};
const FOLLOW_UP_LABEL: Record<string, string> = { cse_follow_up: "CSE follow-up", revision_needed: "Revision needed" };

export interface LmsOutcome {
  stage: string; courseId: string; courseTitle: string; paymentDate: string; paymentMode: string;
  followUpKind: string; followUpDate: string; withMentorName: string; withMentorEmail: string;
  moduleTitle: string; reason: string; remark: string; filledByName: string; filledByEmail: string; filledVia: string; filledAt: string;
}
export interface LmsOutcomeMeeting {
  id: string; title: string; category: string; startsAt: string; durationMins: number;
  attendees: { name: string; email: string }[]; bookedByEmail: string; mentor: { name: string; email: string }; outcome: LmsOutcome | null;
}

/** One line for the outcome: "Interested — Market Breakout, pay 2026-11-02 by Tabby". */
export function outcomeSummary(o: Partial<LmsOutcome>): string {
  const label = STAGE_LABEL[String(o.stage)] ?? String(o.stage ?? "");
  switch (o.stage) {
    case "interested": return `${label} — ${o.courseTitle}, pay ${o.paymentDate} by ${o.paymentMode}`;
    case "follow_up": return `${label} — ${FOLLOW_UP_LABEL[String(o.followUpKind)] ?? o.followUpKind} on ${o.followUpDate}`;
    case "meeting_with": return `${label} — ${o.withMentorName}`;
    case "revision": return `${label} — ${[o.courseTitle, o.moduleTitle].filter(Boolean).join(" · ")}${o.withMentorName ? `, with ${o.withMentorName}` : ""}`;
    case "not_interested": return `${label} — ${o.reason}`;
    default: return label;
  }
}

/** The date the CS should call on, for the stages that make a reminder. */
const reminderDateOf = (o: LmsOutcome) => (o.stage === "interested" ? o.paymentDate : o.stage === "follow_up" ? o.followUpDate : "");

/**
 * The CS's reminder: the student's open follow-up moves to the date (with the outcome in its log), else a new
 * follow-up on it — about the course they're interested in when it is one of ours, else Other.
 */
async function remind(student: any, o: LmsOutcome, mentorName: string, now: string): Promise<{ followup_id: string; date: string; created: boolean } | null> {
  const date = reminderDateOf(o);
  if (!date) return null;
  const sid = String(student._id);
  const by = `${mentorName || "The mentor"} (meeting)`;
  const text = `Meeting outcome: ${outcomeSummary(o)} — next follow-up ${date}`;
  const open: any = await col("student_followups").findOne({ student_id: sid, stage: { $nin: [...CLOSED_STAGES] } }, { sort: { created_date: -1 } });
  if (open) {
    await col("student_followups").updateOne({ _id: open._id }, { $set: { next_followup_date: date, next_followup_time: "", updated_date: now } });
    await recordEvents([{ followup_id: String(open._id), student_id: sid, at: now, by_id: null, by_name: by, kind: "edited", stage_to: open.stage ?? null, next_followup_date: date, notes: o.remark, text }]);
    return { followup_id: String(open._id), date, created: false };
  }
  const courses = (await targetOutcomes()).filter((t) => !["Additional Deposit / Top-up", "Onboarding call", "Other"].includes(t));
  const course = o.stage === "interested" ? courses.find((c) => outcomeMatches(c, o.courseTitle)) : undefined;
  const outcome = course ?? "Other";
  const doc = {
    student_id: sid, target_outcome: outcome, stage: "New", last_contact_date: "", next_followup_date: date, next_followup_time: "",
    followup_count: 0, client_said: "", objection_reason: "", converted_date: "", deal_value: null, notes: o.remark,
    created_by_id: null, created_by_name: by, created_date: now, updated_date: now,
    category: followupCategoryFor({ outcome, studentCreated: student.created_date }),
    from_meeting: true,
  };
  const res = await col("student_followups").insertOne(doc as any);
  await recordEvents([{ followup_id: String(res.insertedId), student_id: sid, at: now, by_id: null, by_name: by, kind: "created", stage_to: "New", next_followup_date: date, notes: o.remark, text }]);
  return { followup_id: String(res.insertedId), date, created: true };
}

/** The student's CS (active), else whoever booked the meeting here. */
async function whoToTell(student: any, bookedByEmail: string): Promise<string[]> {
  const csId = toObjectId(String(student?.primary_mentor_id ?? ""));
  const cs: any = csId ? await col("users").findOne({ _id: csId, status: { $ne: "inactive" } }, { projection: { _id: 1 } }) : null;
  if (cs) return [String(cs._id)];
  const booker: any = bookedByEmail ? await col("users").findOne({ email: bookedByEmail.toLowerCase(), status: { $ne: "inactive" } }, { projection: { _id: 1 } }) : null;
  return booker ? [String(booker._id)] : [];
}

/**
 * Puts one filled outcome on its students — once (the meeting's id): false when it was in already. A student whose
 * stage came from a later outcome keeps it.
 */
export async function applyMeetingOutcome(m: LmsOutcomeMeeting, nowDate = new Date()): Promise<boolean> {
  const o = m.outcome;
  if (!o) return false;
  const now = nowDate.toISOString();
  const emails = [...new Set((m.attendees ?? []).map((a) => String(a.email ?? "").trim().toLowerCase()).filter((e) => e.includes("@")))];
  const students = emails.length
    ? ((await col("students").find({ email: { $in: emails } }, { projection: { full_name: 1, student_code: 1, primary_mentor_id: 1, created_date: 1, meeting_stage_at: 1 } }).toArray()) as any[])
    : [];
  try {
    await col(OUTCOMES).insertOne({
      _id: m.id,
      student_ids: students.map((s) => String(s._id)),
      meeting: { title: m.title, starts_at: m.startsAt, duration_mins: m.durationMins, category: m.category, attendees: m.attendees, booked_by_email: m.bookedByEmail },
      mentor: m.mentor,
      outcome: o,
      stage: o.stage,
      filled_at: o.filledAt,
      created_date: now,
    } as any);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
  const mentorName = m.mentor?.name || o.filledByName;
  const reminders: any[] = [];
  for (const s of students) {
    const stage = { meeting_stage: o.stage, meeting_stage_at: o.filledAt, meeting_stage_summary: outcomeSummary(o), meeting_stage_meeting_id: m.id };
    await col("students").updateOne(
      { _id: s._id, $or: [{ meeting_stage_at: { $exists: false } }, { meeting_stage_at: { $lte: o.filledAt } }] } as any,
      { $set: stage },
    );
    const reminder = await remind(s, o, mentorName, now);
    if (reminder) reminders.push({ student_id: String(s._id), ...reminder });
    const who = `${String(s.full_name ?? "").trim() || "A student"}${s.student_code ? ` (${s.student_code})` : ""}`;
    const tell = await whoToTell(s, m.bookedByEmail);
    if (tell.length) {
      await notify(tell, {
        type: "meeting_outcome",
        title: `Meeting outcome: ${STAGE_LABEL[o.stage] ?? o.stage}`,
        body: `${mentorName} met ${who} — ${outcomeSummary(o)}.${reminder ? ` Follow-up set for ${reminder.date}.` : ""} ${o.remark}`.trim(),
        link: `/StudentDetail?id=${String(s._id)}`,
        tag: `meeting-outcome-${m.id}-${String(s._id)}`,
      }).catch(() => {});
    }
  }
  await col(OUTCOMES).updateOne({ _id: m.id } as any, { $set: { reminders, applied_at: new Date().toISOString() } });
  return true;
}

let running = false;

/** One look: every outcome filled since the last, onto the students. → how many were new here. */
export async function syncMeetingOutcomes(now = new Date()): Promise<{ ok: boolean; applied: number; error?: string }> {
  if (!lmsConfigured()) return { ok: false, applied: 0, error: "no LMS link" };
  if (running) return { ok: false, applied: 0, error: "A run is already going" };
  running = true;
  try {
    const cursor: any = await col(CURSOR.coll).findOne({ _id: CURSOR.id } as any);
    let since: string | undefined = cursor?.since ?? undefined;
    let applied = 0;
    for (let page = 0; page < 20; page++) {
      const data = await callLms<{ meetings: LmsOutcomeMeeting[]; next: string | null }>("/meeting-outcomes", { query: { since, limit: "200" }, verb: "share the meeting outcomes" });
      for (const m of data.meetings ?? []) if (await applyMeetingOutcome(m, now)) applied++;
      const next = data.next ?? since;
      if (next && next !== since) await col(CURSOR.coll).updateOne({ _id: CURSOR.id } as any, { $set: { since: next, at: now.toISOString() } }, { upsert: true });
      // A full page may have more behind it; `since` is inclusive, so a page all at one instant would not move — stop.
      if ((data.meetings ?? []).length < 200 || next === since) break;
      since = next ?? undefined;
    }
    return { ok: true, applied };
  } catch (err) {
    return { ok: false, applied: 0, error: String((err as Error)?.message ?? err) };
  } finally {
    running = false;
  }
}

export function startMeetingOutcomeWorker(): void {
  if (!lmsConfigured()) {
    console.log("[meeting outcomes] off on this server (no LMS link: LMS_API_URL / LMS_SERVICE_SECRET)");
    return;
  }
  const tick = async () => {
    const r = await syncMeetingOutcomes();
    if (r.ok) { if (r.applied) console.log(`[meeting outcomes] ${r.applied} put on students`); }
    else if (r.error !== "A run is already going") console.error(`[meeting outcomes] not run: ${r.error}`);
  };
  setTimeout(() => void tick(), 60_000);
  setInterval(() => void tick(), EVERY_MS);
}
