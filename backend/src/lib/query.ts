import { type Filter, type Sort } from "mongodb";
import { toObjectId } from "./id";

/**
 * Translate a Base44-style "order" string into a Mongo sort spec.
 * "-field" -> desc, "field" -> asc, "" -> {}.
 */
export function parseOrder(order?: string | null): Sort {
  if (!order) return {};
  if (order.startsWith("-")) return { [order.slice(1)]: -1 };
  return { [order]: 1 };
}

/**
 * Translate a frontend-supplied filter into a Mongo filter.
 * - `id` is converted to `_id` ObjectId match.
 * - Booleans/numbers/strings pass through.
 * - Arrays become $in clauses.
 */
export function translateFilter(input: Record<string, any> | undefined | null): Filter<any> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (k === "id") {
      const oid = typeof v === "string" ? toObjectId(v) : null;
      if (oid) out["_id"] = oid;
      else out["_id"] = null; // matches nothing if id is invalid
      continue;
    }
    if (Array.isArray(v)) {
      out[k] = { $in: v };
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function clampLimit(n: unknown, def = 100, max = 100_000): number {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return def;
  return Math.min(Math.floor(num), max);
}

export function clampSkip(n: unknown): number {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.floor(num);
}
