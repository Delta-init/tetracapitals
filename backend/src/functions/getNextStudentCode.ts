import { col } from "../db";
import { json } from "../lib/response";

/**
 * POST /api/functions/getNextStudentCode
 * Body: {} (ignored)
 * Returns: { code: 'STU-0042' }
 *
 * Generates the next unique student code via an atomic counter document in
 * the `counters` collection. Uses `findOneAndUpdate` with `$inc`, which is
 * MongoDB-atomic — even simultaneous calls will receive distinct codes.
 *
 * Self-initializes from the existing data the first time it's called: scans
 * every `students.student_code` matching the `STU-NNNN` pattern, finds the
 * max, and seeds the counter to that value so subsequent increments don't
 * collide with historical codes.
 */
// Signature matches the AUTHED dispatcher's (req, user) shape, but we don't read
// the body — every authenticated user (including mentors) can request a code.
export async function getNextStudentCode(_req: Request, _user: unknown): Promise<Response> {
  const counters = col<{ _id: string; seq: number }>("counters");
  const existing = await counters.findOne({ _id: "student_code" });
  if (!existing) {
    let max = 0;
    const cursor = col("students").find(
      { student_code: { $regex: /^STU-\d+$/ } },
      { projection: { student_code: 1 } },
    );
    for await (const s of cursor as any) {
      const m = String(s.student_code).match(/^STU-(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    // $setOnInsert + upsert makes the seeding race-safe — only one insert wins.
    await counters.updateOne(
      { _id: "student_code" },
      { $setOnInsert: { seq: max } },
      { upsert: true },
    );
  }

  const res = await counters.findOneAndUpdate(
    { _id: "student_code" },
    { $inc: { seq: 1 } },
    { returnDocument: "after" },
  );
  const seq = (res as any)?.seq ?? (res as any)?.value?.seq ?? 1;
  return json({ code: `STU-${String(seq).padStart(4, "0")}` });
}
