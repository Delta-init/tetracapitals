import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pino from "pino";
import qrcode from "qrcode";
import makeWASocket, {
  DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, isLidUser, isPnUser, normalizeMessageContent,
  useMultiFileAuthState, type proto, type WAMessage, type WASocket,
} from "@whiskeysockets/baileys";
import type { Boom } from "@hapi/boom";
import { config } from "../config";
import { col } from "../db";
import { toObjectId } from "../lib/id";
import { push } from "../lib/notify";
import { asVoiceNote, VOICE_MIME } from "./voice";

/* ────────────────────────────────────────────────────────────────────────────
   WhatsApp, as in the Carlton CRM (WHATSAPP_INTEGRATION.md there): each CS
   links their own WhatsApp by scanning a QR — the server becomes one of their
   linked devices (Baileys, the WhatsApp Web protocol). Normal one-to-one
   messages only: no groups, no broadcasts.

   One session per CS, held here and kept in sessionDir/<user id>, so it comes
   back by itself when the server restarts. Every message — received, sent from
   the portal, or sent from their phone — is kept in whatsapp_messages under
   the CS whose WhatsApp it is (owner_id), and matched to students by phone the
   way the CS-sheet import matches them (the last 9 digits of any number they
   have). Photos and files go to mediaDir, not into the database.

   Not as in Carlton: contacts WhatsApp now identifies by a private id (@lid)
   are traced back to their number; messages sent from the phone are kept too,
   so a chat reads the same in the portal as on the phone; and a number that is
   no student is never made one — someone links it to a student.
──────────────────────────────────────────────────────────────────────────── */

export type WAStatus = "disconnected" | "connecting" | "qr_ready" | "connected";

interface Session {
  sock: WASocket | null;
  status: WAStatus;
  phone: string;
  qr: string;
  timer: ReturnType<typeof setTimeout> | null;
}

export class WhatsAppError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const logger = pino({ level: "silent" });
const sessions = new Map<string, Session>();

const session = (userId: string): Session => {
  let s = sessions.get(userId);
  if (!s) sessions.set(userId, (s = { sock: null, status: "disconnected", phone: "", qr: "", timer: null }));
  return s;
};
const sessionDir = (userId: string) => join(resolve(config.whatsapp.sessionDir), userId);
export const mediaPath = (file: string) => join(resolve(config.whatsapp.mediaDir), file);

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
/** Every number in a phone field, by its last 9 digits — how the portal knows a student by phone. */
export const phoneKeys = (v: unknown) => [...new Set(String(v ?? "").replace(/\.0$/, "").split(/[\n\r/,;|]+| - /)
  .map((x) => x.replace(/\(.*?\)/g, "").replace(/\D/g, "").replace(/^00/, "")).filter((x) => x.length >= 7).map((x) => x.slice(-9)))];
/** A number as WhatsApp wants it — digits with the country code. Local UAE numbers (5x…, 05x…) and Indian mobiles get theirs. */
export function toIntl(raw: unknown): string {
  let d = digits(raw).replace(/^00/, "");
  if (/^05\d{8}$/.test(d)) d = `971${d.slice(1)}`;
  else if (/^5\d{8}$/.test(d)) d = `971${d}`;
  else if (/^[6-9]\d{9}$/.test(d)) d = `91${d}`;
  return d;
}
/** Each number in a student's phone field, ready for WhatsApp. */
export const intlNumbers = (v: unknown) => [...new Set(String(v ?? "").replace(/\.0$/, "").split(/[\n\r/,;|]+| - /)
  .map(toIntl).filter((x) => x.length >= 9))];

/* ── Students by phone, cached for a minute ─────────────────────────────── */

let byKeyCache: { at: number; map: Map<string, string[]> } | null = null;
export async function studentsByKey(): Promise<Map<string, string[]>> {
  if (byKeyCache && Date.now() - byKeyCache.at < 60_000) return byKeyCache.map;
  const map = new Map<string, string[]>();
  for await (const s of col("students").find({}, { projection: { phone: 1 } }) as any) {
    for (const k of phoneKeys(s.phone)) map.set(k, [...(map.get(k) ?? []), String(s._id)]);
  }
  // A number linked to a student by hand (it is not on their record).
  for (const l of (await col("whatsapp_links").find({}).toArray()) as any[]) {
    map.set(l.key, [...new Set([...(map.get(l.key) ?? []), String(l.student_id)])]);
  }
  byKeyCache = { at: Date.now(), map };
  return map;
}
export const forgetStudents = () => { byKeyCache = null; };

/* ── Messages ───────────────────────────────────────────────────────────── */

const LABEL: Record<string, string> = { image: "📷 Photo", video: "🎥 Video", audio: "🎵 Audio", ptt: "🎤 Voice note", document: "📄 Document", sticker: "🔖 Sticker" };

function bodyOf(m: proto.IMessage): string {
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage) return m.imageMessage.caption || LABEL.image!;
  if (m.videoMessage) return m.videoMessage.caption || LABEL.video!;
  if (m.audioMessage) return m.audioMessage.ptt ? LABEL.ptt! : LABEL.audio!;
  if (m.documentMessage) return m.documentMessage.caption || `📄 ${m.documentMessage.fileName || "Document"}`;
  if (m.stickerMessage) return LABEL.sticker!;
  if (m.locationMessage) return `📍 Location${m.locationMessage.name ? `: ${m.locationMessage.name}` : ""}`;
  if (m.liveLocationMessage) return "📍 Live location";
  if (m.contactMessage) return `👤 ${m.contactMessage.displayName || "Contact"}`;
  if (m.contactsArrayMessage) return `👤 ${m.contactsArrayMessage.contacts?.length ?? 0} contacts`;
  if (m.reactionMessage) return `${m.reactionMessage.text || "👍"} (reaction)`;
  if (m.pollCreationMessage || m.pollCreationMessageV3) return `📊 Poll: ${(m.pollCreationMessage || m.pollCreationMessageV3)?.name ?? ""}`;
  if (m.buttonsResponseMessage) return m.buttonsResponseMessage.selectedDisplayText || "Button reply";
  if (m.listResponseMessage) return m.listResponseMessage.title || "List reply";
  return "";
}

function mediaOf(m: proto.IMessage): { type: string; mime: string; fileName: string } | null {
  if (m.imageMessage) return { type: "image", mime: m.imageMessage.mimetype || "image/jpeg", fileName: "" };
  if (m.videoMessage) return { type: "video", mime: m.videoMessage.mimetype || "video/mp4", fileName: "" };
  if (m.audioMessage) return { type: "audio", mime: m.audioMessage.mimetype || "audio/ogg", fileName: "" };
  if (m.documentMessage) return { type: "document", mime: m.documentMessage.mimetype || "application/octet-stream", fileName: m.documentMessage.fileName || "" };
  if (m.stickerMessage) return { type: "sticker", mime: m.stickerMessage.mimetype || "image/webp", fileName: "" };
  return null;
}

const EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4",
  "audio/ogg": ".ogg", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "application/pdf": ".pdf" };
async function saveMedia(owner: string, buffer: Buffer, mime: string, fileName: string) {
  const ext = EXT[mime.split(";")[0]!.trim()] || extname(fileName).slice(0, 10) || ".bin";
  const file = `${owner}/${randomUUID()}${ext}`;
  await mkdir(mediaPath(owner), { recursive: true });
  await writeFile(mediaPath(file), buffer);
  return { file, size: buffer.length };
}

/** The other side's number, also for contacts WhatsApp knows by a private id (@lid). "" when it cannot be told. */
async function phoneOf(sock: WASocket, key: proto.IMessageKey & { remoteJidAlt?: string }): Promise<string> {
  for (const jid of [key.remoteJid, key.remoteJidAlt]) {
    if (jid && (jid.endsWith("@s.whatsapp.net") || isPnUser(jid))) return digits(jid.split("@")[0]!.split(":")[0]);
  }
  if (key.remoteJid && isLidUser(key.remoteJid)) {
    const pn = await (sock as any).signalRepository?.lidMapping?.getPNForLID?.(key.remoteJid).catch(() => null);
    if (pn) return digits(String(pn).split("@")[0]!.split(":")[0]);
  }
  return "";
}

interface Saved { id: string; chat: string }
async function store(doc: Record<string, unknown>): Promise<Saved | null> {
  try {
    const res = await col("whatsapp_messages").insertOne({ ...doc, created_date: new Date().toISOString() });
    return { id: String(res.insertedId), chat: String(doc.chat) };
  } catch (err: any) {
    if (err?.code === 11000) return null;   // the same WhatsApp message again (a reconnect replays them)
    throw err;
  }
}

async function receive(owner: { id: string; name: string }, sock: WASocket, msg: WAMessage): Promise<void> {
  const jid = msg.key.remoteJid ?? "";
  if (!jid || jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) return;
  const content = normalizeMessageContent(msg.message);
  if (!content || content.protocolMessage) return;
  const body = bodyOf(content).trim();
  const media = mediaOf(content);
  if (!body && !media) return;

  const phone = await phoneOf(sock, msg.key as any);
  const key = phone ? phone.slice(-9) : "";
  const students = (await studentsByKey()).get(key || jid) ?? [];   // by number, or a chat linked by its address
  let saved: { file: string; size: number } | null = null;
  if (media) {
    try {
      const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
      if (buffer.length <= MAX_MEDIA_BYTES) saved = await saveMedia(owner.id, buffer, media.mime, media.fileName);
    } catch (err) {
      console.warn("[whatsapp] could not download a file", err instanceof Error ? err.message : err);
    }
  }
  const fromMe = !!msg.key.fromMe;
  const ts = Number(msg.messageTimestamp ?? 0);
  const kept = await store({
    owner_id: owner.id, owner_name: owner.name,
    chat: phone || jid, phone, key, jid,
    direction: fromMe ? "out" : "in",
    body: body || LABEL[media!.type] || "File",
    message_id: msg.key.id ?? "",
    sender_name: fromMe ? "From their phone" : msg.pushName || phone || "",
    sent_by_id: "", sent_by_name: fromMe ? "From their phone" : "",
    student_ids: students,
    read: fromMe,
    media: media ? { type: media.type, mime: media.mime, file_name: media.fileName, file: saved?.file ?? "", size: saved?.size ?? 0 } : null,
    at: new Date(ts > 0 ? ts * 1000 : Date.now()).toISOString(),
  });
  // A new message to the CS: a push to their phone and computer (the WhatsApp page keeps the count, so no bell).
  if (kept && !fromMe) {
    const sid = toObjectId(students[0] ?? "");
    const student: any = sid ? await col("students").findOne({ _id: sid }, { projection: { full_name: 1 } }) : null;
    const who = String(student?.full_name ?? "").trim() || msg.pushName || (phone ? `+${phone}` : "WhatsApp");
    const text = body || LABEL[media!.type] || "File";
    void push([owner.id], {
      type: "whatsapp_message",
      title: `WhatsApp · ${who}`,
      body: text.length > 140 ? `${text.slice(0, 137)}…` : text,
      link: `/WhatsApp?chat=${encodeURIComponent(kept.chat)}`,
      tag: `wa-${kept.chat}`,
      renotify: true,
    });
  }
}

/* ── Linking ────────────────────────────────────────────────────────────── */

export function status(userId: string): { status: WAStatus; phone: string; qr: string } {
  const s = session(userId);
  return { status: s.status, phone: s.phone, qr: s.qr };
}

export async function connect(userId: string): Promise<void> {
  if (!config.whatsapp.enabled) throw new WhatsAppError("WhatsApp is switched off on this server", 503);
  const oid = toObjectId(userId);
  const user: any = oid ? await col("users").findOne({ _id: oid }, { projection: { full_name: 1, email: 1 } }) : null;
  if (!user) throw new WhatsAppError("No such user", 404);
  const owner = { id: userId, name: String(user.full_name || user.email || "") };
  const s = session(userId);
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  if (s.sock) { const old = s.sock; s.sock = null; try { old.end(undefined); } catch { /* already closed */ } }
  s.status = "connecting";
  s.qr = "";

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir(userId));
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined as any }));
  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    logger,
    browser: ["Tetra Commission", "Chrome", "1.0.0"],
    markOnlineOnConnect: false,   // the phone keeps its notifications
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });
  s.sock = sock;
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (s.sock !== sock) return;   // a socket already put aside — its late events must not bring it back
    if (qr) {
      s.status = "qr_ready";
      s.qr = await qrcode.toDataURL(qr).catch(() => "");
    }
    if (connection === "open") {
      s.status = "connected";
      s.phone = digits(String(sock.user?.id ?? "").split(":")[0]!.split("@")[0]);
      s.qr = "";
      console.log(`[whatsapp] linked — ${owner.name} (${s.phone})`);
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      s.status = "disconnected";
      if (code === DisconnectReason.loggedOut) {
        // Unlinked from the phone: the saved keys are dead, so the next link starts with a fresh QR.
        s.sock = null;
        s.phone = "";
        await rm(sessionDir(userId), { recursive: true, force: true }).catch(() => undefined);
        console.log(`[whatsapp] unlinked from the phone — ${owner.name}`);
      } else {
        s.timer = setTimeout(() => void connect(userId).catch((err) => console.error("[whatsapp] reconnect failed", err)), 5_000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (s.sock !== sock || type !== "notify") return;
    for (const msg of messages) await receive(owner, sock, msg).catch((err) => console.error(`[whatsapp] message not kept (${owner.name})`, err));
  });
}

export async function disconnect(userId: string): Promise<void> {
  const s = session(userId);
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  const sock = s.sock;
  s.sock = null;   // first, so the close that logout fires does not reconnect
  s.status = "disconnected";
  s.phone = "";
  s.qr = "";
  if (sock) { try { await sock.logout(); } catch { /* already gone */ } }
  await rm(sessionDir(userId), { recursive: true, force: true }).catch(() => undefined);
}

/** Every CS whose WhatsApp was linked on this server comes back after a restart, without a new QR. */
export function startWhatsApp(): void {
  if (!config.whatsapp.enabled) { console.log("[whatsapp] off on this server (WHATSAPP=off)"); return; }
  const dir = resolve(config.whatsapp.sessionDir);
  if (!existsSync(dir)) return;
  for (const id of readdirSync(dir)) {
    if (/^[a-f0-9]{24}$/.test(id) && existsSync(join(dir, id, "creds.json"))) {
      void connect(id).catch((err) => console.error(`[whatsapp] could not restore ${id}`, err instanceof Error ? err.message : err));
    }
  }
}

/* ── Sending ────────────────────────────────────────────────────────────── */

/** Where to send: a known number (checked on WhatsApp), or the chat's own address when only that is known. */
async function target(sock: WASocket, chat: string): Promise<{ jid: string; phone: string }> {
  if (chat.includes("@")) return { jid: chat, phone: "" };
  const phone = toIntl(chat);
  if (phone.length < 9) throw new WhatsAppError("That is not a phone number");
  const [found] = (await sock.onWhatsApp(phone).catch(() => [])) ?? [];
  if (!found?.exists) throw new WhatsAppError(`+${phone} is not on WhatsApp`);
  return { jid: String(found.jid), phone };
}

function connected(userId: string): WASocket {
  const s = session(userId);
  if (!s.sock || s.status !== "connected") throw new WhatsAppError("Your WhatsApp is not linked — link it on the WhatsApp page", 409);
  return s.sock;
}

async function keepSent(owner: { id: string; name: string }, to: { jid: string; phone: string }, chat: string, sentId: string, body: string,
  by: { id: string; name: string }, media: Record<string, unknown> | null) {
  const phone = to.phone;
  const key = phone ? phone.slice(-9) : "";
  return store({
    owner_id: owner.id, owner_name: owner.name,
    chat: phone || chat, phone, key, jid: to.jid,
    direction: "out", body, message_id: sentId,
    sender_name: by.name, sent_by_id: by.id, sent_by_name: by.name,
    student_ids: key ? (await studentsByKey()).get(key) ?? [] : [],
    read: true, media, at: new Date().toISOString(),
  });
}

export async function sendText(owner: { id: string; name: string }, chat: string, text: string) {
  const sock = connected(owner.id);
  const to = await target(sock, chat);
  const sent = await sock.sendMessage(to.jid, { text });
  return keepSent(owner, to, chat, sent?.key?.id ?? "", text, owner, null);
}

/**
 * A file, as a photo, a video, audio or a document by its type — or, with `voice`, a recording made in the
 * portal as a voice note (the blue microphone on the phone): Opus in Ogg, re-wrapped from the browser's WebM
 * when it has to be (voice.ts). A recording that can't be one (an older Safari's MP4) goes as plain audio.
 */
export async function sendFile(owner: { id: string; name: string }, chat: string, buffer: Buffer, mime: string, fileName: string, caption: string,
  voice = false) {
  if (buffer.length > MAX_MEDIA_BYTES) throw new WhatsAppError("Files up to 25 MB");
  const sock = connected(owner.id);
  const to = await target(sock, chat);
  if (voice) {
    const note = await asVoiceNote(buffer, mime).catch(() => { throw new WhatsAppError("That recording could not be sent as a voice note — record it again"); });
    if (note) {
      const sent = await sock.sendMessage(to.jid, { audio: note, mimetype: VOICE_MIME, ptt: true });
      const saved = await saveMedia(owner.id, note, "audio/ogg", "");
      return keepSent(owner, to, chat, sent?.key?.id ?? "", LABEL.ptt!, owner, { type: "audio", mime: "audio/ogg", file_name: "", file: saved.file, size: saved.size });
    }
  }
  const type = mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "document";
  const content: any = type === "image" ? { image: buffer, caption } : type === "video" ? { video: buffer, caption }
    : type === "audio" ? { audio: buffer, mimetype: mime, ptt: false } : { document: buffer, mimetype: mime, fileName, caption };
  const sent = await sock.sendMessage(to.jid, content);
  const saved = await saveMedia(owner.id, buffer, mime, fileName);
  return keepSent(owner, to, chat, sent?.key?.id ?? "", caption || (type === "document" ? `📄 ${fileName || "Document"}` : LABEL[type]!), owner,
    { type, mime, file_name: fileName, file: saved.file, size: saved.size });
}
