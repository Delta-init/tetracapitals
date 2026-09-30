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
  return from.includes("<") ? from : `"Delta Commission Portal" <${from}>`;
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

export async function sendMail(msg: { to: string; subject: string; html: string; text: string }): Promise<SendResult> {
  if (!mailConfigured()) return { ok: false, error: "Email is not configured on the server (SMTP settings)", notConfigured: true };
  try {
    const info = await transport().sendMail({ from: fromAddress(), to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
    const accepted = (info.accepted || []).map(String);
    if (!accepted.length) return { ok: false, error: `Rejected by the mail server: ${info.response || "no recipients accepted"}` };
    return { ok: true, messageId: String(info.messageId || ""), accepted, response: String(info.response || "") };
  } catch (err) {
    transporter = null; // a broken connection shouldn't stick for the next try
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
