import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LifeBuoy, ClipboardCheck, ChevronDown, ChevronRight, Paperclip, CheckCircle2, Loader2, Send } from 'lucide-react';
import { Paged, TablePagination } from '@/components/common/TablePagination';

/* ────────────────────────────────────────────────────────────────────────────
   The student's Help & Support tickets and class assignments in the Delta LMS,
   by their email, across both academies (backend/src/functions/lmsSupport.ts →
   the LMS's /service/support-tickets and /service/class-assignments). A ticket
   can be answered or marked resolved here (and on the Support Tickets page):
   the answer goes to the student's ticket from the LMS's shared support
   account, signed with your name. Assignments are reviewed on the LMS. Their
   CS hears of each as it happens, by email and the bell (students/lmsActivity.ts).
──────────────────────────────────────────────────────────────────────────── */

export const TICKET = {
  open: { label: 'Open', cls: 'border-amber-200 bg-amber-50 text-amber-700', hint: 'Waiting for support to answer' },
  pending: { label: 'Waiting on student', cls: 'border-sky-200 bg-sky-50 text-sky-700', hint: 'Support answered; waiting for the student' },
  resolved: { label: 'Resolved', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  closed: { label: 'Closed', cls: 'border-slate-200 bg-slate-100 text-slate-500' },
};
const WORK = {
  pending: { label: 'Waiting for review', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  approved: { label: 'Approved', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  rejected: { label: 'Rejected', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
};
const FROM = { student: 'Student', support: 'Support', automatic: 'Automatic reply' };
export const when = (iso) => (iso ? format(new Date(iso), 'd MMM yyyy, HH:mm') : '—');
const Empty = ({ children }) => <p className="px-4 py-6 text-center text-sm text-slate-400">{children}</p>;

/** A ticket's conversation, oldest first: the student's messages stand out from support's and the automatic reply. */
export function TicketThread({ ticket }) {
  return (
    <div className="space-y-2">
      {(ticket.messages || []).map((m, i) => (
        <div key={i} className={`rounded-lg border px-3 py-2 ${m.from === 'student' ? 'border-amber-200 bg-white' : 'border-slate-200 bg-slate-50'}`}>
          <div className="mb-1 flex justify-between gap-2 text-xs text-slate-500">
            <span className="font-semibold">{FROM[m.from] || m.from}</span><span>{when(m.at)}</span>
          </div>
          <div className="whitespace-pre-wrap text-sm text-slate-800">{m.body}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Answer a ticket, or mark it resolved — on the LMS, as the help desk would: the answer comes from the shared
 * support account, signed with your name, and the ticket then waits on the student (who the LMS tells).
 */
export function TicketAnswer({ studentId, ticket }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const done = () => {
    qc.invalidateQueries({ queryKey: ['student-lms-support', studentId] });
    qc.invalidateQueries({ queryKey: ['lms-support-tickets'] });
    qc.invalidateQueries({ queryKey: ['student-history', studentId] });
  };
  const answer = useMutation({
    mutationFn: async () => (await base44.functions.invoke('answerLmsTicket', { studentId, ticketId: ticket.id, body: text.trim() })).data,
    onSuccess: () => { setText(''); toast.success('Answer sent — the student sees it on their ticket in the LMS'); done(); },
    onError: (e) => toast.error(e?.message || 'The answer could not be sent'),
  });
  const resolve = useMutation({
    mutationFn: async () => (await base44.functions.invoke('resolveLmsTicket', { studentId, ticketId: ticket.id })).data,
    onSuccess: () => { toast.success('Marked resolved'); done(); },
    onError: (e) => toast.error(e?.message || 'Could not mark it resolved'),
  });
  if (ticket.status === 'closed') {
    return <p className="mt-2 text-xs text-slate-400">Closed on the LMS — the student can open a new ticket if they still need help.</p>;
  }
  const busy = answer.isPending || resolve.isPending;
  return (
    <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
      <Textarea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={4000}
        placeholder="Answer the student — it goes to their ticket in the LMS, signed with your name"
        className="bg-white text-sm"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-400">Sent from Delta's support account in the LMS, signed with your name.</span>
        <div className="flex gap-2">
          {ticket.status !== 'resolved' && (
            <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => resolve.mutate()}>
              {resolve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Mark resolved
            </Button>
          )}
          <Button size="sm" className="gap-1.5" disabled={busy || !text.trim()} onClick={() => answer.mutate()}>
            {answer.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send answer
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function StudentLmsSupportCards({ student }) {
  const { data, isLoading } = useQuery({
    queryKey: ['student-lms-support', student?.id],
    queryFn: async () => (await base44.functions.invoke('getStudentLmsSupport', { studentId: student.id })).data,
    enabled: !!student?.id,
    staleTime: 60_000,
  });
  if (!isLoading && (!data || !data.configured)) return null;   // no LMS link on this server
  const notice = isLoading ? 'Asking the LMS…' : !data.available ? (data.message || 'The LMS could not be asked') : '';
  const none = data?.has_account === false ? 'No Delta LMS account with this email.' : '';
  return (
    <>
      <TicketsCard student={student} tickets={data?.tickets || []} notice={notice} none={none || 'No support tickets.'} />
      <AssignmentsCard student={student} assignments={data?.assignments || []} notice={notice} none={none || 'No class assignments sent.'} />
    </>
  );
}

function TicketsCard({ student, tickets, notice, none }) {
  const [openId, setOpenId] = useState(null);
  const waiting = tickets.filter(t => t.status === 'open').length;
  const onStudent = tickets.filter(t => t.status === 'pending').length;
  return (
    <Card className="overflow-hidden border-gray-200">
      <CardHeader className="border-b border-gray-100 py-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg font-semibold">
          <span className="flex items-center gap-2"><LifeBuoy className="h-5 w-5 text-amber-600" />Support tickets (Delta LMS)</span>
          {!notice && tickets.length > 0 && (
            <span className="flex flex-wrap gap-1.5 text-xs font-normal">
              <Badge variant="outline" className={TICKET.open.cls} title={TICKET.open.hint}>Open {waiting}</Badge>
              <Badge variant="outline" className={TICKET.pending.cls} title={TICKET.pending.hint}>Waiting on student {onStudent}</Badge>
              <Badge variant="outline" className={TICKET.closed.cls}>All {tickets.length}</Badge>
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {notice ? <Empty>{notice}</Empty> : tickets.length === 0 ? <Empty>{none}</Empty> : (
          <Paged items={tickets} resetKey={student.id}>
            {(rows, bar) => (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <th className="w-8 px-2 py-2.5" /><th className="px-4 py-2.5">Opened</th><th className="px-4 py-2.5">Ticket</th>
                        <th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Last message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(t => {
                        const s = TICKET[t.status] || TICKET.open;
                        const open = openId === t.id;
                        return (
                          <Fragment key={t.id}>
                            <tr className="cursor-pointer border-b border-slate-100 align-top hover:bg-slate-50" onClick={() => setOpenId(open ? null : t.id)}>
                              <td className="px-2 py-2.5 text-slate-400">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                              <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{when(t.openedAt)}</td>
                              <td className="px-4 py-2.5">
                                <div className="font-medium text-slate-900">{t.subject || '—'}</div>
                                <div className="text-xs capitalize text-slate-500">{t.category}</div>
                              </td>
                              <td className="px-4 py-2.5"><Badge variant="outline" className={s.cls} title={s.hint}>{s.label}</Badge></td>
                              <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                                {when(t.lastMessageAt)}
                                <div className="text-xs text-slate-400">from {t.lastFrom === 'student' ? 'the student' : 'support'}</div>
                              </td>
                            </tr>
                            {open && (
                              <tr className="border-b border-slate-100 bg-slate-50/60">
                                <td colSpan={5} className="px-4 py-3">
                                  <TicketThread ticket={t} />
                                  <TicketAnswer studentId={student.id} ticket={t} />
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
  );
}

function AssignmentsCard({ student, assignments, notice, none }) {
  const n = (status) => assignments.filter(a => a.status === status).length;
  return (
    <Card className="overflow-hidden border-gray-200">
      <CardHeader className="border-b border-gray-100 py-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg font-semibold">
          <span className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-emerald-600" />Class assignments (Delta LMS)</span>
          {!notice && assignments.length > 0 && (
            <span className="flex flex-wrap gap-1.5 text-xs font-normal">
              {['pending', 'approved', 'rejected'].map(k => (
                <Badge key={k} variant="outline" className={WORK[k].cls}>{WORK[k].label} {n(k)}</Badge>
              ))}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {notice ? <Empty>{notice}</Empty> : assignments.length === 0 ? <Empty>{none}</Empty> : (
          <Paged items={assignments} resetKey={student.id}>
            {(rows, bar) => (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <th className="px-4 py-2.5">Sent</th><th className="px-4 py-2.5">Assignment</th><th className="px-4 py-2.5">Class</th>
                        <th className="px-4 py-2.5">Course</th><th className="px-4 py-2.5">Mentor</th><th className="px-4 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(a => {
                        const s = WORK[a.status] || WORK.pending;
                        return (
                          <tr key={a.id} className="border-b border-slate-100 align-top">
                            <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                              {when(a.submittedAt)}
                              {a.attempt > 1 && <div className="text-xs text-slate-400">attempt {a.attempt}</div>}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="font-medium text-slate-900">{a.title || '—'}</div>
                              {a.note && <div className="mt-0.5 whitespace-pre-wrap text-xs text-slate-500">{a.note}</div>}
                              {(a.files || []).length > 0 && (
                                <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-400"><Paperclip className="h-3 w-3" />{a.files.join(', ')}</div>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-slate-600">{a.className || '—'}{a.classAt && <div className="text-xs text-slate-400">{when(a.classAt)}</div>}</td>
                            <td className="px-4 py-2.5 text-slate-600">{a.course || '—'}</td>
                            <td className="px-4 py-2.5 text-slate-600">{a.mentor || '—'}</td>
                            <td className="px-4 py-2.5">
                              <Badge variant="outline" className={s.cls} title={a.reviewedAt ? `Reviewed ${when(a.reviewedAt)}` : undefined}>{s.label}</Badge>
                              {a.status === 'rejected' && a.reason && <div className="mt-1 max-w-xs text-xs text-rose-700">{a.reason}</div>}
                            </td>
                          </tr>
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
  );
}
