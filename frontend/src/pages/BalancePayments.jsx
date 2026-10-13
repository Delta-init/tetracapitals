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
import { ArrowUpCircle, ClipboardList, Coins, CreditCard, Gift, Loader2, MessageCircle, PhoneCall, Plus, Search } from 'lucide-react';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { WA_GREEN } from '@/components/whatsapp/waUi';

/* ────────────────────────────────────────────────────────────────────────────
   Balance payments (backend/src/functions/balancePayments.ts; the user,
   2026-10-11, changed 2026-10-13): every student in your scope who still owes
   on a course paid in parts HERE — a CS their own, a Chief Mentor or CS
   Manager their people's, admins everyone's:
     - a course on the CS enrolment tracker part paid (DSLP, DQMP…);
     - a Bonus course payment made in parts;
     - a course upgrade still being paid.
   A course a sales CRM closed (Market Breakout…) is not here: its balance,
   next due date and payments are followed up in that sales CRM, and Delta
   finance approves them there. The next payment here is taken where it always
   was — the student's Courses card, or Course Upgrades. AED throughout.
──────────────────────────────────────────────────────────────────────────── */

const money = (minor, currency) =>
  `${currency || ''} ${(Number(minor || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
const firstName = (n) => { const f = String(n || '').trim().split(/\s+/)[0] || ''; return f ? f[0].toUpperCase() + f.slice(1) : 'there'; };

const TABS = [
  { key: 'all', label: 'All', icon: Coins, on: 'border-sky-300 bg-sky-50 text-sky-800' },
  { key: 'tracker', label: 'CS enrolment tracker', icon: ClipboardList, on: 'border-violet-300 bg-violet-50 text-violet-800' },
  { key: 'bonus', label: 'Bonus course payments', icon: Gift, on: 'border-amber-300 bg-amber-50 text-amber-800' },
  { key: 'upgrade', label: 'Course upgrades', icon: ArrowUpCircle, on: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
];

const SOURCE_TONE = {
  tracker: 'border-violet-200 bg-violet-50 text-violet-700',
  bonus: 'border-amber-200 bg-amber-50 text-amber-800',
  upgrade: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

/** A reminder on WhatsApp — from the CS's own linked WhatsApp, sent only when they press Send. */
function WhatsAppDialog({ row, onClose }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['student-whatsapp', row.student_id],
    queryFn: async () => (await base44.functions.invoke('getStudentWhatsApp', { studentId: row.student_id })).data,
  });
  const [number, setNumber] = useState('');
  useEffect(() => { if (!number && data?.numbers?.length) setNumber(data.numbers[0]); }, [data?.numbers, number]);
  const [text, setText] = useState(`Hi ${firstName(row.full_name)}, a friendly reminder about the balance of ${money(row.balance_minor, row.currency)} on ${row.course || 'your course'}. Let me know if you need a payment link — thank you!`);
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
  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [messaging, setMessaging] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['balance-payments'],
    queryFn: async () => (await base44.functions.invoke('getBalancePayments', {})).data,
    enabled: !!currentUser,
    refetchInterval: 60_000,
  });

  const all = data?.rows || [];
  const counts = data?.counts || { all: 0, tracker: 0, bonus: 0, upgrade: 0 };
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => all
    .filter(r => tab === 'all' || r.source === tab)
    .filter(r => !needle || [r.full_name, r.student_code, r.phone, r.email, r.course, r.invoice_number, r.primary_mentor_name].some(v => String(v || '').toLowerCase().includes(needle))),
  [all, tab, needle]);

  const TH = ({ children, right = false }) => <th className={`whitespace-nowrap px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
  const studentUrl = (r, t) => `${createPageUrl('StudentDetail')}?id=${r.student_id}${t ? `&tab=${t}` : ''}`;
  // Where the next payment is taken: an upgrade on Course Upgrades, the rest on the student's Courses card.
  const nextPaymentUrl = (r) => (r.source === 'upgrade' ? createPageUrl('CourseUpgrades') : studentUrl(r, 'courses'));

  const table = (list) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50/80">
            <TH>Student</TH><TH>CS</TH><TH>Course</TH><TH>Paid in parts on</TH><TH right>Total</TH><TH right>Paid</TH><TH right>Balance</TH><TH>Actions</TH>
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
              <td className="whitespace-nowrap px-3 py-2.5"><Badge variant="outline" className={SOURCE_TONE[r.source]}>{r.source_label}</Badge></td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{money(r.total_minor, r.currency)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-emerald-700">{money(r.paid_minor, r.currency)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-amber-700">{money(r.balance_minor, r.currency)}</td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {r.can_record && (
                    <Button size="sm" className="h-8" asChild title={r.source === 'upgrade' ? 'Record it on Course Upgrades' : 'Record it on their Courses card'}>
                      <Link to={nextPaymentUrl(r)}><Plus className="h-3.5 w-3.5" /> Next payment</Link>
                    </Button>
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
            Students who still owe on a course paid in parts here: on the CS enrolment tracker, a Bonus course payment, or a course upgrade.
            A course a sales CRM closed (Market Breakout and the like) is followed up in that sales CRM, where finance approves its payments.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {TABS.map(({ key, label, icon: Icon, on }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${tab === key ? on : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              <Icon className="h-4 w-4" />{label}
              <span className="rounded-full bg-white/70 px-1.5 text-xs font-semibold">{counts[key] ?? 0}</span>
            </button>
          ))}
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Student, code, course, CS…" className="h-9 w-72 pl-9" />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading || !currentUser ? (
              <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
            ) : error ? (
              <p className="py-12 text-center text-sm text-rose-600">{error.message || 'Could not load the balances'}</p>
            ) : rows.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-400">
                {all.length ? (needle ? 'Nobody matches this search.' : 'Nothing of this kind owing.') : 'Nobody owes a balance on a course paid in parts here.'}
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
      {messaging && <WhatsAppDialog row={messaging} onClose={() => setMessaging(null)} />}
    </div>
  );
}
