import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { student_id, mentor_id } = await req.json();
    console.log('updateCoMentorContribution called with:', { student_id, mentor_id, caller_role: user?.app_role, caller_email: user?.email });

    if (!student_id || !mentor_id) {
      return Response.json({ error: 'Missing student_id or mentor_id' }, { status: 400 });
    }

    const student = await base44.asServiceRole.entities.Student.get(student_id);
    if (!student) {
      return Response.json({ error: 'Student not found' }, { status: 404 });
    }

    if (!student.co_mentors_details) {
      return Response.json({ success: true, message: 'No co_mentors_details on student' });
    }

    let coMentors = [];
    try {
      coMentors = typeof student.co_mentors_details === 'string'
        ? JSON.parse(student.co_mentors_details)
        : student.co_mentors_details;
    } catch (e) {
      return Response.json({ error: 'Invalid co_mentors_details format' }, { status: 500 });
    }

    const match = coMentors.find(cm => cm.mentor_id === mentor_id);
    if (!match) {
      return Response.json({ success: true, message: 'Co-mentor not found — no update needed' });
    }

    // Fetch ALL approved FundingTransactions for this student
    const isPrimary = match.role === 'primary' || mentor_id === student.primary_mentor_id;
    let allTransactions;
    if (isPrimary) {
      // Primary mentor's transactions: those without an initiating_mentor_id (normal deposits)
      const allApproved = await base44.asServiceRole.entities.FundingTransaction.filter({
        student_id,
        status: 'APPROVED'
      });
      allTransactions = allApproved.filter(t => !t.initiating_mentor_id || t.initiating_mentor_id === mentor_id);
    } else {
      allTransactions = await base44.asServiceRole.entities.FundingTransaction.filter({
        student_id,
        status: 'APPROVED',
        initiating_mentor_id: mentor_id
      });
    }

    // Sum deposits minus withdrawals to get true net contribution
    let netContribution = 0;
    for (const tx of allTransactions) {
      if (tx.type === 'DEPOSIT') {
        netContribution += tx.amount_usd || 0;
      } else if (tx.type === 'WITHDRAWAL') {
        netContribution -= tx.amount_usd || 0;
      }
    }

    console.log(`Recalculated net contribution for mentor ${mentor_id}: $${netContribution} from ${allTransactions.length} transactions`);

    const updatedCoMentors = coMentors.map(cm =>
      cm.mentor_id === mentor_id
        ? { ...cm, net_deposit_contribution_usd: netContribution }
        : cm
    );

    await base44.asServiceRole.entities.Student.update(student_id, {
      co_mentors_details: JSON.stringify(updatedCoMentors)
    });

    return Response.json({ success: true, netContribution, updatedCoMentors });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});