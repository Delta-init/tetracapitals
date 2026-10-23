import { col } from "../db";
import { notify } from "../lib/notify";
import { toObjectId } from "../lib/id";
import { IS_STUDENT, OF_A_STUDENT } from "./notStudent";

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
   that after a call), or an answered 3CX call with the student (2026-10-23: a
   call nobody picked up no longer counts) — on their record or another record
   of the same person (the same email or LMS account). Then it is called, with
   when and how; until then the Class Completions page and the sidebar count it,
   the same ones (OPEN_COMPLETION: the last SHOWN_DAYS days, students only).

   A seat the LMS later says was missed or cancelled (class_unattended) takes
   back one nobody has called about: withdrawn_at, and it is shown no more.

   class_completions: _id (LMS key) · student_id/name/code · class {…} ·
   notify_at · notified_at · told [{id, name, role}] · told_to · called_at ·
   called_via ("follow-up log" | "3CX call") · called_by · created_date
──────────────────────────────────────────────────────────────────────────── */

export const COMPLETIONS = "class_completions";
export const NOTIFY_AFTER_MS = 10 * 60_000;
/** How far back the page and the sidebar look (the same for both, 2026-10-23 — the sidebar counted older ones too). */
export const SHOWN_DAYS = 60;
/** What waits on the page and in the sidebar: told, students only, not taken back, the last SHOWN_DAYS days. */
export const shownCompletions = (now = new Date()) => ({
  notified_at: { $exists: true }, withdrawn_at: { $exists: false }, ...OF_A_STUDENT,
  ended_at: { $gte: new Date(now.getTime() - SHOWN_DAYS * 86_400_000).toISOString() },
});
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
      // A student marked "not a student" already: kept, never shown or told (2026-10-23 — only a later mark set it).
      ...(student.not_student === true ? { student_not_student: true } : {}),
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
  // The student's CS — a CS Manager who is their CS too (2026-10-16).
  const cs = csId ? await col("users").findOne({ _id: csId, app_role: { $in: ["cs", "cs_manager"] }, status: { $ne: "inactive" } }) : null;
  if (cs) return { to: "cs", people: [cs] };
  return { to: "super_admins", people: await col("users").find({ app_role: "super_admin", status: { $ne: "inactive" } }).toArray() };
}

/** The bell and a push for every completion whose time has come. → how many were told. */
export async function sendDueClassNotices(now: Date): Promise<number> {
  const due = (await col(COMPLETIONS).find({ notified_at: { $exists: false }, withdrawn_at: { $exists: false }, ...OF_A_STUDENT, notify_at: { $lte: now.toISOString() } } as any)
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
/**
 * Each student with the other records of the same person — the same email or LMS account (an import and a sign-up) —
 * so a call logged on either settles a completion kept on one (2026-10-23).
 */
async function sameStudents(ids: string[]): Promise<Map<string, string>> {
  const owner = new Map<string, string>(ids.map((id) => [id, id]));
  const own = (await col("students").find({ _id: { $in: ids.map((id) => toObjectId(id)).filter(Boolean) as any[] } }, { projection: { email: 1, lms_user_id: 1 } }).toArray()) as any[];
  const byEmail = new Map<string, string>(), byLms = new Map<string, string>();
  for (const s of own) {
    const email = String(s.email ?? "").trim().toLowerCase();
    if (email.includes("@")) byEmail.set(email, String(s._id));
    if (s.lms_user_id) byLms.set(String(s.lms_user_id), String(s._id));
  }
  if (!byEmail.size && !byLms.size) return owner;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const others = (await col("students").find({
    _id: { $nin: own.map((s) => s._id) },
    $or: [
      ...(byEmail.size ? [{ email: { $regex: `^\\s*(${[...byEmail.keys()].map(esc).join("|")})\\s*$`, $options: "i" } }] : []),
      ...(byLms.size ? [{ lms_user_id: { $in: [...byLms.keys()] } }] : []),
    ],
  }, { projection: { email: 1, lms_user_id: 1 } }).limit(500).toArray()) as any[];
  for (const o of others) {
    const to = byLms.get(String(o.lms_user_id ?? "")) ?? byEmail.get(String(o.email ?? "").trim().toLowerCase());
    if (to) owner.set(String(o._id), to);
  }
  return owner;
}

export async function settleCalls(docs: any[]): Promise<any[]> {
  const open = docs.filter((d) => !d.called_at);
  if (!open.length) return docs;
  const owner = await sameStudents([...new Set(open.map((d) => String(d.student_id)))]);
  const ids = [...owner.keys()];
  const since = open.map((d) => d.ended_at).sort()[0];
  const [logs, calls] = await Promise.all([
    col("student_followup_events").find(
      { student_id: { $in: ids }, at: { $gt: since }, $or: [{ kind: "logged" }, { kind: "created", client_said: { $exists: true, $ne: "" } }] } as any,
      { projection: { student_id: 1, at: 1, by_name: 1, kind: 1 } },
    ).sort({ at: 1 }).toArray(),
    // Answered only (2026-10-23): a call nobody picked up isn't the call the student is waiting for.
    col("student_calls").find({ student_id: { $in: ids }, started_at: { $gt: since }, answered: true } as any, { projection: { student_id: 1, started_at: 1, user_name: 1 } })
      .sort({ started_at: 1 }).toArray(),
  ]);
  const byStudent = new Map<string, { at: string; via: string; by: string }[]>();
  const push = (sid: string, x: { at: string; via: string; by: string }) => (byStudent.get(sid) ?? byStudent.set(sid, []).get(sid)!).push(x);
  const whose = (sid: unknown) => owner.get(String(sid)) ?? String(sid);
  for (const l of logs as any[]) push(whose(l.student_id), { at: String(l.at), via: "follow-up log", by: String(l.by_name ?? "") });
  for (const c of calls as any[]) push(whose(c.student_id), { at: String(c.started_at), via: "3CX call", by: String(c.user_name ?? "") });
  for (const d of open) {
    const first = (byStudent.get(d.student_id) ?? []).filter((x) => x.at > d.ended_at).sort((a, b) => a.at.localeCompare(b.at))[0];
    if (!first) continue;
    const set = { called_at: first.at, called_via: first.via, called_by: first.by };
    await col(COMPLETIONS).updateOne({ _id: d._id, called_at: { $exists: false } } as any, { $set: set });
    Object.assign(d, set);
  }
  return docs;
}

/** These students' completions — told, and not called yet — that wait for a call (null: everyone's). */
export async function callNeeded(studentIds: string[] | null): Promise<any[]> {
  const docs = (await col(COMPLETIONS).find({
    ...shownCompletions(), called_at: { $exists: false },
    ...(studentIds ? { student_id: { $in: studentIds } } : {}),
  } as any).sort({ ended_at: -1 }).limit(2000).toArray()) as any[];
  if (!docs.length) return [];
  return (await settleCalls(docs)).filter((d) => !d.called_at);
}

/**
 * The LMS says the seat was missed or cancelled after all (class_unattended): the completion is taken back — unless
 * someone has called already, when it stays as it was. → whether one was taken back.
 */
export async function withdrawClassCompletion(bookingId: string, status: string, now: Date): Promise<boolean> {
  if (!bookingId) return false;
  const r = await col(COMPLETIONS).updateOne(
    { _id: `class-attended:${bookingId}`, called_at: { $exists: false }, withdrawn_at: { $exists: false } } as any,
    { $set: { withdrawn_at: now.toISOString(), withdrawn_reason: status === "cancelled" ? "seat cancelled" : "marked missed" } },
  );
  return r.modifiedCount === 1;
}

/** How many of them there are — the sidebar's number. */
export async function countCallNeeded(studentIds: string[] | null): Promise<number> {
  return (await callNeeded(studentIds)).length;
}
