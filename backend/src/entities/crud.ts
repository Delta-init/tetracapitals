import { type Filter } from "mongodb";
import { col } from "../db";
import { getEntity, type EntityConfig, type Role } from "./registry";
import { json, error, forbidden, notFound, unauthorized } from "../lib/response";
import { serialize, serializeMany, toObjectId } from "../lib/id";
import { translateFilter, parseOrder, clampLimit, clampSkip } from "../lib/query";
import { getAuthUser, type AuthUser } from "../auth/middleware";

function rolesAllow(roles: Role[] | undefined, role: string): boolean {
  if (!roles) return true; // undefined => any authenticated user
  if (roles.length === 0) return false;
  return roles.includes(role as Role);
}

function canRead(cfg: EntityConfig, user: AuthUser, doc: any): boolean {
  if (rolesAllow(cfg.read, user.app_role)) return true;
  if (cfg.ownerField && doc && doc[cfg.ownerField] === user.id) return true;
  return false;
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

  const docs = await col(ctx.cfg.collection)
    .find(baseFilter)
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
  const docs = await col(ctx.cfg.collection)
    .find(filter)
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

  const res = await col(ctx.cfg.collection).insertOne(data as any);
  const created = await col(ctx.cfg.collection).findOne({ _id: res.insertedId });
  return json(serialize(created));
}

export async function bulkCreateEntity(req: Request, entityName: string): Promise<Response> {
  const ctx = await buildCtx(req, entityName);
  if (ctx instanceof Response) return ctx;
  if (!rolesAllow(ctx.cfg.create, ctx.user.app_role)) return forbidden();
  const body: any = await req.json().catch(() => null);
  const items: any[] = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return error("Expected an array of items", 400);
  const toInsert = items.map((it) => withTimestamps(stripIncomingId(it), true));
  const res = await col(ctx.cfg.collection).insertMany(toInsert as any[]);
  const created = await col(ctx.cfg.collection)
    .find({ _id: { $in: Object.values(res.insertedIds) } })
    .toArray();
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
  await col(ctx.cfg.collection).updateOne({ _id: oid }, { $set: data });
  const doc = await col(ctx.cfg.collection).findOne({ _id: oid });
  if (!doc) return notFound();
  return json(serialize(doc));
}

export async function deleteEntity(req: Request, entityName: string, id: string): Promise<Response> {
  const ctx = await buildCtx(req, entityName);
  if (ctx instanceof Response) return ctx;
  if (!rolesAllow(ctx.cfg.delete, ctx.user.app_role)) return forbidden();
  const oid = toObjectId(id);
  if (!oid) return notFound();
  const res = await col(ctx.cfg.collection).deleteOne({ _id: oid });
  if (!res.deletedCount) return notFound();
  return json({ ok: true });
}
