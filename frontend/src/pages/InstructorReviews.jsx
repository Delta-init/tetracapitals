import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Award, ChevronDown, Loader2, Star, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   Instructor Reviews (the user, 2026-10-22) — the LMS's: students' ratings
   after each class, highest first; a row opens that instructor's reviews.
   "My team" to start (the mentors of their own team), "Everyone" at a switch
   (backend functions/instructorReviews.ts).
──────────────────────────────────────────────────────────────────────────── */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const MEDAL = ['text-amber-500', 'text-slate-400', 'text-orange-500'];
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '');

function Stars({ value }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => <Star key={i} className={cn('h-4 w-4', value >= i - 0.25 ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />)}
    </span>
  );
}

export default function InstructorReviews() {
  const [scope, setScope] = useState('team');
  const [open, setOpen] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['instructor-reviews', scope], retry: false,
    queryFn: () => fn('getInstructorReviews', { scope }),
  });
  const rows = data?.rows ?? [];
  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <PageTitle eyebrow="Overview" icon={Award}>Instructor Reviews</PageTitle>
            <p className="mt-2 text-sm text-slate-500">Students' ratings after each class in the LMS, highest first. Open a row to read the reviews.</p>
          </div>
          {data?.team && (
            <div className="flex rounded-full border border-slate-200 bg-white p-0.5">
              {[['team', 'My team'], ['all', 'Everyone']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => { setScope(k); setOpen(null); }}
                  className={cn('rounded-full px-3 py-1.5 text-sm font-medium', scope === k ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>
              ))}
            </div>
          )}
        </div>

        {error ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(error?.message)) ? 'This page needs the server update (the API deploy).' : error.message}</p>
        ) : (
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Rank</th>
                      <th className="px-4 py-3 font-semibold">Instructor</th>
                      <th className="px-4 py-3 font-semibold">Rating</th>
                      <th className="px-4 py-3 font-semibold">Breakdown</th>
                      <th className="px-4 py-3 text-right font-semibold">Reviews</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {isLoading && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
                    {!isLoading && !rows.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">{scope === 'team' ? "No reviews for your team's mentors yet — try Everyone." : 'No reviews yet.'}</td></tr>}
                    {rows.map((r, i) => {
                      const max = Math.max(1, ...Object.values(r.ratingCounts || {}));
                      const isOpen = open === r.instructorId;
                      return (
                        <Fragment key={r.instructorId}>
                          <tr className={cn('cursor-pointer hover:bg-slate-50', isOpen && 'bg-slate-50')} onClick={() => setOpen(isOpen ? null : r.instructorId)}>
                            <td className="px-4 py-3">{i < 3 ? <Trophy className={cn('h-5 w-5', MEDAL[i])} /> : <span className="text-slate-500">{i + 1}</span>}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2.5">
                                {r.avatarUrl ? <img src={r.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">{String(r.name || '?').slice(0, 1)}</div>}
                                <span className="font-medium text-slate-900">{r.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3"><span className="inline-flex items-center gap-2"><Stars value={r.avgRating} /><span className="font-semibold text-slate-800">{Number(r.avgRating || 0).toFixed(1)}</span></span>
                              {r.lowRatingCount > 0 && <div className="text-xs text-rose-600">{r.lowRatingCount} low (1–2★)</div>}</td>
                            <td className="px-4 py-3">
                              <div className="space-y-0.5">
                                {[5, 4, 3, 2, 1].map(k => (
                                  <div key={k} className="flex items-center gap-1.5 text-[10px] text-slate-400">
                                    <span className="w-2">{k}</span>
                                    <span className="h-1.5 w-28 overflow-hidden rounded bg-slate-100"><span className={cn('block h-full rounded', k >= 4 ? 'bg-emerald-500' : k === 3 ? 'bg-amber-400' : 'bg-rose-500')} style={{ width: `${((r.ratingCounts?.[k] || 0) / max) * 100}%` }} /></span>
                                    <span>{r.ratingCounts?.[k] || 0}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right text-slate-600"><span className="inline-flex items-center gap-1">{r.totalReviews} review{r.totalReviews === 1 ? '' : 's'}<ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} /></span></td>
                          </tr>
                          {isOpen && <tr><td colSpan={5} className="bg-slate-50 px-4 pb-4"><ReviewList instructorId={r.instructorId} /></td></tr>}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function ReviewList({ instructorId }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['instructor-review-list', instructorId], retry: false,
    queryFn: () => fn('getInstructorReviewList', { instructorId }),
  });
  if (isLoading) return <div className="flex items-center gap-2 py-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;
  if (error) return <p className="py-3 text-sm text-red-600">{error.message}</p>;
  const reviews = data?.reviews ?? [];
  if (!reviews.length) return <p className="py-3 text-sm text-slate-500">No reviews.</p>;
  return (
    <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
      {reviews.map(v => (
        <div key={v._id || v.id} className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Stars value={v.rating} />
            <span className="font-medium text-slate-800">{v.studentId?.name || 'A student'}</span>
            {v.liveClassId?.title && <span className="text-xs text-slate-500">· {v.liveClassId.title}</span>}
            <span className="ml-auto text-xs text-slate-400">{when(v.createdAt)}</span>
          </div>
          {v.comment && <p className="mt-1 text-sm text-slate-700">{v.comment}</p>}
        </div>
      ))}
      {data?.total > reviews.length && <p className="px-3 py-2 text-xs text-slate-400">Showing the latest {reviews.length} of {data.total}.</p>}
    </div>
  );
}
