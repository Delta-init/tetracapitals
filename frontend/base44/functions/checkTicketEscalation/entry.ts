import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const BATCH = 100;
    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // Fetch open, non-escalated tickets
    let allTickets = [];
    let skip = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.Ticket.filter(
        { status: 'open', escalated: false }, 'created_date', BATCH, skip
      );
      if (!Array.isArray(batch) || !batch.length) break;
      allTickets = allTickets.concat(batch);
      if (batch.length < BATCH) break;
      skip += BATCH;
    }

    // Filter by age and no first response
    const toEscalate = allTickets.filter(t =>
      !t.first_response_date &&
      t.created_date && t.created_date < cutoff
    );

    if (toEscalate.length === 0) {
      return Response.json({ escalated: 0 });
    }

    // Get super admins
    let allUsers = [];
    skip = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.User.list('-created_date', BATCH, skip);
      if (!Array.isArray(batch) || !batch.length) break;
      allUsers = allUsers.concat(batch);
      if (batch.length < BATCH) break;
      skip += BATCH;
    }
    const superAdmins = allUsers.filter(u => u.app_role === 'super_admin');

    let count = 0;
    for (const ticket of toEscalate) {
      await base44.asServiceRole.entities.Ticket.update(ticket.id, {
        escalated: true,
        escalation_sent_date: now.toISOString(),
      });

      await Promise.all(superAdmins.map(sa =>
        base44.asServiceRole.entities.Notification.create({
          user_id: sa.id,
          title: `ESCALATION: Ticket ${ticket.ticket_number} unattended for 24+ hours`,
          message: `Ticket "${ticket.title}" raised by ${ticket.created_by_name} (category: ${ticket.category}, assigned to: ${ticket.assigned_to_role}) has not received a response in over 24 hours.`,
          type: 'ticket_escalation',
          read: false,
          link: '/Tickets',
          created_date: now.toISOString(),
        })
      ));
      count++;
    }

    return Response.json({ escalated: count });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});