import { col } from "../db";
import { toObjectId } from "../lib/id";

/**
 * A CS Portal user's email, for finance (the user, 2026-10-30: course-payment invoices said "super admin" as their
 * salesperson — finance only had the name of who raised the payment, and put the approver on the invoice). Finance
 * matches it to the person's own account there. "" when there is no such user or no email.
 */
export async function staffEmailOf(id: unknown): Promise<string> {
  const oid = toObjectId(String(id ?? ""));
  if (!oid) return "";
  const u: any = await col("users").findOne({ _id: oid as any }, { projection: { email: 1 } });
  return String(u?.email ?? "").trim().toLowerCase();
}
