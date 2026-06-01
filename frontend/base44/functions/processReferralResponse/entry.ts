import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { referral_id, action, rejection_reason } = await req.json();

    if (!referral_id || !action) {
      return Response.json({ error: 'Missing referral_id or action' }, { status: 400 });
    }

    const referrals = await base44.asServiceRole.entities.MentorReferral.filter({ id: referral_id });
    if (!referrals.length) return Response.json({ error: 'Referral not found' }, { status: 404 });
    const referral = referrals[0];

    if (referral.receiving_mentor_id !== user.id) {
      return Response.json({ error: 'You are not authorized to respond to this referral' }, { status: 403 });
    }

    if (referral.status !== 'pending') {
      return Response.json({ error: 'This referral has already been responded to' }, { status: 400 });
    }

    if (action === 'approve') {
      // Add initiating mentor to student's co_mentors_details
      const students = await base44.asServiceRole.entities.Student.filter({ id: referral.student_id });
      let student = null;
      if (students.length > 0) {
        student = students[0];
        let coMentors = [];
        if (student.co_mentors_details) {
          try { coMentors = JSON.parse(student.co_mentors_details); } catch (_) { /* ignore */ }
        }
        // Replace co_mentors_details with both primary + co-mentor entries
        const since = new Date().toISOString();
        coMentors = [
          {
            mentor_id: student.primary_mentor_id,
            mentor_name: student.primary_mentor_name,
            net_deposit_contribution_usd: 0,
            role: 'primary',
            since
          },
          {
            mentor_id: referral.initiating_mentor_id,
            mentor_name: referral.initiating_mentor_name,
            net_deposit_contribution_usd: 0,
            role: 'co_mentor',
            since
          }
        ];
        await base44.asServiceRole.entities.Student.update(student.id, {
          co_mentors_details: JSON.stringify(coMentors)
        });
      }

      // Create FundingTransaction so it enters the normal admin approval queue
      const initiatingUser = await base44.asServiceRole.entities.User.filter({ id: referral.initiating_mentor_id });
      const iUser = initiatingUser.length > 0 ? initiatingUser[0] : null;

      await base44.asServiceRole.entities.FundingTransaction.create({
        type: referral.transaction_type || 'DEPOSIT',
        status: 'PENDING',
        student_id: referral.student_id,
        student_name: referral.student_name,
        student_code: referral.student_code,
        primary_mentor_id: student ? student.primary_mentor_id : referral.receiving_mentor_id,
        primary_mentor_name: student ? student.primary_mentor_name : referral.receiving_mentor_name,
        senior_mentor_id: student ? student.senior_mentor_id : null,
        senior_mentor_name: student ? student.senior_mentor_name : null,
        initiating_mentor_id: referral.initiating_mentor_id,
        initiating_mentor_name: referral.initiating_mentor_name,
        upline_commission_percentage: iUser ? (parseFloat(iUser.upline_commission_percentage) || 0) : 0,
        amount_usd: parseFloat(referral.requested_deposit_amount) || 0,
        payment_method: referral.payment_method || '',
        mt5_login: referral.mt5_login || '',
        screenshot_url: referral.screenshot_url || '',
        notes: referral.notes || '',
        requested_by_id: referral.initiating_mentor_id,
        requested_by_name: referral.initiating_mentor_name,
        requested_at: new Date().toISOString()
      });

      await base44.asServiceRole.entities.MentorReferral.update(referral_id, {
        status: 'approved',
        responded_at: new Date().toISOString()
      });

      await base44.asServiceRole.entities.Log.create({
        timestamp: new Date().toISOString(),
        user_id: user.id,
        user_email: user.email,
        user_name: user.full_name,
        user_role: user.app_role,
        action_type: 'other',
        entity_type: 'MentorReferral',
        entity_id: referral_id,
        details: JSON.stringify({
          message: `Referral APPROVED by ${user.full_name}. ${referral.initiating_mentor_name} added as co-mentor for student ${referral.student_name}. FundingTransaction created for broker approval.`
        }),
        success: true
      });

      return Response.json({ success: true, message: 'Referral approved. FundingTransaction created for admin review.' });

    } else if (action === 'reject') {
      if (!rejection_reason) {
        return Response.json({ error: 'Rejection reason is required' }, { status: 400 });
      }

      await base44.asServiceRole.entities.MentorReferral.update(referral_id, {
        status: 'rejected',
        rejection_reason,
        responded_at: new Date().toISOString()
      });

      await base44.asServiceRole.entities.Log.create({
        timestamp: new Date().toISOString(),
        user_id: user.id,
        user_email: user.email,
        user_name: user.full_name,
        user_role: user.app_role,
        action_type: 'other',
        entity_type: 'MentorReferral',
        entity_id: referral_id,
        details: JSON.stringify({
          message: `Referral REJECTED by ${user.full_name}. Reason: ${rejection_reason}`
        }),
        success: true
      });

      return Response.json({ success: true, message: 'Referral rejected.' });
    }

    return Response.json({ error: 'Invalid action. Use "approve" or "reject".' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});