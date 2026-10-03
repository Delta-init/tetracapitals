import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { PageTitle } from '@/components/common/PageHeader';
import { Paged, TablePagination } from '@/components/common/TablePagination';
import StatsCard from '@/components/dashboard/StatsCard';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CheckCircle2, Clock, Copy, CreditCard, Loader2, Search, XCircle } from 'lucide-react';
import { PaymentStatusBadge, NewChip, money, when, copyLink, useAnswersSeen } from '@/components/students/PaymentLinksCard';

// A Super Admin starts on what waits for them; a CS on everything they asked for, the latest first.
const ADMIN_TABS = [
  { key: 'pending', label: 'Waiting' },
  { key: 'approved', label: 'Sent' },
  { key: 'rejected', label: 'Turned down' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];
const CS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Waiting' },
  { key: 'approved', label: 'Link ready' },
  { key: 'rejected', label: 'Turned down' },
  { key: 'cancelled', label: 'Cancelled' },
];
const LINK = /^https?:\/\/[^\s/?#]+\.[^\s/?#]+\S*$/i;

/**
 * Payment Links (backend/src/functions/paymentLinks.ts). A Super Admin sees
 * what CSs asked for on their students' pages: make the link wherever you make
 * it, paste it in, and it is emailed to the student and shows to the CS — or
 * turn the request down with a reason the CS sees. A CS sees what they asked
 * for: the links ready (to copy), the turn-downs and why; opening the page
 * marks the new ones seen.
 */
export default function PaymentLinks() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['payment-links'],
    queryFn: async () => (await base44.functions.invoke('getPaymentLinks', { markSeen: true })).data,
    refetchInterval: 60_000,
  });
  useAnswersSeen(data);
  const admin = !!data?.can_approve;
  const TABS = admin ? ADMIN_TABS : CS_TABS;
  const [picked, setTab] = useState(null);
  const tab = picked ?? (admin ? 'pending' : 'all');
  const [q, setQ] = useState('');
  const [approving, setApproving] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['payment-links'] });
    queryClient.invalidateQueries({ queryKey: ['nav-counts'] });
  };
  const cancel = useMutation({
    mutationFn: async (id) => (await base44.functions.invoke('cancelPaymentLinkRequest', { id })).data,
    onSuccess: () => { toast.success('Request cancelled'); done(); },
    onError: (e) => { toast.error(e?.message || 'Could not cancel it'); done(); },
  });

  const all = data?.requests || [];
  const count = (s) => all.filter(r => r.status === s).length;
  const needle = q.trim().toLowerCase();
  const rows = all
    .filter(r => (tab === 'all' || r.status === tab) &&
      (!needle || [r.student_name, r.student_code, r.requested_by_name, r.team_name, r.description].some(v => String(v || '').toLowerCase().includes(needle))))
    // Waiting: the longest waiting first. The rest: the latest first.
    .sort((a, b) => (tab === 'pending' ? 1 : -1) * String(a.created_at).localeCompare(String(b.created_at)));

  const TH = ({ children, right }) => <th className={`whitespace-nowrap px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
  const table = (list) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50/80">
            <TH>Student</TH><TH right>Amount</TH><TH>For</TH><TH>{admin ? 'Asked by' : 'Asked'}</TH><TH>Status</TH><TH>Link</TH><TH />
          </tr>
        </thead>
        <tbody>
          {list.map(r => (
            <tr key={r.id} className="border-b border-slate-100 align-top hover:bg-slate-50/60">
              <td className="px-3 py-2.5">
                <Link to={`${createPageUrl('StudentDetail')}?id=${r.student_id}`} className="font-medium text-slate-900 hover:text-blue-600">{r.student_name}</Link>
                <div className="font-mono text-xs text-slate-400">{r.student_code}</div>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{money(r.currency, r.amount)}</td>
              <td className="max-w-[260px] px-3 py-2.5 text-slate-700">
                {r.description}
                {r.note && <div className="mt-0.5 text-xs text-slate-500">Note: {r.note}</div>}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5">
                {admin ? (<>
                  <div className="text-slate-700">{r.requested_by_name}</div>
                  <div className="text-xs text-slate-400">{[r.team_name, when(r.created_at)].filter(Boolean).join(' · ')}</div>
                </>) : <div className="text-slate-600">{when(r.created_at)}</div>}
              </td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <PaymentStatusBadge status={r.status} />
                  {r.new && <NewChip />}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {r.status === 'approved' && `${r.approved_by_name} · ${when(r.approved_at)}`}
                  {r.status === 'rejected' && `${r.rejected_by_name} · ${when(r.rejected_at)}`}
                  {r.status === 'cancelled' && `${admin ? 'by the CS' : 'by you'} · ${when(r.cancelled_at)}`}
                </div>
              </td>
              <td className="max-w-[300px] px-3 py-2.5">
                {r.status === 'approved' && r.url ? (
                  <>
                    <div className="flex items-center gap-1">
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="truncate text-blue-600 hover:underline">{r.url}</a>
                      <button type="button" onClick={() => copyLink(r.url)} className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Copy the link"><Copy className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className="text-xs">
                      {r.emailed_to
                        ? <span className="text-emerald-700">Emailed to {r.emailed_to}</span>
                        : <span className="text-amber-700">{r.email_error ? `Not emailed — ${r.email_error}` : 'Not emailed'}</span>}
                    </div>
                    {r.admin_note && <div className="text-xs text-slate-500">{admin ? 'To the CS' : r.approved_by_name}: {r.admin_note}</div>}
                  </>
                ) : r.status === 'rejected' ? (
                  <span className="text-xs text-rose-700">{r.reject_reason}</span>
                ) : <span className="text-slate-300">—</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right">
                {r.status === 'pending' && admin && (
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" className="h-8" onClick={() => setApproving(r)}><CheckCircle2 className="h-3.5 w-3.5" /> Add link</Button>
                    <Button size="sm" variant="ghost" className="h-8 text-slate-500" onClick={() => setRejecting(r)}><XCircle className="h-3.5 w-3.5" /> Turn down</Button>
                  </div>
                )}
                {r.status === 'pending' && !admin && r.mine && (
                  <Button size="sm" variant="ghost" className="h-8 text-slate-500" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>
                    {cancel.isPending && cancel.variables === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />} Cancel
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div>
          <PageTitle eyebrow="Funding" icon={CreditCard}>Payment Links</PageTitle>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
            {admin
              ? 'What CSs asked for on their students’ pages. Make the link, paste it in, and it is emailed to the student and shows to the CS to copy or send on WhatsApp — or turn the request down and say why.'
              : 'The payment links you asked for on your students’ pages. Once a Super Admin adds the link it is emailed to the student and shows here to copy — or you see why it was turned down. Send it on WhatsApp from the student’s page.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatsCard title="Waiting" value={count('pending')} icon={Clock} color="amber" delay={0.02} />
          <StatsCard title={admin ? 'Sent' : 'Link ready'} value={count('approved')} icon={CheckCircle2} color="emerald" delay={0.05} />
          <StatsCard title="Turned down" value={count('rejected')} icon={XCircle} color="red" delay={0.08} />
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
                {TABS.map(t => (
                  <button key={t.key} type="button" onClick={() => setTab(t.key)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                    {t.label}{t.key !== 'all' && count(t.key) > 0 ? ` (${count(t.key)})` : ''}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={q} onChange={e => setQ(e.target.value)} placeholder={admin ? 'Student, CS, team, what for…' : 'Student, what for…'} className="h-9 w-64 pl-9" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="py-12 text-center text-sm text-slate-400">Loading payment links…</p>
            ) : error ? (
              <p className="py-12 text-center text-sm text-rose-600">{error.message || 'Could not load payment links'}</p>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">
                {needle ? 'Nothing matches that search.'
                  : tab === 'pending' ? (admin ? 'Nothing waiting — every request has been dealt with.' : 'Nothing waiting.')
                  : !admin && !all.length ? 'You haven’t asked for a payment link yet — ask on a student’s page.'
                  : 'None yet.'}
              </p>
            ) : (
              <Paged items={rows} resetKey={`${tab}|${needle}`}>
                {(pageRows, bar) => (<>
                  {table(pageRows)}
                  <TablePagination {...bar} />
                </>)}
              </Paged>
            )}
          </CardContent>
        </Card>
      </div>
      {approving && <ApproveDialog request={approving} emailReady={!!data?.email_ready} onClose={() => setApproving(null)} onDone={done} />}
      {rejecting && <RejectDialog request={rejecting} onClose={() => setRejecting(null)} onDone={done} />}
    </div>
  );
}

function Asked({ request: r }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold tabular-nums text-slate-900">{money(r.currency, r.amount)}</span>
        <span className="text-xs text-slate-500">asked by {r.requested_by_name} · {when(r.created_at)}</span>
      </div>
      <div className="text-slate-700">{r.description}</div>
      {r.note && <div className="mt-1 text-xs text-slate-500">Note: {r.note}</div>}
    </div>
  );
}

function ApproveDialog({ request: r, emailReady, onClose, onDone }) {
  const canEmail = emailReady && !!r.student_email;
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [email, setEmail] = useState(canEmail);
  const approve = useMutation({
    mutationFn: async () => (await base44.functions.invoke('approvePaymentLink', { id: r.id, url: url.trim(), note, email: canEmail && email })).data,
    onSuccess: ({ request }) => {
      if (request.emailed_to) toast.success(`Link added — emailed to ${request.emailed_to}; ${request.requested_by_name} can see it`);
      else if (request.email_error) toast.warning(`Link added, but not emailed (${request.email_error}) — ${request.requested_by_name} can send it`);
      else toast.success(`Link added — ${request.requested_by_name} can see it`);
      onDone();
      onClose();
    },
    onError: (e) => { toast.error(e?.message || 'The link was not added'); onDone(); },
  });
  const ready = LINK.test(url.trim());

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !approve.isPending) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-brand-navy">Payment link for {r.student_name}</DialogTitle>
          <DialogDescription>Make the link for this amount, then paste it here.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready && !approve.isPending) approve.mutate(); }}>
          <Asked request={r} />
          <div className="space-y-1.5">
            <Label htmlFor="pl-url">Payment link</Label>
            <Input id="pl-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" autoFocus autoComplete="off" />
            {url.trim() && !ready && <p className="text-xs text-rose-600">Paste the whole link, starting with https://</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-note">Note to the CS (optional)</Label>
            <Textarea id="pl-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Works for 7 days" />
          </div>
          <label className={`flex items-start gap-2 text-sm ${canEmail ? 'text-slate-700' : 'text-slate-400'}`}>
            <Checkbox checked={canEmail && email} onCheckedChange={(v) => setEmail(v === true)} disabled={!canEmail} className="mt-0.5" />
            <span>
              {canEmail ? <>Email the link to the student — <span className="font-medium">{r.student_email}</span></> : 'Email the link to the student'}
              <span className="block text-xs text-slate-500">
                {!emailReady ? 'Email is not set up on this server — the CS sends it.'
                  : !r.student_email ? 'There is no email on the student’s record — the CS sends it.'
                  : `From the portal’s mailbox as Delta Institutions; a reply goes to ${r.requested_by_name}.`}
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={approve.isPending}>Cancel</Button>
            <Button type="submit" disabled={!ready || approve.isPending}>
              {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {canEmail && email ? 'Add & email' : 'Add the link'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ request: r, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const reject = useMutation({
    mutationFn: async () => (await base44.functions.invoke('rejectPaymentLink', { id: r.id, reason })).data,
    onSuccess: () => { toast.success(`Turned down — ${r.requested_by_name} sees why`); onDone(); onClose(); },
    onError: (e) => { toast.error(e?.message || 'Not turned down'); onDone(); },
  });

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !reject.isPending) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-brand-navy">Turn down the link for {r.student_name}?</DialogTitle>
          <DialogDescription>{r.requested_by_name} is told, with your reason.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (reason.trim() && !reject.isPending) reject.mutate(); }}>
          <Asked request={r} />
          <div className="space-y-1.5">
            <Label htmlFor="pl-reason">Why</Label>
            <Textarea id="pl-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="e.g. The amount is wrong — the course is AED 2,500" autoFocus />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={reject.isPending}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={!reason.trim() || reject.isPending}>
              {reject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Turn down
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
