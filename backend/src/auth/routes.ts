import bcrypt from "bcryptjs";
import { z } from "zod";
import { col } from "../db";
import { json, error, unauthorized } from "../lib/response";
import { serialize, toObjectId } from "../lib/id";
import { signJwt } from "./jwt";
import { getAuthUser } from "./middleware";
import { ALL_ROLES, type Role } from "../entities/registry";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1),
  app_role: z.enum(ALL_ROLES as [Role, ...Role[]]).default("junior_mentor"),
  commission_rate: z.number().optional(),
  upline_commission_percentage: z.number().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function handleRegister(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return error("Invalid registration payload", 400, { issues: parsed.error.issues });
  const { email, password, full_name, app_role, commission_rate, upline_commission_percentage } = parsed.data;

  const users = col("users");
  const existing = await users.findOne({ email });
  if (existing) return error("Email already registered", 409);

  // First user becomes super_admin automatically (so the system is usable out of the box).
  const isFirst = (await users.estimatedDocumentCount()) === 0;
  const finalRole: Role = isFirst ? "super_admin" : app_role;

  const password_hash = await bcrypt.hash(password, 10);
  const now = new Date().toISOString();
  const doc = {
    email,
    full_name,
    app_role: finalRole,
    commission_rate: commission_rate ?? 4,
    upline_commission_percentage: upline_commission_percentage ?? 0,
    password_hash,
    created_date: now,
    updated_date: now,
  };
  const res = await users.insertOne(doc as any);
  const user = serialize({ _id: res.insertedId, ...doc, password_hash: undefined });
  const token = await signJwt({
    sub: user.id,
    email: user.email,
    app_role: user.app_role,
    full_name: user.full_name,
  });
  return json({ token, user });
}

export async function handleLogin(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return error("Invalid login payload", 400);
  const { email, password } = parsed.data;

  const userDoc = await col("users").findOne({ email });
  if (!userDoc) return unauthorized("Invalid credentials");
  const ok = await bcrypt.compare(password, (userDoc as any).password_hash ?? "");
  if (!ok) return unauthorized("Invalid credentials");

  const { password_hash, ...safe } = userDoc as any;
  const user = serialize(safe);
  const token = await signJwt({
    sub: user.id,
    email: user.email,
    app_role: user.app_role,
    full_name: user.full_name,
  });
  return json({ token, user });
}

export async function handleMe(req: Request): Promise<Response> {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  return json(user);
}

export async function handleChangePassword(req: Request): Promise<Response> {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  const body = await req.json().catch(() => null);
  const schema = z.object({ current_password: z.string().min(1), new_password: z.string().min(8) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return error("Invalid payload", 400);
  const oid = toObjectId(user.id);
  if (!oid) return error("Bad user id", 400);
  const userDoc = await col("users").findOne({ _id: oid });
  if (!userDoc) return unauthorized();
  const ok = await bcrypt.compare(parsed.data.current_password, (userDoc as any).password_hash ?? "");
  if (!ok) return error("Current password is incorrect", 400);
  const password_hash = await bcrypt.hash(parsed.data.new_password, 10);
  await col("users").updateOne({ _id: oid }, { $set: { password_hash, updated_date: new Date().toISOString() } });
  return json({ ok: true });
}
