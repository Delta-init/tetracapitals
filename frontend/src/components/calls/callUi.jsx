import React, { useState } from 'react';
import { base44, apiUrl } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2, Phone, PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing, Play, RefreshCw } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   Calls with students, from 3CX (synced every 5 minutes): how a call's
   result, length and recording show on the Calls page, a student's page and
   the Follow-ups list.
──────────────────────────────────────────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, '0');

/** 125 → "2:05", 3725 → "1:02:05". */
export const fmtDuration = (s) => {
  const n = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(n % 60)}` : `${m}:${pad(n % 60)}`;
};

/** A total: "3h 12m", "45m", "30s". */
export const fmtTalkTotal = (s) => {
  const n = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${n}s`;
};

export const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtClock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');

export const RESULTS = {
  answered: { label: 'Answered', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', text: 'text-slate-500' },
  missed: { label: 'Missed', cls: 'border-rose-200 bg-rose-50 text-rose-700', text: 'text-rose-500' },
  no_answer: { label: 'No answer', cls: 'border-amber-200 bg-amber-50 text-amber-700', text: 'text-amber-600' },
};

const callIcon = (c) => (c.status === 'missed' ? PhoneMissed : c.status === 'no_answer' ? PhoneOff : c.direction === 'in' ? PhoneIncoming : PhoneOutgoing);

/** In or out, and what happened: answered; missed (they called, nobody answered); no answer (we called). */
export function CallResult({ call }) {
  const r = RESULTS[call.status] || RESULTS.answered;
  const Icon = callIcon(call);
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <Icon className={`h-4 w-4 flex-shrink-0 ${r.text}`} />
      <span className="w-14 text-xs text-slate-500">{call.direction === 'in' ? 'Incoming' : 'Outgoing'}</span>
      <Badge variant="outline" className={r.cls}>{r.label}</Badge>
    </span>
  );
}

/** Who took or made the call: the portal user linked to the 3CX extension, else 3CX's name for it. */
export function CallPerson({ call }) {
  const name = call.user_name || call.agent_name;
  if (!name && !call.extension) return <span className="text-slate-300">—</span>;
  return (
    <div className="whitespace-nowrap">
      <div className="text-slate-800">{name || `Ext ${call.extension}`}</div>
      {call.extension && name && <div className="text-xs text-slate-400">Ext {call.extension}</div>}
    </div>
  );
}

/**
 * A call's recording: asks the server for a 10-minute link (noted in the audit
 * log), then plays it in the browser — streamed from 3CX, never stored here.
 * Several parts (a transferred call): one button each.
 */
export function RecordingPlayer({ call }) {
  const [playing, setPlaying] = useState(null); // { index, url }
  const [busy, setBusy] = useState(null);       // index being opened
  const [err, setErr] = useState(null);
  if (!call?.recordings) return <span className="text-slate-300">—</span>;

  const open = async (index) => {
    setBusy(index); setErr(null);
    try {
      const res = await base44.functions.invoke('getCallRecording', { callId: call.id, index });
      setPlaying({ index, url: apiUrl(res.data.url) });
    } catch (e) {
      setErr(e?.message || 'Could not open the recording');
    } finally {
      setBusy(null);
    }
  };
  const parts = Array.from({ length: call.recordings }, (_, i) => i);

  return (
    <div className="flex flex-col items-start gap-1.5" onClick={(e) => e.stopPropagation()}>
      {playing && (
        <audio
          key={playing.url}
          src={playing.url}
          controls
          autoPlay
          controlsList="nodownload"
          className="h-9 w-64 max-w-full"
          onError={() => { setPlaying(null); setErr('Could not play it — the link may have expired. Play again.'); }}
        />
      )}
      {(!playing || parts.length > 1) && (
        <div className="flex flex-wrap gap-1">
          {parts.map(i => (
            <Button key={i} size="sm" variant={playing?.index === i ? 'secondary' : 'outline'} className="h-8 gap-1.5" disabled={busy !== null} onClick={() => open(i)}>
              {busy === i ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {parts.length > 1 ? `Part ${i + 1}` : 'Play'}
            </Button>
          ))}
        </div>
      )}
      {err && <span className="max-w-[16rem] text-xs text-rose-600">{err}</span>}
    </div>
  );
}

/** A follow-up's latest 3CX call, under its Last Contact date. */
export function LastCallLine({ call }) {
  if (!call) return null;
  const r = RESULTS[call.status] || RESULTS.answered;
  const when = fmtWhen(call.at);
  const text = call.status === 'answered'
    ? `${call.direction === 'in' ? 'They called' : 'Called'} ${when} · ${fmtDuration(call.talk_seconds)}`
    : call.status === 'missed' ? `Missed call ${when}` : `No answer ${when}`;
  return (
    <div className={`mt-0.5 flex items-center gap-1 whitespace-nowrap text-[11px] ${r.text}`} title={`Latest call through 3CX${call.by ? ` — ${call.by}` : ''}`}>
      <Phone className="h-3 w-3" /> {text}
    </div>
  );
}

/** Whether calls are coming in from 3CX, in a line. What went wrong shows for admin roles only (the server sends it to them alone). */
export function SyncNote({ threecx }) {
  if (!threecx) return null;
  const box = (cls, Icon, children) => (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${cls}`}>
      <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${Icon === RefreshCw ? 'animate-spin' : ''}`} /> <span>{children}</span>
    </div>
  );
  if (!threecx.connected) return box('border-amber-200 bg-amber-50 text-amber-800', AlertTriangle, 'Call history is not switched on yet — 3CX still has to be connected to the portal.');
  if (!threecx.first_import_done) {
    return threecx.running
      ? box('border-sky-200 bg-sky-50 text-sky-800', RefreshCw, `Fetching the last ${threecx.backfill_days} days of calls from 3CX — they appear here as they come in.`)
      : box('border-sky-200 bg-sky-50 text-sky-800', Phone, 'Waiting for the first import from 3CX (it starts a couple of minutes after the server does).');
  }
  if (threecx.error) return box('border-rose-200 bg-rose-50 text-rose-700', AlertTriangle, `The last sync with 3CX failed at ${fmtClock(threecx.error.at)}: ${threecx.error.message}`);
  return <p className="text-xs text-slate-400">Updated {fmtClock(threecx.updated_at)} · from 3CX every 5 minutes</p>;
}
