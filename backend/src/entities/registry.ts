/**
 * Registry of every entity exposed via generic CRUD.
 *
 * Each entry maps the Base44-style entity name (used by the React frontend
 * as `base44.entities.<EntityName>.list()`, etc.) to a MongoDB collection
 * and an optional role-based access policy.
 *
 * Roles in this app: super_admin, admin, broker_admin, academic_head,
 * academic_admin, admin_supervisor, finance_admin, senior_mentor,
 * junior_mentor.
 */

export type Role =
  | "super_admin"
  | "admin"
  | "broker_admin"
  | "academic_head"
  | "academic_admin"
  | "admin_supervisor"
  | "finance_admin"
  | "chief_mentor"
  | "senior_mentor"
  | "junior_mentor";

export const ADMIN_ROLES: Role[] = [
  "super_admin",
  "admin",
  "broker_admin",
  "academic_head",
  "academic_admin",
  "admin_supervisor",
  "finance_admin",
];

export const ALL_ROLES: Role[] = [...ADMIN_ROLES, "chief_mentor", "senior_mentor", "junior_mentor"];

export interface EntityConfig {
  collection: string;
  /** Roles allowed to read (list/filter/get). Empty array = any authenticated user. */
  read?: Role[];
  /** Roles allowed to create. */
  create?: Role[];
  /** Roles allowed to update. */
  update?: Role[];
  /** Roles allowed to delete. */
  delete?: Role[];
  /** Field that, when matching current user id, makes any role allowed to read it. */
  ownerField?: string;
  /** Default sort if list/filter called without order. */
  defaultSort?: string;
  /**
   * Fields that must be unique across the collection (case-insensitive).
   * Enforced server-side on create/update/bulkCreate, regardless of caller or
   * data scope. Empty/blank values are exempt (so records without the field are
   * allowed). This is the real guard — client-side checks can't see records
   * outside the caller's data scope.
   */
  uniqueFields?: string[];
}

export const ENTITIES: Record<string, EntityConfig> = {
  User: {
    collection: "users",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ["super_admin"],
    defaultSort: "-created_date",
  },
  Student: {
    collection: "students",
    read: ALL_ROLES,
    create: ALL_ROLES,
    // Mentors are NOT allowed to edit students — only the admin-style roles.
    // (Frontend already hides the Edit button via canEditStudent; this is the
    // matching server-side gate so a mentor can't bypass it via the API.)
    // Admin-mediated automation that touches the doc (auto LEVEL_2 upgrade on
    // first approved deposit, retention assignment, student-request approval)
    // all runs from admin sessions and stays within this allow-list.
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_date",
    // A student's email must be unique across ALL students (any mentor).
    uniqueFields: ["email"],
  },
  StudentRequest: {
    collection: "student_requests",
    read: ALL_ROLES,
    create: ALL_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-requested_at",
  },
  StudentLog: {
    collection: "student_logs",
    read: ALL_ROLES,
    create: ALL_ROLES,
    update: ALL_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_date",
  },
  StudentLogHistory: {
    collection: "student_log_history",
    read: ALL_ROLES,
    create: ALL_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_date",
  },
  Ticket: {
    collection: "tickets",
    read: ALL_ROLES,
    create: ALL_ROLES,
    update: ALL_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_date",
  },
  TicketMessage: {
    collection: "ticket_messages",
    read: ALL_ROLES,
    create: ALL_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "created_date",
  },
  Notification: {
    collection: "notifications",
    read: ALL_ROLES,
    create: ALL_ROLES,
    update: ALL_ROLES,
    delete: ALL_ROLES,
    ownerField: "user_id",
    defaultSort: "-created_date",
  },
  // Configurable commission-hierarchy roles: a named position with a level
  // order, an optional parent (the role above it), and a page-permission list.
  // Distinct from the hard-coded auth app_role — this drives the commission
  // hierarchy + (later) page visibility.
  CommissionRole: {
    collection: "commission_roles",
    read: ALL_ROLES,
    create: ["super_admin", "admin"],
    update: ["super_admin", "admin"],
    delete: ["super_admin"],
    defaultSort: "name",
  },
  // Level-wise commission plans (Bonus With/Without MT5, Deposit). Each plan
  // holds an ordered list of level percentages; the engine walks up the Up Head
  // chain and pays each level its % of the transaction amount.
  // One row per recipient per approved transaction — written by the crediting
  // engine when a bonus is approved (Level 1 = initiator, up the Up Head chain).
  CommissionCredit: {
    collection: "commission_credits",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ["super_admin"],
    defaultSort: "-created_date",
  },
  CommissionPlan: {
    collection: "commission_plans",
    read: ALL_ROLES,
    create: ["super_admin", "admin"],
    update: ["super_admin", "admin"],
    delete: ["super_admin"],
    defaultSort: "name",
  },
  // Per-staff, per-period approval of the Bonus (monthly) / Deposit (quarterly)
  // commission reports. Walks Broker -> Academic -> Finance, then releases that
  // staff's credits for the period. Writes happen only through the
  // approveCommissionPeriod function; reads are open so the report can show status.
  CommissionPeriodApproval: {
    collection: "commission_period_approvals",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ["super_admin"],
    defaultSort: "-created_date",
  },
  // Daily staff activity tracker (Mentor / PA-CSE). One row per staff per day.
  // Staff create + edit only their own (ownerField); admins edit any. Reads are
  // scoped by data_scope, so a staff sees only their own and a chief sees their
  // team (see scope.ts).
  ActivityLog: {
    collection: "activity_logs",
    read: ALL_ROLES,
    create: ALL_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    ownerField: "staff_id",
    defaultSort: "-date",
  },
  FundingTransaction: {
    collection: "funding_transactions",
    read: ALL_ROLES,
    create: ALL_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-requested_at",
  },
  RetentionAssignment: {
    collection: "retention_assignments",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_date",
  },
  AcademicCounselor: {
    collection: "academic_counselors",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_date",
  },
  Log: {
    collection: "logs",
    read: ADMIN_ROLES,
    create: ALL_ROLES,
    update: [],
    delete: ["super_admin"],
    defaultSort: "-timestamp",
  },
  Transaction: {
    // Legacy alias used by the Dashboard page. Keep so old queries do not crash.
    collection: "transactions",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_date",
  },
  Commission: {
    collection: "commissions",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_date",
  },
  Target: {
    collection: "targets",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_date",
  },
  MentorTarget: {
    collection: "mentor_targets",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_date",
  },
  CommissionLedger: {
    collection: "commission_ledgers",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ["super_admin"],
    defaultSort: "-created_date",
  },
  ManualCommissionAdjustment: {
    collection: "manual_commission_adjustments",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_date",
  },
  PayoutTransaction: {
    collection: "payout_transactions",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_date",
  },
  MentorPoints: {
    collection: "mentor_points",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-total_points",
  },
  GamificationSettings: {
    collection: "gamification_settings",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_date",
  },
  MT5Account: {
    collection: "mt5_accounts",
    read: ALL_ROLES,
    create: ALL_ROLES,
    update: ALL_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_date",
  },
  MentorReferral: {
    collection: "mentor_referrals",
    read: ALL_ROLES,
    create: ALL_ROLES,
    update: ALL_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_at",
  },
  MentorDeduction: {
    collection: "mentor_deductions",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-created_date",
  },
  TrainingProgress: {
    collection: "training_progress",
    read: ALL_ROLES,
    create: ALL_ROLES,
    update: ALL_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "-generated_at",
  },
  TransactionTag: {
    // Admin-managed list of tags applied to bonus (and other) transactions.
    // Documents look like: { name: "Promo", color?: "#0ea5e9", active: true, created_by, ... }
    collection: "transaction_tags",
    read: ALL_ROLES,
    create: ADMIN_ROLES,
    update: ADMIN_ROLES,
    delete: ADMIN_ROLES,
    defaultSort: "name",
  },
};

export function getEntity(name: string): EntityConfig | undefined {
  return ENTITIES[name];
}
