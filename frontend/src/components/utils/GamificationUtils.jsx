// Gamification utility functions

export const calculateMentorPoints = (mentorId, transactions, settings) => {
  if (!mentorId || !transactions || !settings) {
    return {
      deposit_points: 0,
      student_points: 0,
      total_net_deposit_usd: 0,
      unique_depositing_students: 0
    };
  }

  // Get settings values
  const pointsPer100USD = settings.find(s => s.setting_key === 'points_per_100_usd')?.setting_value || 1;
  const pointsPerStudent = settings.find(s => s.setting_key === 'points_per_student')?.setting_value || 100;
  const minDepositForStudent = settings.find(s => s.setting_key === 'min_deposit_for_student_points')?.setting_value || 500;

  // Filter approved transactions for this mentor
  const mentorTransactions = transactions.filter(t =>
    t.status === 'APPROVED' &&
    (
      (t.initiating_mentor_id && t.initiating_mentor_id === mentorId) ||
      (!t.initiating_mentor_id && t.primary_mentor_id === mentorId)
    )
  );

  // Calculate net deposit
  const deposits = mentorTransactions.filter(t => t.type === 'DEPOSIT' || t.type === 'BONUS')
    .reduce((sum, t) => sum + (t.amount_usd || 0), 0);
  const withdrawals = mentorTransactions.filter(t => t.type === 'WITHDRAWAL')
    .reduce((sum, t) => sum + (t.amount_usd || 0), 0);
  const totalNetDeposit = deposits - withdrawals;

  // Calculate deposit points
  const depositPoints = Math.floor(totalNetDeposit / 100) * pointsPer100USD;

  // Calculate unique depositing students with minimum deposit
  const studentDeposits = {};
  mentorTransactions.forEach(t => {
    if (!studentDeposits[t.student_id]) {
      studentDeposits[t.student_id] = 0;
    }
    if (t.type === 'DEPOSIT' || t.type === 'BONUS') {
      studentDeposits[t.student_id] += t.amount_usd || 0;
    } else if (t.type === 'WITHDRAWAL') {
      studentDeposits[t.student_id] -= t.amount_usd || 0;
    }
  });

  const uniqueStudents = Object.values(studentDeposits).filter(net => net >= minDepositForStudent).length;
  const studentPoints = uniqueStudents * pointsPerStudent;

  return {
    deposit_points: depositPoints,
    student_points: studentPoints,
    total_net_deposit_usd: totalNetDeposit,
    unique_depositing_students: uniqueStudents
  };
};

export const calculateStreakBonus = (currentStreak, settings) => {
  const bonusPerWeek = settings.find(s => s.setting_key === 'streak_bonus_per_week')?.setting_value || 50;
  if (currentStreak >= 4) {
    return currentStreak * bonusPerWeek;
  }
  return 0;
};

export const awardBadges = (mentorStats) => {
  const badges = [];
  const { total_net_deposit_usd, unique_depositing_students, current_streak_weeks } = mentorStats;

  // Deposit milestone badges
  if (total_net_deposit_usd >= 250000) badges.push('deposit_250k');
  else if (total_net_deposit_usd >= 100000) badges.push('deposit_100k');
  else if (total_net_deposit_usd >= 50000) badges.push('deposit_50k');
  else if (total_net_deposit_usd >= 10000) badges.push('deposit_10k');
  else if (total_net_deposit_usd > 0) badges.push('first_deposit');

  // Student count badges
  if (unique_depositing_students >= 25) badges.push('student_25');
  else if (unique_depositing_students >= 10) badges.push('student_10');
  else if (unique_depositing_students >= 5) badges.push('student_5');

  // Streak badges
  if (current_streak_weeks >= 12) badges.push('streak_12');
  else if (current_streak_weeks >= 8) badges.push('streak_8');
  else if (current_streak_weeks >= 4) badges.push('streak_4');

  return badges;
};

export const calculateWeeklyStreak = (mentorId, transactions) => {
  if (!transactions || transactions.length === 0) return { current: 0, longest: 0 };

  const mentorTxns = transactions.filter(t => 
    t.status === 'APPROVED' && 
    t.primary_mentor_id === mentorId &&
    t.requested_at
  ).sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at));

  if (mentorTxns.length === 0) return { current: 0, longest: 0 };

  // Group by week
  const weeklyActivity = {};
  mentorTxns.forEach(t => {
    const date = new Date(t.requested_at);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const weekKey = weekStart.toISOString().split('T')[0];
    weeklyActivity[weekKey] = true;
  });

  const weeks = Object.keys(weeklyActivity).sort().reverse();
  
  // Calculate current streak
  let currentStreak = 0;
  const today = new Date();
  const currentWeekStart = new Date(today);
  currentWeekStart.setDate(today.getDate() - today.getDay());
  
  let checkDate = new Date(currentWeekStart);
  while (true) {
    const weekKey = checkDate.toISOString().split('T')[0];
    if (weeklyActivity[weekKey]) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 7);
    } else {
      break;
    }
  }

  // Calculate longest streak
  let longestStreak = 0;
  let tempStreak = 1;
  for (let i = 1; i < weeks.length; i++) {
    const prevWeek = new Date(weeks[i-1]);
    const currWeek = new Date(weeks[i]);
    const daysDiff = Math.floor((prevWeek - currWeek) / (1000 * 60 * 60 * 24));
    
    if (daysDiff === 7) {
      tempStreak++;
    } else {
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 1;
    }
  }
  longestStreak = Math.max(longestStreak, tempStreak);

  return { current: currentStreak, longest: longestStreak };
};

export const getDefaultSettings = () => [
  { setting_key: 'points_per_100_usd', setting_value: 1, description: 'Points awarded per $100 USD net deposit' },
  { setting_key: 'points_per_student', setting_value: 100, description: 'Points per unique depositing student' },
  { setting_key: 'min_deposit_for_student_points', setting_value: 500, description: 'Minimum deposit (USD) for student to count towards points' },
  { setting_key: 'streak_bonus_per_week', setting_value: 50, description: 'Bonus points per week in a streak (4+ weeks)' }
];