import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { localFromAed } from '@/components/utils/displayCurrency';
import { createPageUrl } from '@/utils';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   On a mentor's / Chief's Dashboard (the user, 2026-11-09): the team's course
   payments this month — the totals, then each person on the team (collected,
   waiting approval, still to collect); a row opens that person's payments.
   The figures are getCourseCommissionSummary's `members` (the same query as
   the "Team collected this month" card).
──────────────────────────────────────────────────────────────────────────── */

const ROLE = {
  cs: 'CS', cs_manager: 'CS Manager', chief_mentor: 'Chief Mentor', senior_mentor: 'Senior Mentor',
  junior_mentor: 'Junior Mentor', sub_junior_mentor: 'Sub-junior Mentor',
};
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Dubai' }) : '—');

function Total({ title, value, hint, tone }) {
  return (
    <div className={cn('rounded-2xl border p-4', tone)}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <p className="tabular mt-1 text-xl font-bold text-brand-navy">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default function TeamCollectedPanel({ data, loading }) {
  const [open, setOpen] = useState(null);
  const members = data?.members;
  if (loading || !Array.isArray(members) || members.length === 0) return null;
  const c = data.collected || {};
  const tc = data.to_collect || {};
  const best = Math.max(...members.map((m) => m.collected_aed), 0);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-slate-100">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-brand-navy"><Users className="h-4 w-4" />Team stats · this month</CardTitle>
          <p className="mt-1 text-xs text-slate-500">Course payments by everyone on your team — open a person to see theirs</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{members.length} people</span>
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Total title="Team collected" value={localFromAed(c.course_payments_aed)} hint={`${c.count ?? 0} course payments`} tone="border-emerald-200 bg-emerald-50/60" />
          <Total title="Waiting approval" value={localFromAed(c.pending_aed)} hint={`${c.pending_count ?? 0} requests`} tone="border-amber-200 bg-amber-50/60" />
          <Total title="Still to collect" value={localFromAed(tc.aed)} hint={`${tc.students ?? 0} students with a balance`} tone="border-sky-200 bg-sky-50/60" />
          <Total title="Collecting" value={`${members.filter((m) => m.count > 0).length} of ${members.length}`} hint="people with a payment this month" tone="border-slate-200 bg-white" />
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-sm">
            <thead className="bg-slate-50/80">
              <tr>
                {['Person', 'Collected', 'Payments', 'Waiting approval', 'Still to collect'].map((h, i) => (
                  <th key={h} className={cn('whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500', i ? 'text-right' : 'text-left')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => {
                const isOpen = open === m.id;
                const has = m.payments?.length > 0;
                return (
                  <Fragment key={m.id}>
                    <tr className={cn('transition-colors', has && 'cursor-pointer hover:bg-brand-cyan/[0.04]')} onClick={() => has && setOpen(isOpen ? null : m.id)}>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2">
                          {has ? (isOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />) : <span className="w-4" />}
                          <div>
                            <p className="font-semibold text-brand-navy">{m.name}</p>
                            <p className="text-[11px] text-slate-500">{ROLE[m.role] || m.role}</p>
                          </div>
                        </div>
                        {best > 0 && m.collected_aed > 0 && (
                          <div className="ml-6 mt-1.5 h-1 w-32 rounded-full bg-slate-100">
                            <div className="h-1 rounded-full bg-emerald-400" style={{ width: `${Math.max(4, (m.collected_aed / best) * 100)}%` }} />
                          </div>
                        )}
                      </td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-right font-semibold text-emerald-700">{localFromAed(m.collected_aed)}</td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-right text-slate-700">{m.count}</td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-right text-amber-700">{m.pending_count ? `${localFromAed(m.pending_aed)} · ${m.pending_count}` : '—'}</td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-right text-sky-700">{m.to_collect_aed ? `${localFromAed(m.to_collect_aed)} · ${m.to_collect_students} st.` : '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="ml-6 space-y-1.5">
                            {m.payments.map((p) => (
                              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-100">
                                <div className="flex items-center gap-2">
                                  <Link to={`${createPageUrl('StudentDetail')}?id=${p.student_id}`} className="font-semibold text-brand-navy hover:underline" onClick={(e) => e.stopPropagation()}>
                                    {p.student_name || 'Student'}
                                  </Link>
                                  {p.product && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{p.product}</span>}
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-slate-500">{day(p.at)}</span>
                                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', p.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                                    {p.status === 'APPROVED' ? 'Approved' : 'Waiting approval'}
                                  </span>
                                  <span className="tabular font-semibold text-brand-navy">{localFromAed(p.aed)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
