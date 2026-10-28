import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config";

/* ────────────────────────────────────────────────────────────────────────────
   Sending email (follow-up reminders), through the SMTP server in the
   SMTP_* settings — Zoho Mail: smtp.zoho.com / smtppro.zoho.com, port 465.

   A send only counts as sent when the SMTP server ACCEPTED it; the server's
   message id is returned so it can be kept as proof. Not configured → nothing
   is sent and the caller is told so (never a silent "success").
──────────────────────────────────────────────────────────────────────────── */

let transporter: Transporter | null = null;

export const mailConfigured = (): boolean => !!(config.smtp.host && config.smtp.user && config.smtp.pass);

/** The From address: SMTP_FROM, or the mailbox itself (Zoho only sends as the mailbox or its aliases). */
function fromAddress(): string {
  const from = config.smtp.from && config.smtp.from !== "no-reply@example.com" ? config.smtp.from : config.smtp.user;
  return from.includes("<") ? from : `"Delta CS Portal" <${from}>`;
}

/** The same mailbox under another name — what a student sees ("Delta Institutions"). */
function fromNamed(name: string): string {
  const address = fromAddress().match(/<([^>]+)>/)?.[1] ?? fromAddress();
  return `"${name.replace(/["\\]/g, "")}" <${address}>`;
}

/** What the admin pages show about the mail set-up (never the password). */
export const mailInfo = () => (mailConfigured()
  ? { configured: true, host: config.smtp.host, from: fromAddress() }
  : { configured: false, host: "", from: "" });

function transport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure ?? config.smtp.port === 465, // 465 = SSL; 587 = STARTTLS
      auth: { user: config.smtp.user, pass: config.smtp.pass },
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 30_000,
    });
  }
  return transporter;
}

export type SendResult =
  | { ok: true; messageId: string; accepted: string[]; response: string }
  | { ok: false; error: string; notConfigured?: boolean };

/** A file sent with the email; one with a `cid` is an image shown in it (`<img src="cid:…">`), not a download. */
export type MailAttachment = { filename: string; path: string; cid?: string };

/** `fromName` shows the mailbox under that name; `replyTo` is where an answer goes (the person who sent it). */
/** What an email was about and who sent it — for the email log (optional; the log keeps the email either way). */
export type MailLogInfo = { kind?: string; byId?: string; byName?: string; studentId?: string };

export async function sendMail(msg: { to: string; subject: string; html: string; text: string; fromName?: string; replyTo?: string; attachments?: MailAttachment[]; log?: MailLogInfo }): Promise<SendResult> {
  const result = await deliver(msg);
  keepInLog(msg, result);
  return result;
}

async function deliver(msg: { to: string; subject: string; html: string; text: string; fromName?: string; replyTo?: string; attachments?: MailAttachment[] }): Promise<SendResult> {
  if (!mailConfigured()) return { ok: false, error: "Email is not configured on the server (SMTP settings)", notConfigured: true };
  try {
    const info = await transport().sendMail({
      from: msg.fromName ? fromNamed(msg.fromName) : fromAddress(), to: msg.to, subject: msg.subject, html: msg.html, text: msg.text,
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
      ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
    });
    const accepted = (info.accepted || []).map(String);
    if (!accepted.length) return { ok: false, error: `Rejected by the mail server: ${info.response || "no recipients accepted"}` };
    return { ok: true, messageId: String(info.messageId || ""), accepted, response: String(info.response || "") };
  } catch (err) {
    transporter = null; // a broken connection shouldn't stick for the next try
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* Every email the portal sends — to anyone — is kept in email_log (the user, 2026-10-17: the student page's Emails),
   with whether it went, for a year (db.ts). Never in the way: a log that can't be written loses only itself. */
function keepInLog(msg: { to: string; subject: string; html: string; text: string; fromName?: string; log?: MailLogInfo }, result: SendResult): void {
  const now = new Date();
  void import("../db").then(({ col }) => col("email_log").insertOne({
    to: String(msg.to ?? "").trim().toLowerCase(), subject: String(msg.subject ?? "").slice(0, 500),
    html: String(msg.html ?? "").slice(0, 300_000), text: String(msg.text ?? "").slice(0, 50_000), from_name: msg.fromName ?? "",
    status: result.ok ? "sent" : (result as any).notConfigured ? "not_sent" : "failed",
    error: result.ok ? "" : String((result as any).error ?? "").slice(0, 500),
    kind: msg.log?.kind ?? "", by_id: msg.log?.byId ?? "", by_name: msg.log?.byName ?? "", student_id: msg.log?.studentId ?? "",
    at: now.toISOString(), at_date: now,
  } as any)).catch((err) => console.error("[mail] could not keep the email in the log", err));
}
