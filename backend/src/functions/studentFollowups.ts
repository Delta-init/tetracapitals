import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { loadTeams } from "../students/teams";
import { tagNamesOf } from "../students/tags";
import {
  TARGET_OUTCOMES, STAGES, LOST_REASONS, CLOSED_STAGES,
  businessToday, followupStatus, visibleMentorIds, canWorkOn, studentsOf, recordEvents, autoConvert,
} from "../students/followups";
import { theirStudents } from "../students/closedBy";
import { MT5_LOGIN, mt5LoginOf, mt5Of, mt5Owner, keepMt5 } from "../students/mt5";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);
const who = (u: AuthUser) => u.full_name || u.email || "somebody";

/* ── The student's MT5, and the bonus promised at the sales close (the user, 2026-10-04) ──────────────────────
   The call log asks for the student's MT5 ID until they have one; it is kept as their MT5 account (students/mt5.ts —
   the list on the student page), from a call that didn't connect too. After a call that connected, each bonus finance
   says was given at the sales close (course_fees) goes to the admins as a Bonus request to credit in their MT5 — the
   one given now, or the one they have — once per invoice, and a credit only: `bonus_credit` makes creditCommission
   pay nobody commission on it, and the Summary leaves it out of Bonus In. */
const AED_PER_USD = 3.67;

/** The bonus promised at each sales close (finance's course fees) — given or not, and how much; [] when not known. */
export function salesBonusOf(student: any) {
  return (Array.isArray(student?.course_fees) ? student.course_fees : [])
    .filter((f: any) => f && (f.bonus_given === true || f.bonus_given === false))
    .map((f: any) => ({
      invoice_id: String(f.invoice_id ?? ""),
      invoice_number: String(f.invoice_number ?? ""),
      course: String(f.course ?? ""),
      given: f.bonus_given === true,
      amount: f.bonus_given === true ? Math.round(Number(f.bonus_minor) || 0) / 100 : 0,
      currency: String(f.bonus_currency || f.currency || "AED").toUpperCase(),
    }));
}

/** Each sales-close bonus not raised yet goes to the admins to credit in `login` — a credit only; how many went. */
async function raiseSalesBonusCredits(student: any, login: string, user: AuthUser): Promise<number> {
  let raised = 0;
  for (const b of salesBonusOf(student)) {
    if (!b.given || !(b.amount > 0)) continue;
    const usd = b.currency === "USD" ? b.amount : Math.round((b.amount / AED_PER_USD) * 100) / 100;
    const aed = b.currency === "USD" ? Math.round(b.amount * AED_PER_USD * 100) / 100 : b.amount;
    const money = b.currency === "USD" ? `$${b.amount.toLocaleString("en-US")}` : `${b.currency} ${b.amount.toLocaleString("en-US")}`;
    const now = new Date().toISOString();
    // Once per invoice: an upsert, so a second log (or two at once) finds it there.
    const res = await col("funding_transactions").updateOne(
      { student_id: String(student._id), bonus_credit: "sales_close", "sales_close.invoice_id": b.invoice_id },
      {
        $setOnInsert: {
          type: "BONUS", status: "PENDING", bonus_credit: "sales_close",
          sales_close: { invoice_id: b.invoice_id, invoice_number: b.invoice_number, course: b.course },
          amount_currency: b.currency, amount_original: b.amount, amount_aed: aed, amount_usd: usd, fx_rate_aed_per_usd: AED_PER_USD,
          mt5_login: login, tags: [], payment_method: "", screenshot_url: "",
          student_id: String(student._id), student_name: student.full_name ?? "", student_code: student.student_code ?? "",
          primary_mentor_id: student.primary_mentor_id ?? "", primary_mentor_name: student.primary_mentor_name ?? "",
          senior_mentor_id: student.senior_mentor_id ?? null, senior_mentor_name: student.senior_mentor_name ?? null,
          initiating_mentor_id: user.id, initiating_mentor_name: who(user), upline_commission_percentage: 0,
          requested_by_id: user.id, requested_by_name: who(user), requested_at: now,
          notes: `Sales-close bonus credit — ${b.course || "the course"}${b.invoice_number ? `, invoice ${b.invoice_number}` : ""}: ${money} promised at the close. Credit it in MT5 ${login}. No commission on it.`,
          created_date: now, updated_date: now,
        },
      },
      { upsert: true },
    );
    if (res.upsertedCount) raised++;
  }
  return raised;
}

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
  // Their own, and students Common with them — for the Sales role, the students they closed (to read: canWorkOn says no).
  if (visible) Object.assign(studentFilter, await theirStudents(user, studentsOf(visible)));
  if (studentId) {
    const oid = toObjectId(studentId);
    if (!oid) return error("Bad studentId", 400);
    studentFilter._id = oid;
  }
  const followFilter: Record<string, any> = {};
  let students: any[] = [];
  if (visible || studentId) {
    students = (await col("students")
      .find(studentFilter, { projection: { full_name: 1, student_code: 1, phone: 1, email: 1, primary_mentor_id: 1, primary_mentor_name: 1, team_name: 1, common_cs: 1, tags: 1, enrolment_status: 1 } })
      .toArray()) as any[];
    followFilter.student_id = { $in: students.map((s) => String(s._id)) };
  }
  const followups = (await col("student_followups").find(followFilter).sort({ next_followup_date: 1 }).toArray()) as any[];
  if (!visible && !studentId) {
    const ids = [...new Set(followups.map((f) => f.student_id))].map(toObjectId).filter(Boolean);
    students = ids.length
      ? ((await col("students").find({ _id: { $in: ids as any[] } }, { projection: { full_name: 1, student_code: 1, phone: 1, email: 1, primary_mentor_id: 1, primary_mentor_name: 1, team_name: 1, common_cs: 1, tags: 1, enrolment_status: 1 } }).toArray()) as any[])
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
        tag_names: tagNamesOf(s),
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
        // Overdue: when the CS's leaders were told it went overdue (for this due date), or null.
        leaders_told_at: f.leader_alert?.due && f.leader_alert.due === f.next_followup_date ? f.leader_alert.at ?? null : null,
        can_edit: canWorkOn(user, s),
        created_date: f.created_date,
        created_by_name: f.created_by_name ?? "",
      };
    });

  // Each student's latest 3CX call, next to what was logged.
  const sids = [...new Set(rows.map((r) => r.student_id))];
  const lastCalls = sids.length
    ? await col("student_calls").aggregate([
      { $match: { student_id: { $in: sids } } },
      { $sort: { started_at: -1 } },
      { $group: { _id: "$student_id", at: { $first: "$started_at" }, direction: { $first: "$direction" }, status: { $first: "$status" }, talk_seconds: { $first: "$talk_seconds" }, by: { $first: "$user_name" }, agent: { $first: "$agent_name" } } },
    ]).toArray()
    : [];
  const lastCallOf = new Map(lastCalls.map((c: any) => [String(c._id), { at: c.at, direction: c.direction, status: c.status, talk_seconds: c.talk_seconds ?? 0, by: c.by || c.agent || "" }]));
  for (const r of rows as any[]) r.last_call = lastCallOf.get(r.student_id) ?? null;

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
    out.history = historyOf(rows, out.events);
    out.can_create = students[0] ? canWorkOn(user, students[0]) : false;
    // For the call log: the MT5 it asks for until there is one, and what the sales close promised.
    out.mt5 = await mt5Of(studentId);
    out.sales_bonus = salesBonusOf(await col("students").findOne({ _id: toObjectId(studentId) as any }, { projection: { course_fees: 1 } }));
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
 * For the student's own mentor (or Super Admin / Admin). Starts at stage New. One follow-up per student (the user,
 * 2026-10-04): while one is open — not Converted or Lost — another is refused (409, with its followup_id) and each
 * call is logged on it.
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
  const open: any = await col("student_followups").findOne(
    { student_id: String(student._id), stage: { $nin: [...CLOSED_STAGES] } },
    { sort: { created_date: -1 } },
  );
  if (open) {
    return error(`${String(student.full_name ?? "").trim() || "This student"} already has a follow-up (${open.target_outcome} · ${open.stage}) — log the call on it instead`, 409, { followup_id: String(open._id) });
  }

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
    ...(doc.client_said ? { client_said: doc.client_said } : {}),
    ...(doc.notes ? { notes: doc.notes } : {}),
    text: `Follow-up opened for ${outcome}${next ? `, next follow-up ${next}` : ""}`,
  }]);
  return json({ id: String(res.insertedId) });
}

/**
 * What the client said, and the notes, every time — not only the latest the follow-up keeps: each entry as it was
 * written (when a follow-up was opened or logged, or a note on its own), newest first, with who, when, and the
 * follow-up and its stage then. A follow-up from before every entry was kept shows its current text once; a log
 * that only repeated the last "what client said" (as logs used to) isn't counted again.
 */
function historyOf(followups: any[], events: any[]) {
  const byId = new Map(followups.map((f) => [String(f.id), f]));
  const entry = (e: any, text: string) => {
    const f = byId.get(String(e.followup_id ?? ""));
    return {
      text, at: e.at, by_name: e.by_name ?? "", followup_id: String(e.followup_id ?? ""), outcome: f?.target_outcome ?? "", stage: e.stage_to ?? f?.stage ?? "",
      ...(e.earlier ? { earlier: true } : {}),
    };
  };
  const said: any[] = [];
  const notes: any[] = [];
  const lastSaid = new Map<string, string>();
  const written = events.filter((e) => e.kind === "created" || e.kind === "logged" || e.kind === "note")
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const e of written) {
    const s = String(e.client_said ?? "").trim();
    if (s && lastSaid.get(String(e.followup_id)) !== s) {
      said.push(entry(e, s));
      lastSaid.set(String(e.followup_id), s);
    }
    const n = String(e.notes ?? "").trim();
    if (n) notes.push(entry(e, n));
  }
  for (const f of followups) {
    const earlier = { at: f.created_date, by_name: f.created_by_name ?? "", followup_id: f.id, stage_to: null };
    const s = String(f.client_said ?? "").trim();
    const n = String(f.notes ?? "").trim();
    if (s && !said.some((x) => x.followup_id === f.id && x.text === s)) said.push({ ...entry(earlier, s), earlier: true });
    if (n && !notes.some((x) => x.followup_id === f.id && x.text === n)) notes.push({ ...entry(earlier, n), earlier: true });
  }
  const newest = (a: any, b: any) => String(b.at).localeCompare(String(a.at));
  return { client_said: said.sort(newest), notes: notes.sort(newest) };
}

/**
 * What a follow-up still holds from before every entry was kept — its "what client said" and notes as they were
 * last written, in no log entry — goes into the log as it is, before a log writes the follow-up anew. Otherwise
 * the first log after this change would overwrite the one copy there is.
 */
async function keepWhatCameBefore(f: any): Promise<void> {
  const fid = String(f._id);
  const said = String(f.client_said ?? "").trim();
  const notes = String(f.notes ?? "").trim();
  if (!said && !notes) return;
  const logged = (await col("student_followup_events").find({ followup_id: fid }, { projection: { client_said: 1, notes: 1 } }).toArray()) as any[];
  const keepSaid = !!said && !logged.some((e) => String(e.client_said ?? "").trim() === said);
  const keepNotes = !!notes && !logged.some((e) => String(e.notes ?? "").trim() === notes);
  if (!keepSaid && !keepNotes) return;
  await recordEvents([{
    followup_id: fid, student_id: String(f.student_id), at: String(f.updated_date || f.created_date || new Date().toISOString()),
    by_id: f.created_by_id ? String(f.created_by_id) : null, by_name: String(f.created_by_name ?? ""),
    kind: "note", earlier: true, stage_to: f.stage ?? null,
    ...(keepSaid ? { client_said: said } : {}),
    ...(keepNotes ? { notes } : {}),
    text: "Kept from before every entry was kept",
  }]);
}

/**
 * POST /api/functions/addFollowupNote { studentId, followupId?, notes }
 * A note on its own, between calls — as the Sales CRM's notes. On the follow-up named, else on the student's
 * latest open one (or none). For whoever may work on the student.
 */
export async function addFollowupNote(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => null);
  const oid = toObjectId(str(body?.studentId, 40));
  if (!oid) return error("studentId is required", 400);
  const text = str(body?.notes);
  if (!text) return error("Write the note first", 400);
  const student: any = await col("students").findOne({ _id: oid });
  if (!student) return notFound();
  if (!canWorkOn(user, student)) return forbidden();
  const sid = String(student._id);
  const wanted = toObjectId(str(body?.followupId, 40));
  const f: any = wanted
    ? await col("student_followups").findOne({ _id: wanted, student_id: sid })
    : await col("student_followups").find({ student_id: sid, stage: { $nin: [...CLOSED_STAGES] } }).sort({ updated_date: -1 }).limit(1).next();
  if (wanted && !f) return notFound("That follow-up isn't this student's");
  await recordEvents([{
    followup_id: f ? String(f._id) : "", student_id: sid, at: new Date().toISOString(), by_id: user.id, by_name: who(user),
    kind: "note", stage_to: f?.stage ?? null, notes: text, text: "Note added",
  }]);
  return json({ ok: true });
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
  const mt5 = mt5LoginOf(body?.mt5Login);
  if (mt5 && !MT5_LOGIN.test(mt5)) return error("The MT5 ID is its login number — digits only", 400);
  // A login is one student's: another student's is said before anything is written — not whose it is.
  const mt5Holder = mt5 ? await mt5Owner(mt5) : null;
  if (mt5Holder !== null && mt5Holder !== String(student._id)) return error("That MT5 ID is already saved for another student — check the number", 409);
  // The target outcome can change with a call — what it is about now (e.g. an Onboarding call becoming DSLP).
  const target = str(body?.targetOutcome, 60);
  if (target && !(TARGET_OUTCOMES as readonly string[]).includes(target)) return error("Pick a target outcome", 400);
  const retarget = !!target && target !== f.target_outcome;
  // A call from the Not onboarded page says whether it connected: not — they show as Not connected there (with how
  // many tries), and the sales close's bonus waits for a call that did.
  const connected = body?.connected === true ? true : body?.connected === false ? false : null;

  const today = businessToday();
  const patch: Record<string, any> = {
    stage,
    last_contact_date: today,
    followup_count: (Number(f.followup_count) || 0) + 1,
    objection_reason: reason,
    next_followup_date: CLOSED_STAGES.has(stage) ? "" : next,
    updated_date: new Date().toISOString(),
    ...(retarget ? { target_outcome: target } : {}),
  };
  // What was written this time — the follow-up keeps the latest, and the log keeps each one (historyOf).
  const said = str(body?.clientSaid);
  const noteText = str(body?.notes);
  if (said) patch.client_said = said;
  if (noteText) patch.notes = noteText;
  if (said || noteText) await keepWhatCameBefore(f);
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
  if (connected !== null) {
    await col("students").updateOne({ _id: student._id }, {
      $set: { onboarding_call: { connected, at: patch.updated_date, by_id: user.id, by_name: who(user) } },
      ...(connected ? {} : { $inc: { onboarding_call_attempts: 1 } }),
    });
  }
  // The MT5 given on this call: kept as theirs, connected or not. After a call that connected, the sales close's
  // bonus goes to be credited — in the MT5 given now, or the one they have (once per invoice: an upsert).
  const kept = mt5 ? await keepMt5(student, mt5, { email: user.email, name: who(user) }, "call log") : null;
  const mt5Saved = kept === "saved";
  const creditIn = connected === false || kept === "taken" ? "" : kept ? mt5 : ((await mt5Of(String(student._id)))[0] ?? "");
  const bonusCredits = creditIn ? await raiseSalesBonusCredits(student, creditIn, user) : 0;
  const moved = f.stage !== stage;
  await recordEvents([{
    followup_id: String(oid), student_id: String(f.student_id), at: patch.updated_date, by_id: user.id, by_name: who(user),
    kind: "logged", stage_from: f.stage, stage_to: stage, next_followup_date: patch.next_followup_date,
    ...(said ? { client_said: said } : {}),
    ...(noteText ? { notes: noteText } : {}),
    text: `${retarget ? `Target: ${f.target_outcome || "—"} → ${target} · ` : ""}${moved ? `${f.stage} → ${stage}` : stage}${reason ? ` (${reason})` : ""}${stage === "Converted" ? ` — $${Number(patch.deal_value).toLocaleString("en-US")}` : ""}${patch.next_followup_date ? ` · next ${patch.next_followup_date}` : ""}`
      + `${connected === false ? " · not connected" : connected ? " · connected" : ""}${mt5Saved ? ` · MT5 ${mt5} saved` : ""}${bonusCredits ? ` · sales-close bonus sent to be credited` : ""}`,
  }]);
  return json({ ok: true, followup_status: followupStatus({ ...f, ...patch }), mt5_saved: mt5Saved, bonus_credits: bonusCredits });
}

/** POST /api/functions/getFollowupTeams — team names for the page's filter (any signed-in staff). */
export async function getFollowupTeams(_req: Request, _user: AuthUser): Promise<Response> {
  const { teams } = await loadTeams();
  return json({ teams: teams.map((t) => ({ id: t.id, name: t.name })) });
}
