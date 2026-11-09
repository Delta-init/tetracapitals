import { json, error, forbidden, notFound } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { LmsError } from "../lib/lms";
import { col } from "../db";
import { toObjectId } from "../lib/id";
import { notify } from "../lib/notify";
import { csManagerReach, locationOfUser } from "../lib/userLocation";
import { CLOSED_STAGES, isAdmin, recordEvents, visibleMentorIds, studentsOf } from "../students/followups";
import { OUTCOMES } from "../students/meetingOutcomes";
import { meetingRows, promiseOf, type MeetingRow } from "./meetingOutcomes";

/* ────────────────────────────────────────────────────────────────────────────
   Payment verification (the user, 2026-11-09): what the mentor expects after
   an "interested" meeting (date, method, how firm — unverified), what the CS
   then checked with the student (confirmed / a different date / declined /
   not reachable yet), and what finance actually received are three things,
   kept apart. The CS verifies on Meetings done → Payment verification; a date
   they confirm moves the student's follow-up to it; Due / Overdue go by the
   CS's date once there is one. Only an approved payment is Paid. The CS is
   told when the outcome comes; unverified after 24 hours, they and their CS
   Managers are reminded once (PAYMENT_VERIFY_REMINDERS=off).
──────────────────────────────────────────────────────────────────────────── */

const C = "payment_verifications";
const CONFIRMATIONS = ["confirmed", "changed", "declined", "unreachable"] as const;
const str = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nowIso = () => new Date().toISOString();
const keyOf = (meetingId: string, studentId: string) => `${meetingId}|${studentId}`;

/** Where a verification row stands, for the tabs. */
function viewOf(r: MeetingRow, v: any): string {
  if (r.payment?.status === "approved") return "paid";
  if (!v || v.confirmation === "unreachable") return "unverified";
  return v.confirmation === "confirmed" ? "verified" : v.confirmation === "changed" ? "changed" : "declined";
}

/**
 * POST /api/functions/getPaymentVerifications { from, to } → { rows, counts } — the interested meetings of the days
 * (Meetings done's reach), each with the mentor's expectation, the CS's verification and the payment.
 */
export async function getPaymentVerifications(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const from = str(body?.from, 10), to = str(body?.to, 10);
  if (!DAY.test(from) || !DAY.test(to) || from > to) return error("Pick the days: from and to", 400);
  let rows: MeetingRow[];
  try { rows = (await meetingRows(user, from, to)).filter((r) => r.stage === "interested" && r.student); }
  catch (err) { if (err instanceof LmsError) return error(err.message, err.status); throw err; }
  const docs = (await col(C).find({ _id: { $in: rows.map((r) => keyOf(r.meeting_id, r.student!.id)) } } as any).toArray()) as any[];
  const byKey = new Map(docs.map((d) => [String(d._id), d]));
  const out = rows.map((r) => {
    const v = byKey.get(keyOf(r.meeting_id, r.student!.id)) ?? null;
    const date = v && ["confirmed", "changed"].includes(v.confirmation) && v.date ? v.date : "";
    const promise = date ? promiseOf({ stage: "interested", paymentDate: date }, r.payment ?? undefined) : r.promise;
    return {
      ...r, promise, view: viewOf(r, v),
      expectation: { date: r.outcome?.paymentDate ?? "", mode: r.outcome?.paymentMode ?? "", intent: r.outcome?.paymentIntent || "explicit_plan", course: r.outcome?.courseTitle ?? "" },
      verification: v ? { confirmation: v.confirmation, date: v.date ?? "", mode: v.mode ?? "", reason: v.reason ?? "", note: v.note ?? "", by: v.by_name ?? "", at: v.at } : null,
    };
  });
  const counts: Record<string, number> = { all: out.length };
  for (const r of out) counts[r.view] = (counts[r.view] ?? 0) + 1;
  return json({ rows: out, counts });
}

/** May this person verify this student's payment: their CS (or a CS they are Common with), a CS Manager of that location, an admin. */
async function mayVerify(user: AuthUser, s: any): Promise<boolean> {
  if (isAdmin(user)) return true;
  const ids = [String(s?.primary_mentor_id ?? ""), ...(Array.isArray(s?.common_cs) ? s.common_cs.map((c: any) => String(c?.id ?? "")) : [])];
  if (ids.includes(user.id)) return true;
  const reach = await csManagerReach(user);
  return !!reach && ids.some((i) => reach.ids.includes(i));
}

/** A date the CS confirmed: the student's open follow-up moves to it (with a note in its log). */
async function moveFollowup(sid: string, date: string, byName: string, text: string): Promise<void> {
  const open: any = await col("student_followups").findOne({ student_id: sid, stage: { $nin: [...CLOSED_STAGES] } }, { sort: { created_date: -1 } });
  if (!open) return;
  const now = nowIso();
  await col("student_followups").updateOne({ _id: open._id }, { $set: { next_followup_date: date, next_followup_time: "", updated_date: now } });
  await recordEvents([{ followup_id: String(open._id), student_id: sid, at: now, by_id: null, by_name: byName, kind: "edited", stage_to: open.stage ?? null, next_followup_date: date, text }]);
}

/**
 * POST /api/functions/verifyMeetingPayment { meetingId, studentId, confirmation: confirmed | changed | declined |
 *   unreachable, date? (YYYY-MM-DD, for confirmed / changed), mode?, reason? (declined), note? }
 */
export async function verifyMeetingPayment(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const meetingId = str(body?.meetingId, 100), sid = str(body?.studentId, 40);
  const s: any = toObjectId(sid) ? await col("students").findOne({ _id: toObjectId(sid) as any }, { projection: { primary_mentor_id: 1, common_cs: 1, full_name: 1 } }) : null;
  if (!meetingId || !s) return notFound("No such meeting or student");
  if (!(await mayVerify(user, s))) return forbidden("This student's CS verifies their payment");
  const confirmation = str(body?.confirmation, 20);
  if (!(CONFIRMATIONS as readonly string[]).includes(confirmation)) return error("Pick what the student said", 400);
  const date = str(body?.date, 10), mode = str(body?.mode, 40), reason = str(body?.reason, 500), note = str(body?.note, 1000);
  if (["confirmed", "changed"].includes(confirmation) && !DAY.test(date)) return error("Pick the payment date the student confirmed", 400);
  if (confirmation === "declined" && reason.length < 3) return error("Say why they won't pay", 400);
  const me: any = await col("users").findOne({ _id: toObjectId(user.id) as any }, { projection: { full_name: 1 } });
  const byName = me?.full_name ?? user.full_name ?? "";
  const doc = {
    meeting_id: meetingId, student_id: sid, confirmation, date: ["confirmed", "changed"].includes(confirmation) ? date : "",
    mode: ["confirmed", "changed"].includes(confirmation) ? mode : "", reason: confirmation === "declined" ? reason : "", note,
    by_id: user.id, by_name: byName, at: nowIso(),
  };
  await col(C).updateOne({ _id: keyOf(meetingId, sid) } as any, { $set: doc, $push: { history: { ...doc } } as any }, { upsert: true });
  if (doc.date) await moveFollowup(sid, doc.date, `${byName} (payment verified)`, `Payment ${confirmation === "confirmed" ? "date confirmed" : "date changed"} with the student: ${doc.date}${doc.mode ? ` by ${doc.mode}` : ""}${note ? ` — ${note}` : ""}`);
  return json({ ok: true });
}

/** POST /api/functions/getPaymentVerifyCount → { count } — the sidebar's: interested outcomes of this person's students not verified yet. */
export async function getPaymentVerifyCount(_req: Request, user: AuthUser): Promise<Response> {
  if (!["cs", "cs_manager"].includes(user.app_role)) return json({ count: 0 });
  const reach = await csManagerReach(user);
  const ids = reach ? reach.ids : [...((await visibleMentorIds(user)) ?? new Set([user.id]))];
  const mine = ((await col("students").find(studentsOf(ids), { projection: { _id: 1 } }).toArray()) as any[]).map((x) => String(x._id));
  if (!mine.length) return json({ count: 0 });
  const since = await sinceOf();
  const outcomes = (await col(OUTCOMES).find({ stage: "interested", student_ids: { $in: mine }, filled_at: { $gte: since } }, { projection: { student_ids: 1 } }).toArray()) as any[];
  const keys = outcomes.flatMap((o) => (o.student_ids ?? []).filter((x: string) => mine.includes(x)).map((x: string) => keyOf(String(o._id), x)));
  if (!keys.length) return json({ count: 0 });
  const done = await col(C).countDocuments({ _id: { $in: keys }, confirmation: { $ne: "unreachable" } } as any);
  return json({ count: keys.length - done });
}

/** Only outcomes from when this started are counted and reminded (no backlog of older meetings). */
async function sinceOf(): Promise<string> {
  const d: any = await col("app_settings").findOneAndUpdate({ _id: "payment_verify_since" as any }, { $setOnInsert: { value: nowIso() } }, { upsert: true, returnDocument: "after" });
  return String((d?.value?.value ?? d?.value) || nowIso());
}

async function csManagersOf(location: string): Promise<string[]> {
  const managers = (await col("users").find({ app_role: "cs_manager", status: { $ne: "inactive" } }, { projection: { _id: 1 } }).toArray()) as any[];
  const ids: string[] = [];
  for (const m of managers) if ((await locationOfUser(String(m._id))) === location) ids.push(String(m._id));
  return ids;
}

/** Unverified 24 hours after the outcome: the CS and their CS Managers reminded, once. */
async function remindTick(): Promise<void> {
  const since = await sinceOf();
  const before = new Date(Date.now() - 24 * 3600_000).toISOString();
  const outcomes = (await col(OUTCOMES).find({ stage: "interested", filled_at: { $gte: since, $lt: before } }, { projection: { student_ids: 1, mentor: 1 } }).limit(200).toArray()) as any[];
  for (const o of outcomes) {
    for (const sid of o.student_ids ?? []) {
      const key = keyOf(String(o._id), sid);
      const v: any = await col(C).findOne({ _id: key } as any, { projection: { confirmation: 1 } });
      if (v && v.confirmation !== "unreachable") continue;
      const claimed = await col("payment_verify_reminders").updateOne({ _id: key } as any, { $setOnInsert: { at: nowIso() } }, { upsert: true });
      if (!claimed.upsertedCount) continue;
      const s: any = await col("students").findOne({ _id: toObjectId(sid) as any }, { projection: { full_name: 1, primary_mentor_id: 1 } });
      const cs = String(s?.primary_mentor_id ?? "");
      const to = [cs, ...(cs ? await csManagersOf(await locationOfUser(cs)) : [])].filter(Boolean);
      await notify(to, { type: "payment_verify", title: `Payment plan not verified — ${String(s?.full_name ?? "a student").trim()}`, body: `${o.mentor?.name || "The mentor"} reported a payment plan 24 hours ago. Call the student and verify it.`, link: "/MeetingsDone?view=verification", tag: `payment-verify-${key}` });
    }
  }
}
export function startPaymentVerifyWorker(): void {
  if (/^(off|false|0|no)$/i.test(process.env.PAYMENT_VERIFY_REMINDERS ?? "")) return;
  setInterval(() => void remindTick().catch((err) => console.error("[payment-verify] run failed", err instanceof Error ? err.message : err)), 15 * 60_000);
}
