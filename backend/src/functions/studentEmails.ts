import { ObjectId } from "mongodb";
import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { userCanReadDoc } from "../entities/crud";
import { callLms, lmsConfigured, LmsError } from "../lib/lms";

/* ────────────────────────────────────────────────────────────────────────────
   A student's emails (the user, 2026-10-17) — the student page's Emails tab:
   what the portal sent them (email_log, kept from 2026-10-17, a year — every
   email through lib/mailer.ts) and what the LMS sent them (its email queue:
   sent mail kept 30 days, failed and cleared until purged — LMS
   services/portalStudentEmails.service.ts). Anyone who can open the student.
──────────────────────────────────────────────────────────────────────────── */

/** Every address on the student's record (some hold two), in lower case. */
const addressesOf = (s: any): string[] =>
  [...new Set((String(s?.email ?? "").match(/[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+/g) ?? []).map((e) => e.toLowerCase()))];

async function studentFor(body: any, user: AuthUser): Promise<any | Response> {
  const oid = toObjectId(String(body?.studentId ?? ""));
  if (!oid) return error("studentId is required", 400);
  const s: any = await col("students").findOne({ _id: oid }, { projection: { email: 1, primary_mentor_id: 1, common_cs: 1, closed_by: 1, full_name: 1 } });
  if (!s) return notFound("No such student");
  if (!(await userCanReadDoc(user, "Student", s))) return forbidden();
  return s;
}

/**
 * POST /api/functions/getStudentEmails { studentId }
 * → { addresses, emails: [{ source: "portal" | "lms", id, to, subject, status, at, error, kind, by }], lms: { available, message?, keptDays } }
 */
export async function getStudentEmails(req: Request, user: AuthUser): Promise<Response> {
  const s = await studentFor(await req.json().catch(() => ({})), user);
  if (s instanceof Response) return s;
  const addresses = addressesOf(s);
  if (!addresses.length) return json({ addresses, emails: [], lms: { available: false, message: "No email on the student's record" } });

  const portal = ((await col("email_log").find({ to: { $in: addresses } }, { projection: { html: 0, text: 0 } }).sort({ at: -1 }).limit(300).toArray()) as any[])
    .map((r) => ({ source: "portal", id: String(r._id), to: r.to, subject: r.subject ?? "", status: r.status ?? "sent", at: r.at, error: r.error ?? "", kind: r.kind ?? "", by: r.by_name ?? "" }));

  const lms: any[] = [];
  let lmsState: { available: boolean; message?: string; keptDays?: number } = { available: true, keptDays: 30 };
  if (!lmsConfigured()) lmsState = { available: false, message: "The LMS isn't linked to this server" };
  else {
    for (const email of addresses) {
      try {
        const r: any = await callLms("/student-emails", { query: { email, limit: "200" }, verb: "list the student's emails" });
        lmsState.keptDays = r?.keptDays ?? 30;
        for (const e of r?.emails ?? []) {
          lms.push({ source: "lms", id: String(e.id), to: email, subject: e.subject ?? "", status: e.status === "pending" ? "waiting" : e.status ?? "sent",
            at: e.sentAt || e.createdAt, error: e.error ?? "", kind: "", by: "LMS" });
        }
      } catch (err) {
        lmsState = { available: false, message: err instanceof LmsError && /route \S+ \S+ not found|cannot get/i.test(err.message) ? "Needs the LMS update" : err instanceof Error ? err.message : "The LMS did not answer" };
        break;
      }
    }
  }
  const emails = [...portal, ...lms].sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  return json({ addresses, emails, lms: lmsState });
}

/** POST /api/functions/getStudentEmail { studentId, source, id } → { subject, html, text, at, status } — one email's body. */
export async function getStudentEmail(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const s = await studentFor(body, user);
  if (s instanceof Response) return s;
  const addresses = addressesOf(s);
  const id = String(body?.id ?? "");
  if (body?.source === "portal") {
    if (!ObjectId.isValid(id)) return notFound();
    const r: any = await col("email_log").findOne({ _id: new ObjectId(id), to: { $in: addresses } });
    if (!r) return notFound();
    return json({ subject: r.subject ?? "", html: r.html ?? "", text: r.text ?? "", at: r.at, status: r.status });
  }
  if (!lmsConfigured()) return error("The LMS isn't linked to this server", 503);
  for (const email of addresses) {
    try {
      const r: any = await callLms(`/student-emails/${encodeURIComponent(id)}`, { query: { email }, verb: "open the email" });
      return json({ subject: r?.subject ?? "", html: r?.html ?? "", text: r?.text ?? "", at: r?.sentAt || r?.createdAt, status: r?.status });
    } catch (err) {
      // The LMS answers "No such email" for an address it isn't — try the next address on the record.
      if (!(err instanceof LmsError && /no such email/i.test(err.message))) return error(err instanceof Error ? err.message : "The LMS did not answer", 502);
    }
  }
  return notFound();
}
