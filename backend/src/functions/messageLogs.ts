import { ObjectId } from "mongodb";
import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { userCanReadDoc } from "../entities/crud";
import { callLms, lmsConfigured, LmsError } from "../lib/lms";
import { isMentorRole } from "../lib/roles";
import { canEditAny, visibleMentorIds, studentsOf, isStudentOf } from "../students/followups";
import { csManagerReach } from "../lib/userLocation";

/* ────────────────────────────────────────────────────────────────────────────
   Message Logs (the user, 2026-10-29): the emails and WhatsApp messages our
   students were sent, as the LMS's Email Logs / WhatsApp Logs pages show
   them — two tabs, the same filters, the counts.

     Email     what the portal sent (email_log, from 2026-10-17, a year) and
               what the LMS sent (its queue: sent mail 30 days)
     WhatsApp  what the LMS sent (class reminders, join and sign-in links —
               30 days); a CS's own chats stay on the WhatsApp page

   Whose: a CS their students (Common ones too), a Chief Mentor and the team
   mentors their team's, a CS Manager their location's, Super Admins every
   message. A one-tap link (join /j/, sign-in /s/) is shown in full, with
   where it stands, to whoever may act as that student in the LMS anyway
   (functions/lmsEnrolmentRequests.ts actsAsStudent) — masked for anyone else.

   And on the student page: the LMS's WhatsApp messages to that student.
   LMS: POST /service/message-logs (services/portalMessageLogs.service.ts).
──────────────────────────────────────────────────────────────────────────── */

const ROLES = new Set(["cs", "cs_manager", "chief_mentor", "senior_mentor", "junior_mentor", "subjunior_mentor"]);
const may = (user: AuthUser) => canEditAny(user) || ROLES.has(user.app_role);
/** May see one-tap links in full: whoever may Act as student (the Super Admin, the mentor roles — CS Managers too). */
const mayReveal = (user: AuthUser) => user.app_role === "super_admin" || isMentorRole(user.app_role);
const MAX_PAGE_ROWS = 500;   // the LMS's most in one answer — page × limit for the merged email list
const STUDENT_FIELDS = { full_name: 1, student_code: 1, email: 1, phone: 1, phones: 1, primary_mentor_id: 1, primary_mentor_name: 1, common_cs: 1, team_name: 1 };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const addressesOf = (raw: unknown): string[] => (String(raw ?? "").match(/[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+/g) ?? []).map((e) => e.toLowerCase());
const phonesOf = (s: any): string[] =>
  [s?.phone, ...(Array.isArray(s?.phones) ? s.phones.map((p: any) => (typeof p === "string" ? p : p?.number)) : [])]
    .flatMap((p) => String(p ?? "").split(/[,;/]/)).map((p) => p.replace(/\D/g, "")).filter((d) => d.length >= 7);
const tail = (p: unknown) => String(p ?? "").replace(/\D/g, "").slice(-9);
const dayStart = (d: unknown, add = 0) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(Date.parse(`${d}T00:00:00+04:00`) + add).toISOString() : null);
const lmsMissing = (err: unknown) => err instanceof LmsError && /route \S+ \S+ not found|cannot post|cannot get/i.test(err.message);

/** Whose people: null = everyone; else these user ids (themselves included). */
async function reachOf(user: AuthUser): Promise<Set<string> | null> {
  if (canEditAny(user)) return null;
  const manager = await csManagerReach(user);
  if (manager) return new Set([user.id, ...manager.ids]);
  return (await visibleMentorIds(user)) ?? null;
}

/** The students in reach — narrowed by `q` (name, code, email or phone) — at most `cap`. */
async function studentsIn(reach: Set<string> | null, q: string, cap = 20_000): Promise<any[]> {
  const and: Record<string, any>[] = [];
  if (reach) and.push(studentsOf([...reach]));
  if (q) {
    const digits = q.replace(/\D/g, "");
    and.push({ $or: [
      { full_name: { $regex: esc(q), $options: "i" } }, { student_code: { $regex: `^${esc(q)}$`, $options: "i" } },
      { email: { $regex: esc(q), $options: "i" } },
      ...(digits.length >= 5 ? [{ phone: { $regex: digits.split("").join("\\D*") } }] : []),
    ] });
  }
  return (await col("students").find(and.length ? { $and: and } : {}, { projection: STUDENT_FIELDS }).limit(cap).toArray()) as any[];
}

const card = (s: any) => s ? { id: String(s._id), name: s.full_name ?? "", code: s.student_code ?? "", cs_name: s.primary_mentor_name ?? "", team: s.team_name ?? "" } : null;

/** Each address and phone tail → their student here. */
function indexOf(students: any[]) {
  const byEmail = new Map<string, any>(), byTail = new Map<string, any>();
  for (const s of students) {
    for (const e of addressesOf(s.email)) if (!byEmail.has(e)) byEmail.set(e, s);
    for (const p of phonesOf(s)) if (!byTail.has(tail(p))) byTail.set(tail(p), s);
  }
  return { byEmail, byTail };
}

/**
 * POST /api/functions/getMessageLogs { channel: "email" | "whatsapp", page, limit, status, source, template, from, until, q }
 * → { rows, total, page, limit, summary?, templates?, lms: { available, message? }, reveal }
 */
export async function getMessageLogs(req: Request, user: AuthUser): Promise<Response> {
  if (!may(user)) return forbidden("Only for CSs, their leaders and Super Admins");
  const b: any = await req.json().catch(() => ({}));
  const channel = b?.channel === "whatsapp" ? "whatsapp" : "email";
  const limit = Math.min(100, Math.max(1, Math.floor(Number(b?.limit) || 25)));
  const page = Math.min(Math.floor(MAX_PAGE_ROWS / limit), Math.max(1, Math.floor(Number(b?.page) || 1)));
  const status = ["sent", "failed", "pending"].includes(b?.status) ? b.status : "";
  const source = channel === "email" && ["portal", "lms"].includes(b?.source) ? b.source : "all";
  const q = String(b?.q ?? "").trim().slice(0, 80);
  const reach = await reachOf(user);

  // Whose messages: every one (a Super Admin, nothing searched), else the students in reach / found by the search.
  const all = !reach && !q;
  const students = all ? [] : await studentsIn(reach, q);
  const emails = [...new Set(students.flatMap((s) => addressesOf(s.email)))];
  const phones = [...new Set(students.flatMap(phonesOf))];
  // A Super Admin may also search for an address or number that is nobody's here.
  if (!reach && q) {
    if (q.includes("@")) emails.push(q.toLowerCase());
    if (q.replace(/\D/g, "").length >= 7) phones.push(q.replace(/\D/g, ""));
  }
  const reveal = mayReveal(user);
  const summaryToo = page === 1;
  const lmsBody = {
    channel, all, emails, phones, status, from: b?.from, until: b?.until, reveal, summary: summaryToo,
    ...(channel === "whatsapp" && typeof b?.template === "string" ? { template: b.template } : {}),
  };

  let lms: any = { rows: [], total: 0 };
  let lmsState: { available: boolean; message?: string } = { available: true };
  const wantLms = channel === "whatsapp" || source !== "portal";
  if (wantLms) {
    if (!lmsConfigured()) lmsState = { available: false, message: "The LMS isn't linked to this server" };
    else if (all || emails.length || phones.length) {
      try {
        // Email: the first page × limit, to merge with the portal's; WhatsApp: just the page.
        const window = channel === "email" && source === "all" ? { skip: 0, limit: page * limit } : { skip: (page - 1) * limit, limit };
        lms = await callLms("/message-logs", { method: "POST", body: { ...lmsBody, ...window }, verb: "share the message logs" });
      } catch (err) {
        lmsState = { available: false, message: lmsMissing(err) ? "This needs the LMS update" : err instanceof Error ? err.message : "The LMS did not answer" };
      }
    }
  }

  const { byEmail, byTail } = indexOf(students);
  const studentOf = async (email: string, phone?: string) => {
    const hit = byEmail.get(email) ?? (phone ? byTail.get(tail(phone)) : undefined);
    if (hit || reach) return hit ?? null;
    // A Super Admin's "every message": who it was, when it's somebody here.
    if (email) return (await col("students").findOne({ email: { $regex: `(^|[\\s,;<])${esc(email)}($|[\\s,;>])`, $options: "i" } }, { projection: STUDENT_FIELDS })) ?? null;
    return null;
  };

  if (channel === "whatsapp") {
    const rows = [];
    for (const r of lms.rows ?? []) {
      const s = await studentOf(String(r.person?.email ?? "").toLowerCase(), r.to);
      rows.push({ ...r, source: "lms", student: card(s) });
    }
    return json({ channel, rows, total: lms.total ?? 0, page, limit, summary: lms.summary ?? null, templates: lms.templates ?? [], lms: lmsState, reveal });
  }

  // Email: the portal's own as well, merged newest first.
  let portalRows: any[] = [], portalTotal = 0, portalSummary: any = null;
  if (source !== "lms" && status !== "pending" && (all || emails.length)) {
    const match: Record<string, any> = all ? {} : { to: { $in: emails } };
    if (status === "sent") match.status = "sent";
    if (status === "failed") match.status = { $in: ["failed", "not_sent"] };
    const from = dayStart(b?.from), until = dayStart(b?.until, 864e5);
    if (from || until) match.at = { ...(from ? { $gte: from } : {}), ...(until ? { $lt: until } : {}) };
    const window = source === "all" ? { skip: 0, limit: page * limit } : { skip: (page - 1) * limit, limit };
    [portalRows, portalTotal] = await Promise.all([
      col("email_log").find(match, { projection: { html: 0, text: 0 } }).sort({ at: -1 }).skip(window.skip).limit(window.limit).toArray() as Promise<any[]>,
      col("email_log").countDocuments(match),
    ]);
    if (summaryToo) {
      const scope = all ? {} : { to: { $in: emails } };
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
      const count = async (since: string) => {
        const c = { sent: 0, failed: 0, pending: 0, total: 0 };
        for (const r of (await col("email_log").aggregate([{ $match: { ...scope, at: { $gte: since } } }, { $group: { _id: "$status", n: { $sum: 1 } } }]).toArray()) as any[]) {
          if (r._id === "sent") c.sent += r.n; else c.failed += r.n;
          c.total += r.n;
        }
        return c;
      };
      portalSummary = { today: await count(dayStart(today)!), last7Days: await count(new Date(Date.parse(dayStart(today)!) - 6 * 864e5).toISOString()) };
    }
  }
  const merged = [
    ...portalRows.map((r) => ({ source: "portal", id: String(r._id), to: r.to, subject: r.subject ?? "", status: r.status === "sent" ? "sent" : "failed", at: r.at, error: r.error ?? "", kind: r.kind ?? "", by: r.by_name ?? "" })),
    ...(source === "portal" ? [] : (lms.rows ?? []).map((r: any) => ({ source: "lms", id: r.id, to: String(r.to ?? "").toLowerCase(), subject: r.subject, status: r.status, at: r.sentAt || r.createdAt, error: r.error ?? "", kind: "", by: "LMS" }))),
  ].sort((x, y) => String(y.at ?? "").localeCompare(String(x.at ?? "")));
  const pageRows = source === "all" ? merged.slice((page - 1) * limit, page * limit) : merged;
  const rows = [];
  for (const r of pageRows) rows.push({ ...r, student: card(await studentOf(r.to)) });
  const add = (a: any, b2: any) => (a || b2 ? Object.fromEntries(["today", "last7Days"].map((k) => [k, Object.fromEntries(["sent", "failed", "pending", "total"].map((f) => [f, (a?.[k]?.[f] ?? 0) + (b2?.[k]?.[f] ?? 0)]))])) : null);
  return json({
    channel, rows, page, limit, lms: lmsState, reveal,
    total: (source === "lms" ? 0 : portalTotal) + (source === "portal" ? 0 : lms.total ?? 0),
    summary: summaryToo ? add(source === "lms" ? null : portalSummary, source === "portal" ? null : lms.summary) : null,
  });
}

/** POST /api/functions/getMessageLogEmail { source, id, to } → { subject, html, text, at, status } — if `to` is one of theirs. */
export async function getMessageLogEmail(req: Request, user: AuthUser): Promise<Response> {
  if (!may(user)) return forbidden();
  const b: any = await req.json().catch(() => ({}));
  const to = String(b?.to ?? "").trim().toLowerCase(), id = String(b?.id ?? "");
  if (!to.includes("@") || !id) return error("source, id and to are required", 400);
  const reach = await reachOf(user);
  if (reach) {
    const s = await col("students").findOne({ $and: [studentsOf([...reach]), { email: { $regex: `(^|[\\s,;<])${esc(to)}($|[\\s,;>])`, $options: "i" } }] }, { projection: { _id: 1 } });
    if (!s) return forbidden();
  }
  if (b?.source === "portal") {
    if (!ObjectId.isValid(id)) return notFound();
    const r: any = await col("email_log").findOne({ _id: new ObjectId(id), to });
    if (!r) return notFound();
    return json({ subject: r.subject ?? "", html: r.html ?? "", text: r.text ?? "", at: r.at, status: r.status });
  }
  if (!lmsConfigured()) return error("The LMS isn't linked to this server", 503);
  try {
    const r: any = await callLms(`/student-emails/${encodeURIComponent(id)}`, { query: { email: to }, verb: "open the email" });
    return json({ subject: r?.subject ?? "", html: r?.html ?? "", text: r?.text ?? "", at: r?.sentAt || r?.createdAt, status: r?.status });
  } catch (err) {
    if (err instanceof LmsError && /no such email/i.test(err.message)) return notFound();
    return error(err instanceof Error ? err.message : "The LMS did not answer", 502);
  }
}

/**
 * POST /api/functions/getStudentLmsWhatsApp { studentId } → { rows, total, reveal, lms: { available, message? } } — the
 * LMS's WhatsApp messages to this student (their numbers here and on their LMS account), for anyone who may open them.
 */
export async function getStudentLmsWhatsApp(req: Request, user: AuthUser): Promise<Response> {
  const b: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(b?.studentId ?? ""));
  if (!oid) return error("studentId is required", 400);
  const s: any = await col("students").findOne({ _id: oid }, { projection: STUDENT_FIELDS });
  if (!s) return notFound("No such student");
  if (!(await userCanReadDoc(user, "Student", s))) return forbidden();
  const emails = addressesOf(s.email), phones = phonesOf(s);
  // In full for who may act as them: a Super Admin or CS Manager anyone; a CS their own; a Chief / team mentor their team's.
  let reveal = user.app_role === "super_admin" || user.app_role === "cs_manager";
  if (!reveal && isMentorRole(user.app_role)) reveal = isStudentOf(s, (await visibleMentorIds(user)) ?? new Set([user.id]));
  if (!lmsConfigured()) return json({ rows: [], total: 0, reveal, lms: { available: false, message: "The LMS isn't linked to this server" } });
  if (!emails.length && !phones.length) return json({ rows: [], total: 0, reveal, lms: { available: true } });
  try {
    const r: any = await callLms("/message-logs", { method: "POST", body: { channel: "whatsapp", emails, phones, reveal, limit: 100 }, verb: "share the student's WhatsApp messages" });
    return json({ rows: r?.rows ?? [], total: r?.total ?? 0, reveal, lms: { available: true } });
  } catch (err) {
    return json({ rows: [], total: 0, reveal, lms: { available: false, message: lmsMissing(err) ? "This needs the LMS update" : err instanceof Error ? err.message : "The LMS did not answer" } });
  }
}
