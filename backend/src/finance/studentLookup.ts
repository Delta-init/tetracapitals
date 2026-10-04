import { col } from "../db";
import { config } from "../config";
import { ok, refuse, secretMatches, text, isEmail } from "../students/intake";
import { bonusChecksFor, verificationOf, type BonusCheck } from "../students/bonusVerification";

/* ────────────────────────────────────────────────────────────────────────────
   POST /api/v1/integrations/finance/students/lookup { codes?, emails? }

   Who looks after students finance sent here — for the sales CRMs' "My
   Enrolments", which show each approved enrolment's CS and CS team. Asked
   live, so a student given to another CS or team reads as they are now.

   Read-only, with finance's own secret (`x-finance-secret`, the one its new
   students arrive with). At most MAX students a call. By student code — what
   finance was told when it sent them — or by email for a record from before
   that; an email matches whatever its capitals here.

   → { students: [{ asked, found, code, cs, team, assignment, onboarded, onboarded_at,
       onboarded_by, verification, bonuses }] }, one for each code and email
     asked, in that order. `cs` is "" while the student waits in Delta Open
     Students (`assignment: "open_pool"`). `onboarded`: their welcome went;
     `bonuses`: each MT5 bonus promised at a sales close (by finance's invoice
     id) and where its broker-admin approval stands; `verification`: "none"
     when no bonus was promised, else pending / rejected / approved
     (students/bonusVerification.ts) — the steps the sales CRMs show before
     their commission counts.
──────────────────────────────────────────────────────────────────────────── */

const MAX = 200;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Row = {
  _id?: unknown; student_code?: string; email?: string; primary_mentor_name?: string; team_name?: string; assignment_status?: string;
  onboarded?: boolean; onboarded_at?: string; onboarded_by_name?: string; course_fees?: unknown[];
};

const describe = (asked: string, r: Row | undefined, checks: Map<string, BonusCheck[]>) => {
  if (!r) return { asked, found: false, code: "", cs: "", team: "", assignment: "", onboarded: false, verification: "none", bonuses: [] };
  const pooled = r.assignment_status === "open_pool";
  const bonuses = checks.get(String(r._id)) ?? [];
  return {
    asked,
    found: true,
    code: String(r.student_code ?? ""),
    cs: pooled ? "" : String(r.primary_mentor_name ?? ""),
    team: String(r.team_name ?? ""),
    assignment: pooled ? "open_pool" : "assigned",
    onboarded: r.onboarded === true,
    onboarded_at: r.onboarded === true ? (r.onboarded_at ?? null) : null,
    onboarded_by: r.onboarded === true ? String(r.onboarded_by_name ?? "") : "",
    verification: verificationOf(bonuses),
    bonuses,
  };
};

export async function handleFinanceStudentLookup(req: Request): Promise<Response> {
  if (!config.financeS2sSecret) return refuse(503, "INTEGRATION_DISABLED", "The Delta finance link is not configured on this server");
  if (!secretMatches(req.headers.get("x-finance-secret"), config.financeS2sSecret)) return refuse(401, "UNAUTHORISED", "Bad secret");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return refuse(400, "VALIDATION_ERROR", "Body must be a JSON object");

  const list = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => text(x, 320)).filter(Boolean);
  const codes = [...new Set(list(body.codes).map((c) => c.toUpperCase()))];
  const emails = [...new Set(list(body.emails).map((e) => e.toLowerCase()).filter(isEmail))];
  if (codes.length + emails.length > MAX) return refuse(400, "VALIDATION_ERROR", `At most ${MAX} students at a time`);
  if (!codes.length && !emails.length) return ok({ students: [] });

  const rows = (await col("students")
    .find({
      $or: [
        ...(codes.length ? [{ student_code: { $in: codes } }] : []),
        ...emails.map((e) => ({ email: { $regex: `^${escapeRegex(e)}$`, $options: "i" } })),
      ],
    })
    .project({
      student_code: 1, email: 1, primary_mentor_name: 1, team_name: 1, assignment_status: 1,
      onboarded: 1, onboarded_at: 1, onboarded_by_name: 1, course_fees: 1,
    })
    .toArray()) as Row[];
  const checks = await bonusChecksFor(rows);

  const byCode = new Map(rows.map((r) => [String(r.student_code ?? "").toUpperCase(), r]));
  const byEmail = new Map(rows.map((r) => [String(r.email ?? "").toLowerCase(), r]));
  return ok({
    students: [
      ...codes.map((c) => describe(c, byCode.get(c), checks)),
      ...emails.map((e) => describe(e, byEmail.get(e), checks)),
    ],
  });
}
