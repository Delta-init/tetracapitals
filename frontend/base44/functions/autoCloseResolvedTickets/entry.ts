import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const BATCH = 100;
    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    let allTickets = [];
    let skip = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.Ticket.filter(
        { status: 'resolved' }, 'resolved_date', BATCH, skip
      );
      if (!Array.isArray(batch) || !batch.length) break;
      allTickets = allTickets.concat(batch);
      if (batch.length < BATCH) break;
      skip += BATCH;
    }

    const toClose = allTickets.filter(t => t.resolved_date && t.resolved_date < cutoff);

    let count = 0;
    for (const ticket of toClose) {
      await base44.asServiceRole.entities.TicketMessage.create({
        ticket_id: ticket.id,
        sender_id: 'system',
        sender_name: 'System',
        sender_role: 'system',
        message: 'This ticket has been automatically closed after 24 hours without confirmation. If your issue persists, please create a new ticket.',
        message_type: 'auto_closed',
        created_date: now.toISOString(),
      });

      await base44.asServiceRole.entities.Ticket.update(ticket.id, {
        title: ticket.title,
        description: ticket.description,
        category: ticket.category,
        priority: ticket.priority,
        created_by_id: ticket.created_by_id,
        created_by_name: ticket.created_by_name,
        assigned_to_role: ticket.assigned_to_role,
        status: 'closed',
        closed_date: now.toISOString(),
      });

      await base44.asServiceRole.entities.Notification.create({
        user_id: ticket.created_by_id,
        title: `Ticket ${ticket.ticket_number} auto-closed`,
        message: `Your ticket "${ticket.title}" has been automatically closed after 24 hours. If the issue persists, please create a new ticket.`,
        type: 'ticket_auto_closed',
        read: false,
        link: '/Tickets',
        created_date: now.toISOString(),
      });

      count++;
    }

    return Response.json({ closed: count });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});