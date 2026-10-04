import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Phone, PhoneCall, PhoneOff, Smartphone } from 'lucide-react';
import { LogFollowupDialog, NewFollowupDialog, StageBadge, StatusBadge, fmtDate } from './followupUi';
import { dialInfo } from './phone';
import { useAuth } from '@/lib/AuthContext';
import { readsClosedOnly } from '@/components/utils/roles';

/* A phone call's log, kept until it is saved or put aside: following a tel: link can reload the page (some browsers,
   some phones), which would lose the window — on the way back it opens again. */
const PENDING = 'portal.pendingCallLog';
const PENDING_FOR_MS = 30 * 60_000;
const keepPending = (who, followup) => {
  try {
    sessionStorage.setItem(PENDING, JSON.stringify({
      at: Date.now(),
      who: { id: who?.id, full_name: who?.full_name, phone: who?.phone, call_for: who?.call_for, ask_connected: who?.ask_connected },
      followup: followup ? { ...followup } : null,
    }));
  } catch { /* not kept: the window still opens now */ }
};
const takePending = () => {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
    return p && Date.now() - p.at < PENDING_FOR_MS && p.who?.id ? p : null;
  } catch { return null; }
};
const dropPending = () => { try { sessionStorage.removeItem(PENDING); } catch { /* nothing kept */ } };
/** A connected onboarding call was logged (the Not onboarded page opens their welcome). */
export const ONBOARDING_CONNECTED = 'portal:onboarding-call-connected';

/* ────────────────────────────────────────────────────────────────────────────
   Call, then log. A Call button asks how to call, every time:
     - 3CX call (when the caller's 3CX extension is known and 3CX connected):
       the call starts on their 3CX web client — 3CX's own call window pops up
       there, they answer it and 3CX dials the student (backend callStudent);
       a call window here follows it from 3CX (ringing, calling, connected,
       ended) and can hang up;
     - Phone call: a tel: link for the phone app.
   Then it opens the right place to record the call:
     - a follow-up row → its Log dialog;
     - a student → their open follow-up's Log dialog (a picker for the few
       with several from before one follow-up per student); "New follow-up"
       (then Log) when they have none.
   Only for people who may log for that student (their mentor, Super Admin /
   Admin) — anyone else just dials. One set of dialogs for the whole app,
   mounted by Layout.
──────────────────────────────────────────────────────────────────────────── */

const CallFlowContext = createContext(null);
export const useCallFlow = () => useContext(CallFlowContext);

const isOpen = (f) => f.followup_status !== 'Closed' && f.stage !== 'Converted' && f.stage !== 'Lost';

export function CallFlowProvider({ children }) {
  const queryClient = useQueryClient();
  const [logging, setLogging] = useState(null);     // follow-up being logged
  const [choosing, setChoosing] = useState(null);   // { student, followups }
  const [creating, setCreating] = useState(null);   // { student, afterCall }
  const [callChoice, setCallChoice] = useState(null);   // { who, followup, info } — Call pressed: 3CX or phone?
  const [liveCall, setLiveCall] = useState(null);       // a 3CX call under way, for the call window
  const clickToCall = useClickToCall();

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['followups'] });
    queryClient.invalidateQueries({ queryKey: ['nav-counts'] });   // the sidebar's today / overdue
    queryClient.invalidateQueries({ queryKey: ['students', 'not-onboarded'] });   // a call's Connected / Not connected there
  }, [queryClient]);

  const openLog = useCallback((followup) => setLogging(followup), []);

  /** After a Call button dialled: find where to record the call. The call after onboarding (student.call_for, from
   *  components/students/onboarding.jsx) is logged as an "Onboarding call" unless the CS picks another outcome. */
  const startCall = useCallback(async (student, followup = null) => {
    if (!student?.id) return;
    const suggested = student.call_for === 'onboarding' ? 'Onboarding call' : '';
    // From the Not onboarded page: the log asks whether the call connected, and a connected one opens the welcome.
    const extra = {
      ...(suggested ? { suggested_outcome: suggested } : {}),
      ...(student.ask_connected ? { ask_connected: true } : {}),
    };
    const withOutcome = (f) => ({ ...f, ...extra });
    if (followup && followup.can_edit && isOpen(followup)) {
      setLogging(withOutcome({ ...followup, phone: followup.phone || student.phone }));
      return;
    }
    try {
      const data = (await base44.functions.invoke('getFollowups', { studentId: student.id })).data;
      const open = (data?.followups || []).filter(f => f.can_edit && isOpen(f));
      const withPhone = (f) => withOutcome({ ...f, phone: f.phone || student.phone });
      if (open.length === 1) setLogging(withPhone(open[0]));
      else if (open.length > 1) setChoosing({ student, followups: open.map(withPhone), canCreate: !!data?.can_create });
      else if (data?.can_create) setCreating({ student, afterCall: true, outcome: suggested });
      else toast.info(`Calling ${student.full_name || 'the student'} with 3CX`);
    } catch {
      // Dialling already happened; not being able to open the log is not worth an error.
    }
  }, []);

  // Back from a phone call that reloaded the page: its log, again.
  useEffect(() => {
    const p = takePending();
    if (p) startCall(p.who, p.followup);
  }, [startCall]);

  /** A Call button was pressed: ask how to call. */
  const chooseCall = useCallback((who, followup, info) => setCallChoice({ who, followup, info }), []);

  const value = useMemo(() => ({ startCall, openLog, chooseCall }), [startCall, openLog, chooseCall]);

  return (
    <CallFlowContext.Provider value={value}>
      {children}

      <CallChoiceDialog
        choice={callChoice}
        clickToCall={clickToCall}
        onClose={() => setCallChoice(null)}
        onPhone={() => { const c = callChoice; setCallChoice(null); if (c) { keepPending(c.who, c.followup); startCall(c.who, c.followup); } }}
        onStarted={(call) => { const c = callChoice; setCallChoice(null); if (c) setLiveCall({ ...call, who: c.who, followup: c.followup }); }}
      />
      <CallWindow
        call={liveCall}
        onClose={() => setLiveCall(null)}
        onLog={() => { const c = liveCall; setLiveCall(null); if (c) startCall(c.who, c.followup); }}
      />

      <LogFollowupDialog followup={logging} onClose={() => { setLogging(null); dropPending(); }} onSaved={refresh} />

      <Dialog open={!!choosing} onOpenChange={(o) => { if (!o) setChoosing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-brand-navy">Log the call · {choosing?.student?.full_name}</DialogTitle>
            <DialogDescription>Which follow-up was this call about?</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {(choosing?.followups || []).map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => { setChoosing(null); setLogging(f); }}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition-colors hover:border-brand-cyan/60 hover:bg-cyan-50/40"
              >
                <span>
                  <span className="block font-medium text-slate-900">{f.target_outcome}</span>
                  <span className="text-xs text-slate-500">Next follow-up {fmtDate(f.next_followup_date)}</span>
                </span>
                <span className="flex items-center gap-1.5"><StageBadge stage={f.stage} /><StatusBadge status={f.followup_status} /></span>
              </button>
            ))}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => { setChoosing(null); dropPending(); }}>Skip</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewFollowupDialog
        open={!!creating}
        onClose={() => setCreating(null)}
        onCancel={dropPending}
        onLog={(f) => setLogging({ ...f, phone: f.phone || creating?.student?.phone })}
        student={creating?.student ? { id: creating.student.id, full_name: creating.student.full_name } : null}
        title={creating?.afterCall ? `Log the call · ${creating.student.full_name}` : null}
        defaultOutcome={creating?.outcome || ''}
        description={creating?.afterCall ? 'No open follow-up for this student yet — open one for this call, then record what they said.' : null}
        onSaved={(id, input) => {
          refresh();
          const s = creating?.student;
          if (creating?.afterCall && id && s) {
            // Straight on to logging the call against the new follow-up.
            setLogging({
              id, student_id: s.id, student_name: s.full_name, phone: s.phone, target_outcome: input.targetOutcome,
              stage: 'New', client_said: input.clientSaid || '', notes: input.notes || '', objection_reason: '',
              converted_date: '', deal_value: null, can_edit: true,
              ...(s.ask_connected ? { ask_connected: true } : {}),
            });
          }
        }}
      />
    </CallFlowContext.Provider>
  );
}

/** Whether this person's Call buttons place the call through 3CX (their extension is known), asked once. */
function useClickToCall() {
  return useQuery({
    queryKey: ['click-to-call'],
    queryFn: async () => (await base44.functions.invoke('getClickToCall', {})).data,
    staleTime: 5 * 60_000,
  }).data;
}

const stop = (e) => e.stopPropagation();   // the windows open from clickable table rows
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'the student';
const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const OPTION = 'flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors';

/** Call pressed: a 3CX call (3CX rings your extension first) or a phone call — asked every time. */
function CallChoiceDialog({ choice, clickToCall, onClose, onPhone, onStarted }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => { setBusy(false); setProblem(''); }, [choice]);
  const who = choice?.who;
  const info = choice?.info;
  const can3cx = !!clickToCall?.enabled;
  const call3cx = async () => {
    setBusy(true);
    setProblem('');
    try {
      const r = (await base44.functions.invoke('callStudent', { studentId: who.id, dial: info.dial })).data;
      onStarted({
        dial: r?.dial || info.dial, extension: r?.extension || clickToCall?.extension, device: r?.device || '',
        callId: r?.call_id ?? null, participantId: r?.participant_id ?? null, ringing: r?.ringing || [],
      });
    } catch (e) {
      setProblem(e?.message || '3CX could not place the call');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!choice} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md" onClick={stop}>
        <DialogHeader>
          <DialogTitle className="text-brand-navy">Call {who?.full_name || info?.dial}</DialogTitle>
          <DialogDescription>{info?.dial}{info?.note ? ` — ${info.note}` : ''}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <button
            type="button"
            disabled={!can3cx || busy}
            onClick={call3cx}
            className={`${OPTION} ${can3cx ? 'border-emerald-200 hover:bg-emerald-50' : 'cursor-not-allowed border-slate-200 opacity-60'}`}
          >
            {busy ? <Loader2 className="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin text-emerald-600" /> : <PhoneCall className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-600" />}
            <span>
              <span className="block font-semibold text-slate-900">3CX call</span>
              <span className="block text-sm text-slate-500">
                {can3cx
                  ? `Opens in your 3CX web client (extension ${clickToCall.extension}) — answer 3CX's call there, then ${firstName(who?.full_name)} is dialled. The call shows here too.`
                  : clickToCall?.extension ? '3CX is not connected on the server' : 'No 3CX extension on your account — an admin adds it on Personnel'}
              </span>
            </span>
          </button>
          <a
            href={`tel:${info?.dial ?? ''}`}
            onClick={() => setTimeout(onPhone, 0)}   // the browser follows the link before this window closes
            className={`${OPTION} border-slate-200 hover:bg-slate-50`}
          >
            <Smartphone className="mt-0.5 h-5 w-5 flex-shrink-0 text-slate-600" />
            <span>
              <span className="block font-semibold text-slate-900">Phone call</span>
              <span className="block text-sm text-slate-500">Opens your phone app to dial {info?.dial}</span>
            </span>
          </a>
          {problem && <p className="text-sm text-rose-600">{problem}</p>}
          {can3cx && clickToCall?.web_client_url && (
            <a href={clickToCall.web_client_url} target="_blank" rel="noreferrer" className="block text-center text-xs font-medium text-emerald-700 underline">
              Open the 3CX web client
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The call window for a 3CX call: what 3CX says about it every 2 seconds — ringing your 3CX, calling the student,
 * connected (with a timer), ended — with Hang up and Log the call. The call itself is on the 3CX app or phone;
 * closing this window does not end it. 3CX's own status word shows too, so a stage read wrongly can be seen.
 */
function CallWindow({ call, onClose, onLog }) {
  const [state, setState] = useState(null);       // the latest getMyCallState
  const [ended, setEnded] = useState(false);
  const [connectedAt, setConnectedAt] = useState(null);
  const [problem, setProblem] = useState('');
  const [hanging, setHanging] = useState(false);
  const [, setTick] = useState(0);
  const seen = useRef(false);
  const started = useRef(0);

  useEffect(() => {   // a new call: start over
    setState(null); setEnded(false); setConnectedAt(null); setProblem(''); setHanging(false);
    seen.current = false;
    started.current = Date.now();
  }, [call]);

  useEffect(() => {   // follow it from 3CX every 2 seconds until it ends
    if (!call || ended) return undefined;
    let gone = false;
    const look = async () => {
      try {
        const s = (await base44.functions.invoke('getMyCallState', { callId: call.callId, dial: call.dial })).data;
        if (gone) return;
        setState(s);
        setProblem('');
        if (s?.participant) {
          seen.current = true;
          if (/connect/i.test(s.participant.status)) setConnectedAt(at => at ?? Date.now());
        } else if (seen.current || Date.now() - started.current > 60_000) {
          setEnded(true);
        }
      } catch (e) {
        if (!gone) setProblem(e?.message || 'Could not read the call from 3CX');
      }
    };
    look();
    const id = setInterval(look, 2000);
    return () => { gone = true; clearInterval(id); };
  }, [call, ended]);

  useEffect(() => {   // the talk timer
    if (!connectedAt || ended) return undefined;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [connectedAt, ended]);

  const hangUp = async () => {
    if (!state?.participant?.id) return;
    setHanging(true);
    try {
      await base44.functions.invoke('hangUpMyCall', { participantId: state.participant.id });
      setEnded(true);
    } catch (e) {
      setProblem(e?.message || 'Could not hang up');
    } finally {
      setHanging(false);
    }
  };

  const status = state?.participant?.status || '';
  const where = call?.device || '3CX web client';   // the app the call started on
  const ringingYou = `Ringing your ${where}…`;
  const name = firstName(call?.who?.full_name);
  const line = ended ? (connectedAt ? 'Call ended' : 'The call ended before it connected')
    : !state?.participant ? ringingYou
    : /connect/i.test(status) ? `Connected · ${clock(Date.now() - (connectedAt ?? Date.now()))}`
    : /dial/i.test(status) ? `Calling ${name}…`
    : /ring/i.test(status) ? ringingYou
    : status;
  // 3CX "Dialing" covers both steps — your 3CX web client ringing, then the student's phone — so say what has to happen.
  const hint = connectedAt ? ''
    : !ended ? `Answer 3CX's call in your ${where} (the green handset) — then ${name}'s phone rings.`
    : `If 3CX's call didn't pop up in your ${where}, open it, let it use the microphone and call again — or use Phone call. If you answered it, ${name} didn't pick up.`;

  return (
    <Dialog open={!!call} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" onClick={stop}>
        <DialogHeader className="items-center text-center sm:text-center">
          <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${ended ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-600'}`}>
            {ended ? <PhoneOff className="h-6 w-6" /> : <PhoneCall className={`h-6 w-6 ${connectedAt ? '' : 'animate-pulse'}`} />}
          </div>
          <DialogTitle className="text-brand-navy">{call?.who?.full_name || call?.dial}</DialogTitle>
          <DialogDescription>{call?.dial} · from your extension {call?.extension}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1 text-center">
          <p className={`text-lg font-semibold ${ended ? 'text-slate-500' : 'text-emerald-700'}`}>{line}</p>
          {hint && <p className="text-sm text-slate-600">{hint}</p>}
          {status && !ended && <p className="text-xs text-slate-400">3CX: {status}{state?.participant?.party ? ` · ${state.participant.party}` : ''}</p>}
          {!ended && <p className="text-xs text-slate-400">The call is on your 3CX app or phone — closing this window does not end it.</p>}
          {problem && <p className="text-xs text-rose-600">{problem}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-center">
          {!ended && (
            <Button variant="destructive" onClick={hangUp} disabled={hanging || !state?.participant?.id}>
              {hanging ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneOff className="h-4 w-4" />} Hang up
            </Button>
          )}
          <Button variant={ended ? 'default' : 'outline'} onClick={onLog}>Log the call</Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The green Call button. `student` needs { id, full_name, phone };
 * pass `followup` on a follow-up row so the call is logged against it.
 * variant: "button" (Call label) or "icon". It asks how to call: 3CX or phone.
 * Not for the Sales role: they read the students they closed, and call them from their CRM.
 */
export function CallButton({ student, followup = null, variant = 'button', className = '' }) {
  const flow = useCallFlow();
  const { user } = useAuth();
  const info = dialInfo(student?.phone ?? followup?.phone);
  const size = variant === 'icon' ? 'h-8 w-8 justify-center' : 'h-8 gap-1.5 px-3';
  const who = student || { id: followup?.student_id, full_name: followup?.student_name, phone: followup?.phone };

  if (readsClosedOnly(user)) return null;
  if (!info.ok) {
    return (
      <span
        title={info.reason}
        className={`inline-flex flex-shrink-0 cursor-not-allowed items-center rounded-lg border border-slate-200 text-xs font-semibold text-slate-300 ${size} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <PhoneOff className="h-3.5 w-3.5" />{variant !== 'icon' && 'Call'}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (flow) flow.chooseCall(who, followup, info);
        else window.location.href = `tel:${info.dial}`;
      }}
      title={`Call ${info.dial}${info.note ? ` — ${info.note}` : ''}`}
      className={`inline-flex flex-shrink-0 items-center rounded-lg text-xs font-semibold transition-colors ${variant === 'icon'
        ? 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700'
        : 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'} ${info.check ? 'ring-1 ring-amber-300' : ''} ${size} ${className}`}
    >
      <Phone className="h-3.5 w-3.5" />{variant !== 'icon' && 'Call'}
    </button>
  );
}
