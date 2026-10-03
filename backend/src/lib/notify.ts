import webpush from "web-push";
import { col } from "../db";
import { config } from "../config";
import { toObjectId } from "./id";

/* ────────────────────────────────────────────────────────────────────────────
   Telling people: the bell (notifications, read in the portal) and a push to
   every phone and computer they turned notifications on for — Web Push, as in
   the Sales CRM. Push needs VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY; without them
   only the bell rings.

   What notifies: a student given to you (lib callers: the entity API, intake,
   the Team page's reassign, the inactivity rule — never a bulk import script),
   the day's follow-ups — due today, overdue, tomorrow's — with the 10:00
   reminder email, follow-ups that went overdue in the team you lead (the
   leader alert, same time), a new student from finance in the team you lead
   — or anywhere, for a Super Admin (finance/students.ts) — and one still not
   onboarded 6 hours on, with an email (students/onboardingAlerts.ts), and a
   WhatsApp message to your linked WhatsApp (push only — the WhatsApp page
   keeps count).
   A notice that fails never undoes the thing it is about.
──────────────────────────────────────────────────────────────────────────── */

export interface Notice {
  type: string;
  title: string;
  body: string;
  /** Where a tap opens, e.g. /StudentDetail?id=… */
  link?: string;
  /** Notices with the same tag replace each other on the device. */
  tag?: string;
  /** Sound and vibrate again even when one with the same tag is showing. */
  renotify?: boolean;
}

let ready: boolean | null = null;
export function pushConfigured(): boolean {
  if (ready === null) {
    ready = !!(config.push.publicKey && config.push.privateKey);
    if (ready) {
      try {
        webpush.setVapidDetails(config.push.subject, config.push.publicKey, config.push.privateKey);
      } catch (err) {
        console.error("[push] the VAPID keys are not valid — no push", err instanceof Error ? err.message : err);
        ready = false;
      }
    }
  }
  return ready;
}

/** A push to every device these people turned notifications on for. Devices that are gone are forgotten. */
export async function push(userIds: string[], n: Notice): Promise<void> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length || !pushConfigured()) return;
  const subs = (await col("push_subscriptions").find({ user_id: { $in: ids } }).toArray()) as any[];
  const payload = JSON.stringify({ title: n.title, body: n.body, url: n.link || "/", tag: n.tag || n.type, renotify: !!n.renotify, data: { type: n.type } });
  await Promise.allSettled(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 24 * 60 * 60 });
      await col("push_subscriptions").updateOne({ _id: s._id }, { $set: { last_sent_at: new Date().toISOString() } });
    } catch (err: any) {
      const code = err?.statusCode;
      if (code === 404 || code === 410) await col("push_subscriptions").deleteOne({ _id: s._id });   // unsubscribed or expired
      else console.error(`[push] not sent (user ${s.user_id}, ${String(s.endpoint).split("/")[2]}, ${code ?? "no status"}): ${err?.message ?? err}`);
    }
  }));
}

/** The bell (unless bell: false) and a push. Never throws. */
export async function notify(userIds: string[], n: Notice, opts: { bell?: boolean } = {}): Promise<void> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  try {
    if (opts.bell !== false) {
      const now = new Date().toISOString();
      await col("notifications").insertMany(ids.map((user_id) => ({
        user_id, title: n.title, message: n.body, type: n.type, link: n.link ?? "", read: false, created_date: now, updated_date: now,
      })) as any[]);
    }
    await push(ids, n);
  } catch (err) {
    console.error("[notify] failed", err instanceof Error ? err.message : err);
  }
}

/**
 * "New student" for whoever a student was just given to — one notice per person, naming the student, or how many
 * when it is several at once. Not for the person who did it (a CS adding their own student). Each is also marked new
 * for them (students.new_for_id): the sidebar counts it until they open the student (markStudentSeen).
 */
export async function notifyStudentsGiven(students: any[], byUserId?: string | null): Promise<void> {
  const byMentor = new Map<string, any[]>();
  for (const s of students) {
    const mentor = String(s?.primary_mentor_id ?? "");
    if (!mentor || mentor === byUserId) continue;
    byMentor.set(mentor, [...(byMentor.get(mentor) ?? []), s]);
  }
  for (const [mentor, list] of byMentor) {
    const name = (s: any) => String(s.full_name ?? "").trim() || s.student_code || "A student";
    const id = (s: any) => String(s._id ?? s.id);
    const one = list.length === 1;
    await markNewFor(mentor, list.map(id));
    await notify([mentor], {
      type: "student_given",
      title: one ? `New student: ${name(list[0])}` : `${list.length} new students`,
      body: one
        ? `${name(list[0])}${list[0].student_code ? ` (${list[0].student_code})` : ""} was given to you.`
        : `${list.slice(0, 4).map(name).join(", ")}${list.length > 4 ? ` and ${list.length - 4} more` : ""} were given to you.`,
      link: one ? `/StudentDetail?id=${id(list[0])}` : "/Students",
      tag: one ? `student-${id(list[0])}` : `students-${mentor}`,
      renotify: true,
    });
  }
}

/** These students are new for `userId` (still theirs): counted in the sidebar until they open each one. */
export async function markNewFor(userId: string, studentIds: string[]): Promise<void> {
  const ids = studentIds.map(toObjectId).filter(Boolean) as any[];
  if (!userId || !ids.length) return;
  try {
    await col("students").updateMany({ _id: { $in: ids }, primary_mentor_id: userId }, { $set: { new_for_id: userId, new_since: new Date().toISOString() } });
  } catch (err) {
    console.error("[notify] could not mark new students", err instanceof Error ? err.message : err);
  }
}
