import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CheckCircle2, Loader2, Mail, MessageCircle, RotateCcw, Send } from 'lucide-react';
import { isAdminRole } from '@/components/utils/roles';
import { isStudentOf } from '@/components/students/common';

/* ────────────────────────────────────────────────────────────────────────────
   Onboarded or not. Switching it on opens the welcome — an email and a
   WhatsApp, written for the student — to change and send; they are marked
   Onboarded once it has gone (or, for students welcomed before, without
   sending). The email goes from the portal's mailbox as "Delta Institutions",
   a reply to whoever sent it; the WhatsApp from the CS's own linked WhatsApp
   (backend/src/functions/studentOnboarding.ts). Changed by the same people as
   Enrolled; each change is in the student's history.
──────────────────────────────────────────────────────────────────────────── */

export const isOnboarded = (s) => s?.onboarded === true;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const when = (s) => `${s?.onboarded_at ? ` · ${day(s.onboarded_at)}` : ''}${s?.onboarded_by_name ? ` by ${s.onboarded_by_name}` : ''}`;
const stop = (e) => e.stopPropagation();   // opened from clickable table rows

/** Shown to whoever the server would let change it; anyone else just sees Yes / No. */
const mayChange = (user, student) =>
  !!user && (isAdminRole(user.app_role) || isStudentOf(student, user.id) || ['chief_mentor', 'cs_manager'].includes(user.app_role));

/** After a change: the Students list shows it at once, and whatever shows the student is fetched again. */
function useRefresh(student) {
  const queryClient = useQueryClient();
  return (on) => {
    queryClient.setQueriesData({ queryKey: ['students', 'page'] }, (d) => (d?.rows ? { ...d, rows: d.rows.map(s => (s.id === student.id ? { ...s, onboarded: on } : s)) } : d));
    queryClient.invalidateQueries({ queryKey: ['students'] });
    queryClient.invalidateQueries({ queryKey: ['student', student.id] });
    queryClient.invalidateQueries({ queryKey: ['student-history', student.id] });
  };
}

/** The welcome, to change and send — or to mark them onboarded without it. */
export function OnboardingDialog({ student, open, onOpenChange }) {
  const refresh = useRefresh(student);
  const name = student?.full_name || 'Student';
  const { data: draft, isLoading, error } = useQuery({
    queryKey: ['onboarding-draft', student.id],
    queryFn: async () => (await base44.functions.invoke('getOnboardingDraft', { studentId: student.id })).data,
    enabled: open,
    gcTime: 0,
  });
  const [email, setEmail] = useState({ on: false, to: '', subject: '', body: '' });
  const [wa, setWa] = useState({ on: false, to: '', text: '' });
  const [busy, setBusy] = useState(false);
  const filled = useRef(false);
  useEffect(() => {
    if (!draft || filled.current) return;
    filled.current = true;
    setEmail({ on: draft.email.can_send && !!draft.email.to, to: draft.email.to, subject: draft.email.subject, body: draft.email.body });
    setWa({ on: draft.whatsapp.can_send && !!draft.whatsapp.to, to: draft.whatsapp.to, text: draft.whatsapp.text });
  }, [draft]);

  const again = !!draft?.onboarded;
  const close = (o) => { if (!busy) onOpenChange(o); };
  const send = async () => {
    setBusy('send');
    try {
      const res = (await base44.functions.invoke('setOnboarding', {
        studentId: student.id, onboarded: true,
        ...(email.on ? { email: { to: email.to, subject: email.subject, body: email.body } } : {}),
        ...(wa.on ? { whatsapp: { to: wa.to, text: wa.text } } : {}),
      })).data;
      const went = [res?.sent?.email && 'email', res?.sent?.whatsapp && 'WhatsApp'].filter(Boolean).join(' and ');
      toast.success(`${name} ${again ? '— onboarding sent again' : 'onboarded'}: ${went} sent`);
      if (res?.failed?.email) toast.warning(`The email did not go: ${res.failed.email}`);
      if (res?.failed?.whatsapp) toast.warning(`The WhatsApp did not go: ${res.failed.whatsapp}`);
      refresh(true);
      onOpenChange(false);
    } catch (e) {
      toast.error(e?.message || 'Nothing was sent');
    } finally {
      setBusy(false);
    }
  };
  const markOnly = async () => {
    setBusy('mark');
    try {
      await base44.functions.invoke('setOnboarding', { studentId: student.id, onboarded: true });
      toast.success(`${name} marked as onboarded — nothing sent`);
      refresh(true);
      onOpenChange(false);
    } catch (e) {
      toast.error(e?.message || 'Could not mark them onboarded');
    } finally {
      setBusy(false);
    }
  };

  const ready = (email.on && email.to.trim() && email.subject.trim() && email.body.trim()) || (wa.on && wa.to.trim() && wa.text.trim());
  const channel = (icon, label, value, onToggle, canSend, whyNot, children) => (
    <section className={`space-y-2 rounded-xl border p-3 ${value ? 'border-teal-200 bg-teal-50/30' : 'border-slate-200'}`}>
      <label className={`flex items-center gap-2 text-sm font-medium ${canSend ? 'cursor-pointer' : 'text-slate-400'}`}>
        <Checkbox checked={value} disabled={!canSend || !!busy} onCheckedChange={(v) => onToggle(!!v)} />
        {icon}{label}
      </label>
      {whyNot && <p className="text-xs text-amber-700">{whyNot}</p>}
      <div className={`space-y-2 ${value ? '' : 'opacity-60'}`}>{children}</div>
    </section>
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" onClick={stop}>
        <DialogHeader>
          <DialogTitle>{again ? `Send ${name}'s onboarding again` : `Onboard ${name}`}</DialogTitle>
          <DialogDescription>
            Check the welcome, change anything you like, and send it. {again ? 'They are already onboarded.' : 'They are marked Onboarded once it has gone.'}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Writing their welcome…</div>
        ) : error ? (
          <p className="py-6 text-center text-sm text-red-600">{error.message || 'Could not open their onboarding'}</p>
        ) : draft && (
          <div className="space-y-3">
            {channel(<Mail className="h-4 w-4 text-slate-500" />, 'Email', email.on, (on) => setEmail(v => ({ ...v, on })), draft.email.can_send, draft.email.why_not, (
              <>
                <div>
                  <Label htmlFor="onb-email-to">To</Label>
                  <Input id="onb-email-to" type="email" value={email.to} disabled={!email.on || !!busy} onChange={(e) => setEmail(v => ({ ...v, to: e.target.value }))} placeholder="student@example.com" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="onb-email-subject">Subject</Label>
                  <Input id="onb-email-subject" value={email.subject} disabled={!email.on || !!busy} onChange={(e) => setEmail(v => ({ ...v, subject: e.target.value }))} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="onb-email-body">Message</Label>
                  <Textarea id="onb-email-body" rows={11} value={email.body} disabled={!email.on || !!busy} onChange={(e) => setEmail(v => ({ ...v, body: e.target.value }))} className="mt-1 text-sm" />
                </div>
                <p className="text-xs text-slate-500">From “Delta Institutions”{draft.email.reply_to ? ` · replies go to ${draft.email.reply_to}` : ''}</p>
              </>
            ))}
            {channel(<MessageCircle className="h-4 w-4 text-emerald-600" />, 'WhatsApp', wa.on, (on) => setWa(v => ({ ...v, on })), draft.whatsapp.can_send, draft.whatsapp.why_not, (
              <>
                <div>
                  <Label htmlFor="onb-wa-to">Number</Label>
                  <Input id="onb-wa-to" list="onb-wa-numbers" value={wa.to} disabled={!wa.on || !!busy} onChange={(e) => setWa(v => ({ ...v, to: e.target.value }))} placeholder="971501234567" className="mt-1" />
                  <datalist id="onb-wa-numbers">{(draft.whatsapp.numbers || []).map(n => <option key={n} value={n} />)}</datalist>
                </div>
                <div>
                  <Label htmlFor="onb-wa-text">Message</Label>
                  <Textarea id="onb-wa-text" rows={6} value={wa.text} disabled={!wa.on || !!busy} onChange={(e) => setWa(v => ({ ...v, text: e.target.value }))} className="mt-1 text-sm" />
                </div>
                <p className="text-xs text-slate-500">From your own WhatsApp — it shows in your chats on the WhatsApp page.</p>
              </>
            ))}
            {draft.sent_before?.at && (
              <p className="text-xs text-slate-500">
                Sent before on {day(draft.sent_before.at)}{draft.sent_before.by_name ? ` by ${draft.sent_before.by_name}` : ''}
                {draft.sent_before.email ? ` · email to ${draft.sent_before.email.to}` : ''}{draft.sent_before.whatsapp ? ` · WhatsApp to ${draft.sent_before.whatsapp.to}` : ''}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {!again ? (
            <Button variant="ghost" className="text-slate-600" onClick={markOnly} disabled={!!busy || isLoading}>
              {busy === 'mark' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Mark onboarded without sending
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => close(false)} disabled={!!busy}>Cancel</Button>
            <Button onClick={send} disabled={!!busy || isLoading || !ready} className="bg-teal-600 hover:bg-teal-700">
              {busy === 'send' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {again ? 'Send again' : 'Send & mark onboarded'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Switching them back to Not onboarded — nothing is sent. */
function useUnmark(student) {
  const refresh = useRefresh(student);
  return async () => {
    await base44.functions.invoke('setOnboarding', { studentId: student.id, onboarded: false });
    refresh(false);
    toast.success(`${student.full_name || 'Student'} marked as not onboarded`);
  };
}

/**
 * The Students table's Onboarded: a switch for whoever may change it (on → the welcome to send), Yes / No for
 * anyone else. It is a button, so clicking it never opens the student.
 */
export function OnboardedSwitch({ student, currentUser }) {
  const unmark = useUnmark(student);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const on = isOnboarded(student);
  const title = on ? `Onboarded${when(student)}` : 'Not onboarded yet';
  if (!mayChange(currentUser, student)) {
    return <Badge variant="outline" className={on ? 'border-teal-200 bg-teal-50 text-teal-700' : 'border-slate-200 bg-slate-50 text-slate-500'} title={title}>{on ? 'Yes' : 'No'}</Badge>;
  }
  const flip = async (next) => {
    if (next) { setAsking(true); return; }   // the welcome is sent first
    setBusy(true);
    try { await unmark(); } catch (e) { toast.error(e?.message || 'Could not change it'); } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={title}>
      <Switch checked={on} disabled={busy} onCheckedChange={flip} aria-label={`${student.full_name || 'Student'} onboarded`} />
      <span className={`text-xs ${on ? 'font-medium text-teal-700' : 'text-slate-500'}`}>{on ? 'Onboarded' : 'Not onboarded'}</span>
      {asking && <span onClick={stop}><OnboardingDialog student={student} open onOpenChange={setAsking} /></span>}
    </span>
  );
}

/** The student page's Onboarding: the badge, and send (or send again) / mark not onboarded. */
export function OnboardingControl({ student, currentUser }) {
  const unmark = useUnmark(student);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const on = isOnboarded(student);
  const off = async () => {
    setBusy(true);
    try { await unmark(); } catch (e) { toast.error(e?.message || 'Could not change it'); } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm text-slate-500">Onboarding</span>
      <Badge variant="outline" className={on ? 'border-teal-200 bg-teal-50 text-teal-700' : 'border-slate-200 bg-slate-50 text-slate-600'} title={on ? `Onboarded${when(student)}` : 'Not onboarded yet'}>
        {on ? 'Onboarded' : 'Not onboarded'}
      </Badge>
      {mayChange(currentUser, student) && (
        <>
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={() => setAsking(true)}>
            <Send className="h-3 w-3" />{on ? 'Send onboarding again' : 'Onboard'}
          </Button>
          {on && (
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={off}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}Mark as not onboarded
            </Button>
          )}
        </>
      )}
      {asking && <OnboardingDialog student={student} open onOpenChange={setAsking} />}
    </span>
  );
}
