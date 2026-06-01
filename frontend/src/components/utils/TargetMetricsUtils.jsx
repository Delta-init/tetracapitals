// Utility functions for target metrics calculation

export const getNetDepositForPeriod = (transactions, mentorId, startDate, endDate) => {
  if (!transactions || !mentorId || !startDate || !endDate) return 0;
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999); // Include entire end date
  
  // Filter transactions for this mentor and period
  const relevantTransactions = transactions.filter(t => {
    if (t.status !== 'APPROVED') return false;
    if (t.primary_mentor_id !== mentorId) return false;
    
    const requestedDate = new Date(t.requested_at);
    return requestedDate >= start && requestedDate <= end;
  });
  
  // Calculate net deposit
  const totalDeposits = relevantTransactions
    .filter(t => t.type === 'DEPOSIT')
    .reduce((sum, t) => sum + (t.amount_usd || 0), 0);
  
  const totalWithdrawals = relevantTransactions
    .filter(t => t.type === 'WITHDRAWAL')
    .reduce((sum, t) => sum + (t.amount_usd || 0), 0);
  
  return totalDeposits - totalWithdrawals;
};

export const computeTargetAchievement = (target, transactions, currentDate = new Date()) => {
  if (!target) return null;
  
  const now = new Date(currentDate);
  const startDate = new Date(target.period_start_date);
  const endDate = new Date(target.period_end_date);
  endDate.setHours(23, 59, 59, 999);
  
  // Calculate achievement
  const achievement_net_deposit_usd = getNetDepositForPeriod(
    transactions,
    target.mentor_id,
    target.period_start_date,
    target.period_end_date
  );
  
  // Calculate percentage
  let achievement_percent = 0;
  if (target.target_net_deposit_usd > 0) {
    achievement_percent = (achievement_net_deposit_usd / target.target_net_deposit_usd) * 100;
  }
  
  // Determine status
  let target_status = 'NOT_STARTED';
  
  if (now < startDate) {
    target_status = 'NOT_STARTED';
  } else if (now >= startDate && now <= endDate) {
    target_status = achievement_percent >= 100 ? 'ACHIEVED' : 'IN_PROGRESS';
  } else {
    // Period ended
    target_status = achievement_percent >= 100 ? 'ACHIEVED' : 'MISSED';
  }
  
  return {
    achievement_net_deposit_usd,
    achievement_percent,
    target_status
  };
};

// Helper to get current active targets
export const getCurrentActiveTargets = (targets, transactions, currentDate = new Date()) => {
  const now = new Date(currentDate);
  
  const activeTargets = {
    weekly: null,
    monthly: null,
    quarterly: null
  };
  
  targets.forEach(target => {
    const startDate = new Date(target.period_start_date);
    const endDate = new Date(target.period_end_date);
    endDate.setHours(23, 59, 59, 999);
    
    // Check if current date falls within this target period
    if (now >= startDate && now <= endDate) {
      const achievement = computeTargetAchievement(target, transactions, currentDate);
      const enrichedTarget = { ...target, ...achievement };
      
      if (target.period_type === 'WEEKLY' && !activeTargets.weekly) {
        activeTargets.weekly = enrichedTarget;
      } else if (target.period_type === 'MONTHLY' && !activeTargets.monthly) {
        activeTargets.monthly = enrichedTarget;
      } else if (target.period_type === 'QUARTERLY' && !activeTargets.quarterly) {
        activeTargets.quarterly = enrichedTarget;
      }
    }
  });
  
  return activeTargets;
};

// Helper to format period label
export const formatPeriodLabel = (target) => {
  if (!target) return '';
  
  const startDate = new Date(target.period_start_date);
  const endDate = new Date(target.period_end_date);
  
  if (target.period_type === 'WEEKLY') {
    return `Week of ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  } else if (target.period_type === 'MONTHLY') {
    return startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } else if (target.period_type === 'QUARTERLY') {
    const quarter = Math.floor(startDate.getMonth() / 3) + 1;
    return `Q${quarter} ${startDate.getFullYear()}`;
  }
  
  return '';
};