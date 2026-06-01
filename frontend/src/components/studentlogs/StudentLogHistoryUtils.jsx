// Maps field names to their tab/section
export const FIELD_TAB_MAP = {
  // Contact
  followup_priority: 'Contact',
  active_in_classes: 'Contact',
  not_attending_reason: 'Contact',
  last_contact_date: 'Contact',
  last_contact_person: 'Contact',
  contact_history: 'Contact',
  preferred_contact_mode: 'Contact',

  // Basic Info
  email: 'Basic Info',
  phone_number: 'Basic Info',
  home_country_contact: 'Basic Info',
  emergency_contact: 'Basic Info',
  nationality: 'Basic Info',
  gender: 'Basic Info',
  dob: 'Basic Info',
  occupation: 'Basic Info',
  permanent_address: 'Basic Info',
  residency_address: 'Basic Info',
  passport_number: 'Basic Info',
  emirates_id: 'Basic Info',
  photo_url: 'Basic Info',
  passport_copy_url: 'Basic Info',
  date_of_joining: 'Basic Info',
  month_of_joining: 'Basic Info',
  course_enrolled: 'Basic Info',
  preferred_language: 'Basic Info',
  academic_counselors: 'Basic Info',
  mode_of_study: 'Basic Info',
  country_of_attendance: 'Basic Info',
  joined_dollar_club: 'Basic Info',

  // Payment
  course_amount: 'Payment',
  payment_status: 'Payment',
  payment_mode: 'Payment',
  payment_date: 'Payment',
  payment_due: 'Payment',
  discount: 'Payment',
  payment_history: 'Payment',
  amount_collected_by: 'Payment',

  // Induction
  induction_status: 'Induction',
  induction_done_by: 'Induction',
  onboarding_document_status: 'Induction',
  community_status: 'Induction',
  current_class_status: 'Induction',
  last_attended_class: 'Induction',

  // Academic
  exam_date: 'Academic',
  exam_status: 'Academic',
  exam_not_attended_reason: 'Academic',
  exam_valuation_date: 'Academic',
  exam_evaluator: 'Academic',
  exam_marks: 'Academic',
  exam_result: 'Academic',
  failed_assigned_mentor: 'Academic',
  failure_reason: 'Academic',

  // Upgrade
  upgrade_response: 'Upgrade',
  upgrade_not_interested_reason: 'Upgrade',
  course_to_upgrade: 'Upgrade',
  upgrade_date: 'Upgrade',
  upgrade_month: 'Upgrade',

  // Convocation
  convocation_status: 'Convocation',
  certificate_status: 'Convocation',
  convocation_month: 'Convocation',

  // Traders Day
  invited_traders_dayout: 'Traders Day',
  traders_dayout_invite_reason: 'Traders Day',
  traders_dayout_outcome: 'Traders Day',

  // Live Trade
  trading_journal_management: 'Live Trade',
  trading_journal_link: 'Live Trade',
  live_trades_attended_count: 'Live Trade',
  last_attended_live_trade: 'Live Trade',

  // Trading
  trading_status: 'Trading',
  current_broker: 'Trading',
  assets_traded: 'Trading',
  current_profit_loss: 'Trading',
  potential_to_deposit: 'Trading',
  easy_to_convince: 'Trading',
  total_loss_from_trading: 'Trading',

  // Rejoining
  rejoining_response: 'Rejoining',
  rejoining_date: 'Rejoining',
  rejoining_measures: 'Rejoining',
  rejoined_class: 'Rejoining',
  rejoining_sales_person: 'Rejoining',
  rejoinees_feedback: 'Rejoining',

  // Seminar
  seminars_attended_count: 'Seminar',
  online_seminars_list: 'Seminar',
  offline_seminars_list: 'Seminar',
  seminars_not_attended_reason: 'Seminar',

  // Practice Tracking
  mentor_assigned: 'Practice Tracking',
  attended_senior_mentor_class: 'Practice Tracking',
  discussion_with_senior_mentor: 'Practice Tracking',
  practice_sessions_attended: 'Practice Tracking',

  // Feedback & Review
  feedback: 'Feedback & Review',
  testimonial_done: 'Feedback & Review',
  google_review: 'Feedback & Review',

  // Pips Craft
  subscribed_for_pipscraft: 'Pips Craft',
  pipscraft_subscription_date: 'Pips Craft',
  still_using_pipscraft: 'Pips Craft',
  pipscraft_satisfaction: 'Pips Craft',
  pipscraft_not_satisfied_reason: 'Pips Craft',
  pipscraft_subscribed_agent: 'Pips Craft',
};

const SKIP_FIELDS = ['id', 'created_date', 'updated_date', 'created_by', 'student_id', 'student_code', 'student_name'];

export function detectChanges(oldData, newData) {
  const changes = [];
  const allKeys = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);

  allKeys.forEach(key => {
    if (SKIP_FIELDS.includes(key)) return;
    const oldVal = oldData?.[key];
    const newVal = newData?.[key];
    if (String(oldVal ?? '') !== String(newVal ?? '')) {
      changes.push({ field: key, oldValue: oldVal ?? '', newValue: newVal ?? '' });
    }
  });

  return changes;
}

export function getTabsFromChanges(changes) {
  const tabs = new Set(changes.map(c => FIELD_TAB_MAP[c.field] || 'Other'));
  return Array.from(tabs).join(', ');
}

export const TAB_COLORS = {
  'Contact': 'bg-blue-100 text-blue-800',
  'Basic Info': 'bg-purple-100 text-purple-800',
  'Payment': 'bg-green-100 text-green-800',
  'Induction': 'bg-yellow-100 text-yellow-800',
  'Academic': 'bg-indigo-100 text-indigo-800',
  'Upgrade': 'bg-orange-100 text-orange-800',
  'Convocation': 'bg-pink-100 text-pink-800',
  'Traders Day': 'bg-teal-100 text-teal-800',
  'Live Trade': 'bg-cyan-100 text-cyan-800',
  'SSF': 'bg-red-100 text-red-800',
  'Trading': 'bg-orange-100 text-orange-800',
  'Rejoining': 'bg-amber-100 text-amber-800',
  'Seminar': 'bg-lime-100 text-lime-800',
  'Practice Tracking': 'bg-violet-100 text-violet-800',
  'Feedback & Review': 'bg-rose-100 text-rose-800',
  'Pips Craft': 'bg-emerald-100 text-emerald-800',
  'Other': 'bg-gray-100 text-gray-800',
};