// Utility functions for commission calculations

export const isWithinCurrentQuarter = (date, currentDate = new Date()) => {
  if (!date) return false;
  
  const checkDate = new Date(date);
  const current = new Date(currentDate);
  
  // Get current quarter
  const currentQuarter = Math.floor(current.getMonth() / 3);
  const currentYear = current.getFullYear();
  
  // Get quarter start and end
  const quarterStartMonth = currentQuarter * 3;
  const quarterStart = new Date(currentYear, quarterStartMonth, 1);
  const quarterEnd = new Date(currentYear, quarterStartMonth + 3, 0, 23, 59, 59, 999);
  
  return checkDate >= quarterStart && checkDate <= quarterEnd;
};

export const getCurrentQuarterLabel = (currentDate = new Date()) => {
  const current = new Date(currentDate);
  const quarter = Math.floor(current.getMonth() / 3) + 1;
  const year = current.getFullYear();
  return `Q${quarter} ${year}`;
};

export const getQuarterDateRange = (quarter, year) => {
  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
  return { start, end };
};

export const calculateQuarterlyNetDepositAndCommission = (transactions, currentUser, currentDate = new Date(), dateRange = null) => {
  if (!transactions || !currentUser) {
    return {
      netDepositUsd: 0,
      rawNetDepositUsd: 0,
      grossCommissionUsd: 0,
      release75Usd: 0,
      buffer25Usd: 0
    };
  }

  const relevantTransactions = transactions.filter(t => {
    if (t.status !== 'APPROVED') return false;
    if (dateRange) {
      const txDate = new Date(t.requested_at || t.created_date);
      if (txDate < dateRange.start || txDate > dateRange.end) return false;
    } else {
      if (!isWithinCurrentQuarter(t.requested_at, currentDate)) return false;
    }
    // If initiating_mentor_id is set, commission goes to that mentor
    if (t.initiating_mentor_id) return t.initiating_mentor_id === currentUser.id;
    // Otherwise, credit goes to the primary mentor (legacy behavior)
    return t.primary_mentor_id === currentUser.id;
  });
  
  // Calculate net deposit with per-student floor (0) and cap ($25,000)
  const MAX_NET_DEPOSIT_PER_STUDENT = 25000;
  const studentNetDeposits = {};
  relevantTransactions.forEach(t => {
    const studentId = t.student_id;
    if (!studentNetDeposits[studentId]) studentNetDeposits[studentId] = 0;
    if (t.type === 'DEPOSIT') studentNetDeposits[studentId] += (t.amount_usd || 0);
    else if (t.type === 'WITHDRAWAL') studentNetDeposits[studentId] -= (t.amount_usd || 0);
  });

  // rawNetDepositUsd = actual sum per student (can be negative, no floor) for display
  let rawNetDepositUsd = 0;
  Object.values(studentNetDeposits).forEach(studentNet => {
    rawNetDepositUsd += Math.min(studentNet, MAX_NET_DEPOSIT_PER_STUDENT);
  });

  // netDepositUsd = commission-eligible (floored at 0 per student)
  let netDepositUsd = 0;
  Object.values(studentNetDeposits).forEach(studentNet => {
    const capped = Math.min(studentNet, MAX_NET_DEPOSIT_PER_STUDENT);
    netDepositUsd += Math.max(capped, 0);
  });

  // Calculate commission (4% of net deposit)
  const grossCommissionUsd = netDepositUsd * 0.04;
  
  // Calculate release (75%) and buffer (25%)
  const release75Usd = grossCommissionUsd * 0.75;
  const buffer25Usd = grossCommissionUsd * 0.25;
  
  return {
    netDepositUsd,
    rawNetDepositUsd,
    grossCommissionUsd,
    release75Usd,
    buffer25Usd
  };
};