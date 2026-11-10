import { col } from "../db";
import { config } from "../config";
import { serialize } from "../lib/id";
import { ok, refuse, secretMatches, text, isEmail } from "../students/intake";
import type { AuthUser } from "../auth/middleware";
import {
  ASKS_FOR_MEETINGS, listMeetingRequests, createMeetingRequest, cancelMeetingRequest, getMeetingRequestReview,
  searchMeetingStudents, getStudentMeetingHistory,
} from "../functions/meetingRequests";
import { getMeetingsDone } from "../functions/meetingOutcomes";
import { getMeetingCommissions } from "../functions/meetingCommissions";
import { getCommissionReport, getReportFilters } from "../functions/reports";

/* ────────────────────────────────────────────────────────────────────────────
   POST /api/v1/integrations/lms/mentor-meetings — the Delta LMS admin's
   Meeting requests and Meetings done pages (the user, 2026-11-10: "do same as
   the commission portal also in the lms admin"), for the mentor signed in
   there. Body { email, action, body? }: the LMS sends its signed-in
   instructor's own address; the staff account here with that address — a
   Junior, Senior, Sub-junior or Chief Mentor — is who the action runs as, so
   the rules are this portal's own (the 7-day rule, who decides, the
   commission's reach, Converted).

   Actions — what that mentor can do on this portal's pages, nothing more:
     me                        → { mentor, role, name, asks, meetings_done }
     listMeetingRequests       their own requests, every status
     createMeetingRequest      Senior / Junior / Sub-junior only (a Chief books)
     cancelMeetingRequest      take back their own, still waiting
     getMeetingRequestReview   their own request, with the 7-day check
     searchMeetingStudents     Senior / Junior / Sub-junior only
     getStudentMeetingHistory  a student's earlier meetings, for the form
     getMeetingCommissions     their Meeting mentor commission (a Chief: the team's)
     getMeetingsDone           a Chief only — their team's meetings, Converted
     getCommissionReport       the Commission report (2026-11-10: "the commission
                               also they can see from the lms"), with the same
                               reach as on its page here — a Senior / Junior /
                               Sub-junior their team's, a Chief their people's —
                               and the credits behind any number
     getReportFilters          its teams and people to filter by
   Never deciding, escalating or paying. The LMS's own secret in
   `x-lms-secret`, as for new students (lms/students.ts).

   An LMS admin (the user, 2026-11-10: "show in the sidebar the meeting done
   and meeting request"): what their account here may read — a Super Admin or
   Admin every request and meeting, a CS Manager their location's requests and
   the Meeting commission — never asking, taking back or deciding. The
   Commission report too: a Super Admin or Admin everyone's, a CS Manager
   their location's.
──────────────────────────────────────────────────────────────────────────── */

export const MENTOR_ROLES = new Set(["junior_mentor", "senior_mentor", "subjunior_mentor", "chief_mentor"]);
/** Who reads from the LMS admin without being a mentor: these accounts' own reach here, read only. */
export const VIEWER_ROLES = new Set(["super_admin", "admin", "cs_manager"]);
const ADMINS = new Set(["super_admin", "admin"]);
const CHIEF = new Set(["chief_mentor"]);
type Handler = (req: Request, user: AuthUser) => Promise<Response>;
/** `viewers`: a viewer may run it too (read only). */
const ACTIONS: Record<string, { run: Handler; roles?: Set<string>; viewers?: Set<string>; body?: (b: Record<string, unknown>, u: AuthUser) => Record<string, unknown> }> = {
  // A mentor: their own; a viewer: the ones they decide here (read only from the LMS).
  listMeetingRequests: { run: listMeetingRequests, viewers: VIEWER_ROLES, body: (_b, u) => ({ box: MENTOR_ROLES.has(u.app_role) ? "mine" : "to_decide", status: "all" }) },
  createMeetingRequest: { run: createMeetingRequest, roles: ASKS_FOR_MEETINGS },
  cancelMeetingRequest: { run: cancelMeetingRequest },
  getMeetingRequestReview: { run: getMeetingRequestReview, viewers: VIEWER_ROLES },
  searchMeetingStudents: { run: searchMeetingStudents, roles: ASKS_FOR_MEETINGS },
  getStudentMeetingHistory: { run: getStudentMeetingHistory, viewers: VIEWER_ROLES },
  getMeetingCommissions: { run: getMeetingCommissions, viewers: VIEWER_ROLES },
  getMeetingsDone: { run: getMeetingsDone, roles: CHIEF, viewers: ADMINS },
  getCommissionReport: { run: getCommissionReport, viewers: VIEWER_ROLES },
  getReportFilters: { run: getReportFilters, viewers: VIEWER_ROLES },
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The staff account with this address, as an AuthUser — a mentor's first, if the address is on more than one. */
async function staffWithEmail(email: string): Promise<AuthUser | null> {
  const found = (await col("users").find({ email: new RegExp(`^\\s*${esc(email)}\\s*$`, "i"), status: { $ne: "inactive" } }).limit(5).toArray()) as any[];
  const doc = found.find((u) => MENTOR_ROLES.has(String(u.app_role))) ?? found.find((u) => VIEWER_ROLES.has(String(u.app_role))) ?? found[0];
  if (!doc) return null;
  const { password_hash, ...safe } = doc;
  return serialize(safe) as AuthUser;
}

export async function handleLmsMentorMeetings(req: Request): Promise<Response> {
  if (!config.lmsS2sSecret) return refuse(503, "INTEGRATION_DISABLED", "The Delta LMS link is not configured on this server");
  if (!secretMatches(req.headers.get("x-lms-secret"), config.lmsS2sSecret)) return refuse(401, "UNAUTHORISED", "Bad secret");

  const got = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!got || typeof got !== "object" || Array.isArray(got)) return refuse(400, "VALIDATION_ERROR", "Body must be a JSON object");
  const email = text(got.email).toLowerCase();
  const action = text(got.action, 40);
  if (!isEmail(email)) return refuse(400, "VALIDATION_ERROR", "The mentor's email is required");
  const user = await staffWithEmail(email);
  const mentor = !!user && MENTOR_ROLES.has(user.app_role);

  const viewer = !!user && !mentor && VIEWER_ROLES.has(user.app_role);

  if (action === "me") {
    if (viewer) {
      return ok({ mentor: false, viewer: true, role: user!.app_role, name: user!.full_name ?? "", asks: false, requests: "to_decide",
        meetings_done: ADMINS.has(user!.app_role) ? ["meetings", "commission"] : ["commission"], commission_report: true });
    }
    if (!mentor) return ok({ mentor: false, viewer: false, message: user ? "Your CS Portal account isn't a mentor's" : "No CS Portal account has your email" });
    const asks = ASKS_FOR_MEETINGS.has(user!.app_role);
    return ok({ mentor: true, viewer: false, role: user!.app_role, name: user!.full_name ?? "", asks, requests: asks ? "mine" : null, meetings_done: asks ? ["commission"] : ["meetings", "commission"], commission_report: true });
  }
  const spec = ACTIONS[action];
  if (!spec) return refuse(400, "VALIDATION_ERROR", "Unknown action");
  if (!user) return refuse(404, "NO_ACCOUNT", "No CS Portal account has your email");
  if (viewer) {
    if (!spec.viewers?.has(user.app_role)) return refuse(403, "READ_ONLY", "Read only from the LMS — do it in the CS Portal");
  } else {
    if (!mentor) return refuse(403, "NOT_A_MENTOR", "Your CS Portal account isn't a mentor's");
    if (spec.roles && !spec.roles.has(user.app_role)) return refuse(403, "NOT_FOR_YOUR_ROLE", "Not for your role");
  }

  const inner = got.body && typeof got.body === "object" && !Array.isArray(got.body) ? (got.body as Record<string, unknown>) : {};
  const body = spec.body ? { ...inner, ...spec.body(inner, user) } : inner;
  let res: Response;
  try {
    res = await spec.run(new Request(`http://lms.local/api/functions/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), user);
  } catch (err) {
    console.error(`[lms mentor-meetings] ${action} failed`, err);
    return refuse(500, "FAILED", "Something went wrong on the CS Portal");
  }
  const data: any = await res.json().catch(() => ({}));
  if (res.ok) return ok(data);
  const message = String(data?.error?.message ?? data?.error ?? data?.message ?? `Refused (${res.status})`);
  return refuse(res.status, "REFUSED", message);
}
