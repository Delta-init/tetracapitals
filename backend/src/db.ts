import { MongoClient, type Db, type Collection, type Document } from "mongodb";
import { config } from "./config";

let client: MongoClient | null = null;
let dbInstance: Db | null = null;

export async function connectDb(): Promise<Db> {
  if (dbInstance) return dbInstance;
  // Only pass authSource when the URI actually has user creds — embedded
  // mongo-memory-server has no auth and rejects the handshake otherwise.
  const hasCreds = /^mongodb(\+srv)?:\/\/[^/@]+@/.test(config.mongoUri);
  client = new MongoClient(config.mongoUri, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10_000,
    ...(hasCreds ? { authSource: "admin" } : {}),
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
    // One student per finance invoice, even if the same delivery arrives twice at once.
    // Partial: only students that came from finance carry the field.
    d.collection("students").createIndex(
      { finance_invoice_id: 1 },
      { unique: true, partialFilterExpression: { finance_invoice_id: { $type: "string" } } },
    ),
    d.collection("funding_transactions").createIndex({ student_id: 1, status: 1 }),
    d.collection("funding_transactions").createIndex({ primary_mentor_id: 1 }),
    d.collection("funding_transactions").createIndex({ initiating_mentor_id: 1 }),
    d.collection("funding_transactions").createIndex({ requested_at: -1 }),
    // Deposits waiting to go to Delta finance, and the transaction-ID check its decisions make.
    d.collection("funding_transactions").createIndex(
      { "finance_approval.state": 1, "finance_approval.next_attempt_at": 1 },
      { partialFilterExpression: { "finance_approval.state": { $exists: true } } },
    ),
    d.collection("funding_transactions").createIndex({ transaction_id: 1 }),
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
    d.collection("student_history").createIndex({ student_id: 1, at: 1 }),
    d.collection("student_followups").createIndex({ student_id: 1 }),
    d.collection("student_followup_events").createIndex({ student_id: 1, at: -1 }),
    d.collection("student_tags").createIndex({ name: 1 }, { unique: true }),
    d.collection("whatsapp_messages").createIndex({ owner_id: 1, chat: 1, at: -1 }),
    d.collection("whatsapp_messages").createIndex({ key: 1 }),
    d.collection("whatsapp_messages").createIndex({ student_ids: 1 }),
    // The same WhatsApp message twice for one CS (a reconnect replays them) is kept once.
    d.collection("whatsapp_messages").createIndex({ owner_id: 1, message_id: 1 }, { unique: true, partialFilterExpression: { message_id: { $gt: "" } } }),
    d.collection("whatsapp_links").createIndex({ key: 1 }, { unique: true }),
    d.collection("push_subscriptions").createIndex({ endpoint: 1 }, { unique: true }),
    d.collection("push_subscriptions").createIndex({ user_id: 1 }),
    // One reminder email per person per day — the unique key is what stops a second one.
    d.collection("followup_reminders").createIndex({ key: 1 }, { unique: true }),
    d.collection("followup_reminders").createIndex({ date: -1, mentor_id: 1 }),
    d.collection("followup_reminders").createIndex({ followup_ids: 1 }),
    d.collection("followup_reminders").createIndex({ token: 1 }),
    d.collection("student_followups").createIndex({ next_followup_date: 1 }),
    // Calls from 3CX: one per call (key = its main segment), found by student, by person, by time.
    d.collection("student_calls").createIndex({ key: 1 }, { unique: true }),
    d.collection("student_calls").createIndex({ student_id: 1, started_at: -1 }),
    d.collection("student_calls").createIndex({ started_at: -1 }),
    d.collection("student_calls").createIndex({ user_id: 1, started_at: -1 }),
    d.collection("student_calls").createIndex({ extension: 1, user_id: 1 }),
    d.collection("students").createIndex({ team_id: 1 }),
    d.collection("students").createIndex({ new_for_id: 1 }, { sparse: true }),
    d.collection("students").createIndex({ created_date: -1 }),
    d.collection("student_logs").createIndex({ created_date: -1 }),
    d.collection("student_log_history").createIndex({ created_date: -1 }),
    d.collection("tabby_links").createIndex({ student_id: 1, created_at: -1 }),
    d.collection("tabby_links").createIndex({ reference_id: 1 }, { unique: true }),
    d.collection("payment_link_requests").createIndex({ student_id: 1, created_at: -1 }),
    d.collection("payment_link_requests").createIndex({ status: 1, created_at: -1 }),
    d.collection("class_completions").createIndex({ student_id: 1, ended_at: -1 }),
    d.collection("class_completions").createIndex({ notify_at: 1 }),
    d.collection("retention_assignments").createIndex({ student_id: 1 }),
    d.collection("mentor_targets").createIndex({ mentor_id: 1, period: 1 }),
    d.collection("mentor_points").createIndex({ total_points: -1 }),
  ]);

  // One student per LMS account, even if two deliveries of it arrive at once.
  // Partial: only students that came from the LMS (or finance) carry the id.
  // Built apart from the rest and never fatal: it is new over existing data,
  // and the intake refuses a repeat without it — only the same-instant race
  // relies on it. A failure is logged rather than keeping the API down.
  await d.collection("students").createIndex(
    { lms_user_id: 1 },
    { unique: true, partialFilterExpression: { lms_user_id: { $gt: "" } } },
  ).catch((err) => console.error("[indexes] students.lms_user_id was not built:", (err as Error).message));
}
