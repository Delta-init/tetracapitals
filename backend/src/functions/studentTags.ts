import { col } from "../db";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId, serializeMany } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { visibleMentorIds, isStudentOf } from "../students/followups";
import { recordHistory, type HistoryEntry } from "../students/history";
import { tagCatalog, tagNamesOf } from "../students/tags";

/**
 * POST /api/functions/getStudentTags
 * The student tag list (see students/tags.ts), auto tags first, then the course ones, then the rest — anyone signed in.
 */
export async function getStudentTags(_req: Request, _user: AuthUser): Promise<Response> {
  const order: Record<string, number> = { auto: 0, closed: 1, custom: 2 };
  const tags = (await tagCatalog()).sort((a: any, b: any) =>
    (order[a.kind] ?? 2) - (order[b.kind] ?? 2) || String(a.name).localeCompare(String(b.name)));
  return json({ tags: serializeMany(tags) });
}

/**
 * POST /api/functions/setStudentTag { studentId, tag, on: boolean }
 * Puts a tag on a student, or takes it off — by the same people who change their Enrolment: their CS (or a CS they
 * are Common with), the people above them, and admins. Auto tags (Old, Closed, Common) follow the student and are
 * never set by hand. Putting a "Closed - <course>" on marks the student enrolled. Each change goes in their history.
 */
export async function setStudentTag(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const oid = toObjectId(String(body?.studentId ?? ""));
  if (!oid) return error("studentId is required", 400);
  const name = String(body?.tag ?? "").trim();
  if (!name) return error("tag is required", 400);
  const on = body?.on !== false;

  const s: any = await col("students").findOne({ _id: oid });
  if (!s) return notFound();
  const visible = await visibleMentorIds(user);
  if (visible && !isStudentOf(s, visible)) {
    return forbidden("Only this student's CS (or a CS they are Common with), the people above them and admins can tag them");
  }
  const tag: any = await col("student_tags").findOne({ name });
  if (!tag) return error(`There is no tag "${name}"`, 404);
  if (tag.kind === "auto") return error(`"${name}" follows the student — it is not put on by hand`, 400);

  const own: string[] = Array.isArray(s.tags) ? s.tags : [];
  if (on === own.includes(name)) return json({ tags: tagNamesOf(s), unchanged: true });
  if (on && tag.active === false) return error(`"${name}" is switched off on the Student Tags page`, 400);

  const now = new Date().toISOString();
  const who = user.full_name || user.email || "somebody";
  const set: Record<string, unknown> = { updated_date: now };
  const history: HistoryEntry[] = [{
    student_id: String(oid), at: now, type: "tag_changed", text: `${on ? "Tag added" : "Tag removed"}: ${name}`,
    by_id: user.id, by_name: who, ...(on ? { to: name } : { from: name }),
  }];
  // A course closed means the student enrolled.
  if (on && tag.kind === "closed" && s.enrolment_status !== "closed") {
    Object.assign(set, { enrolment_status: "closed", enrolment_updated_at: now, enrolment_updated_by_id: user.id, enrolment_updated_by_name: who });
    history.push({
      student_id: String(oid), at: now, type: "enrolment_changed", text: `Enrolment closed — enrolled (${name})`,
      by_id: user.id, by_name: who, from: s.enrolment_status === "old" ? "old" : "open", to: "closed",
    });
  }
  await col("students").updateOne({ _id: oid }, { $set: set, ...(on ? { $addToSet: { tags: name } } : { $pull: { tags: name } }) } as any);
  await recordHistory(history);
  const updated = await col("students").findOne({ _id: oid });
  return json({ tags: tagNamesOf(updated), enrolment_status: (updated as any)?.enrolment_status ?? "open" });
}
