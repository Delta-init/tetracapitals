import { MongoClient, type Db, type Collection, type Document } from "mongodb";
import { config } from "./config";

let client: MongoClient | null = null;
let dbInstance: Db | null = null;

export async function connectDb(): Promise<Db> {
  if (dbInstance) return dbInstance;
  client = new MongoClient(config.mongoUri, {
    maxPoolSize: 20,
    authSource: "admin",
    serverSelectionTimeoutMS: 10_000,
  });
  await client.connect();
  dbInstance = client.db(config.mongoDb);
  return dbInstance;
}

export function db(): Db {
  if (!dbInstance) throw new Error("DB not connected — call connectDb() first");
  return dbInstance;
}

export function col<T extends Document = Document>(name: string): Collection<T> {
  return db().collection<T>(name);
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    dbInstance = null;
  }
}

/**
 * Create indexes for the entities we know about. Safe to run on every boot.
 */
export async function ensureIndexes(): Promise<void> {
  const d = db();
  await Promise.all([
    d.collection("users").createIndex({ email: 1 }, { unique: true }),
    d.collection("users").createIndex({ app_role: 1 }),
    d.collection("students").createIndex({ primary_mentor_id: 1 }),
    d.collection("students").createIndex({ senior_mentor_id: 1 }),
    d.collection("students").createIndex({ student_code: 1 }, { unique: false, sparse: true }),
    d.collection("funding_transactions").createIndex({ student_id: 1, status: 1 }),
    d.collection("funding_transactions").createIndex({ primary_mentor_id: 1 }),
    d.collection("funding_transactions").createIndex({ initiating_mentor_id: 1 }),
    d.collection("funding_transactions").createIndex({ requested_at: -1 }),
    d.collection("tickets").createIndex({ ticket_number: 1 }, { unique: true, sparse: true }),
    d.collection("tickets").createIndex({ status: 1, escalated: 1, created_date: -1 }),
    d.collection("ticket_messages").createIndex({ ticket_id: 1, created_date: 1 }),
    d.collection("notifications").createIndex({ user_id: 1, read: 1, created_date: -1 }),
    d.collection("commission_ledgers").createIndex({ mentor_id: 1, quarter: 1 }, { unique: true }),
    d.collection("manual_commission_adjustments").createIndex({ mentor_id: 1, created_date: -1 }),
    d.collection("mentor_referrals").createIndex({ status: 1, initiating_mentor_id: 1, student_id: 1 }),
    d.collection("mt5_accounts").createIndex({ student_id: 1 }),
    d.collection("mt5_accounts").createIndex({ mt5_login: 1 }, { unique: true, sparse: true }),
    d.collection("logs").createIndex({ timestamp: -1 }),
    d.collection("logs").createIndex({ entity_type: 1, entity_id: 1 }),
    d.collection("student_logs").createIndex({ student_id: 1, created_date: -1 }),
    d.collection("retention_assignments").createIndex({ student_id: 1 }),
    d.collection("mentor_targets").createIndex({ mentor_id: 1, period: 1 }),
    d.collection("mentor_points").createIndex({ total_points: -1 }),
  ]);
}
