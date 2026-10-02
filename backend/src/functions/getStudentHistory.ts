import { col } from "../db";
import { json, error, notFound, forbidden } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { userCanReadDoc } from "../entities/crud";
import { loadTeams } from "../students/teams";
import { roleLabel } from "../students/history";
import { salesCrmOf, salesCrmName } from "../students/salesCrm";

/**
 * POST /api/functions/getStudentHistory
 * Body: { studentId }
 * Returns: { team, firstReceivedBy, cameFrom, events: [{ at, type, text, by, kind }] }
 *
 * Everything that happened to a student, oldest first, for their page. Only
 * for somebody who may see the student — the same test as opening them.
 *
 * Two sources. The history the server has kept since it started keeping one
 * (student_history — every create and change, whatever screen made it), and,
 * for what came before, the student record itself and their requests (new
 * enrolment, open-pool pick-up, transfer, level upgrade), which carry who asked,
 * who approved and when. Who received a student first is stored for students
 * since then; for older ones it is worked out from those same records.
 */

const STATUS: Record<string, string> = {
  APPROVED: "approved", TRANSFERRED: "done", REJECTED: "rejected",
  PENDING: "waiting for approval", PENDING_ACADEMIC_APPROVAL: "waiting for the Academic Head",
  PENDING_BROKER_APPROVAL: "waiting for the Broker Admin",
};
const statusOf = (s: unknown) => STATUS[String(s ?? "")] ?? String(s ?? "").toLowerCase().replace(/_/g, " ");
const when = (r: any) => String(r.requested_at || r.created_date || "");

function cameFrom(s: any) {
  if (s.finance_invoice_id) {
    // The sales CRM that sold it, as finance said — or, for a student from
    // before it said, Delta's, which every one of those came through.
    const salesCrm = salesCrmOf(s.sales_crm) || "delta";
    return { label: `${salesCrmName(salesCrm)}, via finance`, salesCrm, invoice: s.finance_invoice_number || null, course: s.lms_course || null, academy: null };
  }
  if (s.source === "delta_lms" && s.lms_user_id) {
    return { label: "Delta LMS", invoice: null, course: s.lms_course || null, academy: s.lms_academy || null };
  }
  return { label: s.created_by_name ? `Added by ${s.created_by_name}` : "Added in Tetra Commission", invoice: null, course: null, academy: null };
}

function requestEvents(r: any) {
  const by = r.requested_by_name || null;
  const approvedBy = r.level_upgrade_approved_by_name || r.approved_by_name || null;
  const outcome = `${statusOf(r.status)}${approvedBy && ["APPROVED", "TRANSFERRED"].includes(r.status) ? ` by ${approvedBy}` : ""}`;
  switch (r.request_type) {
    case "NEW_ENROLLMENT":
      return [{ at: when(r), type: "request", kind: "record", by, text: `Enrolment requested by ${by ?? "somebody"} for ${r.requested_primary_mentor_name || "a mentor"} — ${outcome}` }];
    case "OPEN_POOL_ASSIGNMENT":
      return [{ at: when(r), type: "request", kind: "record", by, text: `Taken from Delta Open Students by ${r.requested_primary_mentor_name || by || "a mentor"}` }];
    case "TRANSFER":
      return [{
        at: when(r), type: "request", kind: "record", by,
        text: `Transfer from ${r.previous_mentor_name || "their mentor"} to ${r.requested_primary_mentor_name || "another mentor"} requested by ${by ?? "somebody"} — ${outcome}`,
      }];
    case "LEVEL_UPGRADE":
      return [{ at: when(r), type: "request", kind: "record", by, text: `Level 2 upgrade requested by ${by ?? "somebody"} — ${outcome}` }];
    default:
      return [{ at: when(r), type: "request", kind: "record", by, text: `${String(r.request_type || "Request").replace(/_/g, " ").toLowerCase()} by ${by ?? "somebody"} — ${outcome}` }];
  }
}

/** For a student from before who-received-them-first was stored: the earliest mentor the records name. */
function firstFromRecords(s: any, requests: any[]) {
  const sorted = [...requests].sort((a, b) => (when(a) < when(b) ? -1 : 1));
  const transfer = sorted.find((r) => r.request_type === "TRANSFER" && r.previous_mentor_name);
  if (transfer) return { name: transfer.previous_mentor_name, role: null, at: s.created_date || null };
  const enrolment = sorted.find((r) => r.request_type === "NEW_ENROLLMENT" && r.requested_primary_mentor_name);
  if (enrolment) return { name: enrolment.requested_primary_mentor_name, role: null, at: when(enrolment) || null };
  const pool = sorted.find((r) => r.request_type === "OPEN_POOL_ASSIGNMENT" && r.requested_primary_mentor_name);
  if (pool) return { name: pool.requested_primary_mentor_name, role: null, at: when(pool) || null };
  if (s.primary_mentor_name) return { name: s.primary_mentor_name, role: null, at: s.created_date || null };
  return null;
}

export async function getStudentHistory(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.studentId ?? ""));
  if (!oid) return error("studentId is required", 400);
  const s: any = await col("students").findOne({ _id: oid });
  if (!s) return notFound("No such student");
  if (!(await userCanReadDoc(user, "Student", s))) return forbidden();
  const id = String(oid);

  const [recorded, requests, index] = await Promise.all([
    col("student_history").find({ student_id: id }).sort({ at: 1 }).toArray() as Promise<any[]>,
    col("student_requests").find({ $or: [{ created_student_id: id }, { existing_student_id: id }] }).toArray() as Promise<any[]>,
    loadTeams(),
  ]);

  const events: { at: string; type: string; text: string; by: string | null; kind: "history" | "record" }[] =
    recorded.map((h) => ({ at: String(h.at), type: String(h.type), text: String(h.text), by: h.by_name || null, kind: "history" as const }));

  // From before the history was kept: the student's own record says when and how they came.
  if (!recorded.some((h) => h.type === "arrived" || h.type === "created")) {
    const from = cameFrom(s);
    events.push({
      at: String(s.created_date || ""),
      type: from.label.startsWith("Added") ? "created" : "arrived",
      text: from.label.startsWith("Added") ? from.label : `Arrived from the ${from.label}`,
      by: s.created_by_name || null,
      kind: "record",
    });
  }
  for (const r of requests) events.push(...(requestEvents(r) as typeof events));
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const liveTeam = index.teamOf(s.primary_mentor_id);
  const team = s.team_id
    ? { id: String(s.team_id), name: String(s.team_name || liveTeam?.name || ""), stored: true }
    : liveTeam ? { id: liveTeam.id, name: liveTeam.name, stored: false } : null;

  const firstReceivedBy = s.first_assignee_id
    ? { name: s.first_assignee_name || null, role: s.first_assignee_role ? roleLabel(s.first_assignee_role) : null, at: s.first_assigned_at || null, fromRecords: false }
    : (() => { const f = firstFromRecords(s, requests); return f ? { ...f, fromRecords: true } : null; })();

  return json({ team, firstReceivedBy, cameFrom: cameFrom(s), events });
}
