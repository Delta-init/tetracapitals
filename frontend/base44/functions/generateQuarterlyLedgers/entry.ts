/**
 * Automated Quarterly Ledger Generation
 *
 * This function automatically generates commission ledgers for all mentors
 * for the previous quarter. It runs at the beginning of each new quarter.
 * Manual commission adjustments within the quarter are factored into release/buffer.
 */

export default async function generateQuarterlyLedgers({ entities }) {
  console.log('Starting automated quarterly ledger generation...');
  
  // Calculate previous quarter dates
  const now = new Date();
  const currentMonth = now.getMonth(); // 0-11
  const currentYear = now.getFullYear();
  
  // Determine previous quarter
  let prevQuarterNumber;
  let prevYear;
  
  if (currentMonth < 3) { // Jan-Mar (Q1) -> previous is Q4
    prevQuarterNumber = 4;
    prevYear = currentYear - 1;
  } else if (currentMonth < 6) { // Apr-Jun (Q2) -> previous is Q1
    prevQuarterNumber = 1;
    prevYear = currentYear;
  } else if (currentMonth < 9) { // Jul-Sep (Q3) -> previous is Q2
    prevQuarterNumber = 2;
    prevYear = currentYear;
  } else { // Oct-Dec (Q4) -> previous is Q3
    prevQuarterNumber = 3;
    prevYear = currentYear;
  }
  
  const quarterLabel = `${prevYear}-Q${prevQuarterNumber}`;
  
  // Calculate quarter start and end dates
  const startMonth = (prevQuarterNumber - 1) * 3;
  const startDate = new Date(prevYear, startMonth, 1);
  const endDate = new Date(prevYear, startMonth + 3, 0);
  
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];
  
  console.log(`Generating ledgers for ${quarterLabel}: ${startDateStr} to ${endDateStr}`);
  
  // Get all users (mentors)
  const allUsers = await entities.User.list();
  const mentors = allUsers.filter(u => 
    ['junior_mentor', 'senior_mentor'].includes(u.app_role)
  );
  
  console.log(`Found ${mentors.length} mentors`);
  
  // Get all funding transactions
  const allTransactions = await entities.FundingTransaction.list();

  // Get all manual commission adjustments
  const allAdjustments = await entities.ManualCommissionAdjustment.list();
  
  // Get existing ledgers to check for duplicates
  const existingLedgers = await entities.CommissionLedger.list();
  
  let createdCount = 0;
  let skippedCount = 0;
  
  // Process each mentor
  for (const mentor of mentors) {
    // Check if ledger already exists for this mentor and quarter
    const existingLedger = existingLedgers.find(
      l => l.mentor_id === mentor.id && l.quarter === quarterLabel
    );
    
    if (existingLedger) {
      console.log(`Ledger already exists for ${mentor.full_name} - ${quarterLabel}. Skipping.`);
      skippedCount++;
      continue;
    }
    
    // Calculate net deposit for the quarter
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    end.setHours(23, 59, 59, 999);
    
    const relevantTransactions = allTransactions.filter(t => {
      if (t.status !== 'APPROVED') return false;
      // Use initiating_mentor_id if present (co-managed), else fall back to primary_mentor_id
      const attributedMentorId = t.initiating_mentor_id || t.primary_mentor_id;
      if (attributedMentorId !== mentor.id) return false;
      
      const requestedDate = new Date(t.requested_at);
      return requestedDate >= start && requestedDate <= end;
    });
    
    const totalDeposits = relevantTransactions
      .filter(t => t.type === 'DEPOSIT')
      .reduce((sum, t) => sum + (t.amount_usd || 0), 0);
    
    const totalWithdrawals = relevantTransactions
      .filter(t => t.type === 'WITHDRAWAL')
      .reduce((sum, t) => sum + (t.amount_usd || 0), 0);
    
    const netDeposit = totalDeposits - totalWithdrawals;
    
    // Get previous quarter's buffer
    const prevQuarterNum = prevQuarterNumber === 1 ? 4 : prevQuarterNumber - 1;
    const prevQuarterYear = prevQuarterNumber === 1 ? prevYear - 1 : prevYear;
    const prevQuarterLabel = `${prevQuarterYear}-Q${prevQuarterNum}`;
    
    const prevLedger = existingLedgers.find(
      l => l.mentor_id === mentor.id && l.quarter === prevQuarterLabel
    );
    
    const bufferCarriedIn = prevLedger?.commission_buffer_usd || 0;
    
    // Calculate commissions
    const grossCommission = (netDeposit + bufferCarriedIn) * 0.04;

    // Apply manual commission adjustments for this mentor within the quarter
    const adjustmentTotal = allAdjustments
      .filter(a => {
        if (a.mentor_id !== mentor.id) return false;
        const adjDate = new Date(a.created_date);
        return adjDate >= start && adjDate <= end;
      })
      .reduce((sum, a) => sum + (a.amount_usd || 0), 0);

    const adjustedGross = grossCommission + adjustmentTotal;
    const commissionRelease = adjustedGross * 0.75;
    const commissionBuffer = adjustedGross * 0.25;
    
    // Calculate release date (15th of next month after quarter end)
    const releaseDate = new Date(prevYear, startMonth + 3, 15);
    const releaseDateStr = releaseDate.toISOString().split('T')[0];
    
    // Create ledger record
    const ledgerData = {
      mentor_id: mentor.id,
      mentor_name: mentor.full_name,
      quarter: quarterLabel,
      year: prevYear,
      quarter_number: prevQuarterNumber,
      start_date: startDateStr,
      end_date: endDateStr,
      net_deposit_usd: netDeposit,
      gross_commission_usd: grossCommission,
      commission_release_usd: commissionRelease,
      commission_buffer_usd: commissionBuffer,
      buffer_carried_in_usd: bufferCarriedIn,
      buffer_carried_out_usd: commissionBuffer,
      is_closed: true,
      is_released: false,
      release_date: releaseDateStr,
      closed_by_id: 'SYSTEM',
      closed_by_name: 'Automated System',
      closed_at: new Date().toISOString(),
      notes: 'Auto-generated by quarterly ledger automation'
    };
    
    await entities.CommissionLedger.create(ledgerData);
    console.log(`Created ledger for ${mentor.full_name} - ${quarterLabel}: Net=${netDeposit.toFixed(2)}, Release=${commissionRelease.toFixed(2)}`);
    createdCount++;
  }
  
  const summary = {
    success: true,
    quarter: quarterLabel,
    period: `${startDateStr} to ${endDateStr}`,
    mentors_processed: mentors.length,
    ledgers_created: createdCount,
    ledgers_skipped: skippedCount,
    timestamp: new Date().toISOString()
  };
  
  console.log('Quarterly ledger generation complete:', summary);
  
  return summary;
}