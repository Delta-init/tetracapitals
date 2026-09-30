import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SearchableSelect from '@/components/common/SearchableSelect';
import { AlertTriangle, Clock, Eye, Loader2, MailCheck, MailMinus, MailX, Phone } from 'lucide-react';
import { dialInfo } from './phone';

// Same lists as the CSE Follow-up Tracker sheet (the server checks them too).
export const OUTCOMES = ['DSLP', 'DQMP', 'DGMP', 'Additional Deposit / Top-up', 'Other'];
export const STAGES = ['New', 'Contacted', 'Qualified', 'Session with CM', 'Objection Stage', 'Converted', 'Lost'];
export const LOST_REASONS = [
  'Not enough capital right now', 'Trust / legitimacy concern', 'Comparing with free content',
  'Price too high', 'Needs more time to decide', 'Not interested', 'Other (see notes)',
];

export const STATUS_CLS = {
  OVERDUE: 'border-rose-200 bg-rose-50 text-rose-700',
  'DUE TODAY': 'border-amber-200 bg-amber-50 text-amber-700',
  'On Track': 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Closed: 'border-slate-200 bg-slate-100 text-slate-500',
  '-': 'border-slate-200 bg-white text-slate-400',
};
export const STAGE_CLS = {
  New: 'bg-slate-100 text-slate-700',
  Contacted: 'bg-blue-50 text-blue-700',
  Qualified: 'bg-cyan-50 text-cyan-700',
  'Session with CM': 'bg-violet-50 text-violet-700',
  'Objection Stage': 'bg-amber-50 text-amber-700',
  Converted: 'bg-emerald-50 text-emerald-700',
  Lost: 'bg-rose-50 text-rose-700',
};

export const StatusBadge = ({ status }) => <Badge variant="outline" className={STATUS_CLS[status] || STATUS_CLS['-']}>{status}</Badge>;
export const StageBadge = ({ stage }) => <Badge variant="outline" className={`border-transparent ${STAGE_CLS[stage] || ''}`}>{stage}</Badge>;

export const fmtDate = (d) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
/* ── Reminder emails (10:00 UAE, one per person per day) ─────────────────── */

const UAE_MS = 4 * 3600e3;
export const uaeToday = () => new Date(Date.now() + UAE_MS).toISOString().slice(0, 10);
const uaeHour = () => new Date(Date.now() + UAE_MS).getUTCHours();
export const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const shortDay = (d) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : '');

export const REMINDER = {
  seen: { label: 'Seen', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: Eye },
  sent: { label: 'Sent', cls: 'border-sky-200 bg-sky-50 text-sky-700', icon: MailCheck },
  failed: { label: 'Failed', cls: 'border-rose-200 bg-rose-50 text-rose-700', icon: MailX },
  skipped: { label: 'Not sent', cls: 'border-slate-200 bg-slate-50 text-slate-500', icon: MailMinus },
  sending: { label: 'Sending', cls: 'border-amber-200 bg-amber-50 text-amber-700', icon: Loader2 },
};
/** sent + opened from the email = "seen". */
export const reminderKind = (r) => (r?.status === 'sent' && r.seen_at ? 'seen' : r?.status);

export function reminderTitle(r) {
  const day = r.date === uaeToday() ? 'Today' : shortDay(r.date);
  if (r.status === 'sent') return `${day}: reminder email sent to ${r.to} at ${hhmm(r.at)}${r.seen_at ? ` · opened from the email at ${hhmm(r.seen_at)}` : ' · not opened from the email yet'}`;
  if (r.status === 'failed') return `${day}: reminder email failed — ${r.reason}`;
  if (r.status === 'skipped') return `${day}: reminder email not sent — ${r.reason}`;
  return `${day}: reminder email being sent`;
}

/**
 * A follow-up's latest reminder email: Sent / Seen / Failed / Not sent (why,
 * on hover). Due or overdue before 10:00 UAE with none yet today: "At 10:00".
 */
export function ReminderBadge({ reminder, status }) {
  const today = uaeToday();
  if ((!reminder || reminder.date !== today) && (status === 'DUE TODAY' || status === 'OVERDUE') && uaeHour() < 10) {
    return (
      <span title="Today's reminder email goes out at 10:00 UAE time" className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-slate-400">
        <Clock className="h-3 w-3" /> At 10:00
      </span>
    );
  }
  if (!reminder) return <span className="text-slate-300">—</span>;
  const k = REMINDER[reminderKind(reminder)] || REMINDER.skipped;
  const Icon = k.icon;
  const isToday = reminder.date === today;
  return (
    <span title={reminderTitle(reminder)} className="inline-flex flex-col items-start gap-0.5">
      <Badge variant="outline" className={`gap-1 whitespace-nowrap ${k.cls} ${isToday ? '' : 'opacity-60'}`}>
        <Icon className={`h-3 w-3 ${reminder.status === 'sending' ? 'animate-spin' : ''}`} />{k.label}
      </Badge>
      <span className="whitespace-nowrap text-[11px] text-slate-400">{isToday ? (reminder.status === 'sent' ? hhmm(reminder.at) : 'Today') : shortDay(reminder.date)}</span>
    </span>
  );
}

export const money = (n) => (n === null || n === undefined || n === '' ? '—' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);

/** Phone as a click-to-call link — 3CX (desktop app / web client / extension) dials tel: links. */
export function CallLink({ phone, className = '' }) {
  const info = dialInfo(phone);
  if (!info.ok) return <span className="text-slate-400" title={info.reason}>{String(phone || '').replace(/^[\s'`"]+/, '') || '—'}</span>;
  return (
    <a
      href={`tel:${info.dial}`}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-blue-700 hover:text-blue-900 hover:underline ${className}`}
      title={`Call ${info.dial} with 3CX${info.note ? ` — ${info.note}` : ''}`}
    >
      <Phone className="h-3.5 w-3.5" /> {info.dial}
    </a>
  );
}

/** Log one call / contact: new stage, what the client said, next due date, reason, conversion. */
export function LogFollowupDialog({ followup, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

  useEffect(() => {
    if (!followup) return;
    setError(null); setBusy(false);
    setForm({
      stage: followup.stage === 'New' ? 'Contacted' : followup.stage,
      clientSaid: '',
      nextFollowupDate: '',
      objectionReason: followup.objection_reason || '',
      convertedDate: followup.converted_date || today,
      dealValue: followup.deal_value ?? '',
      notes: followup.notes || '',
    });
  }, [followup]);

  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v?.target ? v.target.value : v }));
  const closed = form.stage === 'Converted' || form.stage === 'Lost';

  const save = async () => {
    if (form.stage === 'Lost' && !form.objectionReason) { setError('Pick a lost reason.'); return; }
    if (form.stage === 'Converted' && (form.dealValue === '' || Number(form.dealValue) < 0)) { setError('Enter the deal value.'); return; }
    setBusy(true); setError(null);
    try {
      await base44.functions.invoke('logFollowup', {
        id: followup.id,
        stage: form.stage,
        clientSaid: form.clientSaid || followup.client_said,
        nextFollowupDate: closed ? '' : form.nextFollowupDate,
        // The reason applies to Objection / Lost only; earlier reasons stay in the log.
        objectionReason: form.stage === 'Lost' || form.stage === 'Objection Stage' ? form.objectionReason : '',
        convertedDate: form.convertedDate,
        dealValue: form.stage === 'Converted' ? Number(form.dealValue) : undefined,
        notes: form.notes,
      });
      toast.success('Follow-up logged');
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e?.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!followup} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-brand-navy">Log follow-up · {followup?.student_name}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{followup?.target_outcome}</span>
            <CallLink phone={followup?.phone} />
            {followup?.client_said && <span className="w-full text-xs text-slate-500">Last time: “{followup.client_said}”</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Stage</Label>
            <Select value={form.stage} onValueChange={(v) => v && set('stage')(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {!closed && (
            <div className="space-y-1.5">
              <Label>Next follow-up</Label>
              <Input type="date" value={form.nextFollowupDate} min={today} onChange={set('nextFollowupDate')} />
            </div>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>What client said (follow-up reason)</Label>
            <Textarea rows={2} value={form.clientSaid} onChange={set('clientSaid')} placeholder="e.g. Needs to arrange the $5,000, call back after market close" />
          </div>
          {(form.stage === 'Lost' || form.stage === 'Objection Stage') && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Objection / lost reason{form.stage === 'Lost' ? ' *' : ''}</Label>
              <Select value={form.objectionReason || undefined} onValueChange={(v) => v && set('objectionReason')(v)}>
                <SelectTrigger><SelectValue placeholder="Pick a reason" /></SelectTrigger>
                <SelectContent>{LOST_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {form.stage === 'Converted' && (
            <>
              <div className="space-y-1.5">
                <Label>Converted date *</Label>
                <Input type="date" value={form.convertedDate} onChange={set('convertedDate')} />
              </div>
              <div className="space-y-1.5">
                <Label>Deal value (USD) *</Label>
                <Input type="number" min="0" step="0.01" value={form.dealValue} onChange={set('dealValue')} />
              </div>
            </>
          )}
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={set('notes')} />
          </div>
        </div>
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {error}
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save follow-up</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Open a follow-up: pick a student (fixed when opened from a student's page) and a target outcome. */
export function NewFollowupDialog({ open, onClose, onSaved, student = null, students = [], title = null, description = null }) {
  const [studentId, setStudentId] = useState('');
  const [outcome, setOutcome] = useState('');
  const [next, setNext] = useState('');
  const [clientSaid, setClientSaid] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

  useEffect(() => {
    if (!open) return;
    setStudentId(student?.id || ''); setOutcome(''); setNext(today); setClientSaid(''); setNotes(''); setError(null); setBusy(false);
  }, [open, student?.id]);

  const options = useMemo(() => students.map(s => ({ value: s.id, label: `${s.full_name}${s.student_code ? ` · ${s.student_code}` : ''}` })), [students]);

  const save = async () => {
    if (!studentId) { setError('Pick a student.'); return; }
    if (!outcome) { setError('Pick a target outcome.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await base44.functions.invoke('createFollowup', { studentId, targetOutcome: outcome, nextFollowupDate: next, clientSaid, notes });
      toast.success('Follow-up opened');
      onSaved?.(res?.data?.id, { studentId, targetOutcome: outcome, nextFollowupDate: next, clientSaid, notes });
      onClose();
    } catch (e) {
      setError(e?.message || 'Could not open the follow-up');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-brand-navy">{title || `New follow-up${student ? ` · ${student.full_name}` : ''}`}</DialogTitle>
          <DialogDescription>{description || 'One per target outcome — a student can have several open at once.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {!student && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Student</Label>
              <SearchableSelect value={studentId || undefined} onValueChange={(v) => v && v !== '__none__' && setStudentId(v)} options={options}
                placeholder={options.length ? 'Search your students…' : 'No students'} searchPlaceholder="Name or code…" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Target outcome</Label>
            <Select value={outcome || undefined} onValueChange={(v) => v && setOutcome(v)}>
              <SelectTrigger><SelectValue placeholder="Pick one" /></SelectTrigger>
              <SelectContent>{OUTCOMES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Next follow-up</Label>
            <Input type="date" value={next} min={today} onChange={e => setNext(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>What client said</Label>
            <Textarea rows={2} value={clientSaid} onChange={e => setClientSaid(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {error}
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Open follow-up</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
