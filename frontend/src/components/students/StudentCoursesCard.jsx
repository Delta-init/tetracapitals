import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowUpCircle, GraduationCap, Loader2, Paperclip, Pencil, Plus, XCircle } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   CSE courses and upgrades on the student page (backend/src/functions/
   courseUpgrades.ts). Their CS enters the courses the student already has,
   once; then picks an upgrade — full payment or installments — seeing what it
   costs, the payments, and the MT5 bonus before starting it. Payments, which
   Delta finance approves, come next; until then an upgrade waits for its first.
──────────────────────────────────────────────────────────────────────────── */

export const aed = (n) => `AED ${Number(n || 0).toLocaleString('en-US')}`;
export const usd = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;

/** "2,750 + 7 × 2,000" — a payment schedule, short. */
export function scheduleText(schedule) {
  if (!schedule?.length) return '—';
  if (schedule.length === 1) return Number(schedule[0]).toLocaleString('en-US');
  const [first, ...rest] = schedule;
  const same = rest.every((x) => x === rest[0]);
  if (same && first === rest[0]) return `${schedule.length} × ${Number(first).toLocaleString('en-US')}`;
  if (same) return `${Number(first).toLocaleString('en-US')} + ${rest.length} × ${Number(rest[0]).toLocaleString('en-US')}`;
  return schedule.map((x) => Number(x).toLocaleString('en-US')).join(' + ');
}

export const UPGRADE_STATUS = {
  open: { label: 'In progress', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  done: { label: 'Paid', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  cancelled: { label: 'Cancelled', cls: 'border-slate-200 bg-slate-100 text-slate-500' },
};
export function UpgradeStatusBadge({ status }) {
  const s = UPGRADE_STATUS[status] || UPGRADE_STATUS.cancelled;
  return <Badge variant="outline" className={`whitespace-nowrap ${s.cls}`}>{s.label}</Badge>;
}

export default function StudentCoursesCard({ student }) {
  const queryClient = useQueryClient();
  const [entering, setEntering] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [paying, setPaying] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['student-courses', student.id],
    queryFn: async () => (await base44.functions.invoke('getStudentCourses', { studentId: student.id })).data,
    enabled: !!student?.id,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['student-courses', student.id] });
    queryClient.invalidateQueries({ queryKey: ['course-upgrades'] });
  };
  const cancel = useMutation({
    mutationFn: async (upgradeId) => (await base44.functions.invoke('cancelCourseUpgrade', { upgradeId })).data,
    onSuccess: () => { toast.success('Upgrade cancelled'); refresh(); },
    onError: (e) => toast.error(e?.message || 'Could not cancel it'),
  });

  if (isLoading) return <Card className="mb-4"><CardContent className="p-6 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading courses…</CardContent></Card>;
  if (error) return <Card className="mb-4"><CardContent className="p-6 text-sm text-rose-600">{error.message || 'Could not load the courses'}</CardContent></Card>;
  const a = data.active;
  const canEnter = data.canWork && !a && !data.past.some((u) => u.status === 'done');

  return (
    <Card className="mb-4 border-gray-200">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><GraduationCap className="h-4 w-4 text-brand-navy" /> CSE courses &amp; upgrades</CardTitle>
        <div className="flex gap-2">
          {canEnter && (
            <Button size="sm" variant="outline" onClick={() => setEntering(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />{data.entered ? 'Edit current courses' : 'Enter current courses'}
            </Button>
          )}
          {data.canWork && data.entered && !a && data.options.length > 0 && (
            <Button size="sm" onClick={() => setUpgrading(true)} className="bg-brand-navy hover:bg-brand-navy/90">
              <ArrowUpCircle className="mr-1.5 h-3.5 w-3.5" />Upgrade
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data.entered ? (
          <p className="text-sm text-muted-foreground">
            Their current courses haven&apos;t been entered yet. {data.canWork ? 'Enter them first — every upgrade is worked out from them.' : 'Their CS enters them.'}
          </p>
        ) : (
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Has</p>
            <div className="flex flex-wrap gap-2">
              {data.owned.map((o) => (
                <Badge key={o.code} variant="outline" className="gap-1 py-1">{o.name} <span className="text-muted-foreground">· {aed(o.paidAed)}</span></Badge>
              ))}
              {!data.owned.length && <span className="text-sm text-muted-foreground">No courses entered</span>}
            </div>
          </div>
        )}

        {a && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Upgrading to {a.courseName} · {a.plan === 'full' ? 'full payment' : 'installments'}</p>
              <UpgradeStatusBadge status={a.status} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Figure label="To pay" value={aed(a.quote.dueAed)} />
              <Figure label="Paid" value={aed(a.progress.paidAed)} />
              <Figure label="Balance" value={aed(a.progress.balanceAed)} strong />
              <Figure label="Next payment" value={a.progress.done ? '—' : aed(a.nextPaymentAed)} />
              <Figure label="Payments" value={scheduleText(a.quote.schedule)} />
              <Figure label="On hold" value={aed(a.progress.onHoldAed)} />
              <Figure label="MT5 bonus" value={`${usd(a.progress.bonusEarnedUsd)} of ${usd(a.quote.bonusUsd)}`} />
              <Figure label="Started" value={`${a.createdBy || ''}`} />
            </div>
            {a.quote.noBonusAed > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">The first payment includes {aed(a.quote.noBonusAed)} that earns no bonus.</p>
            )}
            <PaymentsList payments={a.payments} />
            <div className="mt-2 flex flex-wrap gap-2">
              {data.canWork && !a.progress.done && a.progress.balanceAed - a.pendingAed > 0 && (
                <Button size="sm" onClick={() => setPaying(true)} className="bg-brand-navy hover:bg-brand-navy/90">
                  <Plus className="mr-1.5 h-3.5 w-3.5" />Record payment
                </Button>
              )}
            {data.canWork && !a.payments.some((p) => p.status !== 'rejected') && (
              <Button size="sm" variant="ghost" className="mt-2 text-rose-600" disabled={cancel.isPending} onClick={() => cancel.mutate(a.id)}>
                <XCircle className="mr-1.5 h-3.5 w-3.5" />Cancel upgrade
              </Button>
            )}
            </div>
            {a.pendingAed > 0 && <p className="mt-2 text-xs text-muted-foreground">{aed(a.pendingAed)} is waiting for Delta Finance to approve — it counts once approved.</p>}
          </div>
        )}

        {data.past.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Earlier upgrades</p>
            <ul className="space-y-1 text-sm">
              {data.past.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-2">
                  <UpgradeStatusBadge status={u.status} /> {u.courseName} · {aed(u.quote.dueAed)} · {usd(u.quote.bonusUsd)} bonus
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>

      {entering && <EnterCoursesDialog student={student} owned={data.owned} onClose={() => setEntering(false)} onSaved={refresh} />}
      {paying && a && <PaymentDialog upgrade={a} onClose={() => setPaying(false)} onSaved={refresh} />}
      {upgrading && <UpgradeDialog student={student} options={data.options} onClose={() => setUpgrading(false)} onSaved={refresh} />}
    </Card>
  );
}

const PAYMENT_STATUS = {
  pending: { label: 'With finance', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  approved: { label: 'Approved', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  rejected: { label: 'Rejected', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
};

/** Each payment recorded on the upgrade, and where it stands with Delta Finance. */
function PaymentsList({ payments }) {
  if (!payments?.length) return <p className="mt-3 text-xs text-muted-foreground">No payments recorded yet. Record each one with its receipt — Delta Finance approves it.</p>;
  return (
    <ul className="mt-3 divide-y rounded-md border bg-white text-sm">
      {payments.map((p) => {
        const st = PAYMENT_STATUS[p.status] || PAYMENT_STATUS.pending;
        return (
          <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <Badge variant="outline" className={st.cls}>{st.label}</Badge>
            <span className="font-medium tabular-nums">{aed(p.approvedAed ?? p.amountAed)}</span>
            <span className="text-muted-foreground">{p.method}{p.paidOn ? ` · ${p.paidOn}` : ''}{p.recordedBy ? ` · by ${p.recordedBy}` : ''}</span>
            {p.receiptUrl && <a href={p.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-navy hover:underline"><Paperclip className="h-3 w-3" />Receipt</a>}
            {p.status === 'pending' && !p.sent && <span className="text-xs text-muted-foreground">sending to finance…</span>}
            {p.status === 'rejected' && p.reason && <span className="w-full text-xs text-rose-600">{p.reason}</span>}
            {p.status === 'approved' && p.transactionId && <span className="text-xs text-muted-foreground">{p.transactionId}</span>}
          </li>
        );
      })}
    </ul>
  );
}

const METHODS = ['Card', 'Cash', 'Bank transfer', 'Payment link', 'Tabby'];

/** The CS records a payment the student made, with its receipt; it goes to Delta Finance to approve. */
function PaymentDialog({ upgrade, onClose, onSaved }) {
  const room = Math.max(0, upgrade.progress.balanceAed - upgrade.pendingAed);
  const [amount, setAmount] = useState(String(Math.min(upgrade.nextPaymentAed || room, room)));
  const [method, setMethod] = useState('Card');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
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
  const save = useMutation({
    mutationFn: async () => (await base44.functions.invoke('recordCoursePayment', {
      upgradeId: upgrade.id, amountAed: Number(amount), method, receiptUrl: receipt?.url, receiptName: receipt?.name, paidOn, note,
    })).data,
    onSuccess: () => { toast.success('Payment recorded — sent to Delta Finance for approval'); onSaved(); onClose(); },
    onError: (e) => toast.error(e?.message || 'Could not record the payment'),
  });
  const n = Number(amount);
  const valid = n > 0 && n <= room && receipt && !uploading;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>{upgrade.courseName} upgrade · up to {aed(room)} left to record. Delta Finance approves it; it counts once approved.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block">Amount (AED)
            <Input type="number" min="0" max={room} value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 h-9" />
          </label>
          <label className="block">Method
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 h-9 w-full rounded-md border bg-background px-2">
              {METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label className="block">Paid on
            <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="mt-1 h-9" />
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

function Figure({ label, value, strong }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={strong ? 'font-semibold text-brand-navy' : 'font-medium'}>{value}</p>
    </div>
  );
}

/** The courses a student already has, and what they paid — entered once by their CS. */
function EnterCoursesDialog({ student, owned, onClose, onSaved }) {
  const { data: prices } = useQuery({
    queryKey: ['course-price-list'],
    queryFn: async () => (await base44.functions.invoke('getCoursePriceList', {})).data,
  });
  const start = Object.fromEntries((owned || []).map((o) => [o.code, String(o.paidAed)]));
  // Every student starts from MBT, handed over from Sales.
  if (!owned?.length) start.MBT = '2250';
  const [paid, setPaid] = useState(start);
  const save = useMutation({
    mutationFn: async () => (await base44.functions.invoke('setStudentCourses', {
      studentId: student.id,
      courses: Object.entries(paid).filter(([, v]) => v !== '' && v !== undefined).map(([code, v]) => ({ code, paidAed: Number(v) })),
    })).data,
    onSuccess: () => { toast.success('Courses saved'); onSaved(); onClose(); },
    onError: (e) => toast.error(e?.message || 'Could not save the courses'),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Current courses</DialogTitle>
          <DialogDescription>Tick the courses {student.full_name} already has and enter what they paid for each, in AED. Upgrades are worked out from these.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {(prices?.courses || []).map((c) => {
            const on = paid[c.code] !== undefined;
            return (
              <div key={c.code} className="flex items-center gap-3">
                <label className="flex w-40 items-center gap-2 text-sm">
                  <input type="checkbox" checked={on} onChange={(e) => setPaid((p) => { const n = { ...p }; if (e.target.checked) n[c.code] = String(c.fullAed); else delete n[c.code]; return n; })} />
                  {c.name}
                </label>
                <Input type="number" min="0" disabled={!on} value={on ? paid[c.code] : ''} placeholder="Paid (AED)" className="h-8"
                  onChange={(e) => setPaid((p) => ({ ...p, [c.code]: e.target.value }))} />
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Pick the course and how they pay; see what it costs and brings before starting. */
function UpgradeDialog({ student, options, onClose, onSaved }) {
  const [pick, setPick] = useState(null); // { code, plan }
  const chosen = pick && options.find((o) => o.code === pick.code)?.[pick.plan === 'full' ? 'full' : 'installments'];
  const start = useMutation({
    mutationFn: async () => (await base44.functions.invoke('startCourseUpgrade', { studentId: student.id, course: pick.code, plan: pick.plan })).data,
    onSuccess: () => { toast.success('Upgrade started'); onSaved(); onClose(); },
    onError: (e) => toast.error(e?.message || 'Could not start the upgrade'),
  });
  const Option = ({ o, plan, q }) => {
    if (!q) return <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">{plan === 'full' ? 'Full' : 'Installments'}: not offered</div>;
    const on = pick?.code === o.code && pick?.plan === plan;
    return (
      <button type="button" onClick={() => setPick({ code: o.code, plan })}
        className={`rounded-md border p-2 text-left text-xs transition-colors ${on ? 'border-brand-navy bg-brand-navy/5 ring-1 ring-brand-navy' : 'hover:border-brand-navy/50'}`}>
        <p className="font-semibold">{plan === 'full' ? 'Full payment' : 'Installments'}</p>
        <p>{aed(q.dueAed)}</p>
        <p className="text-muted-foreground">{plan === 'full' ? 'one payment' : scheduleText(q.schedule)}</p>
        <p className="text-emerald-700">+{usd(q.bonusUsd)} MT5</p>
      </button>
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upgrade {student.full_name}</DialogTitle>
          <DialogDescription>Prices take off what they already paid for the courses each one includes.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {options.map((o) => (
            <div key={o.code} className="grid grid-cols-[8rem_1fr_1fr] items-stretch gap-2">
              <p className="self-center text-sm font-medium">{o.name}</p>
              <Option o={o} plan="full" q={o.full} />
              <Option o={o} plan="installments" q={o.installments} />
            </div>
          ))}
        </div>
        {chosen && (
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            {chosen.deductions?.length > 0 && <p className="text-xs text-muted-foreground">Taken off: {chosen.deductions.map((d) => `${d.code} ${aed(d.aed)}`).join(', ')}</p>}
            <p>Student pays <b>{aed(chosen.dueAed)}</b> as {scheduleText(chosen.schedule)} · MT5 bonus <b>+{usd(chosen.bonusUsd)}</b></p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => start.mutate()} disabled={!chosen || start.isPending}>{start.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Start upgrade</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
