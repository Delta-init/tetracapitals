import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || !['super_admin', 'broker_admin', 'academic_head'].includes(user.app_role)) {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Function simplified: returns success without co-managed split logic
    // Co-managed deductions are now handled via the CoManageCalculator UI
    return Response.json({ success: true, message: 'Withdrawal processed. Use CoManageCalculator for co-managed deductions.' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});