import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/common/PageHeader';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Search } from 'lucide-react';
import { useUrlState } from '@/components/utils/urlState';
import { CopyLinkButton, openText } from '@/components/exams/exams';

/* ────────────────────────────────────────────────────────────────────────────
   Exams (the user, 2026-10-10): the Delta LMS's published exams, each with its
   address to copy — the student signs in as usual and takes it there. A
   Dubai team's people see Dubai's academy, a Bangalore team's Bangalore's;
   someone on no team picks (backend functions/lmsExams.ts). A link that signs
   one student straight in is on that student's page, Exams tab.
──────────────────────────────────────────────────────────────────────────── */

export default function Exams() {
  const [academy, setAcademy] = useUrlState('academy', 'dubai');
  const [search, setSearch] = useUrlState('q', '');
  const q = useQuery({
    queryKey: ['lms-exams', academy],
    queryFn: async () => (await base44.functions.invoke('getLmsExams', { academy })).data,
    retry: false,
  });
  const d = q.data;
  const shown = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (d?.exams || []).filter(e => !t || `${e.title} ${e.course}`.toLowerCase().includes(t));
  }, [d, search]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <PageHeader eyebrow="Students" title="Exams" description="The Delta LMS's exams — copy one's link to send a student. For a link that signs one student straight in, open their page → Exams." />

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search exam or course…" className="pl-9" />
          </div>
          {d && !d.fixed ? (
            <div className="flex rounded-md border bg-white p-0.5 text-xs" role="group" aria-label="Academy">
              {[['dubai', 'Dubai'], ['bangalore', 'Bangalore']].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setAcademy(v)}
                  className={`rounded px-2.5 py-1.5 font-medium ${(d.academy || academy) === v ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{l}</button>
              ))}
            </div>
          ) : d?.academy ? (
            <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">{d.academy === 'bangalore' ? 'Bangalore academy' : 'Dubai academy'} — your team's</Badge>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-soft">
          {q.isLoading ? <div className="p-4"><Skeleton className="h-40 w-full" /></div>
            : q.isError ? <p className="p-4 text-sm text-slate-500">{q.error?.message || "The exams couldn't be loaded."}</p>
              : d?.configured === false ? <p className="p-4 text-sm text-slate-500">The LMS isn't connected on this server.</p>
                : !shown.length ? <p className="p-6 text-center text-sm text-slate-500">{d?.exams?.length ? 'No exam matches.' : 'No published exams in this academy yet.'}</p>
                  : (
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr><th className="px-4 py-2.5">Exam</th><th className="px-4 py-2.5">Course</th><th className="hidden px-4 py-2.5 md:table-cell">Details</th><th className="px-4 py-2.5 text-right">Link</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {shown.map(e => (
                          <tr key={e.id}>
                            <td className="px-4 py-3 font-medium text-slate-900">{e.title}</td>
                            <td className="px-4 py-3 text-slate-700">{e.course}{e.shared && <span className="ml-1.5 text-[11px] text-slate-400">(shared)</span>}</td>
                            <td className="hidden px-4 py-3 text-xs text-slate-500 md:table-cell">{[`${e.durationMinutes} min`, `${e.questionCount} questions`, `pass ${e.passPercent}%`, openText(e)].filter(Boolean).join(' · ')}</td>
                            <td className="px-4 py-3 text-right"><CopyLinkButton link={e.link} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
        </div>
      </div>
    </div>
  );
}
