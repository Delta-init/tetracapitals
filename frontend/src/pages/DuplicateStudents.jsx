import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, ArrowLeftRight, CheckCircle2, EyeOff, GitMerge, History, Loader2, RotateCcw, Search, Undo2, Users } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   Duplicates (backend/src/functions/studentMerge.ts; the user, 2026-11-12):
   students recorded twice — the same phone or the same email — merged into
   one. Everything of the closed record moves to the kept one; the CS is
   picked (the other can stay as a Common CS); commission already credited
   stays with whoever earned it. Every merge can be undone from History.
   A Super Admin, or a CS Manager for their own students.
──────────────────────────────────────────────────────────────────────────── */

const fn = async (name, body) => (await base44.functions.invoke(name, body ?? {})).data;
const day = (v) => (v ? String(v).slice(0, 10) : '—');
const studentUrl = (id) => `${createPageUrl('StudentDetail')}?id=${id}`;
const CONF = {
  high: { label: 'Very likely', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  medium: { label: 'Likely', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  low: { label: 'Maybe (a family?)', cls: 'border-slate-200 bg-slate-50 text-slate-600' },
};
const BY = { phone: 'same phone', email: 'same email' };

function StudentLine({ s, picked, onPick }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${picked ? 'border-brand-navy bg-sky-50/60' : 'border-slate-200 bg-white'}`}>
      <Checkbox checked={picked} onCheckedChange={onPick} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={studentUrl(s.id)} className="font-medium text-brand-navy hover:underline" onClick={(e) => e.stopPropagation()}>{s.name || 'Student'}</Link>
          <span className="font-mono text-xs text-slate-400">{s.code}</span>
          {s.lms && <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">LMS</Badge>}
          {s.enrolment === 'closed' && <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Closed</Badge>}
        </div>
        <div className="mt-0.5 truncate text-xs text-slate-500">{s.email || 'no email'} · {s.phone || 'no phone'}</div>
        <div className="text-xs text-slate-500">
          CS {s.open ? <span className="text-amber-700">Delta Open Students</span> : s.cs || <span className="text-slate-400">none</span>}{s.team ? ` · ${s.team}` : ''} · added {day(s.created)}
        </div>
      </div>
    </label>
  );
}

function GroupCard({ g, onMerge, onDismiss, dismissing }) {
  const [picked, setPicked] = useState(() => g.students.slice(0, 2).map((s) => s.id));
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  const conf = CONF[g.confidence] ?? CONF.low;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={conf.cls}>{conf.label}</Badge>
          <span className="text-xs text-slate-500">{g.by.map((b) => BY[b] ?? b).join(' + ')} · {g.students.length} records</span>
          {g.dismissed && <Badge variant="outline">Marked not a duplicate</Badge>}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {g.students.map((s) => <StudentLine key={s.id} s={s} picked={picked.includes(s.id)} onPick={() => toggle(s.id)} />)}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => onDismiss(g)} disabled={dismissing}>
            <EyeOff className="h-4 w-4" /> {g.dismissed ? 'Show again' : 'Not a duplicate'}
          </Button>
          <Button size="sm" onClick={() => onMerge(picked[0], picked[1])} disabled={picked.length !== 2}>
            <GitMerge className="h-4 w-4" /> Merge the two picked
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** One student, found by name, STU code or email. */
function Finder({ value, onChange, label }) {
  const [q, setQ] = useState('');
  const { data = [], isFetching } = useQuery({
    queryKey: ['merge-find', q], enabled: q.trim().length >= 2 && !value,
    queryFn: () => fn('searchStudents', { q }),
  });
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-2 text-sm">
        <span><span className="font-medium">{value.full_name}</span> <span className="font-mono text-xs text-slate-400">{value.student_code}</span></span>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Change</Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={label} className="pl-9" />
      {q.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-white shadow">
          {isFetching ? <p className="p-2 text-xs text-slate-400">Searching…</p>
            : !data.length ? <p className="p-2 text-xs text-slate-400">Nobody matches.</p>
            : data.map((s) => (
              <button key={s.id} type="button" onClick={() => onChange(s)} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                {s.full_name} <span className="font-mono text-xs text-slate-400">{s.student_code}</span>
                <span className="block text-xs text-slate-500">{s.email} · {s.primary_mentor_name || 'no CS'}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** Any two students, found by name, code or email. */
function PickAny({ onMerge }) {
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-sm font-medium">Merge any two students</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Finder value={a} onChange={setA} label="First student — name, STU code or email" />
          <Finder value={b} onChange={setB} label="Second student" />
        </div>
        <div className="flex justify-end">
          <Button size="sm" disabled={!a || !b || a.id === b.id} onClick={() => onMerge(a.id, b.id)}><GitMerge className="h-4 w-4" /> Merge these two</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Side({ s, title, tone }) {
  return (
    <div className={`space-y-1 rounded-md border p-3 text-sm ${tone}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="font-medium">{s.name || 'Student'} <span className="font-mono text-xs text-slate-400">{s.code}</span></p>
      <p className="truncate text-xs text-slate-500">{s.email || 'no email'} · {s.phone || 'no phone'}</p>
      <p className="text-xs">CS <b>{s.open ? 'Delta Open Students' : s.cs.name || 'none'}</b>{s.cs.team ? ` · ${s.cs.team}` : ''}{s.common.length ? ` · Common: ${s.common.join(', ')}` : ''}</p>
      <p className="text-xs text-slate-500">Added {day(s.created)} · {s.deposits} deposit(s) · {s.calls} call(s) · {s.followups} follow-up(s){s.onboarded ? ' · onboarded' : ''}{s.lms ? ' · LMS account' : ''}{s.finance ? ` · ${s.finance}` : ''}</p>
    </div>
  );
}

function MergeDialog({ pair, onClose, onDone }) {
  const [keepId, setKeepId] = useState(null);
  const [csFrom, setCsFrom] = useState(null);
  const [asCommon, setAsCommon] = useState(true);
  const [confirm, setConfirm] = useState('');
  const ids = pair ? (keepId && keepId === pair[1] ? [pair[1], pair[0]] : [pair[0], pair[1]]) : null;
  const { data, isLoading, error } = useQuery({
    queryKey: ['merge-preview', ids?.[0], ids?.[1]], enabled: !!ids,
    queryFn: () => fn('previewStudentMerge', { keepId: ids[0], closeId: ids[1] }),
  });
  // The suggestion, once: which to keep and whose CS.
  useEffect(() => {
    if (!data || keepId !== null) return;
    const swap = data.suggestion.keepId !== data.kept.id;
    setKeepId(data.suggestion.keepId);
    // The suggestion's "kept" / "closed" are this preview's; kept the other way round, they swap too.
    setCsFrom(swap ? (data.suggestion.csFrom === 'kept' ? 'closed' : 'kept') : data.suggestion.csFrom);
  }, [data]);
  const merge = useMutation({
    mutationFn: () => fn('mergeStudents', { keepId: data.kept.id, closeId: data.closed.id, csFrom, otherCsAsCommon: asCommon, confirm }),
    onSuccess: (r) => {
      toast.success(`Merged — ${r.closed.code} is now part of ${r.kept.code}`);
      if (r.leftovers?.length) toast.warning(`Some records still name ${r.closed.code} — see History`);
      onDone();
    },
    onError: (e) => toast.error(e?.message || 'The merge did not go through'),
  });
  const ready = data && keepId === data.kept.id;
  return (
    <Dialog open={!!pair} onOpenChange={(o) => !o && !merge.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><GitMerge className="h-5 w-5" /> Merge two students</DialogTitle>
          <DialogDescription>One record stays; everything of the other moves to it and the other is closed. It can be undone from History.</DialogDescription>
        </DialogHeader>
        {isLoading || !ready ? (
          error ? <p className="py-6 text-sm text-rose-600">{error.message}</p> : <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
              <Side s={data.kept} title="Kept" tone="border-emerald-200 bg-emerald-50/40" />
              <Button variant="outline" size="sm" className="self-center" onClick={() => { setKeepId(data.closed.id); setCsFrom(csFrom === 'kept' ? 'closed' : 'kept'); setConfirm(''); }} title="Keep the other one instead">
                <ArrowLeftRight className="h-4 w-4" />
              </Button>
              <Side s={data.closed} title="Closed — moves into the kept one" tone="border-rose-200 bg-rose-50/40" />
            </div>

            <div className="space-y-2 rounded-md border border-slate-200 p-3">
              <p className="font-medium">Which CS keeps the student?</p>
              {data.sameCs ? (
                <p className="text-slate-600">Both are with {data.kept.cs.name || 'nobody'} — nothing changes.</p>
              ) : (
                <>
                  {[['kept', data.kept], ['closed', data.closed]].map(([key, s]) => (
                    <label key={key} className="flex cursor-pointer items-center gap-2">
                      <input type="radio" name="cs" checked={csFrom === key} onChange={() => setCsFrom(key)} />
                      <span><b>{s.open ? 'Delta Open Students' : s.cs.name || 'No CS'}</b>{s.cs.team ? ` · ${s.cs.team}` : ''} <span className="text-slate-500">(the {key === 'kept' ? 'kept' : 'closed'} record's — {s.deposits} deposit(s), {s.calls} call(s))</span></span>
                    </label>
                  ))}
                  <label className="flex cursor-pointer items-center gap-2 pt-1">
                    <Checkbox checked={asCommon} onCheckedChange={(v) => setAsCommon(!!v)} />
                    <span>Keep the other CS on the student as a Common CS</span>
                  </label>
                  <p className="text-xs text-slate-500">Commission already credited stays with the CS who earned it.</p>
                </>
              )}
            </div>

            <div className="space-y-1 rounded-md border border-slate-200 p-3">
              <p className="font-medium">What moves to {data.kept.code}</p>
              {data.moves.length ? (
                <ul className="grid gap-x-6 gap-y-0.5 text-slate-600 sm:grid-cols-2">
                  {data.moves.map((m) => <li key={m.label}>{m.label}: <b>{m.count}</b></li>)}
                </ul>
              ) : <p className="text-slate-500">Nothing is filed under {data.closed.code}.</p>}
              {data.takes.length > 0 && <p className="pt-1 text-xs text-slate-500">The kept record also takes from it what it lacks: {data.takes.map((t) => t.replace(/_/g, ' ')).join(', ')}.</p>}
              <p className="text-xs text-slate-500">{data.closed.code}, its email and its LMS account stay findable on {data.kept.code} — finance and the LMS land on it.</p>
            </div>

            <div className="space-y-1">
              <p>Type <b className="font-mono">{data.closed.code}</b> to confirm it is the one closed.</p>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={data.closed.code} className="max-w-xs font-mono" />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={merge.isPending}>Cancel</Button>
          <Button onClick={() => merge.mutate()} disabled={!ready || !csFrom || merge.isPending || confirm.trim().toUpperCase() !== String(data?.closed.code).toUpperCase()}>
            {merge.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />} Merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS = {
  merged: { label: 'Merged', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  failed: { label: 'Stopped part-way', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  undone: { label: 'Undone', cls: 'border-slate-200 bg-slate-50 text-slate-600' },
  running: { label: 'Running', cls: 'border-sky-200 bg-sky-50 text-sky-700' },
  undoing: { label: 'Undoing', cls: 'border-sky-200 bg-sky-50 text-sky-700' },
};

/** What the LMS made of a merge made here (backend students/lmsMergeLink.ts). */
function LmsState({ m }) {
  if (m.origin === 'lms' || !m.lms) return null;
  const st = m.lmsUndo?.state === 'pending' ? { label: 'LMS: undo waiting', cls: 'border-amber-200 bg-amber-50 text-amber-800', title: m.lmsUndo.error }
    : m.lms.state === 'done' ? { label: 'LMS accounts merged too', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
    : m.lms.state === 'pending' ? { label: 'LMS: waiting — tried again every minute', cls: 'border-amber-200 bg-amber-50 text-amber-800', title: m.lms.error }
    : m.lms.state === 'failed' ? { label: 'LMS refused', cls: 'border-rose-200 bg-rose-50 text-rose-700', title: m.lms.error }
    : m.lms.state === 'nothing' ? { label: 'LMS: nothing to merge', cls: 'border-slate-200 bg-slate-50 text-slate-600' }
    : m.lms.state === 'not_linked' ? { label: 'LMS not linked on this server', cls: 'border-slate-200 bg-slate-50 text-slate-600' }
    : null;
  return st ? <Badge variant="outline" className={st.cls} title={st.title || undefined}>{st.label}</Badge> : null;
}

function HistoryList() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [undoing, setUndoing] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ['student-merges', page], queryFn: () => fn('getStudentMerges', { page }) });
  const undo = useMutation({
    mutationFn: (id) => fn('undoStudentMerge', { mergeId: id }),
    onSuccess: (r) => {
      toast.success(r.leftAsIs?.length ? `Undone — ${r.leftAsIs.length} field(s) changed since were left as they are` : 'Undone — both records are back as they were');
      setUndoing(null);
      qc.invalidateQueries({ queryKey: ['student-merges'] });
      qc.invalidateQueries({ queryKey: ['duplicate-students'] });
    },
    onError: (e) => toast.error(e?.message || 'Could not undo it'),
  });
  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  const rows = data?.merges ?? [];
  if (!rows.length) return <p className="py-12 text-center text-sm text-slate-400">No merges yet.</p>;
  return (
    <div className="space-y-3">
      {rows.map((m) => {
        const st = STATUS[m.status] ?? STATUS.merged;
        return (
          <Card key={m.id}>
            <CardContent className="flex flex-col gap-3 p-4 text-sm md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={st.cls}>{st.label}</Badge>
                  {m.type === 'relink' ? (
                    <span><Link to={studentUrl(m.kept?.id)} className="font-mono font-medium text-brand-navy hover:underline">{m.kept?.code}</Link> {m.kept?.name} — LMS accounts merged: {m.relink?.fromEmail || 'their account'} → {m.relink?.toEmail || 'the kept account'}</span>
                  ) : (
                    <span><b className="font-mono">{m.closed?.code}</b> {m.closed?.name} → <Link to={studentUrl(m.kept?.id)} className="font-mono font-medium text-brand-navy hover:underline">{m.kept?.code}</Link> {m.kept?.name}</span>
                  )}
                  {m.origin === 'lms' && <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">From the LMS</Badge>}
                  <LmsState m={m} />
                </div>
                <p className="text-xs text-slate-500">By {m.by} · {String(m.at).slice(0, 16).replace('T', ' ')}{m.undoneAt ? ` · undone by ${m.undoneBy} ${String(m.undoneAt).slice(0, 16).replace('T', ' ')}` : ''}</p>
                {m.moved?.length > 0 && <p className="text-xs text-slate-500">Moved: {m.moved.map((x) => `${x.label} ${x.count}`).join(' · ')}</p>}
                {m.error && <p className="text-xs text-rose-600">{m.error}</p>}
                {m.leftovers?.length > 0 && (
                  <p className="flex items-start gap-1 text-xs text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Still naming {m.closed?.code}: {m.leftovers.map((x) => `${x.col}.${x.path} (${x.count})`).join(', ')}</p>
                )}
                {m.leftAsIs?.length > 0 && <p className="text-xs text-slate-500">Changed after the merge, left as they are on undo: {m.leftAsIs.length} field(s).</p>}
              </div>
              {(m.status === 'merged' || m.status === 'failed') && (
                <Button size="sm" variant="outline" onClick={() => setUndoing(m)}><Undo2 className="h-4 w-4" /> Undo</Button>
              )}
            </CardContent>
          </Card>
        );
      })}
      {data.pages > 1 && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="sm" variant="outline" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
      <Dialog open={!!undoing} onOpenChange={(o) => !o && !undo.isPending && setUndoing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Undo this merge?</DialogTitle>
            <DialogDescription>
              {undoing?.closed?.code} comes back as its own student, with everything that moved from it. Anything changed on those records since the merge is left as it is.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUndoing(null)} disabled={undo.isPending}>Cancel</Button>
            <Button onClick={() => undo.mutate(undoing.id)} disabled={undo.isPending}>{undo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Undo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function DuplicateStudents() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('groups');
  const [showDismissed, setShowDismissed] = useState(false);
  const [pair, setPair] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['duplicate-students', showDismissed],
    queryFn: () => fn('findDuplicateStudents', { includeDismissed: showDismissed }),
  });
  const dismiss = useMutation({
    mutationFn: (g) => fn('dismissDuplicateGroup', { key: g.key, undo: !!g.dismissed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['duplicate-students'] }),
    onError: (e) => toast.error(e?.message || 'Could not save that'),
  });
  const groups = data?.groups ?? [];
  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <PageTitle eyebrow="Students" icon={Users}>Duplicates</PageTitle>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Students recorded twice — the same phone or the same email. Merging keeps one record: everything of the other moves to it,
            you pick the CS (the other can stay as a Common CS), and commission already credited stays with whoever earned it. Every merge can be undone.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[['groups', 'Possible duplicates', CheckCircle2], ['history', 'History', History]].map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium ${tab === key ? 'border-sky-300 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              <Icon className="h-4 w-4" />{label}{key === 'groups' && data ? <span className="rounded-full bg-white/70 px-1.5 text-xs">{groups.length}</span> : null}
            </button>
          ))}
        </div>

        {tab === 'history' ? <HistoryList /> : (
          <div className="space-y-4">
            <PickAny onMerge={(a, b) => setPair([a, b])} />
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <Checkbox checked={showDismissed} onCheckedChange={(v) => setShowDismissed(!!v)} /> Show the ones marked not a duplicate
            </label>
            {isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
              : error ? <p className="py-12 text-center text-sm text-rose-600">{error.message || 'Could not load them'}</p>
              : !groups.length ? <p className="py-12 text-center text-sm text-slate-400">No students look recorded twice.</p>
              : groups.map((g) => <GroupCard key={g.key} g={g} onMerge={(a, b) => setPair([a, b])} onDismiss={(x) => dismiss.mutate(x)} dismissing={dismiss.isPending} />)}
          </div>
        )}
      </div>
      <MergeDialog key={pair?.join(',')} pair={pair} onClose={() => setPair(null)} onDone={() => {
        setPair(null);
        qc.invalidateQueries({ queryKey: ['duplicate-students'] });
        qc.invalidateQueries({ queryKey: ['student-merges'] });
      }} />
    </div>
  );
}
