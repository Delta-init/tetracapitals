import { col } from "../db";
import { verifyJwt } from "./jwt";
import { serialize } from "../lib/id";
import { toObjectId } from "../lib/id";

export interface AuthUser {
  id: string;
  email: string;
  full_name?: string;
  app_role: string;
  commission_rate?: number;
  upline_commission_percentage?: number;
  [k: string]: unknown;
}

/**
 * Resolve the authenticated user from a request's Authorization header.
 * Loads the latest user document from MongoDB so role changes take effect immediately.
 */
export async function getAuthUser(req: Request): Promise<AuthUser | null> {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  const claims = await verifyJwt(token);
  if (!claims) return null;
  const oid = toObjectId(claims.sub);
  if (!oid) return null;
  const userDoc = await col("users").findOne({ _id: oid });
  if (!userDoc) return null;
  // Strip password before exposing.
  const { password_hash, ...safe } = userDoc as any;
  return serialize(safe) as AuthUser;
}

export async function requireAuth(req: Request): Promise<AuthUser | Response> {
  const user = await getAuthUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return user;
}
