import { useAuth } from '@/lib/AuthContext';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { PageTitle } from '@/components/common/PageHeader';
import StatsCard from '@/components/dashboard/StatsCard';
import { Button } from '@/components/ui/button';
import { Loader2, Radio, RefreshCw, UserX, Users } from 'lucide-react';
import { NotJoinedClass, useLiveNotJoined } from '@/components/live/LiveNotJoined';

/**
 * Not joined yet (the user, 2026-10-28): today's LMS classes that have started, each with the students who booked and
 * haven't joined — "Live now" while the class runs, "Earlier today" (no-shows) after. Whose: functions/liveNotJoined.ts.
 */
export default function LiveNotJoined() {
  const { user } = useAuth();
  const me = user ? getEffectiveUser(user) : null;
  const q = useLiveNotJoined(me);
  const classes = q.data?.classes || [];
  const live = classes.filter(c => c.live), earlier = classes.filter(c => !c.live).reverse();
  const n = (list) => list.reduce((t, c) => t + c.notJoined.length, 0);
  const showCs = me?.app_role !== 'cs';

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-[1200px] space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <PageTitle eyebrow="Students" icon={UserX}>Not joined yet</PageTitle>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
              Students who booked today's LMS classes and haven't joined. Joined means they came into the LMS room or
              used the join link. It checks every minute; a window comes up when a class starts with someone missing.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} />Refresh
          </Button>
        </div>

        {!q.enabled ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">This page is for CSs, CS Managers, mentors and Super Admins.</p>
        ) : q.isLoading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Checking the classes…</p>
        ) : q.error ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(q.error?.message)) ? 'This needs the server update (the API deploy).' : q.error.message}</p>
        ) : q.data && !q.data.available ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{q.data.message}</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatsCard title="Live classes, someone missing" value={live.length} icon={Radio} color="red" delay={0.02} />
              <StatsCard title="Not joined — live now" value={n(live)} icon={UserX} color="amber" delay={0.06} />
              <StatsCard title="Didn't join — earlier today" value={n(earlier)} icon={Users} color="blue" delay={0.1} />
            </div>

            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-base font-semibold text-brand-navy"><Radio className="h-4 w-4 text-rose-600" />Live now</h2>
              {live.length ? live.map(c => <NotJoinedClass key={c.id} c={c} showCs={showCs} />)
                : <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">No live class with anyone missing right now.</p>}
            </section>

            <section className="space-y-3">
              <h2 className="text-base font-semibold text-brand-navy">Earlier today — booked, never joined</h2>
              {earlier.length ? earlier.map(c => <NotJoinedClass key={c.id} c={c} showCs={showCs} />)
                : <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400">Nobody missed a class today.</p>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
