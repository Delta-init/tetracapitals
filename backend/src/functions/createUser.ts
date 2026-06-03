import bcrypt from "bcryptjs";
import { col } from "../db";
import { json, error, forbidden } from "../lib/response";
import { serialize } from "../lib/id";
import type { AuthUser } from "../auth/middleware";
import { ALL_ROLES } from "../entities/registry";

const ALLOWED_CREATORS = new Set(["super_admin", "admin"]);

/**
 * POST /api/functions/createUser
 * Body: { email, password, full_name, app_role, commission_rate?,
 *         upline_commission_percentage?, senior_mentor_id?, senior_mentor_name?,
 *         assigned_mentor_id?, assigned_mentor_name? }
 *
 * Admin-only path to create a user with a known password. Unlike
 * /api/auth/register (which is public and self-promotes the first user),
 * this one requires a caller with super_admin or admin role.
 */
export async function createUser(req: Request, caller: AuthUser): Promise<Response> {
  if (!ALLOWED_CREATORS.has(caller.app_role)) return forbidden();

  const body: any = await req.json().catch(() => null);
  if (!body) return error("Body required", 400);
  const {
    email, password, full_name, app_role = "junior_mentor",
    commission_rate, upline_commission_percentage,
    senior_mentor_id, senior_mentor_name,
    assigned_mentor_id, assigned_mentor_name,
    ...rest
  } = body;

  if (!email || !password || !full_name) {
    return error("email, password and full_name are required", 400);
  }
  if (typeof password !== "string" || password.length < 8) {
    return error("Password must be at least 8 characters", 400);
  }
  if (!(ALL_ROLES as readonly string[]).includes(app_role)) {
    return error(`Invalid app_role '${app_role}'`, 400);
  }

  const users = col("users");
  const existing = await users.findOne({ email });
  if (existing) return error("A user with that email already exists", 409);

  const password_hash = await bcrypt.hash(password, 10);
  const now = new Date().toISOString();
  const doc: any = {
    email,
    full_name,
    app_role,
    password_hash,
    commission_rate: typeof commission_rate === "number" ? commission_rate : 4,
    upline_commission_percentage: typeof upline_commission_percentage === "number" ? upline_commission_percentage : 0,
    created_date: now,
    updated_date: now,
    created_by_id: caller.id,
    created_by_name: caller.full_name,
    ...rest,                            // preserve any extra fields the form passed
  };
  if (senior_mentor_id) { doc.senior_mentor_id = senior_mentor_id; doc.senior_mentor_name = senior_mentor_name ?? ""; }
  if (assigned_mentor_id) { doc.assigned_mentor_id = assigned_mentor_id; doc.assigned_mentor_name = assigned_mentor_name ?? ""; }

  const res = await users.insertOne(doc);
  const { password_hash: _omit, ...safe } = doc;
  return json({ user: serialize({ _id: res.insertedId, ...safe }) });
}
