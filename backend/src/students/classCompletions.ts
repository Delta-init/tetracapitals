import { col } from "../db";
import { notify } from "../lib/notify";
import { toObjectId } from "../lib/id";

/* ────────────────────────────────────────────────────────────────────────────
   Class completions: a student attended a live class in the Delta LMS that is
   now over — their CS calls them.

   The LMS reports each one (GET /service/student-activity?include=classes,
   type class_attended — students/lmsActivity.ts brings them in): over when the
   meeting said so — Google Meet or the LMS's own room — else at the timetable
   end; attended by joining the room, joining through the link, or marked by
   hand. Each is kept here under the LMS's key, and NOTIFY_AFTER after the class
   ended (or at once, when attendance was marked later than that) their CS —
   with none, the super admins — gets the bell and a push.

   It waits for a call until one is logged after the class ended: a follow-up
   Log (or a follow-up opened with what the student said — the call flow does
   that after a call), or a 3CX call with the student. Then it is called, with
   when and how; until then the Class Completions page and the sidebar count it.

   class_completions: _id (LMS key) · student_id/name/code · class {…} ·
   notify_at · notified_at · told [{id, name, role}] · told_to · called_at ·
   called_via ("follow-up log" | "3CX call") · called_by · created_date
──────────────────────────────────────────────────────────────────────────── */

export const COMPLETIONS = "class_completions";
export const NOTIFY_AFTER_MS = 10 * 60_000;
const NOTICE_BATCH = 200;

/** A class the LMS reported a student attended (its class_attended event's `class`). */
export interface LmsClass {
  id: string; title: string; course: string; mentor: string; academy: string;
  startsAt: string; durationMins: number;
  endedAt: string; endSource: "google_meet" | "lms_room" | "timetable";
  heldIn: "lms_room" | "google_meet" | "classroom" | "link";
  attendance: "joined_room" | "joined_link" | "marked"; attendedAt: string;
}

const tz = "Asia/Dubai";
const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
const ENDED_BY: Record<string, string> = { google_meet: "Google Meet", lms_room: "the LMS room", timetable: "timetable" };

/** Kept for the student — once (the LMS's key); false when it was kept already. */
export async function keepClassCompletion(key: string, cls: LmsClass, student: any, now: Date): Promise<boolean> {
  const ended = Date.parse(cls.endedAt);
  const notifyAt = new Date(Math.max(Number.isNaN(ended) ? now.getTime() : ended + NOTIFY_AFTER_MS, now.getTime()));
  try {
    await col(COMPLETIONS).insertOne({
      _id: key,
      student_id: String(student._id),
      student_name: String(student.full_name ?? "").trim() || "A student",
      student_code: String(student.student_code ?? ""),
      class: cls,
      ended_at: cls.endedAt,
      notify_at: notifyAt.toISOString(),
      created_date: now.toISOString(),
    } as any);
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

/** Their active CS; with none, every active super admin. */
async function whoToTell(studentId: string): Promise<{ to: "cs" | "super_admins"; people: any[] }> {
  const s: any = await col("students").findOne({ _id: toObjectId(studentId) as any }, { projection: { primary_mentor_id: 1 } });
  const csId = toObjectId(String(s?.primary_mentor_id ?? ""));
  const cs = csId ? await col("users").findOne({ _id: csId, app_role: "cs", status: { $ne: "inactive" } }) : null;
  if (cs) return { to: "cs", people: [cs] };
  return { to: "super_admins", people: await col("users").find({ app_role: "super_admin", status: { $ne: "inactive" } }).toArray() };
}

/** The bell and a push for every completion whose time has come. → how many were told. */
export async function sendDueClassNotices(now: Date): Promise<number> {
  const due = (await col(COMPLETIONS).find({ notified_at: { $exists: false }, notify_at: { $lte: now.toISOString() } } as any)
    .sort({ notify_at: 1 }).limit(NOTICE_BATCH).toArray()) as any[];
  let told = 0;
  for (const c of due) {
    // Taken first: a second API process doesn't tell it again.
    const claim = await col(COMPLETIONS).updateOne({ _id: c._id, notified_at: { $exists: false } } as any, { $set: { notified_at: now.toISOString() } });
    if (claim.modifiedCount !== 1) continue;
    const { to, people } = await whoToTell(c.student_id);
    await col(COMPLETIONS).updateOne({ _id: c._id } as any, {
      $set: { told_to: people.length ? to : "nobody", told: people.map((p: any) => ({ id: String(p._id), name: p.full_name ?? "", role: p.app_role })) },
    });
    if (!people.length) continue;
    const k: LmsClass = c.class ?? {};
    const what = [k.course, k.title].filter(Boolean).join(" · ") || "a class";
    await notify(people.map((p: any) => String(p._id)), {
      type: "class_completed",
      title: "Class attended — call them",
      body: `${c.student_name}${c.student_code ? ` (${c.student_code})` : ""} attended ${what} — ended ${clock(c.ended_at)}${k.endSource ? ` (${ENDED_BY[k.endSource] ?? k.endSource})` : ""}.`,
      link: "/ClassCompletions",
      tag: `class-${c._id}`,
    });
    told++;
  }
  return told;
}

/**
 * Settles the ones still waiting for a call: a follow-up Log (or a follow-up opened with what the student said),
 * or a 3CX call with the student, after the class ended → called, with when, how and by whom (kept). Returns the docs,
 * the settled ones updated.
 */
export async function settleCalls(docs: any[]): Promise<any[]> {
  const open = docs.filter((d) => !d.called_at);
  if (!open.length) return docs;
  const ids = [...new Set(open.map((d) => d.student_id))];
  const since = open.map((d) => d.ended_at).sort()[0];
  const [logs, calls] = await Promise.all([
    col("student_followup_events").find(
      { student_id: { $in: ids }, at: { $gt: since }, $or: [{ kind: "logged" }, { kind: "created", client_said: { $exists: true, $ne: "" } }] } as any,
      { projection: { student_id: 1, at: 1, by_name: 1, kind: 1 } },
    ).sort({ at: 1 }).toArray(),
    col("student_calls").find({ student_id: { $in: ids }, started_at: { $gt: since } } as any, { projection: { student_id: 1, started_at: 1, user_name: 1 } })
      .sort({ started_at: 1 }).toArray(),
  ]);
  const byStudent = new Map<string, { at: string; via: string; by: string }[]>();
  const push = (sid: string, x: { at: string; via: string; by: string }) => (byStudent.get(sid) ?? byStudent.set(sid, []).get(sid)!).push(x);
  for (const l of logs as any[]) push(String(l.student_id), { at: String(l.at), via: "follow-up log", by: String(l.by_name ?? "") });
  for (const c of calls as any[]) push(String(c.student_id), { at: String(c.started_at), via: "3CX call", by: String(c.user_name ?? "") });
  for (const d of open) {
    const first = (byStudent.get(d.student_id) ?? []).filter((x) => x.at > d.ended_at).sort((a, b) => a.at.localeCompare(b.at))[0];
    if (!first) continue;
    const set = { called_at: first.at, called_via: first.via, called_by: first.by };
    await col(COMPLETIONS).updateOne({ _id: d._id, called_at: { $exists: false } } as any, { $set: set });
    Object.assign(d, set);
  }
  return docs;
}

/** How many of these students' completions — told, and not called yet — wait for a call (null: everyone's). */
export async function countCallNeeded(studentIds: string[] | null): Promise<number> {
  const docs = (await col(COMPLETIONS).find({
    notified_at: { $exists: true }, called_at: { $exists: false },
    ...(studentIds ? { student_id: { $in: studentIds } } : {}),
  } as any).limit(2000).toArray()) as any[];
  if (!docs.length) return 0;
  return (await settleCalls(docs)).filter((d) => !d.called_at).length;
}
