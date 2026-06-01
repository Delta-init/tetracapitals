import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Handles all role-based ticket notifications that require service-role user lookup.
// For direct-user-id notifications (in_progress, resolved, admin-reply), the frontend handles those directly.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { title, message, type, assignedToRole, assignedToId, referenceId } = await req.json();

    // Use service role to list all users
    const allUsers = await base44.asServiceRole.entities.User.list();

    // Find targets: assigned user (by id or role) + all super_admins
    const targets = allUsers.filter(u => {
      if (u.app_role === 'super_admin') return true;
      if (assignedToId && u.id === assignedToId) return true;
      if (!assignedToId && assignedToRole && u.app_role === assignedToRole) return true;
      return false;
    });

    // Deduplicate by id
    const seen = new Set();
    const uniqueTargets = targets.filter(u => {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    });

    await Promise.all(uniqueTargets.map(u =>
      base44.asServiceRole.entities.Notification.create({
        user_id: u.id,
        title,
        message,
        type,
        read: false,
        ...(referenceId ? { reference_id: referenceId } : {}),
      })
    ));

    return Response.json({ success: true, notified: uniqueTargets.length });
  } catch (error) {
    console.error('sendTicketNotification error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});