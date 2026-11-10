import { Fragment, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Award, ChevronDown, ChevronLeft, ChevronRight, Download, Loader2, MessageSquareQuote, Search, Star, Trophy, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';

/* ────────────────────────────────────────────────────────────────────────────
   Instructor Reviews (the user, 2026-10-22) — the LMS's: students' ratings
   after each class. "My team" to start (the mentors of their own team),
   "Everyone" at a switch (backend functions/instructorReviews.ts).
   2026-11-10 ("full review with filter … they can see their review and others
   review also"): open to Senior / Junior / Sub-junior Mentors too, and two tabs —
     Leaderboard   the ranking (mentor ratings), in the days and programme picked;
                   a row opens that mentor's reviews;
     All reviews   every review, newest first — mentor ratings and class
                   feedback — by mentor, stars, days, programme, kind, with
                   words only, a search; "My reviews"; the totals of what
                   matches; export.
──────────────────────────────────────────────────────────────────────────── */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const MEDAL = ['text-amber-500', 'text-slate-400', 'text-orange-500'];
const MENTORS = ['chief_mentor', 'senior_mentor', 'junior_mentor', 'subjunior_mentor'];
const PROGRAMS = [['4x-trading', 'Forex'], ['digital-marketing', 'Digital Marketing'], ['ai', 'AI'], ['jura', 'JURA'], ['cma', 'CMA']];
const PROGRAM_LABEL = Object.fromEntries(PROGRAMS);
const KIND = { mentor_rating: 'Mentor rating', class_feedback: 'Class feedback' };
const selectCls = 'h-9 rounded-md border border-slate-200 bg-white px-2 text-sm';
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '');
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' }) : '');
const errText = (e) => (/unknown function|not found|404/i.test(String(e?.message)) ? 'This needs the server update (the API deploy).' : e?.message || 'Could not load the reviews');

function Stars({ value, size = 'h-4 w-4' }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => <Star key={i} className={cn(size, value >= i - 0.25 ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />)}
    </span>
  );
}
function Bars({ counts, width = 'w-28' }) {
  const max = Math.max(1, ...Object.values(counts || {}));
  return (
    <div className="space-y-0.5">
      {[5, 4, 3, 2, 1].map(k => (
        <div key={k} className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <span className="w-2">{k}</span>
          <span className={cn('h-1.5 overflow-hidden rounded bg-slate-100', width)}><span className={cn('block h-full rounded', k >= 4 ? 'bg-emerald-500' : k === 3 ? 'bg-amber-400' : 'bg-rose-500')} style={{ width: `${((counts?.[k] || 0) / max) * 100}%` }} /></span>
          <span>{counts?.[k] || 0}</span>
        </div>
      ))}
    </div>
  );
}

export default function InstructorReviews() {
  const { data: me } = useQuery({ queryKey: ['me', 'effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()), staleTime: 5 * 60_000 });
  const isMentor = MENTORS.includes(me?.app_role);
  const [tab, setTab] = useState('leaderboard');
  const [scope, setScope] = useState('team');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [program, setProgram] = useState('');
  const shared = { from, to, program };
  const board = useQuery({
    queryKey: ['instructor-reviews', scope, from, to, program], retry: false,
    queryFn: () => fn('getInstructorReviews', { scope, ...shared }),
  });
  const wrongWay = from && to && from > to;

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <PageTitle eyebrow="Overview" icon={Award}>Instructor Reviews</PageTitle>
            <p className="mt-2 text-sm text-slate-500">Students' ratings after each class in the LMS — yours and every other mentor's.</p>
          </div>
          {board.data?.team && (
            <div className="flex rounded-full border border-slate-200 bg-white p-0.5">
              {[['team', 'My team'], ['all', 'Everyone']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setScope(k)}
                  className={cn('rounded-full px-3 py-1.5 text-sm font-medium', scope === k ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
            {[['leaderboard', 'Leaderboard'], ['all', 'All reviews']].map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={cn('rounded px-3 py-1.5 font-medium', tab === k ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>
            ))}
          </div>
          <div className="flex-1" />
          <label className="flex items-center gap-1.5 text-xs text-slate-500">From <Input type="date" className="h-9 w-40" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">To <Input type="date" className="h-9 w-40" value={to} onChange={e => setTo(e.target.value)} /></label>
          <select className={selectCls} value={program} onChange={e => setProgram(e.target.value)} aria-label="Programme">
            <option value="">Every programme</option>
            {PROGRAMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {(from || to || program) && <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo(''); setProgram(''); }}>Clear</Button>}
        </div>

        {wrongWay ? <p className="text-sm text-rose-600">The From day is after the To day.</p>
          : tab === 'leaderboard' ? <Leaderboard q={board} scope={scope} shared={shared} />
          : <AllReviews scope={scope} shared={shared} isMentor={isMentor} mentors={board.data?.rows ?? []} />}
      </div>
    </div>
  );
}

function Leaderboard({ q, scope, shared }) {
  const [open, setOpen] = useState(null);
  const { data, isLoading, error } = q;
  const rows = data?.rows ?? [];
  if (error) return <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{errText(error)}</p>;
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">Mentor ratings, highest first. Open a row to read that mentor's reviews.</p>
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
              {!isLoading && !rows.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">{scope === 'team' ? "No reviews for your team's mentors here — try Everyone." : 'No reviews here.'}</td></tr>}
              {rows.map((r, i) => {
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
                      <td className="px-4 py-3"><Bars counts={r.ratingCounts} /></td>
                      <td className="px-4 py-3 text-right text-slate-600"><span className="inline-flex items-center gap-1">{r.totalReviews} review{r.totalReviews === 1 ? '' : 's'}<ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} /></span></td>
                    </tr>
                    {isOpen && <tr><td colSpan={5} className="bg-slate-50 px-4 pb-4"><ReviewList instructorId={r.instructorId} shared={shared} /></td></tr>}
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

function ReviewList({ instructorId, shared }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['instructor-review-list', instructorId, shared.from, shared.to], retry: false,
    queryFn: () => fn('getInstructorReviewList', { instructorId, from: shared.from || undefined, to: shared.to || undefined }),
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
            {v.kind === 'class_feedback' && <span className="rounded bg-sky-50 px-1.5 text-[11px] text-sky-700">Class feedback</span>}
            <span className="ml-auto text-xs text-slate-400">{when(v.createdAt)}</span>
          </div>
          {v.comment && <p className="mt-1 text-sm text-slate-700">{v.comment}</p>}
          {v.classComment && <p className="mt-1 text-sm text-slate-500">On the class: {v.classComment}</p>}
        </div>
      ))}
      {data?.total > reviews.length && <p className="px-3 py-2 text-xs text-slate-400">Showing the latest {reviews.length} of {data.total} — All reviews has every one.</p>}
    </div>
  );
}

function AllReviews({ scope, shared, isMentor, mentors }) {
  const [mine, setMine] = useState(false);
  const [instructor, setInstructor] = useState('');
  const [rating, setRating] = useState('');
  const [kind, setKind] = useState('');
  const [withComment, setWithComment] = useState(false);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const filters = { scope, mine, instructor: mine ? '' : instructor, rating, kind, withComment, q, from: shared.from, to: shared.to, program: shared.program };
  useEffect(() => { setPage(1); }, [JSON.stringify(filters)]);
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['instructor-review-feed', filters, page], retry: false, placeholderData: (prev) => prev,
    queryFn: () => fn('getInstructorReviewFeed', { ...filters, page }),
  });
  const reviews = data?.reviews ?? [];
  const stats = data?.stats;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.perPage ?? 25)));

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = [];
      for (let p = 1; p <= 20; p++) {
        const got = await fn('getInstructorReviewFeed', { ...filters, page: p, perPage: 100 });
        all.push(...(got?.reviews ?? []));
        if (all.length >= (got?.total ?? 0) || !(got?.reviews ?? []).length) break;
      }
      const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const head = ['Left', 'Mentor', 'Stars', 'Kind', 'Student', 'Class', 'Class date', 'Programme', 'Words', 'On the class'];
      const lines = [head, ...all.map(v => [when(v.createdAt), v.instructor?.name, v.rating, KIND[v.kind], v.student?.name, v.class?.title, day(v.class?.scheduledStart), PROGRAM_LABEL[v.program] || v.program, v.comment, v.classComment])];
      const blob = new Blob(['﻿' + lines.map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `instructor-reviews${shared.from ? `-${shared.from}` : ''}${shared.to ? `-to-${shared.to}` : ''}.csv`; a.click(); URL.revokeObjectURL(a.href);
    } finally { setExporting(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {isMentor && (
          <button type="button" onClick={() => setMine(v => !v)} aria-pressed={mine}
            className={cn('inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium', mine ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
            <UserRound className="h-4 w-4" />My reviews
          </button>
        )}
        {!mine && (
          <select className={selectCls} value={instructor} onChange={e => setInstructor(e.target.value)} aria-label="Mentor">
            <option value="">Every mentor</option>
            {mentors.map(m => <option key={m.instructorId} value={m.instructorId}>{m.name}</option>)}
          </select>
        )}
        <select className={selectCls} value={rating} onChange={e => setRating(e.target.value)} aria-label="Stars">
          <option value="">Any stars</option>
          {[5, 4, 3, 2, 1].map(n => <option key={n} value={String(n)}>{n} star{n === 1 ? '' : 's'}</option>)}
          <option value="low">Low (1–2★)</option>
        </select>
        <select className={selectCls} value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind">
          <option value="">Mentor ratings + class feedback</option>
          <option value="mentor_rating">Mentor ratings</option>
          <option value="class_feedback">Class feedback</option>
        </select>
        <label className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700">
          <input type="checkbox" checked={withComment} onChange={e => setWithComment(e.target.checked)} />With words
        </label>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="h-9 w-56 pl-8" placeholder="Student, class or words" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex-1" />
        {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        <Button variant="outline" size="sm" className="h-9" disabled={!data?.total || exporting} onClick={exportCsv}>
          {exporting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}Export
        </Button>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div className="rounded-md border bg-white p-3"><p className="text-xs text-slate-500">Reviews</p><p className="text-lg font-semibold text-slate-900">{stats.count}</p></div>
          <div className="rounded-md border bg-white p-3"><p className="text-xs text-slate-500">Average</p><p className="flex items-center gap-1.5 text-lg font-semibold text-slate-900">{stats.average ?? '—'}{stats.average != null && <Star className="h-4 w-4 fill-amber-400 text-amber-400" />}</p></div>
          <div className="rounded-md border bg-white p-3"><p className="text-xs text-slate-500">Low (1–2★)</p><p className={cn('text-lg font-semibold', stats.low ? 'text-rose-600' : 'text-slate-900')}>{stats.low}</p></div>
          <div className="rounded-md border bg-white p-3"><p className="text-xs text-slate-500">With words</p><p className="text-lg font-semibold text-slate-900">{stats.withComment}</p></div>
          <div className="col-span-2 rounded-md border bg-white p-3 sm:col-span-1"><Bars counts={stats.counts} width="w-20" /></div>
        </div>
      )}

      {isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        : error ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{errText(error)}</p>
        : !reviews.length ? <p className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">{mine ? 'No reviews of yours for these filters.' : 'No reviews for these filters.'}</p>
        : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {reviews.map(v => (
              <div key={v.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <Stars value={v.rating} />
                  <span className="font-semibold text-slate-900">{v.instructor?.name || 'A mentor'}</span>
                  <span className={cn('rounded px-1.5 text-[11px]', v.kind === 'class_feedback' ? 'bg-sky-50 text-sky-700' : 'bg-violet-50 text-violet-700')}>{KIND[v.kind]}</span>
                  {v.program && <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">{PROGRAM_LABEL[v.program] || v.program}</span>}
                  <span className="ml-auto text-xs text-slate-400">{when(v.createdAt)}</span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{v.student?.name || 'A student'}{v.class?.title ? ` · ${v.class.title}` : ''}{v.class?.scheduledStart ? ` · class ${day(v.class.scheduledStart)}` : ''}</p>
                {v.comment && <p className="mt-1.5 flex gap-1.5 text-sm text-slate-800"><MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />{v.comment}</p>}
                {v.classComment && <p className="mt-1 text-sm text-slate-500">On the class: {v.classComment}</p>}
              </div>
            ))}
          </div>
        )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-slate-500">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          Page {page} of {pages}
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}
    </div>
  );
}
