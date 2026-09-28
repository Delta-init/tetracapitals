import { col } from "../db";
import { json } from "../lib/response";
import { serializeMany } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

/**
 * POST /api/functions/searchStudents
 * Body: { q: string }
 * Returns: [{ id, full_name, email, student_code, primary_mentor_id, primary_mentor_name, senior_mentor_id, senior_mentor_name }]
 *
 * A deliberately UN-scoped student lookup for the co-management flow: a mentor
 * needs to find a client managed by ANOTHER mentor, which by definition falls
 * outside their own/downline data scope. To keep this safe it (a) requires a
 * search term of >= 2 chars, (b) matches only name / email / student_code,
 * (c) returns a small capped set, and (d) exposes only the minimal fields the
 * co-management picker shows — never phone, country, notes, etc.
 */
export async function searchStudents(req: Request, _user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const q = String(body?.q ?? "").trim();
  if (q.length < 2) return json([]);

  // Escape regex metacharacters so user input is treated literally.
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = { $regex: safe, $options: "i" };

  const docs = await col("students")
    .find(
      { $or: [{ full_name: rx }, { email: rx }, { student_code: rx }] },
      {
        projection: {
          full_name: 1,
          email: 1,
          student_code: 1,
          primary_mentor_id: 1,
          primary_mentor_name: 1,
          senior_mentor_id: 1,
          senior_mentor_name: 1,
        },
      },
    )
    .limit(20)
    .toArray();

  return json(serializeMany(docs));
}
