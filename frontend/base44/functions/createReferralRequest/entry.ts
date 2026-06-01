import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      student_id,
      student_name,
      student_code,
      receiving_mentor_id,
      receiving_mentor_name,
      requested_deposit_amount,
      payment_method,
      mt5_login,
      screenshot_url,
      notes
    } = await req.json();

    if (!student_id || !receiving_mentor_id) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Check if student already has a co-mentor (max 2 mentors total, and current user not already a co-mentor)
    const students = await base44.asServiceRole.entities.Student.filter({ id: student_id });
    if (students.length > 0 && students[0].co_mentors_details) {
      try {
        const raw = students[0].co_mentors_details;
        const existing = Array.isArray(raw) ? raw : JSON.parse(raw);
        if (Array.isArray(existing)) {
          // Block if this mentor is already a co-mentor for this student
          if (existing.some(cm => cm.mentor_id === user.id)) {
            return Response.json({ error: 'You are already a co-mentor for this client.' }, { status: 400 });
          }
          // Block if 2 co-mentors already exist (primary + 1 co = max 2 total)
          if (existing.length >= 2) {
            return Response.json({ error: 'This student already has the maximum number of co-mentors (2 total).' }, { status: 400 });
          }
        }
      } catch (_) { /* ignore parse errors */ }
    }

    // Check if THIS mentor already has a pending referral for this student
    const existingReferrals = await base44.asServiceRole.entities.MentorReferral.filter({
      student_id,
      initiating_mentor_id: user.id,
      status: 'pending'
    });
    if (existingReferrals.length > 0) {
      return Response.json({ error: 'You already have a pending referral request for this client.' }, { status: 400 });
    }

    const referral = await base44.asServiceRole.entities.MentorReferral.create({
      student_id,
      student_name,
      student_code,
      initiating_mentor_id: user.id,
      initiating_mentor_name: user.full_name,
      receiving_mentor_id,
      receiving_mentor_name,
      requested_deposit_amount: parseFloat(requested_deposit_amount) || 0,
      transaction_type: 'DEPOSIT',
      payment_method: payment_method || '',
      mt5_login: mt5_login || '',
      screenshot_url: screenshot_url || '',
      notes: notes || '',
      status: 'pending',
      created_at: new Date().toISOString()
    });

    await base44.asServiceRole.entities.Log.create({
      timestamp: new Date().toISOString(),
      user_id: user.id,
      user_email: user.email,
      user_name: user.full_name,
      user_role: user.app_role,
      action_type: 'other',
      entity_type: 'MentorReferral',
      entity_id: referral.id,
      details: JSON.stringify({
        message: `Referral request sent by ${user.full_name} to ${receiving_mentor_name} for student ${student_name}`,
        student_id,
        requested_deposit_amount
      }),
      success: true
    });

    return Response.json({ referral });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});