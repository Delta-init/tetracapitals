import { col } from "../db";
import { personOf, counts, meta, type ReportCtx, type Person } from "../functions/reports";
import { WAIT_HOURS } from "./onboardingAlerts";

/* ────────────────────────────────────────────────────────────────────────────
   The student workflow (the user, 2026-10-20: "the same workflow chart as the
   sales CRMs' lead workflow, for the CS portal"): the students that came in
   over some UAE days and where each went —

     came in        created in the period (finance, the LMS, a sheet, by hand)
     assigned       has a CS now; the rest wait in the open pool
     onboarded      welcomed (email / WhatsApp) — else still within the 6 hours
                    the portal allows (WAIT_HOURS), or late
     enrolled       in the LMS (enrolment_status closed)
     contacted      any 3CX call with them, or a follow-up opened or logged
     deposit        an approved deposit
     moved by hand  given to another CS by a transfer or reassign — not the
                    admins' bulk reshuffles or imports (unassign-all, student-
                    split, sheets…), not the no-deposit rule (counted apart)

   with each one's follow-up stage now ("No follow-up" when none), and the same
   per team and per CS — their CS now. The filters and who sees what are the
   Reports section's (functions/reports.ts reportCtx): admins everything, a CS
   Manager their location, a team leader their team, a CS their own. Read-only.
──────────────────────────────────────────────────────────────────────────── */

export const WORKFLOW_BOXES = ["came", "assigned", "pool", "onboarded", "waiting", "late", "enrolled", "contacted", "deposited", "moved", "moved_inactivity"] as const;
export type WorkflowBox = (typeof WORKFLOW_BOXES)[number];
export const isWorkflowBox = (v: unknown): v is WorkflowBox => typeof v === "string" && (WORKFLOW_BOXES as readonly string[]).includes(v);

/** Admin bulk moves — reshuffles and imports — not a CS losing a student. */
const BULK_MOVES = new Set(["unassign-all", "student-split", "team-restructure", "cs-sheet", "cs-tracker", "rotation_change", "data-sheet", "import"]);
const STAGES = ["New", "Contacted", "Qualified", "Session with CM", "Objection Stage", "Converted", "Lost"];
const iso = (t: number) => new Date(t).toISOString();

type Counts = Record<WorkflowBox, number>;
const blank = (): Counts => Object.fromEntries(WORKFLOW_BOXES.map((b) => [b, 0])) as Counts;

interface Row {
  id: string; name: string; code: string; came_at: string; source: string; location: string;
  cs: Person | null; onboarded_at: string | null; stage: string; boxes: Set<WorkflowBox>;
}

const sourceOf = (s: any): string =>
  s.finance_invoice_id ? "finance" : s.source === "delta_lms" || s.lms_user_id ? "lms" : /sheet|tracker/.test(String(s.source ?? "")) ? "sheet" : "manual";

async function build(ctx: ReportCtx, now: number): Promise<Row[]> {
  const created: Record<string, unknown> = { $type: "string", $gte: iso(ctx.since || 0) };
  if (ctx.until < Number.MAX_SAFE_INTEGER) created.$lt = iso(ctx.until);
  const students = (await col("students").find(
    { created_date: created, not_student: { $ne: true } } as any,
    { projection: { full_name: 1, student_code: 1, primary_mentor_id: 1, primary_mentor_name: 1, assignment_status: 1, onboarded: 1, onboarded_at: 1,
      created_date: 1, finance_invoice_id: 1, source: 1, lms_user_id: 1, enrolment_status: 1, location: 1 } },
  ).toArray()) as any[];

  // Whose they are now, and whether this viewer and these filters count them.
  const rows: Row[] = [];
  for (const s of students) {
    const owner = String(s.primary_mentor_id ?? "");
    const pooled = !owner || s.assignment_status === "open_pool";
    const cs = pooled ? null : personOf(ctx, owner, s.primary_mentor_name);
    if (cs ? !counts(ctx, cs) : ctx.reach !== null || !!ctx.team || !!ctx.cs || (!!ctx.location && (s.location ?? "dubai") !== ctx.location)) continue;
    const boxes = new Set<WorkflowBox>(["came", pooled ? "pool" : "assigned"]);
    if (s.onboarded === true) boxes.add("onboarded");
    else boxes.add(now - Date.parse(s.created_date) > WAIT_HOURS * 3_600_000 ? "late" : "waiting");
    if (s.enrolment_status === "closed") boxes.add("enrolled");
    rows.push({
      id: String(s._id), name: String(s.full_name ?? ""), code: String(s.student_code ?? ""), came_at: s.created_date, source: sourceOf(s),
      location: cs?.location ?? (s.location === "bangalore" ? "bangalore" : "dubai"), cs,
      onboarded_at: s.onboarded === true ? s.onboarded_at ?? null : null, stage: "No follow-up", boxes,
    });
  }
  if (!rows.length) return rows;

  const ids = rows.map((r) => r.id);
  const [calls, events, followups, deposits, moves] = await Promise.all([
    col("student_calls").distinct("student_id", { student_id: { $in: ids } }),
    col("student_followup_events").distinct("student_id", { student_id: { $in: ids }, kind: { $in: ["created", "logged"] } }),
    col("student_followups").find({ student_id: { $in: ids } }, { projection: { student_id: 1, stage: 1, created_date: 1 } }).toArray(),
    col("funding_transactions").distinct("student_id", { student_id: { $in: ids }, type: "DEPOSIT", status: "APPROVED" }),
    col("student_history").find({ student_id: { $in: ids }, type: "mentor_changed" }, { projection: { student_id: 1, via: 1, text: 1 } }).toArray(),
  ]) as any[];
  const contacted = new Set([...calls, ...events].map(String));
  const deposited = new Set(deposits.map(String));
  // A student's follow-up stage now: the open one, else the latest.
  const stageOf = new Map<string, { stage: string; open: boolean; at: string }>();
  for (const f of followups as any[]) {
    const id = String(f.student_id), stage = String(f.stage ?? "New"), open = stage !== "Converted" && stage !== "Lost", at = String(f.created_date ?? "");
    const was = stageOf.get(id);
    if (!was || (open && !was.open) || (open === was.open && at > was.at)) stageOf.set(id, { stage, open, at });
  }
  const moved = new Set<string>(), movedInactivity = new Set<string>();
  for (const m of moves as any[]) {
    const via = String(m.via ?? "");
    if (via === "inactivity" || String(m.text ?? "").startsWith("No approved deposit")) movedInactivity.add(String(m.student_id));
    else if (!BULK_MOVES.has(via)) moved.add(String(m.student_id));
  }
  for (const r of rows) {
    if (contacted.has(r.id)) r.boxes.add("contacted");
    if (deposited.has(r.id)) r.boxes.add("deposited");
    if (moved.has(r.id)) r.boxes.add("moved");
    if (movedInactivity.has(r.id)) r.boxes.add("moved_inactivity");
    r.stage = stageOf.get(r.id)?.stage ?? "No follow-up";
  }
  return rows;
}

export async function studentWorkflow(ctx: ReportCtx, now = Date.now()) {
  const rows = await build(ctx, now);
  const totals = blank();
  const stages = new Map<string, number>(), sources = new Map<string, number>();
  const teams = new Map<string, { id: string | null; name: string; location: string } & Counts>();
  const people = new Map<string, { id: string; name: string; team: string; location: string } & Counts>();
  const days = new Map<string, number>();
  for (const r of rows) {
    for (const b of r.boxes) totals[b]++;
    stages.set(r.stage, (stages.get(r.stage) ?? 0) + 1);
    sources.set(r.source, (sources.get(r.source) ?? 0) + 1);
    const tk = r.cs?.team_id || "";
    const t = teams.get(tk) ?? { id: tk || null, name: r.cs ? r.cs.team : "Open pool", location: r.location, ...blank() };
    for (const b of r.boxes) t[b]++;
    teams.set(tk, t);
    if (r.cs) {
      const p = people.get(r.cs.id) ?? { id: r.cs.id, name: r.cs.name, team: r.cs.team, location: r.cs.location, ...blank() };
      for (const b of r.boxes) p[b]++;
      people.set(r.cs.id, p);
    }
    const day = new Date(Date.parse(r.came_at) + 4 * 3_600_000).toISOString().slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  const order = (s: string) => (s === "No follow-up" ? 99 : STAGES.indexOf(s) < 0 ? 50 : STAGES.indexOf(s));
  return {
    ...meta(ctx),
    generated_at: iso(now),
    wait_hours: WAIT_HOURS,
    totals,
    stages: [...stages].map(([stage, count]) => ({ stage, count })).sort((a, b) => order(a.stage) - order(b.stage)),
    sources: [...sources].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    teams: [...teams.values()].sort((a, b) => b.came - a.came),
    people: [...people.values()].sort((a, b) => b.came - a.came),
    timeline: [...days].map(([day, came]) => ({ day, came })).sort((a, b) => (a.day < b.day ? -1 : 1)),
  };
}

/** The students behind one box (or one follow-up stage), with their CS — newest first, at most 1000. */
export async function studentWorkflowStudents(ctx: ReportCtx, pick: { box?: WorkflowBox; stage?: string; teamId?: string; csId?: string }, now = Date.now()) {
  const rows = (await build(ctx, now))
    .filter((r) => (!pick.box || r.boxes.has(pick.box)) && (!pick.stage || r.stage === pick.stage))
    .filter((r) => (pick.teamId === undefined ? true : pick.teamId === "" ? !r.cs : r.cs?.team_id === pick.teamId) && (!pick.csId || r.cs?.id === pick.csId))
    .sort((a, b) => (a.came_at < b.came_at ? 1 : -1));
  return {
    total: rows.length,
    students: rows.slice(0, 1000).map((r) => ({
      id: r.id, name: r.name, code: r.code, came_at: r.came_at, source: r.source, location: r.location,
      cs: r.cs ? { id: r.cs.id, name: r.cs.name, team: r.cs.team } : null,
      onboarded_at: r.onboarded_at, stage: r.stage,
      late: r.boxes.has("late"), contacted: r.boxes.has("contacted"), deposited: r.boxes.has("deposited"), enrolled: r.boxes.has("enrolled"), moved: r.boxes.has("moved"),
    })),
  };
}
