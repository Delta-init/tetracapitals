import { type Filter } from "mongodb";
import { col } from "../db";
import { getEntity, ALL_ROLES, type EntityConfig, type Role } from "./registry";
import { json, error, forbidden, notFound, unauthorized } from "../lib/response";
import { serialize, serializeMany, toObjectId } from "../lib/id";
import { translateFilter, parseOrder, clampLimit, clampSkip } from "../lib/query";
import { getAuthUser, type AuthUser } from "../auth/middleware";
import { buildScopeFilter, applyScope, docMatchesScope } from "../lib/scope";
import { stampNewStudents, recordCreated, prepareStudentUpdate, recordHistory, type HistoryEntry } from "../students/history";
import { notifyStudentsGiven } from "../lib/notify";
import type { TeamIndex } from "../students/teams";
import { stampFundingForFinance, kickFinanceFunding, financeLock, withFinance, WITH_FINANCE_MESSAGE } from "../finance/funding";

// The built-in roles the registry policies are written in terms of. Roles
// created at runtime via Role Management (e.g. "cs_manager") are NOT in this
// set, so they'd fail every hardcoded role check below.
const BUILTIN_ROLES = new Set<string>(ALL_ROLES);
// junior_mentor is the "all staff" tier — it appears in ALL_ROLES (which grants
// every entity readable by staff) but never in ADMIN_ROLES. We use its presence
// in a policy as the marker for "this entity is open to all staff, not admins".
const STAFF_TIER: Role = "junior_mentor";

function rolesAllow(roles: Role[] | undefined, role: string): boolean {
  if (!roles) return true; // undefined => any authenticated user
  if (roles.length === 0) return false;
  if (roles.includes(role as Role)) return true;
  // Custom roles (from Role Management) aren't part of the built-in Role union.
  // Treat them as staff/mentor-tier: allow them wherever the staff tier is
  // allowed (entities open to all staff), while keeping admin-only entities
  // restricted to built-in admin roles. Without this, a custom-role user is
  // forbidden from reading every entity — including CommissionRole itself, so
  // the sidebar can't load their page permissions and collapses to nothing.
  if (!BUILTIN_ROLES.has(role) && roles.includes(STAFF_TIER)) return true;
  return false;
}

function canRead(cfg: EntityConfig, user: AuthUser, doc: any): boolean {
  if (rolesAllow(cfg.read, user.app_role)) return true;
  if (cfg.ownerField && doc && doc[cfg.ownerField] === user.id) return true;
  return false;
}

/** Whether `user` may list this entity at all — the role test a list applies (row-level scope comes on top). */
export function userCanListEntity(user: AuthUser, entityName: string): boolean {
  const cfg = getEntity(entityName);
  return !!cfg && rolesAllow(cfg.read, user.app_role);
}

/** Whether `user` may see this record — the same test a fetch by id applies, row-level scope included. */
export async function userCanReadDoc(user: AuthUser, entityName: string, doc: any): Promise<boolean> {
  const cfg = getEntity(entityName);
  if (!cfg || !canRead(cfg, user, doc)) return false;
  return docMatchesScope(doc, await buildScopeFilter(user, entityName));
}

interface CrudCtx {
  user: AuthUser;
  cfg: EntityConfig;
  entityName: string;
}

async function buildCtx(req: Request, entityName: string): Promise<CrudCtx | Response> {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  const cfg = getEntity(entityName);
  if (!cfg) return notFound(`Unknown entity '${entityName}'`);
  return { user, cfg, entityName };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * If the entity declares uniqueFields, return the first conflict found in the
 * collection (case-insensitive, blank values exempt), else null. Pass excludeId
 * to skip the record being updated.
 */
async function findUniqueConflict(
  cfg: EntityConfig,
  data: Record<string, any>,
  excludeOid?: any,
): Promise<{ field: string; value: any } | null> {
  if (!cfg.uniqueFields?.length) return null;
  for (const field of cfg.uniqueFields) {
    const raw = data[field];
    if (raw == null || String(raw).trim() === "") continue; // blank exempt
    const q: Filter<any> = {
      [field]: { $regex: `^${escapeRegex(String(raw).trim())}$`, $options: "i" },
    };
    if (excludeOid) (q as any)._id = { $ne: excludeOid };
    const dup = await col(cfg.collection).findOne(q);
    if (dup) return { field, value: raw };
  }
  return null;
}

function stripIncomingId<T extends Record<string, any>>(data: T): T {
  if (!data || typeof data !== "object") return data;
  const { id, _id, ...rest } = data;
  return rest as T;
}

function withTimestamps(data: Record<string, any>, isCreate: boolean): Record<string, any> {
  const now = new Date().toISOString();
  if (isCreate) {
    // Allow caller-supplied created_date, otherwise default to now.
    return {
      updated_date: now,
      created_date: data.created_date ?? now,
      ...data,
    };
  }
  return { ...data, updated_date: now };
}

export async function listEntity(req: Request, entityName: string): Promise<Response> {
  const ctx = await buildCtx(req, entityName);
  if (ctx instanceof Response) return ctx;
  const url = new URL(req.url);
  const order = url.searchParams.get("order") ?? ctx.cfg.defaultSort ?? null;
  const limit = clampLimit(url.searchParams.get("limit"), 100, 10_000);
  const skip = clampSkip(url.searchParams.get("skip"));

  // Permission: if user can't generally read, fall back to ownerField scoping.
  const baseFilter: Filter<any> = {};
  if (!rolesAllow(ctx.cfg.read, ctx.user.app_role)) {
    if (ctx.cfg.ownerField) baseFilter[ctx.cfg.ownerField] = ctx.user.id;
    else return forbidden();
  }

  // Row-level data scope (own / downline) from the user's role.
  const scopeFilter = await buildScopeFilter(ctx.user, ctx.entityName);
  const finalFilter = applyScope(baseFilter, scopeFilter);

  const docs = await col(ctx.cfg.collection)
    .find(finalFilter)
    .sort(parseOrder(order))
    .skip(skip)
    .limit(limit)
    .toArray();
  return json(serializeMany(docs));
}

export async function filterEntity(req: Request, entityName: string): Promise<Response> {
  const ctx = await buildCtx(req, entityName);
  if (ctx instanceof Response) return ctx;
  const body: any = await req.json().catch(() => ({}));
  const { query = {}, order = ctx.cfg.defaultSort ?? null, limit = 100, skip = 0 } = body ?? {};
  const filter = translateFilter(query);
  if (!rolesAllow(ctx.cfg.read, ctx.user.app_role)) {
    if (ctx.cfg.ownerField) filter[ctx.cfg.ownerField] = ctx.user.id;
    else return forbidden();
  }
  const scopeFilter = await buildScopeFilter(ctx.user, ctx.entityName);
  const finalFilter = applyScope(filter, scopeFilter);
  const docs = await col(ctx.cfg.collection)
    .find(finalFilter)
    .sort(parseOrder(order))
    .skip(clampSkip(skip))
    .limit(clampLimit(limit, 100, 10_000))
    .toArray();
  return json(serializeMany(docs));
}

export async function getEntityById(req: Request, entityName: string, id: string): Promise<Response> {
  const ctx = await buildCtx(req, entityName);
  if (ctx instanceof Response) return ctx;
  const oid = toObjectId(id);
  if (!oid) return notFound();
  const doc = await col(ctx.cfg.collection).findOne({ _id: oid });
  if (!doc) return notFound();
  if (!canRead(ctx.cfg, ctx.user, doc)) return forbidden();
  // Row-level data scope also applies to single-record fetches.
  const scopeFilter = await buildScopeFilter(ctx.user, ctx.entityName);
  if (!docMatchesScope(doc, scopeFilter)) return forbidden();
  return json(serialize(doc));
}

export async function createEntity(req: Request, entityName: string): Promise<Response> {
  const ctx = await buildCtx(req, entityName);
  if (ctx instanceof Response) return ctx;
  if (!rolesAllow(ctx.cfg.create, ctx.user.app_role)) return forbidden();
  const body: any = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return error("Body must be a JSON object", 400);

  const data = withTimestamps(stripIncomingId(body), true);
  // Attribution
  if (!data.created_by) data.created_by = ctx.user.id;
  if (!data.created_by_name) data.created_by_name = ctx.user.full_name;

  // Server-side uniqueness (e.g. student email) — catches duplicates the client
  // can't see because of data scoping.
  const conflict = await findUniqueConflict(ctx.cfg, data);
  if (conflict) {
    return error(`A ${entityName} with ${conflict.field} "${conflict.value}" already exists`, 409);
  }

  // A student's team and who received them first are the server's to set; so is their history.
  const teams: TeamIndex | null = entityName === "Student" ? await stampNewStudents([data]) : null;
  // A new deposit request goes to Delta finance for approval (finance/funding.ts).
  const toFinance = entityName === "FundingTransaction" && stampFundingForFinance(data);

  const res = await col(ctx.cfg.collection).insertOne(data as any);
  const created = await col(ctx.cfg.collection).findOne({ _id: res.insertedId });
  if (teams && created) {
    await recordCreated([created], ctx.user, "created", teams);
    void notifyStudentsGiven([created], ctx.user.id);
  }
  if (toFinance) kickFinanceFunding();
  return json(serialize(created));
}

export async function bulkCreateEntity(req: Request, entityName: string): Promise<Response> {
  const ctx = await buildCtx(req, entityName);
  if (ctx instanceof Response) return ctx;
  if (!rolesAllow(ctx.cfg.create, ctx.user.app_role)) return forbidden();
  const body: any = await req.json().catch(() => null);
  const items: any[] = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return error("Expected an array of items", 400);
  let toInsert = items.map((it) => withTimestamps(stripIncomingId(it), true));

  // Enforce uniqueFields: drop rows that duplicate an existing record OR an
  // earlier row in this same batch (case-insensitive; blanks exempt).
  if (ctx.cfg.uniqueFields?.length) {
    const seen = new Set<string>();
    const kept: any[] = [];
    for (const it of toInsert) {
      let dup = false;
      for (const field of ctx.cfg.uniqueFields) {
        const raw = it[field];
        if (raw == null || String(raw).trim() === "") continue;
        const key = `${field}:${String(raw).trim().toLowerCase()}`;
        if (seen.has(key)) { dup = true; break; }
      }
      if (!dup && (await findUniqueConflict(ctx.cfg, it))) dup = true;
      if (dup) continue;
      for (const field of ctx.cfg.uniqueFields) {
        const raw = it[field];
        if (raw != null && String(raw).trim() !== "") seen.add(`${field}:${String(raw).trim().toLowerCase()}`);
      }
      kept.push(it);
    }
    if (!kept.length) return error(`All items are duplicates of existing ${entityName} records`, 409);
    toInsert = kept;
  }

  const teams: TeamIndex | null = entityName === "Student" ? await stampNewStudents(toInsert) : null;
  const toFinance = entityName === "FundingTransaction" && toInsert.map((it) => stampFundingForFinance(it)).some(Boolean);

  const res = await col(ctx.cfg.collection).insertMany(toInsert as any[]);
  const created = await col(ctx.cfg.collection)
    .find({ _id: { $in: Object.values(res.insertedIds) } })
    .toArray();
  if (teams) {
    await recordCreated(created, ctx.user, "imported", teams);
    void notifyStudentsGiven(created, ctx.user.id);
  }
  if (toFinance) kickFinanceFunding();
  return json(serializeMany(created));
}

export async function updateEntity(req: Request, entityName: string, id: string): Promise<Response> {
  const ctx = await buildCtx(req, entityName);
  if (ctx instanceof Response) return ctx;
  if (!rolesAllow(ctx.cfg.update, ctx.user.app_role)) {
    // Allow self-updates on owner-fielded entities (e.g. user marking own notification as read)
    if (!ctx.cfg.ownerField) return forbidden();
    const oid = toObjectId(id);
    if (!oid) return notFound();
    const existing = await col(ctx.cfg.collection).findOne({ _id: oid });
    if (!existing || (existing as any)[ctx.cfg.ownerField] !== ctx.user.id) return forbidden();
  }
  const oid = toObjectId(id);
  if (!oid) return notFound();
  const body: any = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return error("Body must be a JSON object", 400);
  const data = withTimestamps(stripIncomingId(body), false);
  // Uniqueness on update (e.g. changing a student's email to one already used).
  const conflict = await findUniqueConflict(ctx.cfg, data, oid);
  if (conflict) {
    return error(`A ${entityName} with ${conflict.field} "${conflict.value}" already exists`, 409);
  }
  // A student's history: whatever screen changed them, the change is recorded here.
  let history: HistoryEntry[] = [];
  if (entityName === "Student") {
    const existing = await col(ctx.cfg.collection).findOne({ _id: oid });
    if (!existing) return notFound();
    history = await prepareStudentUpdate(existing, data, ctx.user);
  }
  // A deposit Delta finance is deciding is decided there, not here.
  if (entityName === "FundingTransaction") {
    const existing = await col(ctx.cfg.collection).findOne({ _id: oid });
    if (!existing) return notFound();
    const locked = financeLock(existing, data);
    if (locked) return error(locked, 409);
  }
  await col(ctx.cfg.collection).updateOne({ _id: oid }, { $set: data });
  const doc = await col(ctx.cfg.collection).findOne({ _id: oid });
  if (!doc) return notFound();
  await recordHistory(history);
  // Given to somebody (from Delta Open Students, a transfer, an admin's edit): tell them.
  if (history.some((h) => h.type === "assigned" || h.type === "mentor_changed")) void notifyStudentsGiven([doc], ctx.user.id);
  return json(serialize(doc));
}

export async function deleteEntity(req: Request, entityName: string, id: string): Promise<Response> {
  const ctx = await buildCtx(req, entityName);
  if (ctx instanceof Response) return ctx;
  if (!rolesAllow(ctx.cfg.delete, ctx.user.app_role)) return forbidden();
  const oid = toObjectId(id);
  if (!oid) return notFound();
  // Finance would be left deciding a request that no longer exists: it is
  // rejected there instead.
  if (entityName === "FundingTransaction" && withFinance(await col(ctx.cfg.collection).findOne({ _id: oid }))) {
    return error(WITH_FINANCE_MESSAGE, 409);
  }
  const res = await col(ctx.cfg.collection).deleteOne({ _id: oid });
  if (!res.deletedCount) return notFound();
  return json({ ok: true });
}
