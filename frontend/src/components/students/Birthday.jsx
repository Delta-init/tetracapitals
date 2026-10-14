import { Cake } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   A student's birthday (the user, 2026-10-14) — the date of birth they gave on
   their LMS application, saved by the hourly LMS check (backend
   students/lmsEnrolment.ts, birth_date YYYY-MM-DD). "25 Feb (36)" on their row
   and page; on the day itself, a "Birthday today" badge. Dubai days.
──────────────────────────────────────────────────────────────────────────── */

const dubaiToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });

/** { label: "25 Feb", age, today } — null when there's no date. */
export function birthdayOf(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
  const [y, m, d] = date.split('-').map(Number);
  const today = dubaiToday();
  const [ty, tm, td] = today.split('-').map(Number);
  const age = ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  const label = new Date(Date.UTC(2000, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return { label, age, today: today.slice(5) === date.slice(5) };
}

/** For the Excel export: "25 Feb 1990". */
export const birthdayText = (date) => {
  const b = birthdayOf(date);
  return b ? `${b.label} ${date.slice(0, 4)}` : '';
};

/** "25 Feb (36)" — or, on the day, the "Birthday today" badge. Nothing without a date. */
export function BirthdayTag({ date, className = '' }) {
  const b = birthdayOf(date);
  if (!b) return null;
  if (b.today) {
    return (
      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-pink-200 bg-pink-50 px-2 py-0.5 align-middle text-[11px] font-semibold text-pink-700 ${className}`} title={`Born ${birthdayText(date)}`}>
        <Cake className="h-3 w-3" /> Birthday today · {b.age}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-slate-500 ${className}`} title={`Born ${birthdayText(date)}`}>
      <Cake className="h-3 w-3 text-slate-400" /> {b.label} ({b.age})
    </span>
  );
}
