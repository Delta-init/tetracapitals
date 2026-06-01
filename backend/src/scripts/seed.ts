import bcrypt from "bcryptjs";
import { connectDb, closeDb, col, ensureIndexes } from "../db";

/**
 * Idempotent seed: creates a super_admin and a couple of demo mentors,
 * plus a small set of students, MT5 accounts, and gamification settings.
 * Run with: bun run seed
 */
async function seed() {
  await connectDb();
  await ensureIndexes();

  const users = col("users");
  const now = new Date().toISOString();

  async function upsertUser(email: string, full_name: string, app_role: string, password: string, extras: Record<string, unknown> = {}) {
    const existing = await users.findOne({ email });
    if (existing) {
      console.log(`= user exists: ${email}`);
      return existing._id;
    }
    const password_hash = await bcrypt.hash(password, 10);
    const res = await users.insertOne({
      email, full_name, app_role, password_hash,
      commission_rate: 4, upline_commission_percentage: 0,
      created_date: now, updated_date: now,
      ...extras,
    } as any);
    console.log(`+ created ${app_role}: ${email}`);
    return res.insertedId;
  }

  const adminId = await upsertUser("admin@example.com", "Super Admin", "super_admin", "ChangeMe123!");
  const seniorId = await upsertUser("senior@example.com", "Senior Mentor", "senior_mentor", "ChangeMe123!", { upline_commission_percentage: 1 });
  const juniorId = await upsertUser("junior@example.com", "Junior Mentor", "junior_mentor", "ChangeMe123!");
  await upsertUser("finance@example.com", "Finance Admin", "finance_admin", "ChangeMe123!");
  await upsertUser("broker@example.com", "Broker Admin", "broker_admin", "ChangeMe123!");
  await upsertUser("academic@example.com", "Academic Head", "academic_head", "ChangeMe123!");

  const students = col("students");
  if ((await students.estimatedDocumentCount()) === 0) {
    await students.insertMany([
      {
        student_code: "STU-001", full_name: "Alice Trader", email: "alice@example.com",
        phone: "+10000000001", student_level: "LEVEL_1",
        primary_mentor_id: juniorId.toString(), primary_mentor_name: "Junior Mentor",
        senior_mentor_id: seniorId.toString(), senior_mentor_name: "Senior Mentor",
        co_mentors_details: null, status: "active",
        created_date: now, updated_date: now,
      },
      {
        student_code: "STU-002", full_name: "Bob Trader", email: "bob@example.com",
        phone: "+10000000002", student_level: "LEVEL_2",
        primary_mentor_id: juniorId.toString(), primary_mentor_name: "Junior Mentor",
        senior_mentor_id: seniorId.toString(), senior_mentor_name: "Senior Mentor",
        co_mentors_details: null, status: "active",
        created_date: now, updated_date: now,
      },
    ] as any[]);
    console.log("+ seeded 2 students");
  }

  console.log("\nDone. Login with admin@example.com / ChangeMe123!");
  await closeDb();
}

seed().catch((e) => { console.error(e); process.exit(1); });
