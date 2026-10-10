import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { base44 } from '@/api/base44Client';

/* ────────────────────────────────────────────────────────────────────────────
   "Bonus pending" (the user, 2026-10-10; backend/src/students/bonusPending.ts): a student with a bonus not decided
   yet, its amount in USD, and where it waits —
     Needs call + MT5           promised at the sales close, not sent yet: it goes to be credited once a call that
                                connected is logged with their MT5;
     With finance               Delta finance is approving the payment;
     Waiting for broker admin   a broker admin or a Super Admin credits it in MT5 and approves it: finance approved
                                it, or it is a sales-close / course-upgrade bonus credit, or finance doesn't have it.
   Several: their count and total, and the earliest stage (needs a call, then with finance, then the broker admin); the tooltip says
   how many are where. On the Students tables, the student page and the export. Read-only.
──────────────────────────────────────────────────────────────────────────── */

export const BONUS_STAGES = {
  needs_call: { label: 'Needs call + MT5', cls: 'border-rose-200 bg-rose-50 text-rose-800', note: 'Promised at the sales close — it goes to be credited once a call that connected is logged with their MT5' },
  with_finance: { label: 'With finance', cls: 'border-sky-200 bg-sky-50 text-sky-800', note: 'Delta finance is approving the payment' },
  waiting_broker: { label: 'Waiting for broker admin', cls: 'border-amber-200 bg-amber-50 text-amber-800', note: 'A broker admin or a Super Admin credits it in MT5 and approves it' },
};
const STAGE_KEYS = ['needs_call', 'with_finance', 'waiting_broker'];

const usd = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** "1 with finance ($500), 2 waiting for broker admin ($1,000)" */
const breakdown = (b) => STAGE_KEYS
  .filter(k => b?.[k]?.count)
  .map(k => `${b[k].count} ${BONUS_STAGES[k].label.toLowerCase()} (${usd(b[k].total_usd)})`)
  .join(', ');

/** For the export: "$500 · With finance" — several: "2 bonuses · $800 · 1 with finance ($500), 1 waiting for broker admin ($300)". */
export function bonusPendingText(b) {
  if (!b?.count) return '';
  if (b.count === 1) return `${usd(b.total_usd)} · ${(BONUS_STAGES[b.stage] || BONUS_STAGES.waiting_broker).label}`;
  return `${b.count} bonuses · ${usd(b.total_usd)} · ${breakdown(b)}`;
}

/** The badge: "Bonus pending $500 · With finance" — nothing for a student with none. `onClick` makes it a button. */
export function BonusPendingBadge({ info, className = '', onClick }) {
  if (!info?.count) return null;
  const stage = BONUS_STAGES[info.stage] || BONUS_STAGES.waiting_broker;
  let since = '';
  try { since = info.since ? format(new Date(info.since), 'd MMM yyyy') : ''; } catch { since = ''; }
  const title = [
    `${info.count === 1 ? 'A bonus' : `${info.count} bonuses`} not decided yet — ${usd(info.total_usd)}`,
    info.count === 1 ? stage.note : breakdown(info),
    since ? `${info.count === 1 ? 'since' : 'the oldest since'} ${since}` : '',
  ].filter(Boolean).join(' · ');
  const cls = `inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 align-middle text-[11px] font-semibold ${stage.cls} ${className}`;
  const body = (
    <>
      <span>Bonus pending {usd(info.total_usd)}{info.count > 1 ? ` (${info.count})` : ''}</span>
      <span className="font-normal opacity-80">· {stage.label}</span>
    </>
  );
  return onClick
    ? <button type="button" title={title} onClick={onClick} className={`${cls} hover:brightness-95`}>{body}</button>
    : <span title={title} className={cls}>{body}</span>;
}

/** One student's pending bonuses, for their page (getStudentBonusPending) — refreshed with their funding requests. */
export function useStudentBonusPending(studentId, enabled = true) {
  return useQuery({
    queryKey: ['funding-transactions', studentId, 'bonus-pending'],
    queryFn: async () => (await base44.functions.invoke('getStudentBonusPending', { studentId })).data?.bonus_pending ?? null,
    enabled: !!studentId && enabled,
    retry: false,
  });
}
