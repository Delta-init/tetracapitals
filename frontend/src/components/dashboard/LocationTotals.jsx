import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Award, DollarSign, GraduationCap, MapPin } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Skeleton } from '@/components/ui/skeleton';
import { EASE } from '@/components/motion';
import { useUrlState } from '@/components/utils/urlState';

/* ────────────────────────────────────────────────────────────────────────────
   The Super Admin's dashboard figures (the user, 2026-10-10): Total Deposits,
   Course Upgrade Revenue and Total Commission for a period, each in all and
   for Dubai and Bangalore side by side — added up by the server
   (functions/dashboardTotals.ts). The period is kept in the address.
──────────────────────────────────────────────────────────────────────────── */

const PERIODS = [
  { value: 'month', label: 'This month' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];
const usd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const aed = (n) => `AED ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ACCENT = {
  emerald: { chip: 'bg-emerald-50 text-emerald-600 ring-emerald-100', bar: 'from-emerald-400 to-brand-mint' },
  violet: { chip: 'bg-violet-50 text-violet-600 ring-violet-100', bar: 'from-violet-500 to-fuchsia-400' },
  cyan: { chip: 'bg-cyan-50 text-cyan-700 ring-cyan-100', bar: 'from-brand-cyan to-brand-mint' },
};

/** One figure: the total, then Dubai and Bangalore, each with an optional line under it. */
function LocationCard({ title, icon: Icon, color, total, dubai, bangalore, fmt, sub, delay }) {
  const a = ACCENT[color];
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE, delay }}
      className="relative h-full overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-5 shadow-soft sm:p-6"
    >
      <span className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${a.bar}`} />
      <div className="flex items-start justify-between gap-4">
        <p className="text-[13px] font-medium text-slate-500">{title}</p>
        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${a.chip}`}><Icon className="h-5 w-5" /></span>
      </div>
      <p className="mt-3 break-words text-[1.75rem] font-bold leading-tight tracking-tight text-brand-navy sm:text-3xl">{fmt(total)}</p>
      {sub?.total && <p className="mt-1.5 text-xs text-slate-500">{sub.total}</p>}
      <div className="mt-5 grid grid-cols-2 gap-3">
        {[['Dubai', dubai, sub?.dubai], ['Bangalore', bangalore, sub?.bangalore]].map(([name, v, line]) => (
          <div key={name} className="min-w-0 rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><MapPin className="h-3 w-3" />{name}</p>
            <p className="mt-1 break-words text-base font-semibold text-slate-900">{fmt(v)}</p>
            {line && <p className="text-[11px] text-slate-500">{line}</p>}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export default function LocationTotals() {
  const [period, setPeriod] = useUrlState('period', 'month');
  const q = useQuery({
    queryKey: ['dashboard-totals', period],
    queryFn: async () => (await base44.functions.invoke('getDashboardTotals', { period })).data,
    retry: false,
  });
  const d = q.data;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-brand-navy">Dubai &amp; Bangalore</h2>
        <div className="flex rounded-md border bg-white p-0.5 text-xs" role="group" aria-label="Period">
          {PERIODS.map(p => (
            <button key={p.value} type="button" onClick={() => setPeriod(p.value)}
              className={`rounded px-2.5 py-1.5 font-medium ${period === p.value ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{p.label}</button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 lg:gap-6">{[0, 1, 2].map(i => <Skeleton key={i} className="h-52 rounded-2xl" />)}</div>
      ) : q.isError || !d ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {/not found|unknown function|404/i.test(String(q.error?.message)) ? 'These figures need the server update (the API deploy).' : (q.error?.message || "The figures couldn't be loaded.")}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 lg:gap-6">
            <LocationCard
              title="Total Deposits" icon={DollarSign} color="emerald" fmt={usd} delay={0.1}
              total={d.deposits.total} dubai={d.deposits.dubai} bangalore={d.deposits.bangalore}
              sub={{
                total: `${d.deposits.count.toLocaleString()} approved · withdrawals ${usd(d.deposits.withdrawals.total)} · net ${usd(d.deposits.net.total)}`,
                dubai: `net ${usd(d.deposits.net.dubai)}`,
                bangalore: `net ${usd(d.deposits.net.bangalore)}`,
              }}
            />
            <LocationCard
              title="Course Upgrade Revenue" icon={GraduationCap} color="violet" fmt={aed} delay={0.17}
              total={d.course.aed.total} dubai={d.course.aed.dubai} bangalore={d.course.aed.bangalore}
              sub={{
                total: `${usd(d.course.usd.total)} · ${d.course.count.toLocaleString()} payment${d.course.count === 1 ? '' : 's'} approved`,
                dubai: usd(d.course.usd.dubai),
                bangalore: usd(d.course.usd.bangalore),
              }}
            />
            <LocationCard
              title="Total Commission" icon={Award} color="cyan" fmt={usd} delay={0.24}
              total={d.commission.total} dubai={d.commission.dubai} bangalore={d.commission.bangalore}
              sub={{ total: 'Deposit and bonus commission, by the team of the person paid' }}
            />
          </div>
          {!d.bangalore_teams && (
            <p className="text-xs text-slate-500">No team is tagged Bangalore yet — tag them in Teams → Edit team, and their figures show under Bangalore.</p>
          )}
        </>
      )}
    </section>
  );
}
