import { col } from "../db";
import { json, error } from "../lib/response";
import { serialize, serializeMany, toObjectId } from "../lib/id";
import type { AuthUser } from "../auth/middleware";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Auto-close resolved tickets older than 24 hours. */
export async function autoCloseResolvedTickets(): Promise<Response> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
  const resolved = serializeMany(
    await col("tickets").find({ status: "resolved" }).toArray(),
  );
  const toClose = resolved.filter((t: any) => t.resolved_date && t.resolved_date < cutoff);

  for (const ticket of toClose) {
    const tid = toObjectId(ticket.id);
    if (!tid) continue;
    await col("ticket_messages").insertOne({
      ticket_id: ticket.id,
      sender_id: "system",
      sender_name: "System",
      sender_role: "system",
      message: "This ticket has been automatically closed after 24 hours without confirmation. If your issue persists, please create a new ticket.",
      message_type: "auto_closed",
      created_date: now.toISOString(),
      updated_date: now.toISOString(),
    } as any);
    await col("tickets").updateOne(
      { _id: tid },
      { $set: { status: "closed", closed_date: now.toISOString(), updated_date: now.toISOString() } },
    );
    await col("notifications").insertOne({
      user_id: ticket.created_by_id,
      title: `Ticket ${ticket.ticket_number} auto-closed`,
      message: `Your ticket "${ticket.title}" has been automatically closed after 24 hours. If the issue persists, please create a new ticket.`,
      type: "ticket_auto_closed",
      read: false,
      link: "/Tickets",
      created_date: now.toISOString(),
      updated_date: now.toISOString(),
    } as any);
  }
  return json({ closed: toClose.length });
}

/** Escalate open tickets that haven't received a first response in 24h. */
export async function checkTicketEscalation(): Promise<Response> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
  const open = serializeMany(
    await col("tickets").find({ status: "open", escalated: false }).toArray(),
  );
  const toEscalate = open.filter((t: any) => !t.first_response_date && t.created_date && t.created_date < cutoff);
  if (!toEscalate.length) return json({ escalated: 0 });

  const superAdmins = serializeMany(
    await col("users").find({ app_role: "super_admin" }, { projection: { password_hash: 0 } }).toArray(),
  );

  let count = 0;
  for (const ticket of toEscalate) {
    const tid = toObjectId(ticket.id);
    if (!tid) continue;
    await col("tickets").updateOne(
      { _id: tid },
      { $set: { escalated: true, escalation_sent_date: now.toISOString(), updated_date: now.toISOString() } },
    );
    if (superAdmins.length) {
      await col("notifications").insertMany(
        superAdmins.map((sa: any) => ({
          user_id: sa.id,
          title: `ESCALATION: Ticket ${ticket.ticket_number} unattended for 24+ hours`,
          message: `Ticket "${ticket.title}" raised by ${ticket.created_by_name} (category: ${ticket.category}, assigned to: ${ticket.assigned_to_role}) has not received a response in over 24 hours.`,
          type: "ticket_escalation",
          read: false,
          link: "/Tickets",
          created_date: now.toISOString(),
          updated_date: now.toISOString(),
        })) as any[],
      );
    }
    count++;
  }
  return json({ escalated: count });
}

/** Send role-based ticket notification. */
export async function sendTicketNotification(req: Request, _user: AuthUser): Promise<Response> {
  const body: any = await req.json().catch(() => null);
  if (!body) return error("Body required", 400);
  const { title, message, type, assignedToRole, assignedToId, referenceId } = body;
  const allUsers = serializeMany(
    await col("users").find({}, { projection: { password_hash: 0 } }).toArray(),
  );
  const targets = allUsers.filter((u: any) => {
    if (u.app_role === "super_admin") return true;
    if (assignedToId && u.id === assignedToId) return true;
    if (!assignedToId && assignedToRole && u.app_role === assignedToRole) return true;
    return false;
  });
  const seen = new Set<string>();
  const unique = targets.filter((u: any) => (seen.has(u.id) ? false : (seen.add(u.id), true)));
  if (unique.length) {
    const now = new Date().toISOString();
    await col("notifications").insertMany(
      unique.map((u: any) => ({
        user_id: u.id,
        title, message, type,
        read: false,
        ...(referenceId ? { reference_id: referenceId } : {}),
        created_date: now,
        updated_date: now,
      })) as any[],
    );
  }
  return json({ success: true, notified: unique.length });
}

/** Generate the next ticket number like TKT-00001. */
export async function nextTicketNumber(): Promise<string> {
  const count = await col("tickets").estimatedDocumentCount();
  return `TKT-${String(count + 1).padStart(5, "0")}`;
}
