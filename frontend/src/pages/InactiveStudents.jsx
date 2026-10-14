import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Eye, Loader2, Search, UserCheck, UserX } from 'lucide-react';
import { useUrlState } from '@/components/utils/urlState';

/* ────────────────────────────────────────────────────────────────────────────
   Inactive students (the user, 2026-10-14): those marked not a student — gone
   from the Students page and every work list, kept here with who marked them,
   when and why. A CS Manager or an admin marks one a student again (backend
   functions/notStudent.ts listNotStudents / unmarkNotStudent).
──────────────────────────────────────────────────────────────────────────── */

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '—');

export default function InactiveStudents() {
  const [search, setSearch] = useUrlState('q', '');
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['not-students', search, page],
    queryFn: async () => (await base44.functions.invoke('listNotStudents', { search, page })).data,
    retry: false,
  });
  const unmark = useMutation({
    mutationFn: async (row) => (await base44.functions.invoke('unmarkNotStudent', { studentId: row.id })).data,
    onSuccess: (_d, row) => {
      toast.success(`${row.full_name} is a student again — back on every list`);
      queryClient.invalidateQueries({ queryKey: ['not-students'] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
    },
    onError: (e) => toast.error(e?.message || "Couldn't mark them a student again"),
  });
  const rows = data?.rows || [];
  const pages = Math.max(1, Math.ceil((data?.total || 0) / (data?.page_size || 50)));

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <PageTitle eyebrow="Students" icon={UserX}>Inactive students</PageTitle>
          <p className="mt-2 text-sm text-slate-500">Marked not a student — they don't show on the Students page, follow-ups, not onboarded, class completions or balances. Nothing about them is deleted.</p>
        </div>

        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Name, STU code, email, phone, reason…" className="bg-white pl-9" />
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
                      <th className="px-4 py-3 font-semibold">Student</th>
                      <th className="px-4 py-3 font-semibold">CS · team</th>
                      <th className="px-4 py-3 font-semibold">Why</th>
                      <th className="px-4 py-3 font-semibold">Marked</th>
                      <th className="px-4 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {isLoading && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
                    {!isLoading && !rows.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Nobody marked not a student{search ? ' matches that' : ''}.</td></tr>}
                    {rows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900">{r.full_name}</div>
                          <div className="text-xs text-slate-500"><span className="font-mono">{r.student_code}</span>{r.email ? ` · ${r.email}` : ''}{r.phone ? ` · ${r.phone}` : ''}</div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{r.primary_mentor_name || '—'}{r.team_name ? <span className="text-xs text-slate-400"> · {r.team_name}</span> : ''}</td>
                        <td className="max-w-xs px-4 py-2.5 text-slate-700">{r.reason || '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{when(r.at)}<div>by {r.by || '—'}</div></td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex justify-end gap-1">
                            <Link to={createPageUrl('StudentDetail') + '?id=' + r.id}>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Open their page"><Eye className="h-4 w-4" /></Button>
                            </Link>
                            {data?.may_unmark && (
                              <Button size="sm" variant="outline" className="h-8" disabled={unmark.isPending}
                                onClick={() => { if (window.confirm(`Mark ${r.full_name} a student again? They go back on every list.`)) unmark.mutate(r); }}>
                                <UserCheck className="mr-1.5 h-4 w-4" />Student again
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pages > 1 && (
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-sm text-slate-500">
                  <span>{data.total} in all · page {page} of {pages}</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                    <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
