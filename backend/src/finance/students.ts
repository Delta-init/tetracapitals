import { timingSafeEqual } from "node:crypto";
import { col } from "../db";
import { config } from "../config";
import { json } from "../lib/response";
import { nextStudentCode } from "../lib/studentCode";
import { isMentorRole } from "../lib/roles";

/* ────────────────────────────────────────────────────────────────────────────
   POST /api/v1/integrations/finance/students — a new Delta LMS student.

   When accounts approve an enrolment the sales CRM raised, finance gives the
   student their LMS course; once the LMS has them, finance sends them here.
   Server to server, with a shared secret in `x-finance-secret`
   (FINANCE_S2S_SECRET here, COMMISSION_S2S_SECRET in finance). Unset means
   off, never open. Its own secret rather than the Root portal's: finance may
   add students, and nothing else.

   Each new student goes to the next team in turn — team 1, 2, 3, 4, then
   team 1 again. Teams are the ones the Teams page shows (see teamsInTurn),
   and the student's primary mentor is the team's leader, who can pass them to
   somebody in the team with a transfer request, as today. Teams take turns in
   the order their leaders' accounts were created; a team whose leader was
   switched off from the portal is skipped, and a new team takes its place in
   the round. With no team at all the student waits in Delta Open Students
   rather than being lost.

   Safe to repeat. The same invoice twice is the same student. An email that is
   already here — a mentor added them, or it is their second course — is left
   exactly as it is, and does not use up a team's turn.

   Answers use the same envelope as the LMS's finance routes ({ success, data }
   / { success: false, error: { code, message } }): finance reads the reason
   for a refusal from error.message.
──────────────────────────────────────────────────────────────────────────── */

const ok = (data: unknown) => json({ success: true, data });
const refuse = (status: number, code: string, message: string) =>
  json({ success: false, error: { code, message } }, { status });

function secretOk(presented: string | null): boolean {
  const expected = config.financeS2sSecret;
  if (!presented || !expected) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const text = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface Team {
  /** The leader's id: the student's primary mentor. */
  id: string;
  /** The team's name, or its leader's when it has none — as the Teams page shows it. */
  name: string;
  leaderName: string;
  key: string;
}

/**
 * The teams, in turn order — the same teams the Teams page shows
 * (frontend/src/pages/Teams.jsx, with teamRootId in components/utils/teams.js;
 * keep the three in step).
 *
 * A team is an Up-Head chain of staff rooted at its top person: climbing
 * stops at a Chief Mentor, at a missing parent, or at a parent who isn't staff,
 * so a team never runs into the admins. Somebody alone at the top is a team
 * only if the team was named (created empty on purpose) — anyone else alone,
 * a Chief Mentor included, is unassigned. A team whose leader was switched
 * off from the portal cannot take a student, so it sits the round out.
 */
async function teamsInTurn(): Promise<Team[]> {
  const users = (await col("users")
    .find({}, { projection: { full_name: 1, email: 1, app_role: 1, up_head_id: 1, team_name: 1, status: 1, created_date: 1 } })
    .toArray()) as any[];
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const rootOf = (user: any): string => {
    let cur = user;
    const seen = new Set<string>();
    while (cur && cur.app_role !== "chief_mentor" && cur.up_head_id && !seen.has(String(cur._id))) {
      seen.add(String(cur._id));
      const parent = byId.get(String(cur.up_head_id));
      if (!parent || !isMentorRole(String(parent.app_role ?? ""))) break;
      cur = parent;
    }
    return String(cur._id);
  };

  const size = new Map<string, number>();
  for (const u of users) {
    if (!isMentorRole(String(u.app_role ?? ""))) continue;
    const root = rootOf(u);
    size.set(root, (size.get(root) ?? 0) + 1);
  }

  const teams: Team[] = [];
  for (const [id, members] of size) {
    const leader = byId.get(id);
    if (!leader) continue;
    if (members === 1 && !leader.team_name) continue;
    if (leader.status === "inactive") continue;
    const leaderName = String(leader.full_name || leader.email || "Team leader");
    teams.push({
      id,
      name: String(leader.team_name || leaderName),
      leaderName,
      // Creation time, then id: a stable order, whatever the teams are renamed to.
      key: `${leader.created_date ?? ""}|${id}`,
    });
  }
  return teams.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

const TURN = "finance_student_team_turn";

/**
 * Whose turn it is: the first team after the one that took the last student.
 *
 * Remembered by that team's place in the order rather than by a count, so a
 * team added, or sitting out, between two students neither skips a team nor
 * gives one two in a row. Compare-and-set, so two students arriving at once
 * cannot both take the same turn.
 */
async function takeTurn(): Promise<Team | null> {
  const counters = col<{ _id: string; last_key?: string }>("counters");
  for (let attempt = 0; attempt < 5; attempt++) {
    const teams = await teamsInTurn();
    if (!teams.length) return null;
    const state = await counters.findOne({ _id: TURN });
    const last = state?.last_key ?? "";
    const next = teams.find((t) => t.key > last) ?? teams[0]!;
    const set = { last_key: next.key, last_team_id: next.id, last_team_name: next.name, updated_date: new Date().toISOString() };
    try {
      const res = state
        ? await counters.updateOne({ _id: TURN, last_key: last }, { $set: set })
        : await counters.updateOne({ _id: TURN }, { $setOnInsert: set }, { upsert: true });
      if (state ? res.modifiedCount === 1 : res.upsertedCount === 1) return next;
    } catch (err) {
      // Two first-ever students racing to create the turn record: one wins, the other goes round again.
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  throw new Error("Could not take a team's turn — try again");
}

/**
 * `created` is whether this call made the student. `existing` says why not:
 * "invoice" — finance sent this invoice before, so the student is still its
 * own; "email" — somebody with that address was already here, and was left
 * alone.
 */
function answer(student: any, created: boolean, existing: "invoice" | "email" | null, detail: string) {
  return {
    created,
    existing,
    studentId: String(student._id),
    studentCode: String(student.student_code ?? ""),
    assignment: student.assignment_status === "open_pool" ? "open_pool" : "assigned",
    mentorName: String(student.primary_mentor_name ?? ""),
    /** The team this call gave them to; empty when it gave them to nobody. */
    teamName: created ? String(student.auto_assigned_team_name ?? "") : "",
    detail,
  };
}

export async function handleFinanceStudents(req: Request): Promise<Response> {
  if (!config.financeS2sSecret) return refuse(503, "INTEGRATION_DISABLED", "The Delta finance link is not configured on this server");
  if (!secretOk(req.headers.get("x-finance-secret"))) return refuse(401, "UNAUTHORISED", "Bad secret");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse(400, "VALIDATION_ERROR", "Body must be a JSON object");

  const invoiceId = text(body.invoiceId, 64);
  const email = text(body.email).toLowerCase();
  if (!invoiceId) return refuse(400, "VALIDATION_ERROR", "invoiceId is required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return refuse(400, "VALIDATION_ERROR", "A valid email is required");

  const name = text(body.name) || email.split("@")[0]!;
  const invoiceNumber = text(body.invoiceNumber, 64);
  const course = text(body.course);

  const students = col("students");

  // The same invoice again — finance retrying, or asked twice. One student.
  const already = await students.findOne({ finance_invoice_id: invoiceId });
  if (already) return ok(answer(already, false, "invoice", "This invoice's student is already here"));

  // Already here by email: a mentor added them, or this is their second course.
  // Left exactly as they are — their mentor, level and notes are not ours to change.
  const existing = await students.findOne({ email: { $regex: `^${escapeRegex(email)}$`, $options: "i" } });
  if (existing) return ok(answer(existing, false, "email", `${email} is already a student here — left as they are`));

  const team = await takeTurn();
  const now = new Date().toISOString();
  const doc = {
    student_code: await nextStudentCode(),
    full_name: name,
    email,
    phone: text(body.phone, 40),
    country: text(body.country, 80),
    notes: `From Delta LMS — ${course || "a course"}${invoiceNumber ? `, invoice ${invoiceNumber}` : ""}`,
    primary_mentor_id: team?.id ?? "",
    primary_mentor_name: team?.leaderName ?? "",
    senior_mentor_id: "",
    senior_mentor_name: "",
    assignment_status: team ? "assigned" : "open_pool",
    status: "ACTIVE",
    student_level: "LEVEL_1",
    // Where they came from, kept on the record for tracing; the pages ignore these.
    source: "delta_lms",
    finance_invoice_id: invoiceId,
    finance_invoice_number: invoiceNumber,
    lms_course: course,
    lms_user_id: text(body.lmsUserId, 64),
    auto_assigned_team_id: team?.id ?? "",
    auto_assigned_team_name: team?.name ?? "",
    created_by: "delta-finance",
    created_by_name: "Delta LMS (via finance)",
    created_date: now,
    updated_date: now,
  };

  let insertedId;
  try {
    insertedId = (await students.insertOne(doc as any)).insertedId;
  } catch (err) {
    // Two deliveries of one invoice at the same moment: the unique index lets one through.
    if ((err as { code?: number }).code === 11000) {
      const winner = await students.findOne({ finance_invoice_id: invoiceId });
      if (winner) return ok(answer(winner, false, "invoice", "This invoice's student is already here"));
    }
    throw err;
  }

  const where = team
    ? `team ${team.name}${team.name !== team.leaderName ? ` (${team.leaderName})` : ""}`
    : "Delta Open Students — there is no team to give them to";
  try {
    // The same activity log the Students page writes to when somebody adds a student.
    await col("logs").insertOne({
      timestamp: now,
      user_id: null,
      user_email: "",
      user_name: "Delta LMS (via finance)",
      user_role: "system",
      action_type: "create_student",
      entity_type: "Student",
      entity_id: String(insertedId),
      details: JSON.stringify({ message: `Created student from Delta LMS: ${name} → ${where}` }),
      old_value: null,
      new_value: JSON.stringify(doc),
      ip_address: null,
      success: true,
      created_date: now,
      updated_date: now,
    } as any);
  } catch (err) {
    // The student is what matters; a missing log line must not undo them.
    console.error("[finance students] could not write the activity log", err);
  }

  return ok(answer({ _id: insertedId, ...doc }, true, null, `Created ${doc.student_code} for ${where}`));
}
