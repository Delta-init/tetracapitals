import { col } from "../db";
import { toObjectId } from "../lib/id";
import { callLms, lmsConfigured } from "../lib/lms";
import { loadTeams } from "../students/teams";
import { bonusStageOf, notSentOf } from "../students/bonusPending";
import { PROGRAM_NOTICES } from "../students/programNotices";
import {
  rangeOf, grouper, meta, inRange, raisedBy, when, creditUsdOf, paidAedOf, usdOf, personOf, counts, type ReportCtx, type Person,
} from "../functions/reports";

/* ────────────────────────────────────────────────────────────────────────────
   GET /api/v1/service/cs-report — the Root portal's Reports → CS portal tab
   (the user, 2026-10-17): what the CSs did in a period, by the Reports
   section's own rules (functions/reports.ts — UAE days, a row for the person
   it counts for, their team and its location, and by month):

     revenue      deposits and withdrawals approved in the period (when
                  approved), course payments finance approved (when decided)
     followups    follow-up work logged — calls logged, follow-ups opened,
                  students contacted, moved to Converted or Lost (by who did it)
     calls        3CX calls with students (by who took them): connected, talk
     programs     programs a CS made with classes in the period: classes held,
                  cancelled, students on them, confirmed / can't attend
     onboarded    students onboarded in the period (for their CS)
     bonus        bonuses raised in the period by where they stand, as the
                  Bonus report — needs a call, with finance, broker admin,
                  approved, rejected — USD and the AED paid
     commission   commission credited in the period (pool rows aside)
     upgrades     course upgrades started in the period, and AED approved on
                  any in the period

   The same filters as the Reports section: period (or from/to), location,
   team, cs. Everyone's — Root's root admins. Each section carries its rows
   (the latest 2000). Money in AED (the user, 2026-10-17: "all in AED, only the bonus in
   USD") — as recorded, else USD at the portal's fixed 3.67; a bonus keeps its USD
   (the MT5 bonus) beside the AED paid. Read-only.
──────────────────────────────────────────────────────────────────────────── */

const ROWS = 2000;
type Q = Record<string, string | undefined>;
const iso = (t: number) => (Number.isFinite(t) ? new Date(t).toISOString() : "");
const latest = <T extends { at: string }>(rows: T[]) => rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, ROWS);
/** AED as recorded, else the USD at the portal's fixed 3.67. */
const aedFrom = (aed: unknown, usd: number) => (Number(aed) > 0 ? Number(aed) : Math.round(usd * 367) / 100);
const who = (p: Person) => ({ cs_id: p.id, cs: p.name, team: p.team, location: p.location });

export async function csReportForPortal(q: Q): Promise<Record<string, unknown> | string> {
  const range = rangeOf({ period: q.period ?? (q.from || q.to ? "custom" : "month"), from: q.from, to: q.to });
  if (typeof range === "string") return range;
  const ctx: ReportCtx = {
    ...range, index: await loadTeams(), reach: null, lockedLocation: null,
    location: q.location === "dubai" || q.location === "bangalore" ? q.location : null,
    team: String(q.team ?? "").slice(0, 40), cs: String(q.cs ?? "").slice(0, 40),
  };
  const P = (id: unknown, fallback = "") => personOf(ctx, String(id ?? ""), fallback);

  const [txs, payments, upgrades, events, calls, credits, onboarded, notSent] = await Promise.all([
    col("funding_transactions").find({ type: { $in: ["DEPOSIT", "WITHDRAWAL", "BONUS"] } }, { projection: {
      type: 1, status: 1, amount_usd: 1, amount_aed: 1, course_payment: 1, bonus_credit: 1, initiating_mentor_id: 1, primary_mentor_id: 1, primary_mentor_name: 1,
      student_id: 1, student_name: 1, requested_at: 1, created_date: 1, approved_at: 1, updated_date: 1, finance_approval: 1, returned: 1, resubmitted_as: 1, mt5_login: 1 } }).toArray(),
    col("course_payments").find({ status: "approved" }, { projection: { upgrade_id: 1, student_id: 1, amount_aed: 1, approved_amount_aed: 1, decided_at: 1, created_by: 1, method: 1 } }).toArray(),
    col("course_upgrades").find({ status: { $ne: "cancelled" } }, { projection: { student_id: 1, course: 1, plan: 1, status: 1, created_by: 1, created_by_name: 1, created_at: 1, "quote.dueAed": 1 } }).toArray(),
    col("student_followup_events").find({ at: { $gte: iso(ctx.since || 0), ...(ctx.until < Number.MAX_SAFE_INTEGER ? { $lt: iso(ctx.until) } : {}) } } as any,
      { projection: { followup_id: 1, student_id: 1, at: 1, by_id: 1, by_name: 1, kind: 1, stage_from: 1, stage_to: 1, text: 1, client_said: 1 } }).toArray(),
    col("student_calls").find({ started_at: { $gte: iso(ctx.since || 0), ...(ctx.until < Number.MAX_SAFE_INTEGER ? { $lt: iso(ctx.until) } : {}) } } as any,
      { projection: { user_id: 1, user_name: 1, started_at: 1, direction: 1, status: 1, answered: 1, talk_seconds: 1, recording_ids: 1, student_id: 1, student_name: 1, student_code: 1, number: 1 } }).toArray(),
    col("commission_credits").find({ is_pool: { $ne: true } }, { projection: { recipient_id: 1, recipient_name: 1, commission_usd: 1, requested_at: 1, created_date: 1, student_id: 1, student_name: 1, level: 1, transaction_type: 1, status: 1, transaction_id: 1 } }).toArray(),
    col("students").find({ onboarded: true, onboarded_at: { $type: "string" } }, { projection: { full_name: 1, student_code: 1, primary_mentor_id: 1, primary_mentor_name: 1, onboarded_at: 1, onboarded_by_name: 1, finance_invoice_id: 1, created_date: 1 } }).toArray(),
    notSentOf({}),
  ]) as any[];

  // Students named anywhere, for the rows.
  const sids = new Set<string>();
  for (const x of [...txs, ...payments, ...upgrades, ...events, ...credits]) if (x.student_id) sids.add(String(x.student_id));
  for (const k of notSent.keys()) sids.add(k);
  const students = sids.size ? ((await col("students").find({ _id: { $in: [...sids].map((s) => toObjectId(s)).filter(Boolean) as any[] } },
    { projection: { full_name: 1, student_code: 1, primary_mentor_id: 1, primary_mentor_name: 1 } }).toArray()) as any[]) : [];
  const studentById = new Map(students.map((s) => [String(s._id), s]));
  const stu = (id: unknown, name = "") => {
    const s = studentById.get(String(id ?? ""));
    return { student_id: String(id ?? ""), student: String(s?.full_name || name || ""), code: String(s?.student_code ?? "") };
  };

  /* ── Revenue ─────────────────────────────────────────────────────────── */
  const revenue = grouper(() => ({ deposits: 0, deposit_usd: 0, deposit_aed: 0, withdrawals: 0, withdrawal_usd: 0, withdrawal_aed: 0, course_payments: 0, course_payment_aed: 0, net_usd: 0, net_aed: 0 }));
  const revenueRows: any[] = [];
  for (const t of txs) {
    if (t.status !== "APPROVED" || (t.type !== "DEPOSIT" && t.type !== "WITHDRAWAL")) continue;
    const at = when(t.approved_at, t.requested_at, t.created_date);
    if (!inRange(ctx, at)) continue;
    const p = P(raisedBy(t), t.primary_mentor_name);
    if (!counts(ctx, p)) continue;
    const usd = usdOf(t), aed = aedFrom(t.amount_aed, usd);
    if (t.type === "DEPOSIT") revenue.add(p, at, { deposits: 1, deposit_usd: usd, deposit_aed: aed, net_usd: usd, net_aed: aed });
    else revenue.add(p, at, { withdrawals: 1, withdrawal_usd: usd, withdrawal_aed: aed, net_usd: -usd, net_aed: -aed });
    revenueRows.push({ kind: t.type === "DEPOSIT" ? "deposit" : "withdrawal", at: iso(at), usd, aed, ...stu(t.student_id, t.student_name), ...who(p) });
  }
  const upgradeById = new Map((upgrades as any[]).map((u) => [String(u._id), u]));
  const ownerOf = (u: any) => String(u?.created_by || studentById.get(String(u?.student_id ?? ""))?.primary_mentor_id || "");
  for (const pay of payments) {
    const at = when(pay.decided_at);
    if (!inRange(ctx, at)) continue;
    const u = upgradeById.get(String(pay.upgrade_id));
    const p = P(ownerOf(u) || pay.created_by, u?.created_by_name);
    if (!counts(ctx, p)) continue;
    const aed = Number(pay.approved_amount_aed ?? pay.amount_aed) || 0;
    revenue.add(p, at, { course_payments: 1, course_payment_aed: aed });
    revenueRows.push({ kind: "course_payment", at: iso(at), usd: 0, aed, course: String(u?.course ?? ""), ...stu(pay.student_id ?? u?.student_id), ...who(p) });
  }

  /* ── Follow-ups and contacted ────────────────────────────────────────── */
  const fu = grouper(() => ({ logged: 0, opened: 0, contacted: 0, converted: 0, lost: 0 }));
  const contacted = new Map<string, Set<string>>();
  const fuRows: any[] = [];
  for (const e of events) {
    if (e.kind !== "logged" && e.kind !== "created") continue;
    const at = when(e.at);
    if (!inRange(ctx, at)) continue;
    const p = P(e.by_id, e.by_name);
    if (!counts(ctx, p)) continue;
    const seen = contacted.get(p.id) ?? new Set<string>();
    const fresh = e.student_id && !seen.has(String(e.student_id)) ? 1 : 0;
    if (e.student_id) seen.add(String(e.student_id));
    contacted.set(p.id, seen);
    const moved = e.stage_to && e.stage_to !== e.stage_from ? String(e.stage_to) : "";
    fu.add(p, at, { logged: e.kind === "logged" ? 1 : 0, opened: e.kind === "created" ? 1 : 0, contacted: fresh,
      converted: moved === "Converted" ? 1 : 0, lost: moved === "Lost" ? 1 : 0 });
    fuRows.push({ at: iso(at), kind: e.kind, stage_from: String(e.stage_from ?? ""), stage_to: String(e.stage_to ?? ""), text: String(e.text ?? "").slice(0, 300),
      client_said: String(e.client_said ?? "").slice(0, 300), ...stu(e.student_id), ...who(p) });
  }

  /* ── Calls ───────────────────────────────────────────────────────────── */
  const cg = grouper(() => ({ calls: 0, connected: 0, missed: 0, talk_seconds: 0, outgoing: 0, incoming: 0, recorded: 0 }));
  const callRows: any[] = [];
  for (const c of calls) {
    const at = when(c.started_at);
    if (!inRange(ctx, at)) continue;
    const p = P(c.user_id, c.user_name);
    if (!counts(ctx, p)) continue;
    const rec = Array.isArray(c.recording_ids) ? c.recording_ids.length : 0;
    cg.add(p, at, { calls: 1, connected: c.answered ? 1 : 0, missed: c.answered ? 0 : 1, talk_seconds: Number(c.talk_seconds) || 0,
      outgoing: c.direction === "out" ? 1 : 0, incoming: c.direction === "in" ? 1 : 0, recorded: rec ? 1 : 0 });
    callRows.push({ id: String(c._id), at: iso(at), direction: String(c.direction ?? ""), status: String(c.status ?? ""), answered: !!c.answered,
      talk_seconds: Number(c.talk_seconds) || 0, recordings: rec, number: String(c.number ?? ""),
      student_id: String(c.student_id ?? ""), student: String(c.student_name ?? ""), code: String(c.student_code ?? ""), ...who(p) });
  }

  /* ── Program scheduling ─────────────────────────────────────────────── */
  const pg = grouper(() => ({ programs: 0, classes: 0, held: 0, cancelled: 0, students: 0, confirmed: 0, declined: 0 }));
  const programRows: any[] = [];
  let programsAvailable = true, programsMessage = "";
  if (lmsConfigured()) {
    try {
      const all = ((await callLms("/programs", { verb: "list its programs" })) as any[]) ?? [];
      const byEmail = new Map([...ctx.index.userById.entries()].map(([id, u]) => [String(u?.email ?? "").toLowerCase(), id]));
      const notices = all.length ? ((await col(PROGRAM_NOTICES).find({ program_id: { $in: all.map((p) => String(p.id)) } }, { projection: { program_id: 1, response: 1 } }).toArray()) as any[]) : [];
      const answers = new Map<string, { confirmed: number; declined: number }>();
      for (const n of notices) {
        const a = answers.get(n.program_id) ?? { confirmed: 0, declined: 0 };
        if (n.response === "confirmed") a.confirmed++; else if (n.response === "declined") a.declined++;
        answers.set(n.program_id, a);
      }
      for (const prog of all) {
        const inPeriod = (prog.classes ?? []).filter((c: any) => inRange(ctx, when(c.startsAt)));
        if (!inPeriod.length) continue;
        const p = P(byEmail.get(String(prog.createdByEmail ?? "").toLowerCase()) ?? "", prog.createdByName);
        if (!counts(ctx, p)) continue;
        const first = when(inPeriod[0].startsAt);
        const a = answers.get(String(prog.id)) ?? { confirmed: 0, declined: 0 };
        const held = inPeriod.filter((c: any) => c.status !== "cancelled" && when(c.startsAt) <= Date.now()).length;
        const cancelled = inPeriod.filter((c: any) => c.status === "cancelled").length;
        const students = (prog.students ?? []).length;
        pg.add(p, first, { programs: 1, classes: inPeriod.length, held, cancelled, students, confirmed: a.confirmed, declined: a.declined });
        programRows.push({ id: String(prog.id), at: iso(first), title: String(prog.title ?? ""), mentor: String(prog.mentor?.name ?? ""), repeat: String(prog.repeat ?? ""),
          classes: inPeriod.length, held, cancelled, students, confirmed: a.confirmed, declined: a.declined, status: String(prog.status ?? ""), ...who(p) });
      }
    } catch (err) {
      programsAvailable = false;
      programsMessage = err instanceof Error ? err.message : "The LMS could not be asked";
    }
  } else { programsAvailable = false; programsMessage = "The LMS is not linked on this server"; }

  /* ── Onboarded clients ──────────────────────────────────────────────── */
  const ob = grouper(() => ({ onboarded: 0, from_finance: 0 }));
  const obRows: any[] = [];
  for (const s of onboarded) {
    const at = when(s.onboarded_at);
    if (!inRange(ctx, at)) continue;
    const p = P(s.primary_mentor_id, s.primary_mentor_name);
    if (!counts(ctx, p)) continue;
    ob.add(p, at, { onboarded: 1, from_finance: s.finance_invoice_id ? 1 : 0 });
    obRows.push({ at: iso(at), student_id: String(s._id), student: String(s.full_name ?? ""), code: String(s.student_code ?? ""),
      by: String(s.onboarded_by_name ?? ""), added_at: String(s.created_date ?? ""), from_finance: !!s.finance_invoice_id, ...who(p) });
  }

  /* ── Bonus (as the Bonus report) ────────────────────────────────────── */
  const bg = grouper(() => ({ count: 0, usd: 0, aed: 0, needs_call: 0, with_finance: 0, waiting_broker: 0, approved: 0, approved_usd: 0, approved_aed: 0, rejected: 0 }));
  const bonusRows: any[] = [];
  for (const t of txs) {
    if (t.type !== "BONUS") continue;
    const at = when(t.requested_at, t.created_date);
    if (!inRange(ctx, at)) continue;
    const p = P(raisedBy(t), t.primary_mentor_name);
    if (!counts(ctx, p)) continue;
    const raw = t.status === "APPROVED" ? "approved" : t.status === "REJECTED" ? "rejected" : bonusStageOf(t);
    const stage = raw === "sent_back" ? "waiting_broker" : raw;
    const usd = creditUsdOf(t), aed = paidAedOf(t);
    bg.add(p, at, { count: 1, usd, aed, [stage]: 1, ...(stage === "approved" ? { approved_usd: usd, approved_aed: aed } : {}) } as any);
    bonusRows.push({ at: iso(at), stage, raw_stage: raw, usd, aed, mt5: String(t.mt5_login ?? ""), decided_at: t.status === "PENDING" ? "" : iso(when(t.approved_at, t.updated_date)),
      kind: t.bonus_credit ? `${String(t.bonus_credit).replace(/_/g, " ")} credit` : t.course_payment ? "course payment bonus" : "MT5 bonus", ...stu(t.student_id, t.student_name), ...who(p) });
  }
  for (const [sid, left] of notSent) {
    const s = studentById.get(sid);
    const p = P(s?.primary_mentor_id, s?.primary_mentor_name);
    if (!counts(ctx, p)) continue;
    for (const x of left) {
      const at = when(x.since);
      if (!inRange(ctx, at)) continue;
      bg.add(p, at, { count: 1, usd: x.usd, needs_call: 1 });
      bonusRows.push({ at: iso(at), stage: "needs_call", raw_stage: "needs_call", usd: x.usd, aed: 0, mt5: "", decided_at: "", kind: "sales-close bonus", ...stu(sid), ...who(p) });
    }
  }

  /* ── Commission ─────────────────────────────────────────────────────── */
  const cm = grouper(() => ({ credits: 0, usd: 0, aed: 0 }));
  const cmRows: any[] = [];
  for (const c of credits) {
    const at = when(c.requested_at, c.created_date);
    if (!inRange(ctx, at)) continue;
    const p = P(c.recipient_id, c.recipient_name);
    if (!counts(ctx, p)) continue;
    const usd = Number(c.commission_usd) || 0;
    cm.add(p, at, { credits: 1, usd, aed: aedFrom(0, usd) });
    cmRows.push({ at: iso(at), usd, aed: aedFrom(0, usd), level: c.level ?? null, type: String(c.transaction_type ?? ""), status: String(c.status ?? ""), ...stu(c.student_id, c.student_name), ...who(p) });
  }

  /* ── Course upgrades ────────────────────────────────────────────────── */
  const ug = grouper(() => ({ started: 0, quoted_aed: 0, payments: 0, paid_aed: 0 }));
  const ugRows: any[] = [];
  const paidOn = new Map<string, { n: number; aed: number }>();
  for (const pay of payments) {
    if (!inRange(ctx, when(pay.decided_at))) continue;
    const x = paidOn.get(String(pay.upgrade_id)) ?? { n: 0, aed: 0 };
    x.n++; x.aed += Number(pay.approved_amount_aed ?? pay.amount_aed) || 0;
    paidOn.set(String(pay.upgrade_id), x);
  }
  for (const u of upgrades) {
    const at = when(u.created_at);
    const started = inRange(ctx, at);
    const paid = paidOn.get(String(u._id));
    if (!started && !paid) continue;
    const p = P(ownerOf(u), u.created_by_name);
    if (!counts(ctx, p)) continue;
    ug.add(p, started ? at : NaN, { started: started ? 1 : 0, quoted_aed: started ? Number(u.quote?.dueAed) || 0 : 0, payments: paid?.n ?? 0, paid_aed: paid?.aed ?? 0 });
    ugRows.push({ at: iso(at), course: String(u.course ?? ""), plan: String(u.plan ?? ""), status: String(u.status ?? ""), quoted_aed: Number(u.quote?.dueAed) || 0,
      paid_aed: Math.round((paid?.aed ?? 0) * 100) / 100, started_in_period: started, ...stu(u.student_id), ...who(p) });
  }

  // The teams and people to filter by.
  const people = [...ctx.index.userById.entries()]
    .filter(([, u]) => u?.status !== "inactive" && /mentor|cs|assistance/.test(String(u?.app_role ?? "")))
    .map(([id, u]) => ({ id, name: String(u.full_name || u.email || ""), team_id: ctx.index.teamOf(id)?.id ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    ...meta(ctx),
    filters: { teams: ctx.index.teams.map((t) => ({ id: t.id, name: t.name, location: t.location })), people },
    revenue: { ...revenue.out("deposit_aed"), rows: latest(revenueRows) },
    followups: { ...fu.out("logged"), rows: latest(fuRows) },
    calls: { ...cg.out("calls"), rows: latest(callRows) },
    programs: { available: programsAvailable, ...(programsMessage ? { message: programsMessage } : {}), ...pg.out("classes"), rows: latest(programRows) },
    onboarded: { ...ob.out("onboarded"), rows: latest(obRows) },
    bonus: { ...bg.out("usd"), rows: latest(bonusRows) },
    commission: { ...cm.out("aed"), rows: latest(cmRows) },
    upgrades: { ...ug.out("paid_aed"), rows: latest(ugRows) },
  };
}
