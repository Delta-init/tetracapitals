/* Where a client stands after a meeting — the mentor's outcome (backend students/meetingOutcomes.ts). */
export const STAGE_LABEL = {
  interested: 'Interested',
  follow_up: 'Follow-up',
  meeting_with: 'Meeting with mentor',
  revision: 'Revision',
  not_interested: 'Not interested',
};
export const FOLLOW_UP_LABEL = { cse_follow_up: 'CSE follow-up', revision_needed: 'Revision needed' };
export const EXPERIENCE_LABEL = { fresher: 'Fresher', beginner: 'Beginner', expert: 'Expert' };
export const LOSS_WAY_LABEL = { scammed: 'Scammed by someone', self_trading: 'Self trading', money_management: 'Given for money management' };

const TONE = {
  interested: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  follow_up: 'bg-amber-50 text-amber-800 border-amber-200',
  meeting_with: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  revision: 'bg-sky-50 text-sky-700 border-sky-200',
  not_interested: 'bg-slate-100 text-slate-600 border-slate-200',
};

/** The stage as a small badge; the summary (course, dates, mentor) on hover. Nothing for none. */
export function MeetingStageBadge({ stage, summary, className = '' }) {
  if (!stage) return null;
  return (
    <span title={summary || undefined} className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[stage] ?? TONE.not_interested} ${className}`}>
      {STAGE_LABEL[stage] ?? stage}
    </span>
  );
}
