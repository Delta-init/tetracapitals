import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TablePagination, usePagination } from '@/components/common/TablePagination';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Mail, RefreshCw, Send, Zap } from 'lucide-react';
import { REMINDER, reminderKind, reminderTitle, hhmm, fmtDate, StatusBadge } from './followupUi';

/**
 * Reminder emails — one a day at 10:00 UAE to each person with follow-ups
 * due today, overdue or due tomorrow, and a leader alert to the Chief Mentor /
 * CS Manager when one of their CSs' follow-ups goes overdue: who got one, what
 * was in it, sent / failed / not sent and why, and whether they opened the
 * portal from it. Everyone sees their own; managers their people; admin roles
 * everyone (the server decides).
 */
export default function ReminderLog({ currentUser }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['followups', 'reminders', date],
    queryFn: async () => (await base44.functions.invoke('getReminderLog', date ? { date } : {})).data,
    refetchInterval: 60_000,
  });
  const [expanded, setExpanded] = useState(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [runOpen, setRunOpen] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['followups'] });

  const today = data?.today;
  const day = date || today;
  const isToday = day === today;
  const rows = data?.rows || [];
  const { pageItems, bar } = usePagination(rows, { resetKey: day, urlKey: 'reminders_page' });
  const c = data?.counts || {};
  const mail = data?.mail || {};

  const resend = useMutation({
    mutationFn: async (id) => (await base44.functions.invoke('resendReminder', { id })).data,
    onSuccess: (r) => { if (r.status === 'sent') toast.success('Reminder sent'); else toast.error(r.reason || 'Not sent'); refresh(); },
    onError: (e) => toast.error(e?.message || 'Could not send it again'),
  });
  const run = useMutation({
    mutationFn: async () => (await base44.functions.invoke('runRemindersNow', {})).data,
    onSuccess: (r) => {
      setRunOpen(false);
      toast.success(`Sent ${r.sent}${r.failed ? `, failed ${r.failed}` : ''}${r.skipped ? `, not sent ${r.skipped}` : ''}${r.alerts ? ` (${r.alerts} leader alert${r.alerts === 1 ? '' : 's'})` : ''}${r.already ? ` — ${r.already} already had today's` : ''}`);
      refresh();
    },
    onError: (e) => toast.error(e?.message || 'Could not run the reminders'),
  });
  const test = useMutation({
    mutationFn: async (to) => (await base44.functions.invoke('sendTestReminder', { to })).data,
    onSuccess: (r) => { setTestOpen(false); toast.success(`Test email sent to ${r.to}`); refresh(); },
    onError: (e) => toast.error(e?.message || 'The test email was not sent'),
  });

  const pill = (label, n, cls) => <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label} <span className="tabular font-semibold">{n ?? 0}</span></span>;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-3 border-b">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base text-brand-navy"><Mail className="h-4 w-4" /> Reminder emails</CardTitle>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              One email a day at {data?.send_time || '10:00 UAE'} to each person with follow-ups due today, overdue or due tomorrow — and to their Chief Mentor and CS Manager when one goes overdue. Sent, failed or not sent (and why), and whether they opened the portal from it.
            </p>
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
            <Input type="date" value={day || ''} max={today} onChange={(e) => setDate(e.target.value === today ? '' : e.target.value)} className="h-9 w-40" />
            {data?.can_run && (
              <>
                <Button size="sm" variant="outline" onClick={() => { setTestTo(currentUser?.email || ''); setTestOpen(true); }}><Send className="h-4 w-4" /> Test email</Button>
                <Button size="sm" onClick={() => setRunOpen(true)} disabled={!isToday}><Zap className="h-4 w-4" /> Run now</Button>
              </>
            )}
          </div>
        </div>

        {data && (
          <div className="flex flex-wrap items-center gap-2">
            {pill('Sent', c.sent, 'border-sky-200 bg-sky-50 text-sky-700')}
            {pill('Seen', c.seen, 'border-emerald-200 bg-emerald-50 text-emerald-700')}
            {pill('Failed', c.failed, 'border-rose-200 bg-rose-50 text-rose-700')}
            {pill('Not sent', c.skipped, 'border-slate-200 bg-slate-50 text-slate-600')}
            {mail.from && <span className="text-xs text-slate-400">From {mail.from} via {mail.host}</span>}
            {data.last_run && data.last_run.date === day && (
              <span className="text-xs text-slate-400">· last run {hhmm(data.last_run.at)} by {data.last_run.by}</span>
            )}
          </div>
        )}
        {data && !mail.configured && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>Email isn’t set up on the server yet, so reminders are recorded as <b>not sent</b>. Once it is, today’s go out on their own.</span>
          </div>
        )}
        {data?.last_test && (
          <p className="text-xs text-slate-400">
            Last test email {new Date(data.last_test.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} to {data.last_test.to}: {data.last_test.ok ? <span className="text-emerald-600">delivered to the mail server</span> : <span className="text-rose-600">{data.last_test.error}</span>}
          </p>
        )}
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50/80">
                {['', 'Person', 'Due today', 'Overdue', 'Tomorrow', 'Email', 'Sent', 'Opened', 'Tries', 'Details', ''].map((h, i) => (
                  <th key={i} className={`whitespace-nowrap px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${[2, 3, 4, 8].includes(i) ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={11} className="py-10 text-center text-slate-400">Loading…</td></tr>
              ) : error ? (
                <tr><td colSpan={11} className="py-10 text-center text-rose-600">{error.message || 'Could not load the reminder emails'}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={11} className="py-10 text-center text-slate-400">
                  {isToday && !data?.ran_today ? `No reminder emails yet today — they go out at ${data?.send_time || '10:00 UAE'}.` : 'No reminder emails on this day.'}
                </td></tr>
              ) : pageItems.map((r) => {
                const k = REMINDER[reminderKind(r)] || REMINDER.skipped;
                const Icon = k.icon;
                const open = expanded === r.id;
                const canResend = data?.can_resend && isToday && r.status !== 'sending' && r.mentor_id;
                const alert = r.kind === 'leader_alert';
                return (
                  <React.Fragment key={r.id}>
                    <tr className="cursor-pointer border-b border-slate-100 align-top hover:bg-cyan-50/40" onClick={(e) => { if (!e.target.closest('button')) setExpanded(open ? null : r.id); }}>
                      <td className="w-8 px-3 py-2.5 text-slate-400">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-slate-900">
                          {r.mentor_name || (r.mentor_id ? 'Unknown' : 'No mentor')}
                          {alert && <span title="What went overdue in the team they lead" className="ml-1.5 rounded bg-rose-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-rose-700">Leader alert</span>}
                        </div>
                        <div className="text-xs text-slate-400">{r.to || '—'}</div>
                      </td>
                      <td className="tabular px-3 py-2.5 text-right text-slate-700">{r.due_today ?? 0}</td>
                      <td className="tabular px-3 py-2.5 text-right text-slate-700">{r.overdue ?? 0}</td>
                      <td className="tabular px-3 py-2.5 text-right text-slate-700">{r.tomorrow ?? 0}</td>
                      <td className="px-3 py-2.5" title={reminderTitle(r)}>
                        <Badge variant="outline" className={`gap-1 whitespace-nowrap ${k.cls}`}><Icon className={`h-3 w-3 ${r.status === 'sending' ? 'animate-spin' : ''}`} />{k.label}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{r.sent_at ? hhmm(r.sent_at) : '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{r.seen_at ? <>{hhmm(r.seen_at)}{r.seen_count > 1 && <span className="text-xs text-slate-400"> · {r.seen_count}×</span>}</> : '—'}</td>
                      <td className="tabular px-3 py-2.5 text-right text-slate-600">{r.attempts ?? 0}</td>
                      <td className="max-w-[320px] px-3 py-2.5 text-slate-500">{r.status === 'sent' ? <span className="font-mono text-[11px] text-slate-400">{r.message_id}</span> : r.reason || '—'}</td>
                      <td className="px-3 py-2.5 text-right">
                        {canResend && (
                          <Button size="sm" variant="outline" className="h-8" disabled={resend.isPending} onClick={() => resend.mutate(r.id)}>
                            {resend.isPending && resend.variables === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Send again
                          </Button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-slate-100 bg-slate-50/60">
                        <td />
                        <td colSpan={10} className="px-3 py-3">
                          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">In the email</p>
                              <ul className="space-y-1.5">
                                {(r.items || []).map((i) => (
                                  <li key={i.followup_id} className="flex flex-wrap items-center gap-2 text-sm">
                                    <StatusBadge status={i.status} />
                                    <span className="font-medium text-slate-800">{i.student_name}</span>
                                    <span className="text-slate-400">{i.cs_name ? `${i.cs_name} · ` : ''}{i.target_outcome} · {i.stage} · due {fmtDate(i.next_followup_date)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Tries</p>
                              {(r.history || []).length === 0 ? <p className="text-sm text-slate-400">{r.reason || 'None'}</p> : (
                                <ol className="space-y-1.5 text-sm">
                                  {r.history.map((h, n) => (
                                    <li key={n} className={h.ok ? 'text-emerald-700' : 'text-rose-700'}>
                                      {hhmm(h.at)} · {h.ok ? 'accepted by the mail server' : h.error} <span className="text-slate-400">({h.by})</span>
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePagination {...bar} />
      </CardContent>

      <Dialog open={testOpen} onOpenChange={setTestOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-brand-navy">Send a test reminder</DialogTitle>
            <DialogDescription>A sample reminder email (two made-up students), to check the mail set-up. Nothing is recorded against anyone.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Send to</Label>
            <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@deltainstitutions.com" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestOpen(false)}>Cancel</Button>
            <Button onClick={() => test.mutate(testTo.trim())} disabled={!testTo.trim() || test.isPending}>
              {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={runOpen} onOpenChange={setRunOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-brand-navy">Send today’s reminders now?</DialogTitle>
            <DialogDescription>
              Everyone with follow-ups due today, overdue or due tomorrow who hasn’t had today’s reminder gets it now, and leaders hear about follow-ups that went overdue. Nobody gets two in a day — the {data?.send_time || '10:00 UAE'} run only reaches people still without one.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunOpen(false)}>Cancel</Button>
            <Button onClick={() => run.mutate()} disabled={run.isPending}>
              {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
