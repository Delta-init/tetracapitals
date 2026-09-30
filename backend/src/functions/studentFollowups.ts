import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { loadTeams } from "../students/teams";
import {
  TARGET_OUTCOMES, STAGES, LOST_REASONS, CLOSED_STAGES,
  businessToday, followupStatus, visibleMentorIds, canWorkOn, recordEvents, autoConvert,
} from "../students/followups";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);
const who = (u: AuthUser) => u.full_name || u.email || "somebody";

/**
 * POST /api/functions/getFollowups
 * Body: { studentId? }
 * Returns: { followups: [...with student + status], stats, lists, events? (with studentId) }
 *
 * Follow-ups for the students `user` may see: their own; Chief Mentor and CS
 * Manager also everyone under them; admin roles everyone. Open follow-ups are
 * checked for auto-conversion first, so what you see is current.
 */
export async function getFollowups(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const visible = await visibleMentorIds(user);
  const studentId = str(body?.studentId, 40);

  const studentFilter: Record<string, any> = {};
  if (visible) studentFilter.primary_mentor_id = { $in: [...visible] };
  if (studentId) {
    const oid = toObjectId(studentId);
    if (!oid) return error("Bad studentId", 400);
    studentFilter._id = oid;
  }
  const followFilter: Record<string, any> = {};
  let students: any[] = [];
  if (visible || studentId) {
    students = (await col("students")
      .find(studentFilter, { projection: { full_name: 1, student_code: 1, phone: 1, email: 1, primary_mentor_id: 1, primary_mentor_name: 1, team_name: 1 } })
      .toArray()) as any[];
    followFilter.student_id = { $in: students.map((s) => String(s._id)) };
  }
  const followups = (await col("student_followups").find(followFilter).sort({ next_followup_date: 1 }).toArray()) as any[];
  if (!visible && !studentId) {
    const ids = [...new Set(followups.map((f) => f.student_id))].map(toObjectId).filter(Boolean);
    students = ids.length
      ? ((await col("students").find({ _id: { $in: ids as any[] } }, { projection: { full_name: 1, student_code: 1, phone: 1, email: 1, primary_mentor_id: 1, primary_mentor_name: 1, team_name: 1 } }).toArray()) as any[])
      : [];
  }
  await autoConvert(followups);

  const byId = new Map(students.map((s) => [String(s._id), s]));
  const today = businessToday();
  const rows = followups
    .filter((f) => byId.has(String(f.student_id)))
    .map((f) => {
      const s = byId.get(String(f.student_id));
      return {
        id: String(f._id),
        student_id: String(f.student_id),
        student_name: s.full_name ?? "",
        student_code: s.student_code ?? "",
        phone: s.phone ?? "",
        email: s.email ?? "",
        mentor_id: String(s.primary_mentor_id ?? ""),
        mentor_name: s.primary_mentor_name ?? "",
        team_name: s.team_name ?? "",
        target_outcome: f.target_outcome,
        stage: f.stage,
        last_contact_date: f.last_contact_date ?? "",
        next_followup_date: f.next_followup_date ?? "",
        followup_status: followupStatus(f, today),
        followup_count: Number(f.followup_count) || 0,
        client_said: f.client_said ?? "",
        objection_reason: f.objection_reason ?? "",
        converted_date: f.converted_date ?? "",
        deal_value: f.deal_value ?? null,
        notes: f.notes ?? "",
        auto_converted: !!f.converted_by_deposit_id,
        // The latest reminder email about it: { date, status, reason, at, to, seen_at }.
        reminder: f.last_reminder ?? null,
        can_edit: canWorkOn(user, s),
        created_date: f.created_date,
      };
    });

  const converted = rows.filter((r) => r.stage === "Converted");
  const lost = rows.filter((r) => r.stage === "Lost").length;
  const stats = {
    total: rows.length,
    converted: converted.length,
    lost,
    in_progress: rows.length - converted.length - lost,
    conversion_rate: rows.length ? converted.length / rows.length : 0,
    overdue: rows.filter((r) => r.followup_status === "OVERDUE").length,
    due_today: rows.filter((r) => r.followup_status === "DUE TODAY").length,
    revenue: converted.reduce((a, r) => a + (Number(r.deal_value) || 0), 0),
  };

  const out: any = { today, followups: rows, stats, lists: { outcomes: TARGET_OUTCOMES, stages: STAGES, lost_reasons: LOST_REASONS } };
  if (studentId) {
    out.events = await col("student_followup_events").find({ student_id: studentId }).sort({ at: -1 }).limit(500).toArray();
    out.can_create = students[0] ? canWorkOn(user, students[0]) : false;
    // Reminder emails that listed this student's follow-ups, newest first.
    const ids = rows.map((r) => r.id);
    out.reminders = ids.length
      ? ((await col("followup_reminders")
        .find({ followup_ids: { $in: ids } }, { projection: { date: 1, status: 1, reason: 1, to: 1, mentor_name: 1, sent_at: 1, seen_at: 1, last_attempt_at: 1, created_at: 1, items: 1 } })
        .sort({ date: -1 })
        .limit(90)
        .toArray()) as any[]).map((r) => ({
        id: String(r._id),
        date: r.date,
        status: r.status,
        reason: r.reason ?? "",
        to: r.to ?? "",
        mentor_name: r.mentor_name ?? "",
        at: r.sent_at || r.last_attempt_at || r.created_at,
        seen_at: r.seen_at ?? null,
        items: (r.items ?? []).filter((i: any) => ids.includes(i.followup_id)).map((i: any) => ({ followup_id: i.followup_id, status: i.status })),
      }))
      : [];
  }
  return json(out);
}

/**
 * POST /api/functions/createFollowup
 * Body: { studentId, targetOutcome, nextFollowupDate?, clientSaid?, notes? }
 * For the student's own mentor (or Super Admin / Admin). Starts at stage New.
 */
export async function createFollowup(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => null);
  const oid = toObjectId(str(body?.studentId, 40));
  if (!oid) return error("studentId is required", 400);
  const outcome = str(body?.targetOutcome, 60);
  if (!(TARGET_OUTCOMES as readonly string[]).includes(outcome)) return error("Pick a target outcome", 400);
  const next = str(body?.nextFollowupDate, 10);
  if (next && !DATE.test(next)) return error("Next follow-up must be a date", 400);

  const student: any = await col("students").findOne({ _id: oid });
  if (!student) return notFound();
  if (!canWorkOn(user, student)) return forbidden();

  const now = new Date().toISOString();
  const doc = {
    student_id: String(student._id),
    target_outcome: outcome,
    stage: "New",
    last_contact_date: "",
    next_followup_date: next,
    followup_count: 0,
    client_said: str(body?.clientSaid),
    objection_reason: "",
    converted_date: "",
    deal_value: null,
    notes: str(body?.notes),
    created_by_id: user.id,
    created_by_name: who(user),
    created_date: now,
    updated_date: now,
  };
  const res = await col("student_followups").insertOne(doc as any);
  await recordEvents([{
    followup_id: String(res.insertedId), student_id: doc.student_id, at: now, by_id: user.id, by_name: who(user),
    kind: "created", stage_to: "New", next_followup_date: next,
    text: `Follow-up opened for ${outcome}${next ? `, next follow-up ${next}` : ""}`,
  }]);
  return json({ id: String(res.insertedId) });
}

/**
 * POST /api/functions/logFollowup
 * Body: { id, stage, clientSaid?, nextFollowupDate?, objectionReason?, convertedDate?, dealValue?, notes? }
 * One call / contact: last contact = today, count + 1. Lost needs a reason;
 * Converted needs a date and a deal value.
 */
export async function logFollowup(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => null);
  const oid = toObjectId(str(body?.id, 40));
  if (!oid) return error("id is required", 400);
  const f: any = await col("student_followups").findOne({ _id: oid });
  if (!f) return notFound();
  const student: any = await col("students").findOne({ _id: toObjectId(f.student_id) as any });
  if (!student || !canWorkOn(user, student)) return forbidden();

  const stage = str(body?.stage, 40);
  if (!(STAGES as readonly string[]).includes(stage)) return error("Pick a stage", 400);
  const next = str(body?.nextFollowupDate, 10);
  if (next && !DATE.test(next)) return error("Next follow-up must be a date", 400);
  const reason = str(body?.objectionReason, 80);
  if (reason && !(LOST_REASONS as readonly string[]).includes(reason)) return error("Pick a reason from the list", 400);
  if (stage === "Lost" && !reason) return error("A lost follow-up needs a lost reason", 400);

  const today = businessToday();
  const patch: Record<string, any> = {
    stage,
    last_contact_date: today,
    followup_count: (Number(f.followup_count) || 0) + 1,
    objection_reason: reason,
    next_followup_date: CLOSED_STAGES.has(stage) ? "" : next,
    updated_date: new Date().toISOString(),
  };
  if (body?.clientSaid !== undefined) patch.client_said = str(body.clientSaid);
  if (body?.notes !== undefined) patch.notes = str(body.notes);
  if (stage === "Converted") {
    const cd = str(body?.convertedDate, 10) || today;
    const dv = Number(body?.dealValue);
    if (!DATE.test(cd)) return error("Converted date must be a date", 400);
    if (!Number.isFinite(dv) || dv < 0) return error("A converted follow-up needs a deal value", 400);
    patch.converted_date = cd;
    patch.deal_value = dv;
  } else if (f.stage === "Converted") {
    // Reopened: it no longer counts as converted.
    patch.converted_date = "";
    patch.deal_value = null;
    patch.converted_by_deposit_id = null;
  }

  await col("student_followups").updateOne({ _id: oid }, { $set: patch });
  const moved = f.stage !== stage;
  await recordEvents([{
    followup_id: String(oid), student_id: String(f.student_id), at: patch.updated_date, by_id: user.id, by_name: who(user),
    kind: "logged", stage_from: f.stage, stage_to: stage, client_said: patch.client_said ?? f.client_said ?? "", next_followup_date: patch.next_followup_date,
    text: `${moved ? `${f.stage} → ${stage}` : stage}${reason ? ` (${reason})` : ""}${stage === "Converted" ? ` — $${Number(patch.deal_value).toLocaleString("en-US")}` : ""}${patch.next_followup_date ? ` · next ${patch.next_followup_date}` : ""}`,
  }]);
  return json({ ok: true, followup_status: followupStatus({ ...f, ...patch }) });
}

/** POST /api/functions/getFollowupTeams — team names for the page's filter (any signed-in staff). */
export async function getFollowupTeams(_req: Request, _user: AuthUser): Promise<Response> {
  const { teams } = await loadTeams();
  return json({ teams: teams.map((t) => ({ id: t.id, name: t.name })) });
}
