import { createHmac, timingSafeEqual } from "node:crypto";
import { col } from "../db";
import { config } from "../config";
import { json, error, forbidden, notFound } from "../lib/response";
import { toObjectId } from "../lib/id";
import { getDownlineIds } from "../lib/scope";
import type { AuthUser } from "../auth/middleware";
import { loadTeams } from "../students/teams";
import { visibleMentorIds, isStudentOf } from "../students/followups";
import {
  status, connect, disconnect, sendText, sendFile, studentsByKey, forgetStudents, phoneKeys, intlNumbers, mediaPath, WhatsAppError,
} from "../whatsapp/service";

/* ────────────────────────────────────────────────────────────────────────────
   The WhatsApp page and the student page's WhatsApp card (whatsapp/service.ts
   does the WhatsApp side).

   Each CS links their own WhatsApp and is the only one who sends from it. Who
   reads it: the CS; the Chief Mentor and CS Manager above them (Up Head); a
   Super Admin — everyone's.
──────────────────────────────────────────────────────────────────────────── */

const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const who = (u: AuthUser) => u.full_name || u.email || "somebody";
const canLink = (u: AuthUser) => u.app_role === "cs";

/** Whose WhatsApp `user` may read — null: everyone's. */
async function readable(user: AuthUser): Promise<Set<string> | null> {
  if (user.app_role === "super_admin") return null;
  if (user.app_role === "chief_mentor" || user.app_role === "cs_manager") return new Set(await getDownlineIds(user.id));
  return new Set([user.id]);
}
const fail = (err: unknown) =>
  err instanceof WhatsAppError ? error(err.message, err.status) : error(err instanceof Error ? err.message : "WhatsApp did not answer", 502);

/* ── Photos and files, on short-lived signed links (as call recordings) ─── */

const MEDIA_TTL_S = 60 * 60;
const sign = (payload: string) => createHmac("sha256", `${config.jwtSecret}|whatsapp-media`).update(payload).digest("base64url");
function mediaUrl(messageId: string, userId: string): string {
  const e = Math.floor(Date.now() / 1000) + MEDIA_TTL_S;
  const q = new URLSearchParams({ m: messageId, e: String(e), u: userId, s: sign(`${messageId}.${e}.${userId}`) });
  return `/api/whatsapp/media?${q}`;
}

/** GET /api/whatsapp/media?m=&e=&u=&s= — a photo or file from a chat, for whoever was given the link. */
export async function streamWhatsAppMedia(url: URL): Promise<Response> {
  const m = url.searchParams.get("m") ?? "", e = url.searchParams.get("e") ?? "", u = url.searchParams.get("u") ?? "", s = url.searchParams.get("s") ?? "";
  if (!/^[a-f0-9]{24}$/.test(m) || !/^\d{9,11}$/.test(e) || !/^[a-f0-9]{24}$/.test(u) || !s) return notFound();
  if (Number(e) < Date.now() / 1000) return error("This link has expired — reopen the chat", 410);
  const want = Buffer.from(sign(`${m}.${e}.${u}`)), got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return notFound();
  const doc: any = await col("whatsapp_messages").findOne({ _id: toObjectId(m) as any }, { projection: { media: 1 } });
  if (!doc?.media?.file) return notFound();
  const file = Bun.file(mediaPath(doc.media.file));
  if (!(await file.exists())) return notFound();
  const name = String(doc.media.file_name || doc.media.file.split("/").pop() || "file").replace(/[^\w.\- ]+/g, "_");
  return new Response(file, {
    headers: { "Content-Type": doc.media.mime || "application/octet-stream", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, max-age=3600" },
  });
}

const shape = (m: any, viewer: string) => ({
  id: String(m._id),
  direction: m.direction,
  body: m.body ?? "",
  at: m.at,
  sender_name: m.sender_name ?? "",
  sent_by_name: m.sent_by_name ?? "",
  media: m.media ? { type: m.media.type, mime: m.media.mime, file_name: m.media.file_name, size: m.media.size, url: m.media.file ? mediaUrl(String(m._id), viewer) : "" } : null,
});

async function studentsBrief(ids: string[]) {
  const oids = [...new Set(ids)].map(toObjectId).filter(Boolean) as any[];
  if (!oids.length) return new Map<string, any>();
  const docs = await col("students").find({ _id: { $in: oids } }, { projection: { full_name: 1, student_code: 1, primary_mentor_name: 1 } }).toArray();
  return new Map(docs.map((d: any) => [String(d._id), { id: String(d._id), code: d.student_code ?? "", name: String(d.full_name ?? "").trim(), cs: d.primary_mentor_name ?? "" }]));
}

/* ── Linking a WhatsApp ─────────────────────────────────────────────────── */

/**
 * POST /api/functions/getWhatsAppStatus
 * Your own link (a CS: status, number, the QR while linking) and — for a Chief Mentor, CS Manager or Super Admin —
 * the CSs whose chats you can read, with whether each has linked.
 */
export async function getWhatsAppStatus(_req: Request, user: AuthUser): Promise<Response> {
  const owners = await readable(user);
  let list: any[] = [];
  if (!owners || owners.size > 1) {
    const filter: Record<string, any> = { app_role: "cs", status: { $ne: "inactive" } };
    if (owners) filter._id = { $in: [...owners].map(toObjectId).filter(Boolean) };
    const teams = await loadTeams();
    const counts = new Map((await col("whatsapp_messages").aggregate([{ $group: { _id: "$owner_id", n: { $sum: 1 } } }]).toArray()).map((r: any) => [String(r._id), r.n]));
    list = (await col("users").find(filter, { projection: { full_name: 1, email: 1 } }).toArray())
      .map((u: any) => ({ id: String(u._id), name: String(u.full_name || u.email), team: teams.teamOf(String(u._id))?.name ?? "", ...status(String(u._id)), qr: undefined, messages: counts.get(String(u._id)) ?? 0 }))
      .sort((a, b) => (a.status === "connected" ? 0 : 1) - (b.status === "connected" ? 0 : 1) || a.name.localeCompare(b.name));
  }
  return json({ enabled: config.whatsapp.enabled, can_link: canLink(user), me: { id: user.id, name: who(user), ...status(user.id) }, owners: list });
}

/** POST /api/functions/connectWhatsApp — a CS starts linking their WhatsApp; the QR follows in getWhatsAppStatus. */
export async function connectWhatsApp(_req: Request, user: AuthUser): Promise<Response> {
  if (!canLink(user)) return forbidden("Each CS links their own WhatsApp");
  try { await connect(user.id); } catch (err) { return fail(err); }
  return json(status(user.id));
}

/** POST /api/functions/disconnectWhatsApp — unlinks the CS's WhatsApp from the portal. Their chats so far stay. */
export async function disconnectWhatsApp(_req: Request, user: AuthUser): Promise<Response> {
  await disconnect(user.id);
  return json(status(user.id));
}

/* ── Chats ──────────────────────────────────────────────────────────────── */

async function ownerFor(user: AuthUser, raw: unknown): Promise<string | Response> {
  const owner = str(raw, 40) || user.id;
  if (!/^[a-f0-9]{24}$/.test(owner)) return error("Bad ownerId", 400);
  const owners = await readable(user);
  if (owners && !owners.has(owner)) return forbidden("Only the CS, the people above them and Super Admins read these chats");
  return owner;
}

/**
 * POST /api/functions/getWhatsAppChats { ownerId? }
 * One CS's chats (yours by default), newest first: who (the student, else their WhatsApp name), the last message and
 * how many are unread.
 */
export async function getWhatsAppChats(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const owner = await ownerFor(user, body?.ownerId);
  if (owner instanceof Response) return owner;
  const rows = (await col("whatsapp_messages").aggregate([
    { $match: { owner_id: owner } },
    { $sort: { at: -1 } },
    { $group: {
      _id: "$chat", last: { $first: "$$ROOT" }, count: { $sum: 1 },
      unread: { $sum: { $cond: [{ $and: [{ $eq: ["$direction", "in"] }, { $eq: ["$read", false] }] }, 1, 0] } },
      name: { $max: { $cond: [{ $eq: ["$direction", "in"] }, "$sender_name", ""] } },
    } },
    { $sort: { "last.at": -1 } },
    { $limit: 300 },
  ]).toArray()) as any[];
  const byKey = await studentsByKey();
  const idsOf = (r: any) => [...new Set([...(r.last.student_ids ?? []), ...(byKey.get(r.last.key || r._id) ?? [])])];
  const students = await studentsBrief(rows.flatMap(idsOf));
  return json({
    owner_id: owner,
    can_send: owner === user.id && status(owner).status === "connected",
    chats: rows.map((r) => {
      const linked = idsOf(r).map((id) => students.get(id)).filter(Boolean);
      return {
        chat: String(r._id), phone: r.last.phone ?? "",
        name: linked[0]?.name || r.name || (r.last.phone ? `+${r.last.phone}` : "Unknown"),
        whatsapp_name: r.name || "",
        students: linked,
        last: { body: r.last.body ?? "", at: r.last.at, direction: r.last.direction, media: r.last.media?.type ?? null },
        unread: r.unread, count: r.count,
      };
    }),
  });
}

/** POST /api/functions/getWhatsAppMessages { ownerId?, chat } — one chat, oldest first (the last 300). */
export async function getWhatsAppMessages(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const owner = await ownerFor(user, body?.ownerId);
  if (owner instanceof Response) return owner;
  const chat = str(body?.chat, 120);
  if (!chat) return error("chat is required", 400);
  const docs = (await col("whatsapp_messages").find({ owner_id: owner, chat }).sort({ at: -1 }).limit(300).toArray()).reverse();
  return json({ owner_id: owner, chat, can_send: owner === user.id && status(owner).status === "connected", messages: docs.map((m) => shape(m, user.id)) });
}

/**
 * POST /api/functions/getWhatsAppUnread { since? }
 * A CS's own unread WhatsApp — how many, and the messages that came in after `since` (the `now` of their last call),
 * newest first: what the portal pops up as browser notifications and counts on the menu.
 */
export async function getWhatsAppUnread(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const now = new Date().toISOString();
  if (!canLink(user)) return json({ unread: 0, messages: [], now });
  const since = typeof body?.since === "string" && /^\d{4}-\d{2}-\d{2}T/.test(body.since) ? body.since : "";
  const base = { owner_id: user.id, direction: "in", read: false };
  const unread = await col("whatsapp_messages").countDocuments(base);
  // By when the portal got them (a message can carry an older WhatsApp time).
  const fresh = since ? ((await col("whatsapp_messages").find({ ...base, created_date: { $gt: since } }).sort({ created_date: -1 }).limit(5).toArray()) as any[]) : [];
  const byKey = await studentsByKey();
  const idsOf = (m: any) => [...(m.student_ids ?? []), ...(byKey.get(m.key || m.chat) ?? [])];
  const students = await studentsBrief(fresh.flatMap(idsOf));
  return json({
    unread, now,
    messages: fresh.map((m) => {
      const sid = idsOf(m).find((id) => students.has(id));
      return { id: String(m._id), chat: m.chat, name: (sid && students.get(sid)?.name) || m.sender_name || (m.phone ? `+${m.phone}` : "WhatsApp"), body: m.body ?? "", at: m.at };
    }),
  });
}

/** POST /api/functions/markWhatsAppRead { chat } — your own chat only (a manager reading it leaves it unread for the CS). */
export async function markWhatsAppRead(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const chat = str(body?.chat, 120);
  if (!chat) return error("chat is required", 400);
  const res = await col("whatsapp_messages").updateMany({ owner_id: user.id, chat, direction: "in", read: false }, { $set: { read: true } });
  return json({ marked: res.modifiedCount });
}

/** POST /api/functions/sendWhatsApp { chat, text } — from your own WhatsApp; chat is the number (or a chat's address). */
export async function sendWhatsApp(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const chat = str(body?.chat, 120), text = String(body?.text ?? "").trim().slice(0, 4000);
  if (!chat || !text) return error("chat and text are required", 400);
  if (!canLink(user)) return forbidden("Messages go from a CS's own WhatsApp");
  try {
    const saved = await sendText({ id: user.id, name: who(user) }, chat, text);
    return json({ ok: true, chat: saved?.chat ?? chat });
  } catch (err) { return fail(err); }
}

/**
 * POST /api/functions/sendWhatsAppFile (form: chat, caption, file, voice?) — a photo, video, audio or document,
 * up to 25 MB; voice=1: a recording from the portal, sent as a voice note.
 */
export async function sendWhatsAppFile(req: Request, user: AuthUser): Promise<Response> {
  if (!canLink(user)) return forbidden("Messages go from a CS's own WhatsApp");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const chat = str(form?.get("chat"), 120), caption = String(form?.get("caption") ?? "").trim().slice(0, 1000);
  const voice = String(form?.get("voice") ?? "") === "1";
  if (!chat || !file || typeof file === "string") return error("chat and file are required", 400);
  try {
    const saved = await sendFile({ id: user.id, name: who(user) }, chat, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream", file.name || "file",
      voice ? "" : caption, voice);
    return json({ ok: true, chat: saved?.chat ?? chat });
  } catch (err) { return fail(err); }
}

/**
 * POST /api/functions/linkWhatsAppChat { ownerId?, chat, studentId }
 * A number that is on no student's record is theirs: the chat, its earlier messages and anything that comes later
 * from that number show under the student. By whoever reads the chat and may see the student.
 */
export async function linkWhatsAppChat(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const owner = await ownerFor(user, body?.ownerId);
  if (owner instanceof Response) return owner;
  const chat = str(body?.chat, 120);
  const sid = toObjectId(str(body?.studentId, 40));
  if (!chat || !sid) return error("chat and studentId are required", 400);
  const student: any = await col("students").findOne({ _id: sid }, { projection: { primary_mentor_id: 1, common_cs: 1, full_name: 1, student_code: 1 } });
  if (!student) return notFound();
  const visible = await visibleMentorIds(user);
  if (visible && !isStudentOf(student, visible)) return forbidden("You can link chats only to students you can see");
  const last: any = await col("whatsapp_messages").findOne({ owner_id: owner, chat }, { sort: { at: -1 } });
  if (!last) return notFound("No such chat");
  const key = last.key || chat;   // the number's last 9 digits, or the chat's address when the number is not known
  const now = new Date().toISOString();
  await col("whatsapp_links").updateOne({ key }, { $set: { key, student_id: String(sid), by_id: user.id, by_name: who(user), at: now } }, { upsert: true });
  await col("whatsapp_messages").updateMany(last.key ? { key } : { chat }, { $set: { student_ids: [String(sid)] } });
  forgetStudents();
  return json({ ok: true, student: { id: String(sid), code: student.student_code ?? "", name: String(student.full_name ?? "").trim() } });
}

/* ── The student page ───────────────────────────────────────────────────── */

/**
 * POST /api/functions/getStudentWhatsApp { studentId }
 * The student's WhatsApp chats that you may read — yours with them, and for a manager or Super Admin their CSs' — and
 * the numbers on their record, to message them from your own WhatsApp.
 */
export async function getStudentWhatsApp(req: Request, user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => ({}));
  const sid = toObjectId(str(body?.studentId, 40));
  if (!sid) return error("studentId is required", 400);
  const s: any = await col("students").findOne({ _id: sid }, { projection: { phone: 1, primary_mentor_id: 1, common_cs: 1 } });
  if (!s) return notFound();
  const visible = await visibleMentorIds(user);
  if (visible && !isStudentOf(s, visible)) return forbidden();
  const owners = await readable(user);
  const filter: Record<string, any> = { $or: [{ key: { $in: phoneKeys(s.phone) } }, { student_ids: String(sid) }] };
  if (owners) filter.owner_id = { $in: [...owners] };
  const docs = (await col("whatsapp_messages").find(filter).sort({ at: -1 }).limit(400).toArray()).reverse() as any[];
  const threads = new Map<string, any>();
  for (const m of docs) {
    const k = `${m.owner_id}|${m.chat}`;
    if (!threads.has(k)) threads.set(k, { owner_id: m.owner_id, owner_name: m.owner_name ?? "", chat: m.chat, phone: m.phone ?? "", messages: [] });
    threads.get(k).messages.push(shape(m, user.id));
  }
  const mine = status(user.id);
  return json({
    numbers: intlNumbers(s.phone),
    can_send: canLink(user) && mine.status === "connected",
    can_link: canLink(user),
    linked: mine.status === "connected",
    me: user.id,
    threads: [...threads.values()].sort((a, b) => (a.owner_id === user.id ? -1 : 0) - (b.owner_id === user.id ? -1 : 0)),
  });
}
