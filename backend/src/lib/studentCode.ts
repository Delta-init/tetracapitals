import { col } from "../db";

/**
 * The next student code, e.g. 'STU-0042'.
 *
 * Drawn from an atomic counter document in the `counters` collection
 * (`findOneAndUpdate` with `$inc`), so even simultaneous callers receive
 * distinct codes. The Students page asks through getNextStudentCode, and
 * students arriving from Delta finance take theirs here too — one sequence for
 * both, so the two can never hand out the same code.
 *
 * Self-initializes from the existing data the first time it's called: scans
 * every `students.student_code` matching the `STU-NNNN` pattern, finds the
 * max, and seeds the counter to that value so subsequent increments don't
 * collide with historical codes.
 */
export async function nextStudentCode(): Promise<string> {
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
  return `STU-${String(seq).padStart(4, "0")}`;
}
