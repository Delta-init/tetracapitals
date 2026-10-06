import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { AlertTriangle, Clock, Eye, Gift, Loader2, MailCheck, MailMinus, MailX, Phone } from 'lucide-react';
import { dialInfo } from './phone';
import { HistoryEntry } from './FollowupNotes';
import { Mt5LoginField, useStudentMt5 } from '../students/mt5Accounts';

// Same lists as the CSE Follow-up Tracker sheet (the server checks them too).
export const OUTCOMES = ['DSLP', 'DQMP', 'DGMP', 'Additional Deposit / Top-up', 'Onboarding call', 'Other'];
export const STAGES = ['New', 'Contacted', 'Qualified', 'Session with CM', 'Objection Stage', 'Converted', 'Lost'];
export const LOST_REASONS = [
  'Not enough capital right now', 'Trust / legitimacy concern', 'Comparing with free content',
  'Price too high', 'Needs more time to decide', 'Not interested', 'Other (see notes)',
];

export const STATUS_CLS = {
  OVERDUE: 'border-rose-200 bg-rose-50 text-rose-700',
  'DUE TODAY': 'border-amber-200 bg-amber-50 text-amber-700',
  TOMORROW: 'border-sky-200 bg-sky-50 text-sky-700',
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
/** What the sales close promised (finance's course fees): each course's bonus — or that none was given, or not known. */
export function SalesBonusNote({ bonuses, className = '' }) {
  const list = Array.isArray(bonuses) ? bonuses : [];
  const money = (b) => `${b.currency === 'USD' ? '$' : `${b.currency} `}${Number(b.amount || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return (
    <div className={`flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm ${className}`}>
      <Gift className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
      <div className="min-w-0">
        <p className="font-medium text-amber-900">Bonus at the sales close</p>
        {list.length === 0
          ? <p className="text-xs text-amber-800/80">Not known — finance didn't say for this student.</p>
          : list.map((b, i) => (
            <p key={i} className="text-xs text-amber-900">
              {b.given ? <strong>{money(b)}</strong> : 'No bonus'}{b.course ? ` · ${b.course}` : ''}{b.invoice_number ? ` · invoice ${b.invoice_number}` : ''}
            </p>
          ))}
      </div>
    </div>
  );
}

const MT5_LOGIN = /^\d{4,15}$/;

export function LogFollowupDialog({ followup, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  // What was said and noted on this follow-up before — this log adds to it, never overwrites it.
  const { data: past } = useQuery({
    queryKey: ['followups', 'student', followup?.student_id],
    queryFn: async () => (await base44.functions.invoke('getFollowups', { studentId: followup.student_id })).data,
    enabled: !!followup?.student_id,
  });
  const earlierSaid = (past?.history?.client_said || []).filter(e => e.followup_id === followup?.id);
  const earlierNotes = (past?.history?.notes || []).filter(e => e.followup_id === followup?.id);
  // The student's MT5 — picked from their saved ones or typed, and kept as theirs whenever it is given; after a call
  // that connected, the sales close's bonus goes to the admins to credit in the one given (backend logFollowup).
  const mt5s = past?.mt5 || [];
  // After a call from the Not onboarded page: did it connect? Not connected — the MT5 not required, next follow-up today.
  const askConnected = !!followup?.ask_connected;
  // The onboarding call: that one, or the call after the welcome — CallFlow's suggested outcome, or a follow-up opened for it.
  const onboardingCall = askConnected || (followup?.suggested_outcome || followup?.target_outcome) === 'Onboarding call';
  // A bonus finance says was given at the sales close — raised to be credited in the MT5 given (backend logFollowup).
  const bonusGiven = (past?.sales_bonus || []).some(b => b.given && b.amount > 0);
  // Required on the onboarding call only, for a student with none saved: from the Not onboarded page once it connected,
  // after the welcome only when they have that bonus; optional on every other follow-up (the user, 2026-10-06).
  const needsMt5 = !!past && mt5s.length === 0 && (askConnected ? form.connected === 'yes' : onboardingCall && bonusGiven);
  // Where that bonus goes, their primary is picked for them: on the Not onboarded page's call, and after the welcome
  // when they have the bonus.
  const picksPrimary = askConnected || (onboardingCall && bonusGiven);

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
      notes: '',
      mt5: '',
      // What the call is about: the follow-up's own — or, for the call after onboarding, "Onboarding call" (CallFlow).
      targetOutcome: followup.suggested_outcome || followup.target_outcome || '',
      connected: '',
    });
  }, [followup]);

  // Their primary MT5 picked for them (picksPrimary), once their logins and bonus are known. Picked here, after the
  // reset above: the field's own effect runs first and would be wiped by it.
  const { data: mt5Accounts = [], isFetched: mt5Fetched } = useStudentMt5(followup?.student_id);
  const pickedFor = useRef(null);
  useEffect(() => {
    if (!followup) { pickedFor.current = null; return; }
    if (!mt5Fetched || !past || pickedFor.current === followup) return;
    pickedFor.current = followup;
    const primary = mt5Accounts[0]?.mt5_login;
    if (picksPrimary && primary) setForm(f => (f.mt5 ? f : { ...f, mt5: String(primary) }));
  }, [followup, mt5Fetched, past]);

  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v?.target ? v.target.value : v }));
  const closed = form.stage === 'Converted' || form.stage === 'Lost';

  const save = async () => {
    if (form.stage === 'Lost' && !form.objectionReason) { setError('Pick a lost reason.'); return; }
    if (form.stage === 'Converted' && (form.dealValue === '' || Number(form.dealValue) < 0)) { setError('Enter the deal value.'); return; }
    if (askConnected && !form.connected) { setError('Did the call connect? Pick Connected or Not connected.'); return; }
    const mt5 = String(form.mt5 || '').replace(/\s+/g, '');
    if (needsMt5 && !MT5_LOGIN.test(mt5)) {
      setError(`Enter the student's MT5 ID — its login number, digits only. ${askConnected ? 'The onboarding call needs one until they have one saved.' : 'Their sales-close bonus is credited in it.'}`);
      return;
    }
    // Picked or typed even when not needed: kept as theirs (a saved one stays as it is) — so a login number too.
    const sendMt5 = !!mt5;
    if (sendMt5 && !MT5_LOGIN.test(mt5)) { setError("The MT5 ID is its login number — digits only."); return; }
    setBusy(true); setError(null);
    try {
      const res = (await base44.functions.invoke('logFollowup', {
        id: followup.id,
        stage: form.stage,
        // Only what was written now: the earlier entries are kept as they are.
        clientSaid: form.clientSaid,
        nextFollowupDate: closed ? '' : form.nextFollowupDate,
        // The reason applies to Objection / Lost only; earlier reasons stay in the log.
        objectionReason: form.stage === 'Lost' || form.stage === 'Objection Stage' ? form.objectionReason : '',
        convertedDate: form.convertedDate,
        dealValue: form.stage === 'Converted' ? Number(form.dealValue) : undefined,
        notes: form.notes,
        ...(sendMt5 ? { mt5Login: mt5 } : {}),
        ...(askConnected ? { connected: form.connected === 'yes' } : {}),
        ...(form.targetOutcome && form.targetOutcome !== followup.target_outcome ? { targetOutcome: form.targetOutcome } : {}),
      })).data;
      toast.success(['Follow-up logged', res?.mt5_saved && 'MT5 saved', res?.bonus_credits && 'the sales-close bonus went to the admins to credit'].filter(Boolean).join(' · '));
      onSaved?.();
      onClose();
      // A connected call from the Not onboarded page: on to their welcome.
      if (askConnected && form.connected === 'yes') {
        window.dispatchEvent(new CustomEvent('portal:onboarding-call-connected', {
          detail: { id: followup.student_id, full_name: followup.student_name, phone: followup.phone },
        }));
      }
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
          </DialogDescription>
        </DialogHeader>

        {(earlierSaid.length > 0 || earlierNotes.length > 0) && (
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
            {earlierSaid.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">What the client said before</p>
                <ul className="space-y-1.5">{earlierSaid.map((e, i) => <HistoryEntry key={`s${i}`} e={e} quote showFollowup={false} />)}</ul>
              </div>
            )}
            {earlierNotes.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Notes before</p>
                <ul className="space-y-1.5">{earlierNotes.map((e, i) => <HistoryEntry key={`n${i}`} e={e} showFollowup={false} />)}</ul>
              </div>
            )}
          </div>
        )}

        {askConnected && (
          <div className="space-y-1.5">
            <Label>Call connected? *</Label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={form.connected === 'yes' ? 'default' : 'outline'} aria-pressed={form.connected === 'yes'}
                onClick={() => setForm(f => ({ ...f, connected: 'yes' }))}>Connected</Button>
              <Button type="button" size="sm" variant={form.connected === 'no' ? 'destructive' : 'outline'} aria-pressed={form.connected === 'no'}
                onClick={() => setForm(f => ({ ...f, connected: 'no', nextFollowupDate: f.nextFollowupDate || today }))}>Not connected</Button>
            </div>
            <p className="text-[11px] text-slate-400">{form.connected === 'no' ? 'Next follow-up today — they stay Not connected on the Not onboarded page' : form.connected === 'yes' ? 'Their welcome opens after you save' : ''}</p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            {/* Their saved logins to pick, or a new one typed. Picked for them only where the sales-close bonus is credited
                in the one given (picksPrimary, above); an ordinary follow-up leaves it to the CS. */}
            <Mt5LoginField
              id="log-mt5"
              studentId={followup?.student_id}
              value={form.mt5 || ''}
              onChange={set('mt5')}
              label={`MT5 ID${needsMt5 ? ' *' : ' (optional)'}`}
              prefill={false}
              newNote="saved as their MT5 account"
            />
            {picksPrimary && mt5s.length > 0 && <p className="text-[11px] text-slate-400">A sales-close bonus is credited in the one picked</p>}
          </div>
          <SalesBonusNote bonuses={past?.sales_bonus} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Target outcome</Label>
            <Select value={form.targetOutcome || undefined} onValueChange={(v) => v && set('targetOutcome')(v)}>
              <SelectTrigger><SelectValue placeholder="Pick a target outcome" /></SelectTrigger>
              <SelectContent>{OUTCOMES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </div>
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
          <Button onClick={save} disabled={busy || !past}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save follow-up</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Open, not Converted or Lost — a student has one at a time (backend createFollowup). */
export const isOpenFollowup = (f) => !!f && f.followup_status !== 'Closed' && f.stage !== 'Converted' && f.stage !== 'Lost';

/**
 * Open a follow-up: pick a student (fixed when opened from a student's page) and a target outcome. One per student
 * (the user, 2026-10-04): a student who already has one open is marked in the list, and picked shows that follow-up
 * with "Log the call" (onLog) instead of opening a second — the server refuses a second too.
 */
export function NewFollowupDialog({ open, onClose, onCancel, onSaved, onLog, student = null, students = [], followups = [], title = null, description = null, defaultOutcome = '' }) {
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
    setStudentId(student?.id || ''); setOutcome(defaultOutcome || ''); setNext(today); setClientSaid(''); setNotes(''); setError(null); setBusy(false);
  }, [open, student?.id]);

  // The picked student's follow-ups: one already open means log on it, not open another.
  const { data: theirs, isFetching: checking } = useQuery({
    queryKey: ['followups', 'student', studentId],
    queryFn: async () => (await base44.functions.invoke('getFollowups', { studentId })).data,
    enabled: !!open && !!studentId,
  });
  const existing = (theirs?.followups || []).find(isOpenFollowup) || null;

  const withOne = useMemo(() => new Set(followups.filter(isOpenFollowup).map(f => f.student_id)), [followups]);
  const options = useMemo(() => students.map(s => ({
    value: s.id,
    label: `${s.full_name}${s.student_code ? ` · ${s.student_code}` : ''}${withOne.has(s.id) ? ' — has a follow-up' : ''}`,
  })), [students, withOne]);

  const save = async () => {
    if (!studentId) { setError('Pick a student.'); return; }
    if (existing) return;
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
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) { onCancel?.(); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-brand-navy">{title || `New follow-up${student ? ` · ${student.full_name}` : ''}`}</DialogTitle>
          <DialogDescription>{description || 'One follow-up per student — while it is open, each call is logged on it.'}</DialogDescription>
        </DialogHeader>
        {!student && (
          <div className="space-y-1.5">
            <Label>Student</Label>
            <SearchableSelect value={studentId || undefined} onValueChange={(v) => v && v !== '__none__' && setStudentId(v)} options={options}
              placeholder={options.length ? 'Search your students…' : 'No students'} searchPlaceholder="Name or code…" />
          </div>
        )}
        {existing ? (
          <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <p className="font-medium">{existing.student_name || student?.full_name || 'This student'} already has a follow-up</p>
            <div className="flex flex-wrap items-center gap-2 text-amber-900/90">
              <span className="font-medium">{existing.target_outcome}</span>
              <StageBadge stage={existing.stage} />
              {existing.next_followup_date && <span className="text-xs">Next follow-up {fmtDate(existing.next_followup_date)}</span>}
            </div>
            <p className="text-xs text-amber-800">One follow-up per student: log this call on it instead of opening another.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
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
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {error}
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => { onCancel?.(); onClose(); }} disabled={busy}>Cancel</Button>
          {existing ? (
            onLog && existing.can_edit !== false && (
              <Button onClick={() => { onClose(); onLog(existing); }}>Log the call</Button>
            )
          ) : (
            <Button onClick={save} disabled={busy || (!!studentId && checking)}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Open follow-up</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
