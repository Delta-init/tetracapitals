import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allowedRoles = ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'admin_supervisor', 'finance_admin'];
    if (!allowedRoles.includes(user.app_role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const users = await base44.asServiceRole.entities.User.list('-created_date', 200);
    return Response.json({ users: Array.isArray(users) ? users : [] });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});