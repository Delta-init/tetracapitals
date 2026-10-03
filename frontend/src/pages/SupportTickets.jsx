import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronRight, LifeBuoy, RefreshCw, Search, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Paged, TablePagination } from '@/components/common/TablePagination';
import { TICKET, TicketAnswer, TicketThread, when } from '@/components/students/StudentLmsSupportCards';
import StudentInfoDialog from '@/components/students/StudentInfoDialog';

/* ────────────────────────────────────────────────────────────────────────────
   Support Tickets — every Help & Support ticket in the Delta LMS from the
   students you can see (your own and Common ones; your team's; everyone's for
   admins), newest activity first (backend/src/functions/lmsSupport.ts,
   getLmsSupportTickets). Open one to read the conversation, answer it — the
   answer goes to the student's ticket from Delta's support account in the LMS,
   signed with your name — or mark it resolved. "Student" shows who they are and
   every number to reach them on, without leaving the list.
──────────────────────────────────────────────────────────────────────────── */

const FILTERS = [
  { key: 'open', label: 'Open', title: 'Waiting for an answer', test: (t) => t.status === 'open' },
  { key: 'pending', label: 'Waiting on student', title: 'Answered; waiting for the student', test: (t) => t.status === 'pending' },
  { key: 'resolved', label: 'Resolved', test: (t) => t.status === 'resolved' },
  { key: 'closed', label: 'Closed', test: (t) => t.status === 'closed' },
  { key: 'all', label: 'All', test: () => true },
];
const Empty = ({ children }) => <p className="px-4 py-10 text-center text-sm text-slate-400">{children}</p>;

export default function SupportTickets() {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['lms-support-tickets'],
    queryFn: async () => (await base44.functions.invoke('getLmsSupportTickets', {})).data,
    staleTime: 60_000,
  });
  const tickets = useMemo(() => data?.tickets ?? [], [data]);
  const [filter, setFilter] = useState('open');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [info, setInfo] = useState(null);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, tickets.filter(f.test).length])), [tickets]);
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[FILTERS.length - 1];
    const q = query.trim().toLowerCase();
    return tickets.filter(f.test).filter((t) => !q || [t.student?.name, t.student?.code, t.student?.email, t.student?.cs, t.subject]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }, [tickets, filter, query]);

  const notice = isLoading ? '' : !data?.configured ? "The LMS isn't linked to this server, so there are no tickets to show."
    : !data.available ? (data.message || 'The LMS could not be asked') : '';

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <PageTitle eyebrow="Students" icon={LifeBuoy}>Support Tickets</PageTitle>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
              Your students' Help &amp; Support tickets in the Delta LMS. Open one to read it, answer — it goes to their ticket,
              signed with your name — or mark it resolved.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Student, STU code, subject…" className="pl-8" />
            </div>
            <Button variant="outline" size="icon" title="Ask the LMS again" disabled={isFetching} onClick={() => refetch()}>
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              title={f.title}
              onClick={() => { setFilter(f.key); setOpenId(null); }}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors',
                filter === f.key ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {f.label} <span className={cn('ml-1 tabular-nums', filter === f.key ? 'text-white/80' : 'text-slate-400')}>{isLoading ? '…' : counts[f.key]}</span>
            </button>
          ))}
        </div>

        <Card className="overflow-hidden border-gray-200">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : notice ? <Empty>{notice}</Empty> : shown.length === 0 ? (
              <Empty>{tickets.length === 0 ? 'None of your students has a support ticket.' : query ? 'No ticket matches that search.' : 'No tickets here.'}</Empty>
            ) : (
              <Paged items={shown} resetKey={`${filter}|${query}`}>
                {(rows, bar) => (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            <th className="w-8 px-2 py-2.5" />
                            <th className="px-4 py-2.5">Opened</th>
                            <th className="px-4 py-2.5">Student</th>
                            <th className="px-4 py-2.5">Ticket</th>
                            <th className="px-4 py-2.5">Status</th>
                            <th className="px-4 py-2.5">Last message</th>
                            <th className="px-4 py-2.5" />
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((t) => {
                            const s = TICKET[t.status] || TICKET.open;
                            const open = openId === t.id;
                            return (
                              <Fragment key={t.id}>
                                <tr className="cursor-pointer border-b border-slate-100 align-top hover:bg-slate-50" onClick={() => setOpenId(open ? null : t.id)}>
                                  <td className="px-2 py-2.5 text-slate-400">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{when(t.openedAt)}</td>
                                  <td className="px-4 py-2.5">
                                    <div className="font-medium text-slate-900">{t.student?.name || t.student?.email}</div>
                                    <div className="text-xs text-slate-500">{[t.student?.code, t.student?.cs].filter(Boolean).join(' · ')}</div>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <div className="font-medium text-slate-900">{t.subject || '—'}</div>
                                    <div className="text-xs capitalize text-slate-500">{t.category}</div>
                                  </td>
                                  <td className="px-4 py-2.5"><Badge variant="outline" className={s.cls} title={s.hint}>{s.label}</Badge></td>
                                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                                    {when(t.lastMessageAt)}
                                    <div className="text-xs text-slate-400">from {t.lastFrom === 'student' ? 'the student' : 'support'}</div>
                                  </td>
                                  <td className="px-4 py-2.5 text-right">
                                    <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={(e) => { e.stopPropagation(); setInfo(t.student); }}>
                                      <UserRound className="h-3.5 w-3.5" /> Student
                                    </Button>
                                  </td>
                                </tr>
                                {open && (
                                  <tr className="border-b border-slate-100 bg-slate-50/60">
                                    <td colSpan={7} className="px-4 py-3">
                                      <TicketThread ticket={t} />
                                      <TicketAnswer studentId={t.student.id} ticket={t} />
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <TablePagination {...bar} />
                  </>
                )}
              </Paged>
            )}
          </CardContent>
        </Card>
      </div>

      <StudentInfoDialog student={info} onClose={() => setInfo(null)} />
    </div>
  );
}
