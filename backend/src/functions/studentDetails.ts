import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { visibleMentorIds, isStudentOf } from "../students/followups";
import { recordHistory } from "../students/history";

/** The details a student's people may change, and what the history calls them. */
const FIELDS: Record<string, string> = { full_name: "Name", email: "Email", phone: "Phone", country: "Country" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/functions/updateStudentDetails { studentId, full_name?, email?, phone?, country? }
 *
 * A student's own details — name, email, phone, country — changed by the people who look after them: their CS (or a
 * CS they are Common with), the people above them and admin roles, the same people who change their enrolment. Only
 * these four fields (everything else stays with the full Edit Student form, admins only). The email must be free —
 * no other student has it. Each change is in the student's history, from and to.
 */
export async function updateStudentDetails(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.studentId ?? ""));
  if (!oid) return error("studentId is required", 400);
  const s: any = await col("students").findOne({ _id: oid });
  if (!s) return notFound();
  const visible = await visibleMentorIds(user);
  if (visible && !isStudentOf(s, visible)) {
    return forbidden("Only this student's CS (or a CS they are Common with), the people above them and admins can change their details");
  }

  const data: Record<string, string> = {};
  for (const f of Object.keys(FIELDS)) {
    if (typeof body?.[f] !== "string") continue;
    const v = body[f].replace(/\s+/g, " ").trim().slice(0, 200);
    if (v !== String(s[f] ?? "").trim()) data[f] = v;
  }
  if ("full_name" in data && !data.full_name) return error("The name cannot be empty", 400);
  if (data.email) {
    if (!EMAIL.test(data.email)) return error("That is not an email address", 400);
    const taken: any = await col("students").findOne(
      { _id: { $ne: oid }, email: { $regex: `^${data.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
      { projection: { student_code: 1, full_name: 1 } },
    );
    if (taken) return error(`${taken.student_code} ${taken.full_name} already has this email`, 409);
  }
  if (!Object.keys(data).length) return json({ unchanged: true });

  const now = new Date().toISOString();
  const who = user.full_name || user.email || "somebody";
  await col("students").updateOne({ _id: oid }, { $set: { ...data, updated_date: now } });
  await recordHistory([{
    student_id: String(oid), at: now, type: "details_changed",
    text: `Details changed — ${Object.entries(data).map(([f, v]) => `${FIELDS[f]}: ${String(s[f] ?? "").trim() || "none"} → ${v || "none"}`).join("; ")}`,
    by_id: user.id, by_name: who,
    from: Object.fromEntries(Object.keys(data).map((f) => [f, s[f] ?? ""])), to: data,
  }]);
  return json({ ...data, updated_date: now });
}
