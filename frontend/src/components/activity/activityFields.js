// Field definitions for the daily Activity Tracker, mirroring the team sheet.
// Two categories with different fields: 'mentor' and 'pa' (PA / CSE).
//
// Each field: { key, label, type }  type ∈ 'number' | 'money' | 'text' | 'yn'
// The `key` is what we store on the ActivityLog document.

// Which category a role logs under. Assistance / PA / CSE roles use the PA
// tracker; every other staff role (mentors, custom) uses the Mentor tracker.
export function activityCategory(appRole) {
  const r = String(appRole || '').toLowerCase();
  if (r.includes('assistance') || r.includes('pa') || r.includes('cse')) return 'pa';
  return 'mentor';
}

export const MENTOR_FIELDS = [
  { key: 'classes_taken', label: 'Classes Taken', type: 'number' },
  { key: 'pipscrapt_trades', label: 'Pipscrapt Trades', type: 'number' },
  { key: 'sales_meetings', label: 'Sales Meetings', type: 'number' },
  { key: 'programs_conducted', label: 'Programs Conducted', type: 'number' },
  { key: 'community_posts', label: 'Community Posts', type: 'number' },
  { key: 'account_openings', label: 'Account Openings', type: 'number' },
  { key: 'students_screened', label: 'New Students Screened', type: 'number' },
  { key: 'meetings_deposit_course', label: 'Meetings Done (Deposit / Course)', type: 'number' },
  { key: 'meetings_scheduled_cm_sm', label: 'Meetings Scheduled to CM/SM', type: 'number' },
  { key: 'followups_done', label: 'Follow-Ups Done', type: 'number' },
  { key: 'deposit_usd', label: 'Deposit (USD)', type: 'money' },
  { key: 'dslp_closings', label: 'DSLP Closings', type: 'number' },
  { key: 'dqmp_closings', label: 'DQMP Closings', type: 'number' },
  { key: 'dgmp_closings', label: 'DGMP Closings', type: 'number' },
  { key: 'mmv2_closings', label: 'MM V2 Closings', type: 'number' },
  { key: 'losses_reported_usd', label: 'Losses Reported by Student (USD)', type: 'money' },
  { key: 'scam_cases', label: 'Scam Cases Identified', type: 'number' },
  { key: 'student_notes', label: 'Student Occupation / Background Notes', type: 'text' },
  { key: 'meeting_remarks', label: 'Meeting Remarks After Meeting', type: 'text' },
  { key: 'learned_today', label: 'What Did You Learn Today?', type: 'text' },
  { key: 'daily_summary', label: 'Daily Summary (late to office / notes)', type: 'text' },
  { key: 'late_to_office', label: 'Late To Office?', type: 'yn' },
  { key: 'daily_score', label: 'Daily Performance Score', type: 'number' },
];

export const PA_FIELDS = [
  { key: 'calls_done', label: 'Calls Done', type: 'number' },
  { key: 'calls_connected', label: 'Calls Connected', type: 'number' },
  { key: 'calls_not_connected', label: 'Calls Not Connected', type: 'number' },
  { key: 'whatsapp_followup', label: 'WhatsApp Follow-Ups', type: 'number' },
  { key: 'meetings_scheduled', label: 'Meetings Scheduled (Coming Days)', type: 'number' },
  { key: 'meetings_done', label: 'Total Meetings Done Today', type: 'number' },
  { key: 'deposit_usd', label: 'Deposit (USD)', type: 'money' },
  { key: 'expected_deposit_usd', label: 'Expected Deposit Tomorrow (USD)', type: 'money' },
  { key: 'account_openings', label: 'Account Openings', type: 'number' },
  { key: 'dslp_closings', label: 'DSLP Closings ($5k ea.)', type: 'number' },
  { key: 'dqmp_closings', label: 'DQMP Closings ($10k ea.)', type: 'number' },
  { key: 'dgmp_closings', label: 'DGMP Closings ($25k ea.)', type: 'number' },
  { key: 'mmv2_closings', label: 'MM V2 Closings ($1.5k ea.)', type: 'number' },
  { key: 'course_value_usd', label: 'Course Value Closed (USD)', type: 'money' },
  { key: 'mm_meetings_scheduled', label: 'MM · Meetings Scheduled', type: 'number' },
  { key: 'mm_meetings_done', label: 'MM · Meeting Done Today', type: 'number' },
  { key: 'mm_redeposit_today', label: "MM · Today's Re-Deposit (USD)", type: 'money' },
  { key: 'mm_master_enrollments', label: 'MM · Master Course Enrollments', type: 'number' },
  { key: 'mm_total_redeposit', label: 'MM · Total Re-Deposit (USD)', type: 'money' },
  { key: 'pipeline', label: 'Pipeline', type: 'text' },
  { key: 'extra_notes', label: 'Extra Notes', type: 'text' },
  { key: 'learned_today', label: 'What Did You Learn Today?', type: 'text' },
  { key: 'daily_summary', label: 'Daily Summary (late to office / notes)', type: 'text' },
  { key: 'late_to_office', label: 'Late To Office?', type: 'yn' },
  { key: 'daily_score', label: 'Daily Performance Score', type: 'number' },
];

export const FIELDS_BY_CATEGORY = { mentor: MENTOR_FIELDS, pa: PA_FIELDS };

// Connection Rate % is derived, not entered (PA only).
export const connectionRate = (row) => {
  const done = Number(row?.calls_done) || 0;
  const conn = Number(row?.calls_connected) || 0;
  return done > 0 ? (conn / done) * 100 : 0;
};

// The few columns each category shows in the compact list (before the drill-in).
export const MENTOR_SUMMARY_KEYS = ['classes_taken', 'sales_meetings', 'students_screened', 'meetings_deposit_course', 'followups_done', 'deposit_usd', 'daily_score'];
export const PA_SUMMARY_KEYS = ['calls_done', 'calls_connected', 'whatsapp_followup', 'meetings_done', 'deposit_usd', 'daily_score'];

export const isNumeric = (t) => t === 'number' || t === 'money';

// Daily Performance Score — auto-calculated from the entered fields, using the
// weights from the team sheet. Mentor formula (verified against the sheet):
//   Classes×5 + Pipscrapt×2 + SalesMtgs×5 + Programs×10 + CommunityPosts×1
//   + AccountOpenings×15 + Screened×2 + Meetings(Deposit/Course)×5 + FollowUps×1
const MENTOR_SCORE_WEIGHTS = {
  classes_taken: 5, pipscrapt_trades: 2, sales_meetings: 5, programs_conducted: 10,
  community_posts: 1, account_openings: 15, students_screened: 2,
  meetings_deposit_course: 5, followups_done: 1,
};
// PA / CSE formula — set the weights here once confirmed. null = entered manually.
const PA_SCORE_WEIGHTS = null;

export const SCORE_WEIGHTS = { mentor: MENTOR_SCORE_WEIGHTS, pa: PA_SCORE_WEIGHTS };

// Returns the computed score for a row, or null when the category has no formula
// yet (then the score stays a manual field).
export function computeDailyScore(category, row) {
  const weights = SCORE_WEIGHTS[category];
  if (!weights) return null;
  return Object.entries(weights).reduce((sum, [k, w]) => sum + (Number(row?.[k]) || 0) * w, 0);
}
