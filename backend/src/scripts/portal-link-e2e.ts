/**
 * The Root portal link, end to end, against a real API process.
 *
 *   - POST /api/auth/sso: a one-time token checked with the portal signs in
 *     the matching account — never creates one, never works twice, never for
 *     an account switched off;
 *   - /api/v1/service/*: only with the shared secret; roles (built-in and
 *     custom), one account, a page of accounts, creating an account (sign-in
 *     from the portal only), changing a role, switching an account off and on;
 *   - switching off closes every door at once: portal sign-in, password login
 *     and a session already open.
 *
 * Run through ./test-portal-link.sh (throwaway mongod, a stand-in portal,
 * the API — no .env). Refuses anything but a scratch database on 127.0.0.1.
 */
import bcrypt from "bcryptjs";
import { MongoClient } from "mongodb";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/?$/.test(uri) || !/e2e/.test(dbName)) {
  console.error(`Refusing to run: needs a scratch e2e database on 127.0.0.1, got ${uri} / ${dbName}`);
  process.exit(1);
}
const API = `http://127.0.0.1:${process.env.E2E_API_PORT}`;
const PORTAL = `http://127.0.0.1:${process.env.E2E_PORTAL_PORT}`;
const SECRET = process.env.ROOT_ERP_SECRET ?? "";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${label}${detail ? ` — ${detail}` : ""}\x1b[0m`); }
}
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

type Res = { status: number; body: any };
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const service = (method: string, path: string, body?: unknown, secret = SECRET) =>
  call(method, `/api/v1/service${path}`, body, secret ? { "x-portal-secret": secret } : {});
/** Ask the stand-in portal for a one-time token for this address. */
async function portalToken(email: string): Promise<string> {
  const r = await fetch(`${PORTAL}/issue?email=${encodeURIComponent(email)}`);
  return ((await r.json()) as { token: string }).token;
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
if (!/127\.0\.0\.1/.test(uri)) process.exit(1);
await db.dropDatabase();

step("Setting up");
const hash = await bcrypt.hash("Password123!", 10);
const now = new Date().toISOString();
await db.collection("users").insertMany([
  { email: "admin@e2e-commission.test", full_name: "Admin", app_role: "super_admin", password_hash: hash, created_date: now, updated_date: now },
  { email: "mentor@e2e-commission.test", full_name: "Mentor", app_role: "junior_mentor", password_hash: hash, created_date: now, updated_date: now },
]);
await db.collection("commission_roles").insertMany([
  { name: "Chief Mentor", role_key: "chief_mentor", page_permissions: ["Dashboard", "Students"], data_scope: "team", active: true },
  { name: "Old Role", role_key: "old_role", page_permissions: [], data_scope: "own", active: false },
]);
console.log("  2 accounts, 2 custom roles");

step("The service door is the portal's alone");
check("no secret: refused", (await service("GET", "/roles", undefined, "")).status === 401);
check("wrong secret: refused", (await service("GET", "/roles", undefined, "not-the-secret-at-all")).status === 401);

step("Roles");
const roles = await service("GET", "/roles");
const keys = (roles.body?.data?.roles ?? []).map((r: any) => r.key);
check("answers in the portal's envelope", roles.status === 200 && roles.body?.success === true && roles.body?.data?.organization === "Tetra Commission", JSON.stringify(roles.body).slice(0, 160));
check("built-in roles, marked as such", keys.includes("super_admin") && roles.body.data.roles.find((r: any) => r.key === "super_admin")?.isSystem === true);
check("custom roles from Role Management", roles.body.data.roles.find((r: any) => r.key === "chief_mentor")?.isSystem === false);
check("...but not a switched-off one", !keys.includes("old_role"));
check("a friendly name", roles.body.data.roles.find((r: any) => r.key === "senior_mentor")?.name === "Senior Mentor");

step("Accounts");
let u = await service("GET", "/user?email=ADMIN@e2e-commission.test");
check("an account, found whatever the case", u.body?.data?.exists === true && u.body.data.status === "active" && u.body.data.roleKey === "super_admin" && u.body.data.roleName === "Super Admin", JSON.stringify(u.body));
u = await service("GET", "/user?email=nobody@e2e-commission.test");
check("somebody with no account", u.body?.data?.exists === false && u.body.data.inOrganization === false);
const many = await service("POST", "/accounts", { emails: ["admin@e2e-commission.test", "nobody@e2e-commission.test"] });
check("a page of people at once", many.body?.data?.accounts?.length === 2 && many.body.data.accounts[0].exists === true && many.body.data.accounts[1].exists === false);

step("Giving somebody an account");
let p = await service("POST", "/provision-user", { email: "new@e2e-commission.test", name: "New Person", role: "chief_mentor" });
check("created with the chosen role", p.status === 200 && p.body?.data?.created === true, JSON.stringify(p.body));
const created = await db.collection("users").findOne({ email: "new@e2e-commission.test" });
check("...as the portal's, with the usual defaults", created?.app_role === "chief_mentor" && created?.created_via === "root-portal" && created?.commission_rate === 4 && created?.status === "active");
p = await service("POST", "/provision-user", { email: "new@e2e-commission.test", name: "Again", role: "junior_mentor" });
check("asking again leaves them as they are", p.body?.data?.created === false && (await db.collection("users").findOne({ email: "new@e2e-commission.test" }))?.app_role === "chief_mentor");
check("a role that does not exist is refused", (await service("POST", "/provision-user", { email: "x@e2e-commission.test", role: "wizard" })).status === 400);
check("a switched-off custom role is refused", (await service("POST", "/provision-user", { email: "x@e2e-commission.test", role: "old_role" })).status === 400);
check("no email, no account", (await service("POST", "/provision-user", { email: "not-an-email", role: "junior_mentor" })).status === 400);
const guess = await call("POST", "/api/auth/login", { email: "new@e2e-commission.test", password: "Password123!" });
check("their password is nobody's to know", guess.status === 401);

step("Signing in from the portal");
let sso = await call("POST", "/api/auth/sso", { token: await portalToken("new@e2e-commission.test") });
const session = sso.body?.token as string | undefined;
check("a portal token signs them in", sso.status === 200 && Boolean(session), JSON.stringify(sso.body).slice(0, 160));
const me = await call("GET", "/api/auth/me", undefined, { authorization: `Bearer ${session}` });
check("...as themselves, with their role", me.body?.email === "new@e2e-commission.test" && me.body?.app_role === "chief_mentor", JSON.stringify(me.body).slice(0, 160));
const once = await portalToken("new@e2e-commission.test");
await call("POST", "/api/auth/sso", { token: once });
check("a token works once", (await call("POST", "/api/auth/sso", { token: once })).status === 401);
check("a made-up token does not", (await call("POST", "/api/auth/sso", { token: "made-up" })).status === 401);
sso = await call("POST", "/api/auth/sso", { token: await portalToken("stranger@e2e-commission.test") });
check("nobody is given an account by signing in", sso.status === 403 && !(await db.collection("users").findOne({ email: "stranger@e2e-commission.test" })));

step("Changing a role, switching off and on");
let r = await service("POST", "/set-user-role", { email: "new@e2e-commission.test", role: "senior_mentor" });
check("role changed", r.status === 200 && r.body?.data?.roleKey === "senior_mentor" && r.body.data.membershipStatus === "active", JSON.stringify(r.body));
r = await service("POST", "/set-user-role", { email: "new@e2e-commission.test", status: "inactive" });
check("switched off", r.body?.data?.membershipStatus === "inactive");
check("...the session already open stops at once", (await call("GET", "/api/auth/me", undefined, { authorization: `Bearer ${session}` })).status === 401);
check("...signing in from the portal is refused", (await call("POST", "/api/auth/sso", { token: await portalToken("new@e2e-commission.test") })).status === 403);
check("...and the portal sees it switched off", (await service("GET", "/user?email=new@e2e-commission.test")).body?.data?.status === "inactive");
await service("POST", "/set-user-role", { email: "mentor@e2e-commission.test", status: "inactive" });
check("a switched-off account cannot use its password either", (await call("POST", "/api/auth/login", { email: "mentor@e2e-commission.test", password: "Password123!" })).status === 401);
await service("POST", "/set-user-role", { email: "new@e2e-commission.test", status: "active" });
check("switched back on, the session works again", (await call("GET", "/api/auth/me", undefined, { authorization: `Bearer ${session}` })).status === 200);
check("somebody with no account: 404", (await service("POST", "/set-user-role", { email: "nobody@e2e-commission.test", role: "junior_mentor" })).status === 404);
check("nothing to change: 400", (await service("POST", "/set-user-role", { email: "new@e2e-commission.test" })).status === 400);
check("a status that is not one: 400", (await service("POST", "/set-user-role", { email: "new@e2e-commission.test", status: "banned" })).status === 400);

step("Everybody else is untouched");
const admin = await call("POST", "/api/auth/login", { email: "admin@e2e-commission.test", password: "Password123!" });
check("a password login works as it always did", admin.status === 200 && Boolean(admin.body?.token));

await db.dropDatabase();
await client.close();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
