import { json, error, forbidden } from "../lib/response";
import type { AuthUser } from "../auth/middleware";
import { col } from "../db";
import { toObjectId } from "../lib/id";
import { getDownlineIds } from "../lib/scope";
import { isAdmin } from "../students/followups";

/* ────────────────────────────────────────────────────────────────────────────
   Meeting commission (the user, 2026-11-10: "the mentors … need to see which
   meeting conducted they got commission … on the Meetings done page with a
   separate tab"). Every Meeting mentor credit (functions/creditCommission.ts —
   the Junior / Senior / Sub-junior Mentor who held the meeting gets the
   Junior + Senior % of a course payment) with the payment it came from and
   the meeting: the one the request links, else that mentor's last meeting
   with the student on the Mentor Calendar before the payment, else none.
   A mentor sees their own, a Chief their team's, a CS Manager and admins
   everyone's; a CS none.
──────────────────────────────────────────────────────────────────────────── */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const AED_PER_USD = 3.67;
const MENTORS = new Set(["junior_mentor", "senior_mentor", "subjunior_mentor"]);
const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Whose Meeting mentor credits this person reads: null everyone's, a set of user ids, or none (false). */
export async function commissionReach(user: AuthUser): Promise<Set<string> | null | false> {
  if (isAdmin(user) || user.app_role === "cs_manager") return null;
  if (user.app_role === "chief_mentor") return new Set([user.id, ...(await getDownlineIds(user.id))]);
  if (MENTORS.has(user.app_role)) return new Set([user.id]);
  return false;
}

export interface MeetingCommissionRow {
  id: string; requested_at: string; paid_on: string; txn_id: string; payment_status: string;
  student: { id: string; name: string; code: string };
  course: string; paid_aed: number;
  mentor: { id: string; name: string };
  pct: number; commission_usd: number; commission_aed: number; status: string;
  /** The meeting it came from — linked on the request, or found on the Mentor Calendar — or null (not booked there). */
  meeting: { id: string; starts_at: string; title: string; stage: string; how: "linked" | "calendar" } | null;
}

/**
 * POST /api/functions/getMeetingCommissions { from, to (YYYY-MM-DD, Dubai days the payment was raised), mentor? (user
 * id) } → { rows, totals: { count, aed, by_status }, mentors } — newest first; reversed (cancelled) credits are listed
 * but not counted.
 */
export async function getMeetingCommissions(req: Request, user: AuthUser): Promise<Response> {
  const reach = await commissionReach(user);
  if (reach === false) return forbidden("Meeting commission is for mentors, Chiefs, CS Managers and admins");
  const body: any = await req.json().catch(() => ({}));
  const from = String(body?.from ?? "").slice(0, 10), to = String(body?.to ?? "").slice(0, 10);
  if (!DAY.test(from) || !DAY.test(to) || from > to) return error("Pick the days: from and to", 400);
  if (Date.parse(to) - Date.parse(from) > 400 * 86_400_000) return error("At most about a year at a time", 400);
  const since = new Date(Date.parse(`${from}T00:00:00+04:00`)).toISOString();
  const until = new Date(Date.parse(`${to}T00:00:00+04:00`) + 86_400_000).toISOString();
  const inDays: Record<string, unknown> = { position: "Meeting mentor", requested_at: { $gte: since, $lt: until } };
  if (reach) inDays.recipient_id = { $in: [...reach] };

  // The mentor filter's list: whoever has some in these days.
  const ids = (await col("commission_credits").distinct("recipient_id", inDays)).map(String);
  const people = ids.length
    ? ((await col("users").find({ _id: { $in: ids.map(toObjectId).filter(Boolean) as any[] } }, { projection: { full_name: 1 } }).toArray()) as any[])
    : [];
  const nameOf = new Map(people.map((u) => [String(u._id), String(u.full_name ?? "")]));
  const mentor = String(body?.mentor ?? "");
  const q = mentor && mentor !== "all" ? { ...inDays, recipient_id: reach && !reach.has(mentor) ? "__none__" : mentor } : inDays;
  const credits = (await col("commission_credits").find(q).sort({ requested_at: -1 }).limit(5000).toArray()) as any[];

  const txIds = [...new Set(credits.map((c) => String(c.transaction_id)))].map(toObjectId).filter(Boolean) as any[];
  const txs = new Map(((await col("funding_transactions").find({ _id: { $in: txIds } }, {
    projection: { student_id: 1, student_name: 1, student_code: 1, status: 1, approved_at: 1, requested_at: 1, txn_id: 1, transaction_id: 1, amount_aed: 1, course_payment: 1, meeting_link: 1, tags: 1 },
  }).toArray()) as any[]).map((t) => [String(t._id), t]));
  const studentIds = [...new Set([...txs.values()].map((t) => String(t.student_id ?? "")).filter(Boolean))];
  const codes = new Map(((await col("students").find({ _id: { $in: studentIds.map(toObjectId).filter(Boolean) as any[] } }, { projection: { student_code: 1, full_name: 1 } }).toArray()) as any[])
    .map((s) => [String(s._id), s]));

  // The meetings: linked on the request (or found when credited), by id; else the mentor's last one before the payment.
  const linkedIds = [...new Set(credits.map((c) => String(txs.get(String(c.transaction_id))?.meeting_link?.meeting_id || c.meeting_outcome_id || "")).filter(Boolean))];
  const byId = new Map(((await col("meeting_outcomes").find({ _id: { $in: linkedIds } } as any, { projection: { meeting: 1, stage: 1 } }).toArray()) as any[])
    .map((m) => [String(m._id), m]));
  const emails = new Map(((await col("users").find({ _id: { $in: [...new Set(credits.map((c) => String(c.recipient_id)))].map(toObjectId).filter(Boolean) as any[] } }, { projection: { email: 1 } }).toArray()) as any[])
    .map((u) => [String(u._id), String(u.email ?? "").trim().toLowerCase()]));

  const rows: MeetingCommissionRow[] = [];
  for (const c of credits) {
    const t = txs.get(String(c.transaction_id));
    const sid = String(t?.student_id ?? c.student_id ?? "");
    const paidAt = String(t?.requested_at ?? c.requested_at ?? "");
    let meeting: MeetingCommissionRow["meeting"] = null;
    const linkedId = String(t?.meeting_link?.meeting_id || c.meeting_outcome_id || "");
    const linked = linkedId ? byId.get(linkedId) : null;
    if (linked) meeting = { id: linkedId, starts_at: String(linked.meeting?.starts_at ?? ""), title: String(linked.meeting?.title ?? ""), stage: String(linked.stage ?? ""), how: "linked" };
    else if (sid && emails.get(String(c.recipient_id))) {
      const m: any = await col("meeting_outcomes").findOne(
        { student_ids: sid, "mentor.email": { $regex: `^\\s*${escRe(emails.get(String(c.recipient_id))!)}\\s*$`, $options: "i" }, "meeting.starts_at": { $lt: paidAt } },
        { sort: { "meeting.starts_at": -1 }, projection: { meeting: 1, stage: 1 } },
      );
      if (m) meeting = { id: String(m._id), starts_at: String(m.meeting?.starts_at ?? ""), title: String(m.meeting?.title ?? ""), stage: String(m.stage ?? ""), how: "calendar" };
    }
    const usd = Number(c.commission_usd) || 0;
    const s = codes.get(sid);
    rows.push({
      id: String(c._id), requested_at: paidAt, paid_on: String(t?.approved_at ?? ""), txn_id: String(t?.txn_id || t?.transaction_id || c.txn_id || ""),
      payment_status: String(t?.status ?? ""),
      student: { id: sid, name: String(s?.full_name ?? t?.student_name ?? c.student_name ?? "").trim(), code: String(s?.student_code ?? t?.student_code ?? "") },
      course: String(t?.course_payment?.product || c.tag || ""), paid_aed: round2(Number(t?.course_payment?.paid_today_aed) || Number(t?.amount_aed) || 0),
      mentor: { id: String(c.recipient_id ?? ""), name: String(c.recipient_name || nameOf.get(String(c.recipient_id)) || "") },
      pct: Number(c.percentage) || 0, commission_usd: round2(usd), commission_aed: round2(usd * AED_PER_USD), status: String(c.status ?? ""),
      meeting,
    });
  }
  const counted = rows.filter((r) => r.status !== "cancelled");
  const byStatus: Record<string, number> = {};
  for (const r of counted) byStatus[r.status] = round2((byStatus[r.status] ?? 0) + r.commission_aed);
  return json({
    rows,
    totals: { count: counted.length, aed: round2(counted.reduce((a, r) => a + r.commission_aed, 0)), by_status: byStatus },
    mentors: ids.map((id) => ({ id, name: nameOf.get(id) || "?" })).sort((a, b) => a.name.localeCompare(b.name)),
    sees: reach === null ? "everyone" : reach.size > 1 ? "team" : "own",
  });
}
