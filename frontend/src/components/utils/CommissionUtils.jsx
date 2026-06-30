// Utility functions for commission calculations.
//
// Quarter boundaries come from the shared, business-timezone-anchored helper in
// quarterRange.jsx so this (mentor) screen and the admin Quarter Closing screen
// can never disagree about which quarter a boundary transaction belongs to.
import { getQuarterRange, getBusinessQuarter } from "./quarterRange";

export const isWithinCurrentQuarter = (date, currentDate = new Date()) => {
  if (!date) return false;
  const { quarter, year } = getBusinessQuarter(new Date(currentDate));
  const { start, end } = getQuarterRange(quarter, year);
  const checkDate = new Date(date);
  return checkDate >= start && checkDate <= end;
};

export const getCurrentQuarterLabel = (currentDate = new Date()) => {
  const { quarter, year } = getBusinessQuarter(new Date(currentDate));
  return `Q${quarter} ${year}`;
};

export const getQuarterDateRange = (quarter, year) => getQuarterRange(quarter, year);

export const calculateQuarterlyNetDepositAndCommission = (transactions, currentUser, currentDate = new Date(), dateRange = null) => {
  if (!transactions || !currentUser) {
    return {
      netDepositUsd: 0,
      rawNetDepositUsd: 0,
      commissionRate: parseFloat(currentUser?.commission_rate) || 4,
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
    if (t.type === 'DEPOSIT' || t.type === 'BONUS') studentNetDeposits[studentId] += (t.amount_usd || 0);
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

  // Commission uses the MENTOR'S OWN configured rate (e.g. 2% / 5%), not a flat
  // 4%. Mirrors the admin Quarter Closing page (mentor.commission_rate ?? 4) so
  // a mentor's portal shows the same rate the admin assigned them. Falls back to
  // 4% only when no rate is set.
  const commissionRate = parseFloat(currentUser.commission_rate) || 4;
  const grossCommissionUsd = netDepositUsd * (commissionRate / 100);

  // Calculate release (75%) and buffer (25%)
  const release75Usd = grossCommissionUsd * 0.75;
  const buffer25Usd = grossCommissionUsd * 0.25;

  return {
    netDepositUsd,
    rawNetDepositUsd,
    commissionRate,
    grossCommissionUsd,
    release75Usd,
    buffer25Usd
  };
};