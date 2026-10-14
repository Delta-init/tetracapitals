import { ObjectId } from "mongodb";
import { col } from "../db";
import { toObjectId } from "../lib/id";
import { CALLS, LINK_TTL_S, recordingCount, recordingPath, recordingSource } from "../students/calls";

/*
 * 3CX calls for the Root portal (2026-10-14): Root's "3CX calls" page and the
 * calls on its Pending page, every portal side by side. Every call with a
 * student (student_calls, synced from 3CX by students/calls.ts), with the
 * totals and a per-person table — in the shape every portal answers Root with,
 * and each person's email so Root can put one person's calls together across
 * portals. Root asks with its portal secret (portal/service.ts). Read only.
 *
 * Days are Dubai days (YYYY-MM-DD); none → the last 7. A recording plays the
 * way it does here: a link signed by this server for 10 minutes, which Root
 * hands to the browser — the 3CX key never leaves this server.
 */

export class CallFilterError extends Error {}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UAE_MS = 4 * 3_600_000;
const uaeDay = (t = Date.now()) => new Date(t + UAE_MS).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The instant a Dubai day starts, as stored (ISO, UTC). */
const dayStart = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - UAE_MS).toISOString();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const str = (v: unknown, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const RESULTS: Record<string, string> = { connected: "answered", answered: "answered", missed: "missed", not_answered: "no_answer", no_answer: "no_answer" };
const SORTS: Record<string, string> = { date: "started_at", talk: "talk_seconds", ring: "ring_seconds" };

/** Who a call is counted under: the portal user, else the 3CX extension, else "-" (nobody took it). */
const personKey = (userId: string, extension: string) => (userId ? `u:${userId}` : extension ? `x:${extension}` : "-");
function personFilter(key: string): Record<string, any> | null {
  if (key === "-") return { user_id: { $in: ["", null] }, extension: { $in: ["", null] } };
  if (key.startsWith("u:") && /^[a-f0-9]{24}$/i.test(key.slice(2))) return { user_id: key.slice(2) };
  if (key.startsWith("x:") && /^[\w*#+-]{1,20}$/.test(key.slice(2))) return { user_id: { $in: ["", null] }, extension: key.slice(2) };
  return null;
}

const count = (field: string, value: string) => ({ $sum: { $cond: [{ $eq: [field, value] }, 1, 0] } });
const GROUP = {
  calls: { $sum: 1 },
  outgoing: count("$direction", "out"),
  incoming: count("$direction", "in"),
  connected: count("$status", "answered"),
  missed: count("$status", "missed"),
  notAnswered: count("$status", "no_answer"),
  talkSeconds: { $sum: { $ifNull: ["$talk_seconds", 0] } },
  recorded: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$recording_ids", []] } }, 0] }, 1, 0] } },
};
const KEYS = ["calls", "outgoing", "incoming", "connected", "missed", "notAnswered", "talkSeconds", "recorded"] as const;
type Totals = Record<(typeof KEYS)[number], number>;
const zero = (): Totals => ({ calls: 0, outgoing: 0, incoming: 0, connected: 0, missed: 0, notAnswered: 0, talkSeconds: 0, recorded: 0 });
const withAverage = <T extends Totals>(t: T) => ({ ...t, avgTalkSeconds: t.connected ? Math.round(t.talkSeconds / t.connected) : 0 });

/** GET /service/calls?from&to&direction&result&person&search&sort&order&page&limit[&list=0] */
export async function callsForPortal(q: URLSearchParams) {
  const from = str(q.get("from")), to = str(q.get("to"));
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) throw new CallFilterError("from / to must be dates (YYYY-MM-DD)");
  if (from && to && from > to) throw new CallFilterError("from is after to");
  const today = uaeDay();
  const start = from || (to ? "" : addDays(today, -6));
  const end = to || (from ? "" : today);
  const and: Record<string, any>[] = [];
  const range: Record<string, string> = {};
  if (start) range.$gte = dayStart(start);
  if (end) range.$lt = dayStart(addDays(end, 1));
  if (Object.keys(range).length) and.push({ started_at: range });

  const direction = str(q.get("direction")) || "all";
  if (direction === "in" || direction === "out") and.push({ direction });
  else if (direction !== "all") throw new CallFilterError("direction is in, out or all");
  const result = str(q.get("result")) || "all";
  if (RESULTS[result]) and.push({ status: RESULTS[result] });
  else if (result !== "all") throw new CallFilterError("result is connected, missed, not_answered or all");
  const search = str(q.get("search"));
  if (search) {
    const or: Record<string, any>[] = [{ student_name: { $regex: escape(search), $options: "i" } }, { student_code: { $regex: escape(search), $options: "i" } }];
    const digits = search.replace(/\D/g, "").replace(/^0+/, "");
    if (digits.length >= 3) or.push({ number: { $regex: digits } });
    and.push({ $or: or });
  }
  const base = and.length ? { $and: and } : {};

  // Per person over everything matching (the person picked narrows the list and totals, not this table).
  const grouped = (await col(CALLS).aggregate([
    { $match: base },
    { $group: { _id: { u: { $ifNull: ["$user_id", ""] }, x: { $ifNull: ["$extension", ""] } }, user_name: { $first: "$user_name" }, agent_name: { $first: "$agent_name" }, ...GROUP } },
  ]).toArray()) as any[];
  const people = new Map<string, { key: string; userId: string; extension: string; name: string } & Totals>();
  for (const g of grouped) {
    const userId = String(g._id.u ?? "");
    const extension = userId ? "" : String(g._id.x ?? "");
    const key = personKey(userId, extension);
    const p = people.get(key) ?? { key, userId, extension, name: g.user_name || g.agent_name || (extension ? `Ext ${extension}` : "Nobody — not answered"), ...zero() };
    for (const k of KEYS) p[k] += g[k] ?? 0;
    people.set(key, p);
  }
  const person = str(q.get("person"), 80);
  const onePerson = person && person !== "all" ? personFilter(person) : null;
  if (person && person !== "all" && !onePerson) throw new CallFilterError("Unknown person");
  const stats = zero();
  for (const p of onePerson ? [people.get(person)].filter(Boolean) : [...people.values()]) for (const k of KEYS) stats[k] += p![k];

  const wantList = q.get("list") !== "0";
  const page = Math.max(1, Math.floor(Number(q.get("page")) || 1));
  const limit = wantList ? Math.min(1000, Math.max(1, Math.floor(Number(q.get("limit")) || 50))) : 0;
  const field = SORTS[str(q.get("sort")) || "date"] ?? "started_at";
  const dir = q.get("order") === "asc" ? 1 : -1;
  const match = onePerson ? { $and: [...and, onePerson] } : base;
  const docs = wantList
    ? ((await col(CALLS).find(match).sort({ [field]: dir, started_at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).toArray()) as any[])
    : [];

  const ids = [...new Set([...[...people.values()].map((p) => p.userId), ...docs.map((c) => String(c.user_id ?? ""))].filter((id) => /^[a-f0-9]{24}$/i.test(id)))];
  const users = ids.length ? ((await col("users").find({ _id: { $in: ids.map((id) => new ObjectId(id)) } }, { projection: { email: 1 } }).toArray()) as any[]) : [];
  const emailOf = new Map(users.map((u) => [String(u._id), String(u.email ?? "").toLowerCase()]));

  return {
    stats: withAverage(stats),
    people: [...people.values()].map((p) => ({ ...withAverage(p), email: emailOf.get(p.userId) ?? "" })).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)),
    calls: docs.map((c) => {
      const userId = String(c.user_id ?? "");
      return {
        id: String(c._id),
        startedAt: c.started_at,
        direction: c.direction,
        status: c.status,
        talkSeconds: c.talk_seconds ?? 0,
        ringSeconds: c.ring_seconds ?? 0,
        number: c.number ?? "",
        extension: c.extension ?? "",
        agentName: c.agent_name ?? "",
        userId,
        userName: c.user_name ?? "",
        userEmail: emailOf.get(userId) ?? "",
        person: personKey(userId, userId ? "" : c.extension ?? ""),
        contact: [c.student_name, c.student_code].filter(Boolean).join(" · "),
        contactKind: "student",
        recordings: recordingCount(c),
      };
    }),
    total: stats.calls,
    page,
    limit,
  };
}

/** GET /service/calls/:id/recording-link?index= — the path on this server a browser plays it from (10 minutes); null if none. */
export async function recordingLinkForPortal(id: string, indexRaw: string | null): Promise<{ path: string; expiresIn: number } | null | "bad"> {
  const oid = toObjectId(id);
  const index = /^\d{1,2}$/.test(indexRaw ?? "0") ? Number(indexRaw ?? 0) : -1;
  if (!oid || index < 0) return "bad";
  const call: any = await col(CALLS).findOne({ _id: oid as any });
  if (!call || !recordingSource(call, index)) return null;
  return { path: recordingPath(String(call._id), index, "root-portal"), expiresIn: LINK_TTL_S };
}
