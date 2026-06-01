import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allowedRoles = ['super_admin', 'admin', 'broker_admin', 'academic_head'];
    if (!allowedRoles.includes(user.app_role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { userId, userData } = await req.json();

    if (!userId || !userData) {
      return Response.json({ error: 'userId and userData are required' }, { status: 400 });
    }

    const result = await base44.asServiceRole.entities.User.update(userId, userData);
    return Response.json({ user: result });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});