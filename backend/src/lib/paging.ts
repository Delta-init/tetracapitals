import type { Sort } from "mongodb";
import { col } from "../db";
import { serializeMany } from "./id";

/* ────────────────────────────────────────────────────────────────────────────
   Lists paged on the server (Students, Student logs, their history,
   Transactions): one page of 25 / 50 / 100, or every match at once (export,
   select all) up to MAX_ALL, with how many match.
──────────────────────────────────────────────────────────────────────────── */

export const PAGE_SIZES = [25, 50, 100];
export const MAX_ALL = 10_000;

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every non-empty condition, together. */
export function allOf(...parts: (Record<string, any> | null | undefined)[]): Record<string, any> {
  const list = parts.filter((p): p is Record<string, any> => !!p && Object.keys(p).length > 0);
  return list.length === 0 ? {} : list.length === 1 ? list[0] : { $and: list };
}

/** `q` anywhere in any of these fields, any letter case — numbers (phones) searched as text, as the pages did. */
export function textMatch(fields: string[], q: string): Record<string, any> | null {
  const text = q.trim().toLowerCase();
  if (!text) return null;
  const has = (field: string) => ({
    $regexMatch: { input: { $convert: { input: `$${field}`, to: "string", onError: "", onNull: "" } }, regex: escapeRe(text), options: "i" },
  });
  return { $expr: { $or: fields.map(has) } };
}

/** One page of `collection` matching `query` — body: { page, pageSize, all }. */
export async function pageOf(collection: string, query: Record<string, any>, sort: Sort, body: any) {
  const all = !!body?.all;
  const pageSize = all ? MAX_ALL : PAGE_SIZES.includes(Number(body?.pageSize)) ? Number(body.pageSize) : PAGE_SIZES[0];
  const total = await col(collection).countDocuments(query);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = all ? 1 : Math.min(Math.max(1, Math.floor(Number(body?.page) || 1)), pages);
  const docs = await col(collection).find(query).sort(sort).skip((page - 1) * pageSize).limit(pageSize).toArray();
  return { rows: serializeMany(docs), total, page, page_size: all ? total : pageSize, ...(all && total > MAX_ALL ? { truncated: true } : {}) };
}
