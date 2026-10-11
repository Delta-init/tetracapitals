import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { PageTitle } from '@/components/common/PageHeader';
import { Paged, TablePagination } from '@/components/common/TablePagination';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlarmClock, ArrowUpDown, CalendarClock, Coins, CreditCard, Loader2, MessageCircle, PhoneCall, Plus, Search } from 'lucide-react';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { WA_GREEN } from '@/components/whatsapp/waUi';

/* ────────────────────────────────────────────────────────────────────────────
   Balance payments (backend/src/functions/balancePayments.ts; the user,
   2026-10-11): every student in your scope who still owes on a course Delta
   finance sold them — a CS their own, a Chief Mentor or CS Manager their
   people's, admins everyone's — one row per invoice. Finance works out the
   next instalment's due date: the latest payment's paid-on date + 29 days,
   again after every payment, until the balance is 0; it emails the student 3,
   2 and 1 days before, and the CS hears at 10:00 UAE.

   "Record next payment" sends the payment, with its receipt, to Delta Finance
   to approve; it shows With finance until decided, and the row's paid and
   balance change once finance's update arrives. Amounts stay in each invoice's
   currency — AED and INR are never added together.
──────────────────────────────────────────────────────────────────────────── */

const money = (minor, currency) =>
  `${currency || ''} ${(Number(minor || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
const fmtDay = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const uaeToday = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
const firstName = (n) => { const f = String(n || '').trim().split(/\s+/)[0] || ''; return f ? f[0].toUpperCase() + f.slice(1) : 'there'; };

const TABS = [
  { key: 'soon', label: 'Due in 3 days', icon: CalendarClock, on: 'border-amber-300 bg-amber-50 text-amber-800' },
  { key: 'overdue', label: 'Overdue', icon: AlarmClock, on: 'border-rose-300 bg-rose-50 text-rose-700' },
  { key: 'all', label: 'All', icon: Coins, on: 'border-sky-300 bg-sky-50 text-sky-800' },
];

/** Days left until the next instalment, or how late it is. */
export function DueBadge({ row }) {
  if (!row.next_due_on) return <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-500">No date yet</Badge>;
  const d = row.days_left;
  if (row.due_state === 'overdue') return <Badge className="border-transparent bg-rose-500 text-white hover:bg-rose-500">{-d} day{d === -1 ? '' : 's'} overdue</Badge>;
  if (row.due_state === 'soon') return <Badge className="border-transparent bg-amber-400 text-brand-navy hover:bg-amber-400">{d === 0 ? 'Due today' : `${d} day${d === 1 ? '' : 's'} left`}</Badge>;
  return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">{d} days left</Badge>;
}

/** The latest payment recorded here: with finance, or turned down (why). An approved one is in finance's figures already. */
function RequestCell({ request: r }) {
  if (!r) return <span className="text-slate-300">—</span>;
  if (r.status === 'pending') {
    return (
      <div className="space-y-0.5">
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">With finance</Badge>
        <div className="text-xs text-slate-500">{money(r.amount_minor, r.currency)} · {r.method}{r.sent ? '' : ' · sending…'}</div>
      </div>
    );
  }
  if (r.status === 'rejected') {
    return (
      <div className="max-w-[220px] space-y-0.5">
        <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">Turned down</Badge>
        <div className="text-xs text-slate-500" title={r.reason}>{money(r.amount_minor, r.currency)} — {r.reason}</div>
      </div>
    );
  }
  return <span className="text-xs text-emerald-700">{money(r.amount_minor, r.currency)} approved</span>;
}

/** Record the next payment, with its receipt: sent to Delta Finance to approve. */
function RecordPaymentDialog({ row, methods, onClose, onSaved }) {
  const pending = row.request?.status === 'pending' ? Number(row.request.amount_minor) || 0 : 0;
  const room = Math.max(0, row.balance_minor - pending);
  const [amount, setAmount] = useState(String(room / 100));
  const [method, setMethod] = useState(methods[0] || 'Card');
  const [paidOn, setPaidOn] = useState(uaeToday());
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [uploading, setUploading] = useState(false);
  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setReceipt({ url: file_url, name: file.name });
    } catch (e) {
      toast.error(e?.message || 'Could not upload the receipt');
    } finally { setUploading(false); }
  };
  const amountMinor = Math.round((Number(amount) || 0) * 100);
  const save = useMutation({
    mutationFn: async () => (await base44.functions.invoke('recordBalancePayment', {
      studentId: row.student_id, invoiceId: row.invoice_id, amountMinor, method, paidOn, receiptUrl: receipt?.url, receiptName: receipt?.name, note,
    })).data,
    onSuccess: () => { toast.success('Payment recorded — sent to Delta Finance for approval'); onSaved(); onClose(); },
    onError: (e) => toast.error(e?.message || 'Could not record the payment'),
  });
  const valid = amountMinor > 0 && amountMinor <= room && receipt && !uploading && paidOn && paidOn <= uaeToday();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record next payment · {row.full_name}</DialogTitle>
          <DialogDescription>
            {row.course}{row.invoice_number ? ` · ${row.invoice_number}` : ''} — balance {money(row.balance_minor, row.currency)}
            {pending ? `, ${money(pending, row.currency)} of it with finance already` : ''}. Delta Finance approves it; the balance changes once it does.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block">Amount ({row.currency})
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 h-9" />
            {amountMinor > room && <span className="text-xs text-rose-600">Up to {money(room, row.currency)}</span>}
          </label>
          <label className="block">Method
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-background px-2">
              {methods.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label className="block">Paid on
            <Input type="date" value={paidOn} max={uaeToday()} onChange={(e) => setPaidOn(e.target.value)} className="mt-1 h-9" />
            <span className="text-xs text-muted-foreground">The next instalment falls due 29 days after this, once finance approves it.</span>
          </label>
          <label className="block">Receipt
            <Input type="file" accept="image/*,application/pdf" onChange={(e) => upload(e.target.files?.[0])} className="mt-1 h-9" />
            {uploading && <span className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Uploading…</span>}
            {receipt && <span className="text-xs text-emerald-700">Attached: {receipt.name}</span>}
          </label>
          <label className="block">Note (optional)
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 h-9" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send to finance</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A reminder on WhatsApp — from the CS's own linked WhatsApp, sent only when they press Send. */
function WhatsAppDialog({ row, onClose }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['student-whatsapp', row.student_id],
    queryFn: async () => (await base44.functions.invoke('getStudentWhatsApp', { studentId: row.student_id })).data,
  });
  const [number, setNumber] = useState('');
  useEffect(() => { if (!number && data?.numbers?.length) setNumber(data.numbers[0]); }, [data?.numbers, number]);
  const due = row.next_due_on
    ? (row.due_state === 'overdue' ? ` was due on ${fmtDay(row.next_due_on)}` : ` is due on ${fmtDay(row.next_due_on)}`)
    : ' is due';
  const [text, setText] = useState(`Hi ${firstName(row.full_name)}, a friendly reminder that your next instalment for ${row.course || 'your course'}${due}. Your balance is ${money(row.balance_minor, row.currency)}. Let me know if you need a payment link — thank you!`);
  const send = useMutation({
    mutationFn: async () => (await base44.functions.invoke('sendWhatsApp', { chat: number, text })).data,
    onSuccess: () => { toast.success('Sent on WhatsApp'); queryClient.invalidateQueries({ queryKey: ['student-whatsapp', row.student_id] }); onClose(); },
    onError: (e) => toast.error(e?.message || 'Not sent on WhatsApp'),
  });
  const canSend = data?.can_send && data.numbers?.length > 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5" style={{ color: WA_GREEN }} />WhatsApp {row.full_name}</DialogTitle>
          <DialogDescription>From your own linked WhatsApp — nothing is sent until you press Send.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
        ) : !canSend ? (
          <p className="py-4 text-sm text-slate-600">
            {data?.linked === false || !data?.can_send
              ? <>Your WhatsApp is not linked. <Link to={createPageUrl('WhatsApp')} className="text-blue-600 hover:underline">Link it</Link> to message students from here.</>
              : 'No phone number on their record.'}
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            {data.numbers.length > 1 && (
              <label className="block">To
                <select value={number} onChange={(e) => setNumber(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-background px-2">
                  {data.numbers.map((n) => <option key={n} value={n}>+{n}</option>)}
                </select>
              </label>
            )}
            <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {canSend && <Button onClick={() => send.mutate()} disabled={!text.trim() || send.isPending}>{send.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BalancePayments() {
  const queryClient = useQueryClient();
  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const [tab, setTab] = useState('soon');
  const [q, setQ] = useState('');
  const [desc, setDesc] = useState(false);
  const [recording, setRecording] = useState(null);
  const [messaging, setMessaging] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['balance-payments'],
    queryFn: async () => (await base44.functions.invoke('getBalancePayments', {})).data,
    enabled: !!currentUser,
    refetchInterval: 60_000,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['balance-payments'] });
    queryClient.invalidateQueries({ queryKey: ['nav-counts'] });
  };
  // What the sidebar counts follows what is on this page.
  useEffect(() => { if (data) queryClient.invalidateQueries({ queryKey: ['nav-counts'] }); }, [data?.counts?.soon, data?.counts?.overdue]);

  const all = data?.rows || [];
  const counts = data?.counts || { all: 0, soon: 0, overdue: 0 };
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = all
      .filter(r => tab === 'all' || r.due_state === tab)
      .filter(r => !needle || [r.full_name, r.student_code, r.phone, r.email, r.course, r.invoice_number, r.primary_mentor_name].some(v => String(v || '').toLowerCase().includes(needle)));
    // By the next due date — the server's order, earliest first; those with no date yet always last.
    const undated = (r) => (r.next_due_on ? 0 : 1);
    return desc ? [...list].sort((a, b) => undated(a) - undated(b) || String(b.next_due_on).localeCompare(String(a.next_due_on))) : list;
  }, [all, tab, needle, desc]);

  const TH = ({ children, right = false }) => <th className={`whitespace-nowrap px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
  const studentUrl = (r, t) => `${createPageUrl('StudentDetail')}?id=${r.student_id}${t ? `&tab=${t}` : ''}`;

  const table = (list) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50/80">
            <TH>Student</TH><TH>CS</TH><TH>Course</TH><TH right>Total</TH><TH right>Paid</TH><TH right>Balance</TH>
            <TH>Last payment</TH>
            <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <button type="button" onClick={() => setDesc(d => !d)} className="inline-flex items-center gap-1 uppercase hover:text-slate-700">Next due <ArrowUpDown className="h-3 w-3" /></button>
            </th>
            <TH>Days left</TH><TH>Payment request</TH><TH>Actions</TH>
          </tr>
        </thead>
        <tbody>
          {list.map(r => (
            <tr key={r.key} className="border-b align-top last:border-0 hover:bg-slate-50/60">
              <td className="px-3 py-2.5">
                <Link to={studentUrl(r, 'courses')} className="font-medium text-brand-navy hover:underline">{r.full_name || 'Student'}</Link>
                <div className="font-mono text-[11px] text-slate-400">{r.student_code}</div>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{r.primary_mentor_name || <span className="text-slate-400">No CS</span>}</td>
              <td className="px-3 py-2.5">
                <div className="text-slate-800">{r.course || '—'}</div>
                {r.invoice_number && <div className="text-xs text-slate-400">{r.invoice_number}</div>}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{money(r.total_minor, r.currency)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-emerald-700">{money(r.paid_minor, r.currency)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-amber-700">{money(r.balance_minor, r.currency)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{fmtDay(r.last_paid_on)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-800">{fmtDay(r.next_due_on)}</td>
              <td className="whitespace-nowrap px-3 py-2.5"><DueBadge row={r} /></td>
              <td className="px-3 py-2.5"><RequestCell request={r.request} /></td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {r.can_record && (
                    <Button size="sm" className="h-8" onClick={() => setRecording(r)}><Plus className="h-3.5 w-3.5" /> Record next payment</Button>
                  )}
                  <Button size="sm" variant="outline" className="h-8" asChild title="Ask for or send a payment link">
                    <Link to={studentUrl(r, 'payment-links')}><CreditCard className="h-3.5 w-3.5" /> Link</Link>
                  </Button>
                  {r.can_record && (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => setMessaging(r)} title="A reminder from your WhatsApp">
                      <MessageCircle className="h-3.5 w-3.5" style={{ color: WA_GREEN }} /> WhatsApp
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-8" asChild title="Log a follow-up">
                    <Link to={studentUrl(r, 'followups')}><PhoneCall className="h-3.5 w-3.5" /> Follow-up</Link>
                  </Button>
                </div>
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
          <PageTitle eyebrow="Students" icon={Coins}>Balance payments</PageTitle>
          <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
            Students who still owe on a course from Delta finance. The next instalment falls due 29 days after their latest payment, again after every payment until the balance is 0.
            Finance emails the student 3, 2 and 1 days before; you hear at 10:00 UAE. Record a payment here with its receipt — Delta Finance approves it, then the balance updates.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {TABS.map(({ key, label, icon: Icon, on }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${tab === key ? on : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              <Icon className="h-4 w-4" />{label}
              <span className="rounded-full bg-white/70 px-1.5 text-xs font-semibold">{counts[key]}</span>
            </button>
          ))}
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Student, code, course, invoice, CS…" className="h-9 w-72 pl-9" />
              </div>
              {data && !data.finance_linked && (
                <span className="text-xs text-rose-600">The Delta Finance link is not set up on this server — payments can't be sent for approval.</span>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading || !currentUser ? (
              <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
            ) : error ? (
              <p className="py-12 text-center text-sm text-rose-600">{error.message || 'Could not load the balances'}</p>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">
                {all.length ? (needle ? 'Nobody matches this search.' : tab === 'overdue' ? 'Nothing overdue.' : 'Nothing due in the next 3 days.') : 'Nobody owes a balance — every course is paid.'}
              </p>
            ) : (
              <Paged items={rows} resetKey={`${tab}|${needle}|${desc}`}>
                {(pageRows, bar) => (<>
                  {table(pageRows)}
                  <TablePagination {...bar} />
                </>)}
              </Paged>
            )}
          </CardContent>
        </Card>
      </div>
      {recording && <RecordPaymentDialog row={recording} methods={data?.methods || []} onClose={() => setRecording(null)} onSaved={refresh} />}
      {messaging && <WhatsAppDialog row={messaging} onClose={() => setMessaging(null)} />}
    </div>
  );
}
