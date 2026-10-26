import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle2, Loader2, Mic, Pause, Play, Save, Square, Trash2, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   Voice recordings (the user, 2026-10-26: "own Malayalam recordings, stored in
   R2") — the CS TV board says each approved payment in the owner's own voice,
   from these pieces: who collected it, the course, the amount, "Congratulations".
   Each is recorded once here, kept in R2 (backend functions/voiceRecordings.ts)
   and played one after another on the board. The Malayalam shown is a prompt —
   say it however sounds right. Super Admins only.
──────────────────────────────────────────────────────────────────────────── */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const GROUPS = [
  ['people', 'People', 'Who collected it — said first'],
  ['courses', 'Courses', 'The course — said second'],
  ['close', 'The close', 'Said last'],
  ['amounts', 'Amounts', 'Said third, when that amount is recorded — optional: the screen always shows it'],
];
const pickMime = () => {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return '';
};
const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = reject;
  r.readAsDataURL(blob);
});
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/** One audio at a time on the page. */
let current = null;
function playUrls(urls, onEnd) {
  current?.pause();
  let i = 0;
  const next = () => {
    if (i >= urls.length) { current = null; onEnd?.(); return; }
    const a = new Audio(urls[i++]);
    current = a;
    a.onended = () => setTimeout(next, 220);
    a.onerror = () => next();
    a.play().catch(() => next());
  };
  next();
}

export default function VoiceRecordings() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['voice-recordings'], queryFn: () => fn('getVoiceRecordings', {}), retry: false });
  const [q, setQ] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [showAmounts, setShowAmounts] = useState(false);
  const lines = data?.lines ?? [];
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => lines.filter(l => (!onlyMissing || !l.recording) && (!needle || `${l.prompt} ${l.text}`.toLowerCase().includes(needle))), [lines, onlyMissing, needle]);
  const done = (g) => lines.filter(l => l.group === g && l.recording).length;
  const total = (g) => lines.filter(l => l.group === g).length;

  const sample = () => {
    const pick = (g) => lines.find(l => l.group === g && l.recording)?.recording.url;
    const urls = [pick('people'), pick('courses'), lines.find(l => l.key === 'aed:2000' && l.recording)?.recording.url, pick('close')].filter(Boolean);
    if (!urls.length) { toast.info('Record a person first'); return; }
    playUrls(urls);
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['voice-recordings'] });

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <PageTitle eyebrow="CS TV" icon={Mic}>Voice recordings</PageTitle>
            <p className="mt-2 text-sm text-slate-500">
              The CS TV says each approved payment in your voice, from these pieces — who collected it, the course, the amount, then the close.
              Record each once: press <b>Record</b>, say it, <b>Stop</b>, listen, <b>Save</b>. The Malayalam is a prompt — say it however sounds right.
            </p>
          </div>
          <Button variant="outline" onClick={sample} className="gap-2"><Volume2 className="h-4 w-4" /> Hear a payment</Button>
        </div>

        {error && <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(error?.message)) ? 'This page needs the server update (the API deploy).' : error.message}</p>}
        {data && !data.ready && <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">R2 isn't set up on the API server yet (the R2_* settings) — you can listen to a recording before saving, but it can't be kept.</p>}

        {data && (
          <div className="flex flex-wrap items-center gap-2">
            {GROUPS.map(([g, label]) => (
              <span key={g} className={cn('rounded-full border px-3 py-1 text-xs font-medium', done(g) === total(g) && total(g) ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600')}>
                {label} {done(g)}/{total(g)}
              </span>
            ))}
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a line…" className="ml-auto h-9 w-48" />
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={onlyMissing} onChange={e => setOnlyMissing(e.target.checked)} /> Not recorded yet
            </label>
          </div>
        )}

        {isLoading && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>}

        {GROUPS.map(([g, label, hint]) => {
          const rows = shown.filter(l => l.group === g);
          if (!rows.length) return null;
          const folded = g === 'amounts' && !showAmounts && !needle;
          return (
            <Card key={g}>
              <CardContent className="p-0">
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                  <h2 className="font-semibold text-slate-900">{label}</h2>
                  <span className="text-xs text-slate-400">{hint}</span>
                  {g === 'amounts' && (
                    <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={() => setShowAmounts(v => !v)}>{showAmounts ? 'Hide' : `Show ${rows.length}`}</Button>
                  )}
                </div>
                {!folded && <div className="divide-y divide-slate-100">{rows.map(l => <LineRow key={l.key} line={l} ready={!!data?.ready} onSaved={refresh} />)}</div>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function LineRow({ line, ready, onSaved }) {
  const [state, setState] = useState('idle');   // idle | recording | recorded | saving
  const [blob, setBlob] = useState(null);
  const [preview, setPreview] = useState('');
  const [secs, setSecs] = useState(0);
  const [playingNow, setPlayingNow] = useState(false);
  const rec = useRef(null);
  const timer = useRef(null);

  useEffect(() => () => { clearInterval(timer.current); if (preview) URL.revokeObjectURL(preview); rec.current?.stream?.getTracks().forEach(t => t.stop()); }, [preview]);

  const start = async () => {
    const mime = pickMime();
    if (!mime) { toast.error("This browser can't record — use Chrome"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const r = new MediaRecorder(stream, { mimeType: mime });
      const parts = [];
      r.ondataavailable = (e) => e.data.size && parts.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(timer.current);
        const b = new Blob(parts, { type: mime.split(';')[0] });
        setBlob(b);
        setPreview(URL.createObjectURL(b));
        setState('recorded');
      };
      rec.current = r;
      r.start();
      setSecs(0);
      timer.current = setInterval(() => setSecs(s => { if (s >= 59) r.state === 'recording' && r.stop(); return s + 1; }), 1000);
      setState('recording');
    } catch {
      toast.error('The microphone was not allowed — allow it in the browser and try again');
    }
  };
  const stop = () => rec.current?.state === 'recording' && rec.current.stop();
  const play = (url) => { setPlayingNow(true); playUrls([url], () => setPlayingNow(false)); };
  const save = async () => {
    if (!blob) return;
    setState('saving');
    try {
      await fn('saveVoiceRecording', { key: line.key, audio: await toBase64(blob), mime: blob.type });
      toast.success('Saved — the TV uses it from now on');
      setBlob(null); setPreview(''); setState('idle');
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.error || e?.message || "Couldn't save it");
      setState('recorded');
    }
  };
  const remove = async () => {
    if (!window.confirm('Delete this recording? The TV goes back to the browser voice for it.')) return;
    try { await fn('deleteVoiceRecording', { key: line.key }); onSaved(); } catch (e) { toast.error(e?.message || "Couldn't delete it"); }
  };

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium text-slate-900" lang="ml">{line.prompt}</p>
        <p className="truncate text-xs text-slate-400">{line.text}{line.recording ? ` · recorded ${when(line.recording.at)}${line.recording.by ? ` by ${line.recording.by}` : ''}` : ''}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {line.recording && state === 'idle' && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
        {line.recording && state === 'idle' && (
          <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => play(line.recording.url)}>{playingNow ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}Play</Button>
        )}
        {state === 'recording' ? (
          <Button size="sm" variant="destructive" className="h-8 gap-1" onClick={stop}><Square className="h-3.5 w-3.5" />Stop · {secs}s</Button>
        ) : (
          <Button size="sm" variant={line.recording ? 'ghost' : 'default'} className="h-8 gap-1" onClick={start} disabled={state === 'saving'}>
            <Mic className="h-3.5 w-3.5" />{line.recording || blob ? 'Record again' : 'Record'}
          </Button>
        )}
        {state === 'recorded' && preview && (
          <>
            <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => play(preview)}><Play className="h-3.5 w-3.5" />Listen</Button>
            <Button size="sm" className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={save} disabled={!ready}><Save className="h-3.5 w-3.5" />Save</Button>
          </>
        )}
        {state === 'saving' && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        {line.recording && state === 'idle' && (
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600" onClick={remove} title="Delete the recording"><Trash2 className="h-3.5 w-3.5" /></Button>
        )}
      </div>
    </div>
  );
}
