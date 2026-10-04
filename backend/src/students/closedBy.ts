import { col } from "../db";
import type { AuthUser } from "../auth/middleware";
import { getConfiguredScope } from "../lib/scope";

/* ────────────────────────────────────────────────────────────────────────────
   Who closed a student: the sales person in a sales CRM — Delta's, Draw's or
   the Remote team's — who sold them their course. Kept on the student as
   closed_by, a list (two courses can be two people's): from finance with each
   close (finance/students.ts), and once for the students already here (a
   one-off backfill from the CRMs). Shown with the student — under the Enrolled
   switch and on the student page — for everyone who sees them.

   The Sales role's people see exactly the students they closed (lib/scope.ts,
   data scope "closed"): the Students list and the student page in full —
   their CS, their classes, follow-ups, calls, everything — and change nothing.
   The role is made here when the server starts, never before: on code that
   does not know the "closed" scope an unknown scope means "see everyone".
──────────────────────────────────────────────────────────────────────────── */

export interface ClosedBy {
  email: string;
  name: string;
  /** Which sales CRM: delta, draw or remote. */
  crm: string;
}

const emailOf = (user: AuthUser) => String(user.email ?? "").trim().toLowerCase();

/** Did this person close this student? */
export function closedBy(student: any, user: AuthUser): boolean {
  const me = emailOf(user);
  return !!me && (Array.isArray(student?.closed_by) ? student.closed_by : []).some((c: any) => String(c?.email ?? "").toLowerCase() === me);
}

/** The filter for the students this person closed (none without an email). */
export const closedByFilter = (user: AuthUser) => (emailOf(user) ? { "closed_by.email": emailOf(user) } : { _id: { $in: [] } });

/** Is this person's role the Sales kind — the students they closed, to read? */
export async function seesClosedOnly(user: AuthUser): Promise<boolean> {
  return (await getConfiguredScope(user)) === "closed";
}

/**
 * The students a list shows this person, for the lists that go by whose students they are (follow-ups, calls,
 * not onboarded): the ones they closed for the Sales role, else `ofTheirs` — their own and their people's.
 */
export async function theirStudents(user: AuthUser, ofTheirs: Record<string, any>): Promise<Record<string, any>> {
  return (await seesClosedOnly(user)) ? closedByFilter(user) : ofTheirs;
}

export const SALES_READ_ONLY = "The Sales role sees the students its people closed — it changes nothing here";

/**
 * The functions the Sales role may call (functions/index.ts): reads — get…, list…, find… (each keeps to what
 * they may see) — and their own Mentor Calendar bookings (the Sales CRM's calendar) and browser notifications.
 */
const READ = /^(get|list|find)[A-Z]/;
const ALSO = new Set(["bookMentorMeeting", "updateMentorMeeting", "cancelMentorMeeting", "savePushSubscription", "deletePushSubscription"]);
export const salesMayCall = (name: string) => READ.test(name) || ALSO.has(name);

/** A closed_by entry from what finance sends, or null when it names nobody. */
export function closedByEntry(raw: unknown): ClosedBy | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const email = String(r.email ?? "").trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { email, name: String(r.name ?? "").trim().slice(0, 200), crm: String(r.crm ?? "").trim().slice(0, 40) };
}

/**
 * The Sales role, made once: its people see the Students list (and what goes with it), only the students they
 * closed. Left exactly as it is if it is there — an admin may have changed its pages in Role Management.
 */
export async function ensureSalesRole(): Promise<void> {
  const now = new Date().toISOString();
  try {
    await col("commission_roles").updateOne(
      { role_key: "sales" },
      { $setOnInsert: { role_key: "sales", name: "Sales", page_permissions: ["Students"], data_scope: "closed", active: true, created_date: now, updated_date: now } },
      { upsert: true },
    );
  } catch (err) {
    console.error("[sales role] could not make it", err instanceof Error ? err.message : err);
  }
}
