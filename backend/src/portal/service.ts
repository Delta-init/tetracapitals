import { randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { col } from "../db";
import { config } from "../config";
import { json } from "../lib/response";
import { BUILTIN_ROLES, isAdminRole } from "../lib/roles";

/* ────────────────────────────────────────────────────────────────────────────
   /api/v1/service/*   — the Root portal asking about roles and people.

   Server to server, with a shared secret in `x-portal-secret` (ROOT_ERP_SECRET
   here, COMMISSION_SSO_SECRET on the portal). Not a session: the portal is not
   a person. Unset means these routes are off, never open.

   The same five calls, and the same answers, HRMS and Media ERP give the
   portal — its Users page, its launch check and its account creation rely on
   those shapes. Answers use the portal's envelope ({ success, data } /
   { error: { code, message } }) rather than this app's own, because the portal
   reads the reason for a refusal from error.message.
──────────────────────────────────────────────────────────────────────────── */

const ORGANIZATION = "Tetra Commission";
const MAX_EMAILS = 500;

const ok = (data: unknown) => json({ success: true, data });
const refuse = (status: number, code: string, message: string) =>
  json({ success: false, error: { code, message } }, { status });

function secretOk(presented: string | null): boolean {
  const expected = config.rootErpSecret;
  if (!presented || !expected) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const titleCase = (key: string) =>
  key.split("_").filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");

interface PortalRole { key: string; name: string; description: string; permissions: string[]; isSystem: boolean }

/** Every role a person can be given here: the built-in ones, then the ones made in Role Management. */
async function listRoles(): Promise<PortalRole[]> {
  const builtin: PortalRole[] = BUILTIN_ROLES.map((key) => ({
    key,
    name: titleCase(key),
    description: isAdminRole(key) ? "Admin — sees and manages everything" : "Staff — their own students, funding and commissions",
    permissions: isAdminRole(key) ? ["all pages"] : ["own students", "own funding", "own commissions"],
    isSystem: true,
  }));
  const custom = await col("commission_roles").find({ active: { $ne: false } }).sort({ name: 1 }).toArray();
  return [
    ...builtin,
    ...custom
      .filter((r: any) => typeof r.role_key === "string" && r.role_key && !(BUILTIN_ROLES as readonly string[]).includes(r.role_key))
      .map((r: any) => ({
        key: r.role_key as string,
        name: String(r.name ?? titleCase(r.role_key)),
        description: `Custom role — sees ${r.data_scope ?? "own"} data`,
        permissions: Array.isArray(r.page_permissions) ? r.page_permissions.map(String) : [],
        isSystem: false,
      })),
  ];
}

async function roleNamed(key: string): Promise<PortalRole | undefined> {
  return (await listRoles()).find((r) => r.key === key);
}

async function accountOf(email: string, roles?: PortalRole[]) {
  const user = (await col("users").findOne({ email })) as any;
  if (!user) {
    return { exists: false, inOrganization: false, name: "", status: "", membershipStatus: null, roleKey: null, roleName: null, permissions: [] as string[], lastLoginAt: null };
  }
  const role = (roles ?? (await listRoles())).find((r) => r.key === user.app_role);
  return {
    exists: true,
    // One organization here, so an account is always in it.
    inOrganization: true,
    name: String(user.full_name ?? ""),
    status: user.status === "inactive" ? "inactive" : "active",
    membershipStatus: null,
    roleKey: String(user.app_role ?? "") || null,
    roleName: role?.name ?? (user.app_role ? titleCase(String(user.app_role)) : null),
    permissions: role?.permissions ?? [],
    lastLoginAt: null,
  };
}

const emailOf = (v: unknown) => String(v ?? "").trim().toLowerCase();

export async function handlePortalService(req: Request, path: string): Promise<Response> {
  if (!config.rootErpSecret) return refuse(503, "INTEGRATION_DISABLED", "The Root portal link is not configured on this server");
  if (!secretOk(req.headers.get("x-portal-secret"))) return refuse(401, "UNAUTHORISED", "Bad secret");

  const url = new URL(req.url);
  const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};

  /* GET /roles — what a person can be given here. */
  if (path === "/roles" && req.method === "GET") {
    return ok({ organization: ORGANIZATION, roles: await listRoles() });
  }

  /* GET /user?email= — whether somebody has an account here, and what it is. */
  if (path === "/user" && req.method === "GET") {
    const email = emailOf(url.searchParams.get("email"));
    if (!email) return refuse(400, "VALIDATION_ERROR", "email is required");
    return ok(await accountOf(email));
  }

  /* POST /accounts { emails } — the same, for a page of people at once. */
  if (path === "/accounts" && req.method === "POST") {
    const emails = Array.isArray(body.emails) ? [...new Set(body.emails.map(emailOf).filter(Boolean))].slice(0, MAX_EMAILS) : [];
    const roles = await listRoles();
    const accounts = [];
    for (const email of emails) {
      const a = await accountOf(email, roles);
      accounts.push({ email, exists: a.exists, inOrganization: a.inOrganization, name: a.name, status: a.status, roleKey: a.roleKey, roleName: a.roleName });
    }
    return ok({ accounts });
  }

  /* POST /provision-user { email, name, role } — give somebody an account.
     Somebody who already has one is left exactly as they are; changing a role
     is /set-user-role, on purpose, so creating never silently demotes. The
     password is random and never told to anyone: they sign in from the portal. */
  if (path === "/provision-user" && req.method === "POST") {
    const email = emailOf(body.email);
    const roleKey = String(body.role ?? "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return refuse(400, "VALIDATION_ERROR", "A valid email is required");
    const role = await roleNamed(roleKey);
    if (!role) return refuse(400, "UNKNOWN_ROLE", `"${roleKey}" is not a role here`);

    const users = col("users");
    const existing = (await users.findOne({ email })) as any;
    if (existing) {
      return ok({ created: false, userId: String(existing._id), detail: `${email} already has an account in ${ORGANIZATION}` });
    }
    const now = new Date().toISOString();
    const res = await users.insertOne({
      email,
      full_name: String(body.name ?? "").trim() || email.split("@")[0],
      app_role: role.key,
      // The same defaults a registration gives.
      commission_rate: 4,
      upline_commission_percentage: 0,
      password_hash: await bcrypt.hash(randomBytes(24).toString("hex"), 10),
      status: "active",
      created_via: "root-portal",
      created_date: now,
      updated_date: now,
    } as any);
    return ok({ created: true, userId: String(res.insertedId), detail: `Created ${email} in ${ORGANIZATION} as ${role.name}` });
  }

  /* POST /set-user-role { email, role?, status? } — change a role, or switch an
     account off ("inactive") and back on ("active"). */
  if (path === "/set-user-role" && req.method === "POST") {
    const email = emailOf(body.email);
    const roleKey = String(body.role ?? "").trim();
    const status = String(body.status ?? "").trim().toLowerCase();
    if (!email) return refuse(400, "VALIDATION_ERROR", "email is required");
    if (!roleKey && !status) return refuse(400, "VALIDATION_ERROR", "Nothing to change: give a role, a status, or both");
    if (status && !["active", "inactive"].includes(status)) return refuse(400, "VALIDATION_ERROR", `"${status}" is not a status here`);

    const users = col("users");
    const user = (await users.findOne({ email })) as any;
    if (!user) return refuse(404, "NOT_FOUND", `${email} has no account in ${ORGANIZATION} — create one first`);

    const set: Record<string, unknown> = {};
    const changes: string[] = [];
    let finalRole = await roleNamed(String(user.app_role ?? ""));
    if (roleKey) {
      const role = await roleNamed(roleKey);
      if (!role) return refuse(400, "UNKNOWN_ROLE", `"${roleKey}" is not a role here`);
      if (user.app_role !== role.key) { set.app_role = role.key; changes.push(`role to ${role.name}`); }
      finalRole = role;
    }
    const currentStatus = user.status === "inactive" ? "inactive" : "active";
    if (status && status !== currentStatus) { set.status = status; changes.push(`status to ${status}`); }
    if (changes.length) {
      set.updated_date = new Date().toISOString();
      await users.updateOne({ _id: user._id }, { $set: set });
    }
    return ok({
      detail: changes.length ? `Changed ${email}'s ${changes.join(" and ")} in ${ORGANIZATION}` : `${email} already held that in ${ORGANIZATION}`,
      roleKey: finalRole?.key ?? String(user.app_role ?? ""),
      membershipStatus: (set.status as string) ?? currentStatus,
    });
  }

  return refuse(404, "NOT_FOUND", "No such service route");
}
