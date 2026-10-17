import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CalendarClock, Check, Loader2, Mail, MessageCircle, Plus, Repeat, RotateCw, Search, Square, UserMinus, UserPlus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import AudiencePicker from '@/components/programs/AudiencePicker';

/* Programs (the user, 2026-10-09): a live class in the LMS that repeats weekly or monthly until an end date, for the
   students picked for it only. A CS picks their own students (and any other CS's by searching), a Chief Mentor or CS
   Manager their team's, a Super Admin anyone. Each date is a normal LMS class with a seat for every student, so they
   get its reminders and join it from the LMS. Backend: functions/programs.ts → the LMS's /service/programs. */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const errText = (e) => e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Something went wrong';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TZ = 'Asia/Dubai';
const when = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const repeatText = (p) => p.repeat === 'weekly'
  ? `Every ${p.weekdays.map(d => DAYS[d]).join(', ')} at ${p.time}`
  : `Monthly on day ${p.monthDay ?? Number(String(p.startDate).slice(8))} at ${p.time}`;

/** A program's teams — several since 2026-10-15, one before. */
const teamsOfProgram = (p) => (p.teams?.length ? p.teams : p.team ? [p.team] : []);

export default function Programs() {
  const { data, isLoading, error } = useQuery({ queryKey: ['programs'], queryFn: () => fn('listPrograms', {}), staleTime: 15_000,
    // While messages are going out, look again so "sending…" turns into sent.
    refetchInterval: (q) => (q.state.data?.programs ?? []).some(p => p.students.some(s => s.notice?.sending)) ? 5000 : false });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const [showStopped, setShowStopped] = useState(false);
  // A program's team (the user, 2026-10-14) — kept by the portal, picked when it is made.
  const [teamFilter, setTeamFilter] = useState('all');
  const teamsSeen = useMemo(() => {
    const m = new Map();
    for (const p of data?.programs ?? []) for (const t of teamsOfProgram(p)) m.set(t.id, t.name);
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const list = (data?.programs ?? []).filter(p => (showStopped || p.status === 'active')
    && (teamFilter === 'all' || (teamFilter === 'none' ? !teamsOfProgram(p).length : teamsOfProgram(p).some(t => t.id === teamFilter))));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <PageTitle eyebrow="Students" icon={Repeat}>Programs</PageTitle>
          <p className="mt-1 text-sm text-gray-500">A class that repeats weekly or monthly for the students you pick — only they see it in the LMS and get its reminders.</p>
        </div>
        {data?.canCreate && <Button onClick={() => setCreating(true)} className="bg-blue-600 hover:bg-blue-700"><Plus className="mr-1 h-4 w-4" />New program</Button>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Team" className="rounded-md border bg-white px-3 py-1.5 text-sm" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
          <option value="all">Every team</option>
          {teamsSeen.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          <option value="none">No team</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={showStopped} onChange={e => setShowStopped(e.target.checked)} />Show stopped</label>
      </div>
      {isLoading && <div className="space-y-3">{[0, 1].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>}
      {error && <p className="text-sm text-red-600">{errText(error)}</p>}
      {list.map(p => <ProgramCard key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />)}
      {!isLoading && !error && !list.length && <Card><CardContent className="py-10 text-center text-sm text-gray-500">No programs yet{data?.canCreate ? ' — make one with “New program”.' : '.'}</CardContent></Card>}
      {creating && <ProgramDialog teams={data?.teams ?? []} onClose={() => setCreating(false)} />}
    </div>
  );
}

function useProgramAction(name, okText) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => fn(name, body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['programs'] });
      if (res?.missing?.length) toast.warning(`Not on the LMS, so not added: ${res.missing.join(', ')}`);
      else if (okText) toast.success(okText);
    },
    onError: (e) => toast.error(errText(e)),
  });
}

/** The program's link: the next class's Google Meet (or the program's own link), with Copy and Open. */
function ProgramLink({ p }) {
  const now = Date.now();
  const next = p.classes.find(c => c.status === 'scheduled' && new Date(c.startsAt).getTime() + (p.durationMins || 60) * 60_000 > now && c.meetUrl);
  const url = p.meetingMode === 'link' && p.meetingUrl ? p.meetingUrl : next?.meetUrl;
  if (!p.isOnline) return <p className="text-xs text-gray-500">In person — {p.location || 'no place given'}; no link.</p>;
  if (!url) return <p className="text-xs text-gray-500">No Meet link yet — the LMS makes one for each class{p.classes.some(c => 'meetUrl' in c) ? '' : ' (needs the LMS update to show here)'}.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2 text-sm">
      <span className="text-xs font-medium uppercase text-gray-500">{p.meetingMode === 'link' ? 'Program link' : 'Next class link'}</span>
      <a href={url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono text-blue-700 hover:underline">{url}</a>
      {next && p.meetingMode !== 'link' && <span className="text-xs text-gray-500">· {when(next.startsAt)}</span>}
      <Button type="button" size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => { navigator.clipboard?.writeText(url).then(() => toast.success('Link copied'), () => toast.error("Couldn't copy")); }}>Copy</Button>
    </div>
  );
}

/* The programme's form link from the LMS ({LMS}/p/{code}) — to share with anyone: an LMS student signs in, anyone
   else fills in name, email and phone and gets the class's Join now button. Shown on every card in the list. */
function FormLink({ p }) {
  if (!p.joinUrl) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-sm">
      <span className="text-xs font-medium uppercase text-gray-500">Form link</span>
      <a href={p.joinUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate font-mono text-emerald-700 hover:underline">{p.joinUrl}</a>
      <Button type="button" size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => { navigator.clipboard?.writeText(p.joinUrl).then(() => toast.success('Form link copied'), () => toast.error("Couldn't copy")); }}>Copy</Button>
    </div>
  );
}

function ProgramCard({ p, open, onToggle }) {
  const change = useProgramAction('changeProgramStudents', 'Students changed');
  // A guest with an LMS account now: booked on the program like everyone else (2026-10-15).
  const toLms = useProgramAction('addProgramGuestToLms', 'Booked on the program in the LMS');
  const stop = useProgramAction('stopProgram', 'Program stopped');
  const [editing, setEditing] = useState(false);
  const upcoming = p.classes.filter(c => c.status === 'scheduled' && new Date(c.startsAt).getTime() > Date.now());
  return (
    <Card>
      <CardContent className="p-4">
        <button type="button" onClick={onToggle} className="flex w-full flex-wrap items-start justify-between gap-3 text-left">
          <div>
            <p className="font-semibold text-gray-900">{p.title}
              {p.status === 'stopped' && <Badge variant="secondary" className="ml-2">stopped</Badge>}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500"><Repeat className="h-3.5 w-3.5" />{repeatText(p)} · {p.durationMins} min · until {p.endDate} · {p.isOnline ? 'online' : p.location}</p>
            <p className="mt-0.5 text-xs text-gray-400">{teamsOfProgram(p).map(t => <Badge key={t.id} variant="outline" className="mr-1.5 border-blue-200 bg-blue-50 px-1.5 py-0 text-[10px] text-blue-700">{t.name}</Badge>)}Made by {p.createdByName || p.createdByEmail || 'the LMS'}{p.source === 'lms' ? ' (in the LMS)' : ''}</p>
          </div>
          <div className="text-right text-xs text-gray-600">
            <p className="font-medium text-gray-800">{p.mentor?.name ?? '—'}{p.coMentors?.length ? <span className="font-normal text-gray-500"> + {p.coMentors.map(m => m.name).join(', ')}</span> : null}</p>
            <p>{p.students.length} student{p.students.length === 1 ? '' : 's'} · {upcoming.length} to come</p>
            {p.nextClassAt && <p className="flex items-center justify-end gap-1"><CalendarClock className="h-3.5 w-3.5" />{when(p.nextClassAt)}</p>}
          </div>
        </button>
        {/* The form link (LMS, 2026-10-17): LMS students sign in; anyone else fills in a short form and gets Join now */}
        <FormLink p={p} />
        {open && (
          <div className="mt-4 space-y-4 border-t pt-4">
            {/* Its link (the user, 2026-10-15): the next class's Google Meet, to copy or open; each date opens its own below */}
            <ProgramLink p={p} />
            {p.thumbnailUrl && <img src={p.thumbnailUrl} alt="" className="h-24 w-44 rounded-md border object-cover" />}
            <div>
              <p className="mb-2 text-xs font-medium uppercase text-gray-500">Students</p>
              <div className="flex flex-wrap gap-2">
                {p.students.map(s => (
                  <span key={s.email} title={`${s.email}${s.csName ? ` · CS ${s.csName}` : ''}${s.guest ? ' · no LMS account — told by email and WhatsApp with the Meet link' : ''}`} className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-xs', s.guest ? 'bg-amber-50 text-amber-800' : s.yours ? 'bg-blue-50 text-blue-800' : 'bg-gray-100 text-gray-700')}>
                    {s.name}{!s.yours && s.csName ? <span className="text-gray-400">· {s.csName}</span> : null}
                    {s.guest && <span className="rounded bg-amber-200/70 px-1 text-[10px] font-semibold">No LMS</span>}
                    {s.guest && p.canManage && p.status === 'active' && (
                      <button type="button" title="They have an LMS account now — book them on the program" disabled={toLms.isPending} onClick={() => toLms.mutate({ id: p.id, email: s.email })} className="text-[10px] font-semibold text-amber-900 underline-offset-2 hover:underline">Add to LMS</button>
                    )}
                    {p.canManage && p.status === 'active' && (
                      <button type="button" aria-label={`Take ${s.name} off`} disabled={change.isPending} onClick={() => { if (confirm(`Take ${s.name} off "${p.title}"? Their seats on the classes still to come are freed.`)) change.mutate({ id: p.id, removeEmails: [s.email] }); }} className="opacity-60 hover:opacity-100"><UserMinus className="h-3 w-3" /></button>
                    )}
                  </span>
                ))}
              </div>
              {p.canManage && p.status === 'active' && (
                <div className="mt-3"><StudentPicker exclude={p.students.map(s => s.email)} onPick={(s) => change.mutate({ id: p.id, addEmails: [s.email] })} /></div>
              )}
            </div>
            <ProgramMessages p={p} />
            <div>
              <p className="mb-2 text-xs font-medium uppercase text-gray-500">Classes</p>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {p.classes.map(c => {
                  const cls = cn('rounded px-1.5 py-0.5', c.status === 'cancelled' ? 'bg-gray-100 text-gray-400 line-through' : new Date(c.startsAt).getTime() < Date.now() ? 'bg-gray-100 text-gray-500' : 'bg-blue-50 text-blue-700');
                  return c.meetUrl && c.status !== 'cancelled'
                    ? <a key={c.id} href={c.meetUrl} target="_blank" rel="noreferrer" title="Open its Google Meet" className={cn(cls, 'underline-offset-2 hover:underline')}>{when(c.startsAt)}</a>
                    : <span key={c.id} className={cls}>{when(c.startsAt)}</span>;
                })}
              </div>
            </div>
            {p.canManage && p.status === 'active' && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Change time or dates</Button>
                <Button size="sm" variant="outline" disabled={stop.isPending} className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => { if (confirm(`Stop "${p.title}"? Every class still to come is cancelled; past ones stay.`)) stop.mutate({ id: p.id }); }}><Square className="mr-1 h-3 w-3" />Stop program</Button>
              </div>
            )}
          </div>
        )}
        {editing && <ProgramDialog program={p} onClose={() => setEditing(false)} />}
      </CardContent>
    </Card>
  );
}

/* What each student was sent and their answer (the user, 2026-10-15): the email and their CS's WhatsApp when they were
   put on it, and Confirmed / Can't attend from a YES or NO, the email's Confirm my seat, or by hand here. Resend and the
   answer for who made it, a Super Admin, or the student's own CS (backend students/programNotices.ts). */
const SENT = {
  sent: ['text-emerald-600', 'sent'], failed: ['text-red-600', 'failed'], skipped: ['text-amber-600', 'not sent'],
};
function Sent({ icon: Icon, label, r, sending }) {
  const [tone, word] = sending ? ['text-gray-400', 'sending…'] : r ? SENT[r.status] ?? ['text-gray-400', r.status] : ['text-gray-400', 'not sent'];
  return <span title={r?.why || ''} className={cn('inline-flex items-center gap-1', tone)}><Icon className="h-3.5 w-3.5" />{label} {word}{r?.why && !sending ? <span className="text-gray-400">— {r.why}</span> : null}</span>;
}
function ProgramMessages({ p }) {
  const resend = useProgramAction('resendProgramNotice', 'Sending again');
  const answer = useProgramAction('setProgramResponse', 'Saved');
  const busy = resend.isPending || answer.isPending;
  const confirmed = p.students.filter(s => s.notice?.response === 'confirmed').length;
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase text-gray-500">Messages and answers <span className="normal-case text-gray-400">· {confirmed} of {p.students.length} confirmed</span></p>
      <div className="divide-y rounded-lg border text-xs">
        {p.students.map(s => {
          const n = s.notice, may = (p.canManage || s.yours) && p.status === 'active';
          return (
            <div key={s.email} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
              <span className="min-w-[140px] font-medium text-gray-800">{s.name}{s.guest && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800" title="No LMS account — the Meet link by email and WhatsApp, and before each class">No LMS</span>}</span>
              <Sent icon={Mail} label="Email" r={n?.email} sending={n?.sending} />
              <Sent icon={MessageCircle} label="WhatsApp" r={n?.whatsapp} sending={n?.sending} />
              {n?.response === 'confirmed' ? <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Confirmed{n.via ? ` · ${n.via === 'by hand' ? 'by hand' : n.via === 'email' ? 'by email' : 'on WhatsApp'}` : ''}</Badge>
                : n?.response === 'declined' ? <Badge className="bg-red-100 text-red-800 hover:bg-red-100">Can't attend</Badge>
                : <Badge variant="outline" className="text-gray-500">No answer yet</Badge>}
              {may && (
                <span className="ml-auto flex gap-1">
                  {n?.response !== 'confirmed' && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => answer.mutate({ id: p.id, email: s.email, response: 'confirmed' })}><Check className="mr-1 h-3 w-3" />Confirmed</Button>}
                  {n?.response !== 'declined' && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={() => answer.mutate({ id: p.id, email: s.email, response: 'declined' })}>Can't attend</Button>}
                  {n?.response && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={() => answer.mutate({ id: p.id, email: s.email, response: null })}>Clear</Button>}
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy || n?.sending} onClick={() => { if (confirm(`Send ${s.name} the program's email and WhatsApp again?`)) resend.mutate({ id: p.id, email: s.email }); }}><RotateCw className="mr-1 h-3 w-3" />Resend</Button>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* Your (team's) students first; "Any CS's student" searches everyone, to add one by one. */
function StudentPicker({ onPick, exclude = [], teams: picked = [] }) {
  const team = picked.join(',');
  const [q, setQ] = useState('');
  const [everyone, setEveryone] = useState(false);
  const enabled = everyone ? q.trim().length >= 2 : true;
  const { data, isFetching } = useQuery({
    queryKey: ['program-students', q.trim(), everyone, team], enabled, staleTime: 30_000,
    queryFn: () => fn('searchProgramStudents', { q: q.trim(), everyone, ...(picked.length ? { teams: picked } : {}) }),
  });
  const hits = (data?.students ?? []).filter(s => !exclude.includes(s.email)).slice(0, 30);
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder={everyone ? 'Any CS’s student — name, email or code…' : team ? 'The team’s students — name, email or code…' : 'Your students — name, email or code…'} className="pl-8" />
        </div>
        <Button type="button" size="sm" variant={everyone ? 'default' : 'outline'} onClick={() => setEveryone(v => !v)} className="whitespace-nowrap">{everyone ? 'Any CS’s student' : team ? 'Only the team' : 'Only mine'}</Button>
      </div>
      {enabled && (
        <div className="max-h-48 overflow-auto rounded-md border">
          {isFetching && <p className="flex items-center gap-1 px-3 py-2 text-xs text-gray-500"><Loader2 className="h-3 w-3 animate-spin" />Searching…</p>}
          {!isFetching && !hits.length && <p className="px-3 py-2 text-xs text-gray-500">{everyone ? 'No student found' : team ? 'None of the team’s students match — try “Any CS’s student”.' : 'None of your students match — try “Any CS’s student”.'}</p>}
          {hits.map(s => (
            <button key={s.id} type="button" onClick={() => { onPick(s); setQ(''); }} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50">
              <span>{s.name} <span className="text-xs text-gray-500">{s.code} · {s.email}{!s.yours && s.csName ? ` · CS ${s.csName}` : ''}</span></span>
              <UserPlus className="h-3.5 w-3.5 text-gray-400" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProgramDialog({ program, onClose, teams = [] }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const { data: sched } = useQuery({
    queryKey: ['program-mentors'], staleTime: 5 * 60_000, enabled: !program,
    queryFn: () => fn('getMentorSchedule', { from: new Date().toISOString(), to: new Date(Date.now() + 864e5).toISOString() }),
  });
  const mentors = useMemo(() => (sched?.mentors ?? []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name))), [sched]);
  const create = useProgramAction('createProgram', 'Program made — the students are booked on every class and get the email and WhatsApp');
  const reschedule = useProgramAction('rescheduleProgram', 'Program changed');
  const [f, setF] = useState({
    title: program?.title ?? '', description: program?.description ?? '', mentorEmail: program?.mentor?.email ?? '',
    repeat: program?.repeat ?? 'weekly', weekdays: program?.weekdays ?? [], monthDay: program?.monthDay ?? '',
    startDate: program?.startDate ?? today, endDate: program?.endDate ?? '', time: program?.time ?? '19:00', durationMins: program?.durationMins ?? 60,
    isOnline: program?.isOnline ?? true, location: program?.location ?? '',
  });
  const [students, setStudents] = useState([]);
  /* Groups ticked in the dropdown (2026-10-15) and which brought each student: unticking a group takes off only the
     students no other group (or a pick by hand, 'manual') brought. */
  const [groups, setGroups] = useState([]);
  const [via, setVia] = useState({});
  const addGroup = (key, found) => {
    setGroups(g => (g.includes(key) ? g : [...g, key]));
    setVia(v => { const n = { ...v }; for (const s of found) n[s.email] = [...new Set([...(n[s.email] ?? []), key])]; return n; });
    setStudents(xs => { const have = new Set(xs.map(x => x.email)); return [...xs, ...found.filter(x => !have.has(x.email))]; });
  };
  const removeGroup = (key) => {
    setGroups(g => g.filter(k => k !== key));
    const n = {}, drop = new Set();
    for (const [email, keys] of Object.entries(via)) { const left = keys.filter(k => k !== key); if (left.length) n[email] = left; else if (keys.includes(key)) drop.add(email); }
    setVia(n);
    setStudents(xs => xs.filter(x => !drop.has(x.email)));
  };
  const pickOne = (s) => {
    setVia(v => ({ ...v, [s.email]: [...new Set([...(v[s.email] ?? []), 'manual'])] }));
    setStudents(xs => (xs.some(x => x.email === s.email) ? xs : [...xs, s]));
  };
  const dropOne = (email) => {
    setVia(v => { const n = { ...v }; delete n[email]; return n; });
    setStudents(xs => xs.filter(x => x.email !== email));
  };
  // Co-mentors beside the main one, and its picture (2026-10-15; the LMS shows it on the class cards).
  const [coMentors, setCoMentors] = useState((program?.coMentors ?? []).map(m => String(m.email).toLowerCase()));
  const [image, setImage] = useState(program?.thumbnailUrl ?? '');
  const [uploading, setUploading] = useState(false);
  const upload = async (file) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast.error('A JPG, PNG or WebP picture'); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error('At most 2 MB'); return; }
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setImage(file_url);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setUploading(false);
    }
  };
  // The team it is for — their own (the first they may pick) to start (2026-10-14).
  // Several teams, or all of them (the user, 2026-10-15).
  const [picked, setPicked] = useState(teams[0]?.id ? [teams[0].id] : []);
  const allPicked = teams.length > 0 && picked.length === teams.length;
  const toggleTeam = (id) => setPicked(xs => (xs.includes(id) ? xs.filter(x => x !== id) : [...xs, id]));
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const busy = create.isPending || reschedule.isPending;
  const ready = f.title.trim().length >= 3 && f.endDate && (f.repeat === 'monthly' || f.weekdays.length) && (f.isOnline || f.location.trim().length >= 2) && (program || (f.mentorEmail && students.length));
  const submit = () => {
    const sched = { repeat: f.repeat, weekdays: f.repeat === 'weekly' ? f.weekdays : [], monthDay: f.repeat === 'monthly' && f.monthDay !== '' ? Number(f.monthDay) : null, startDate: f.startDate, endDate: f.endDate, time: f.time, durationMins: Number(f.durationMins), title: f.title.trim(), description: f.description.trim(), isOnline: f.isOnline, location: f.location.trim() };
    // Changing: the picture on its own (the classes stay), then the rest only if any of it changed.
    const same = program && ['repeat', 'monthDay', 'startDate', 'endDate', 'time', 'durationMins', 'title', 'description', 'isOnline', 'location'].every(k => String(sched[k] ?? '') === String(program[k] ?? ''))
      && JSON.stringify(sched.weekdays) === JSON.stringify(program.repeat === 'weekly' ? program.weekdays : []);
    const m = program
      ? (async () => {
          if (image !== (program.thumbnailUrl ?? '')) await reschedule.mutateAsync({ id: program.id, thumbnailUrl: image });
          if (!same) await reschedule.mutateAsync({ id: program.id, ...sched });
        })()
      : create.mutateAsync({ ...sched, mentorEmail: f.mentorEmail, coMentorEmails: coMentors.filter(e => e !== f.mentorEmail), ...(image ? { thumbnailUrl: image } : {}), studentEmails: students.map(s => s.email), ...(picked.length ? { teams: allPicked ? ['all'] : picked } : {}) });
    m.then(onClose).catch(() => {});
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-auto">
        <DialogHeader>
          <DialogTitle>{program ? 'Change program' : 'New program'}</DialogTitle>
          <DialogDescription>{program ? 'The classes still to come are cancelled and made again; the students are told as for any moved class.' : 'A class that repeats until the end date, in the LMS, for these students only.'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={f.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Weekly trade review" /></div>
          <div><Label>What it is (optional)</Label><Input value={f.description} onChange={e => set('description', e.target.value)} /></div>
          {!program && teams.length > 0 && (
            <div>
              <div className="flex items-center justify-between">
                <Label>Teams</Label>
                {teams.length > 1 && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    <input type="checkbox" checked={allPicked} onChange={e => setPicked(e.target.checked ? teams.map(t => t.id) : [])} />All teams
                  </label>
                )}
              </div>
              <div className="mt-1 flex max-h-32 flex-wrap gap-1.5 overflow-auto rounded-md border p-2">
                {teams.map(t => {
                  const on = picked.includes(t.id);
                  return (
                    <button key={t.id} type="button" onClick={() => toggleTeam(t.id)} aria-pressed={on}
                      className={cn('rounded-full border px-2.5 py-1 text-xs', on ? 'border-blue-300 bg-blue-100 font-medium text-blue-800' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50')}>
                      {t.name}{t.location === 'bangalore' ? ' · Bangalore' : ''}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-gray-500">{picked.length ? `${picked.length} team${picked.length === 1 ? '' : 's'} — their students are listed below` : 'No team — your own students are listed below'}</p>
            </div>
          )}
          {!program && (
            <div><Label>Mentor</Label>
              <select className="mt-1 w-full rounded-md border px-3 py-2 text-sm" value={f.mentorEmail} onChange={e => set('mentorEmail', e.target.value)}>
                <option value="">{sched ? 'Pick the mentor…' : 'Loading mentors…'}</option>
                {mentors.map(m => <option key={m.email} value={String(m.email).toLowerCase()}>{m.name}</option>)}
              </select>
            </div>
          )}
          {!program && mentors.length > 1 && (
            <div>
              <Label>Co-mentors (optional)</Label>
              <div className="mt-1 flex max-h-28 flex-wrap gap-1.5 overflow-auto rounded-md border p-2">
                {mentors.filter(m => String(m.email).toLowerCase() !== f.mentorEmail).map(m => {
                  const e = String(m.email).toLowerCase();
                  const on = coMentors.includes(e);
                  return (
                    <button key={e} type="button" aria-pressed={on} onClick={() => setCoMentors(xs => (on ? xs.filter(x => x !== e) : [...xs, e]))}
                      className={cn('rounded-full border px-2.5 py-1 text-xs', on ? 'border-violet-300 bg-violet-100 font-medium text-violet-800' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50')}>{m.name}</button>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <Label>Picture (optional)</Label>
            <div className="mt-1 flex items-center gap-3">
              {image ? <img src={image} alt="" className="h-14 w-24 rounded-md border object-cover" /> : <div className="flex h-14 w-24 items-center justify-center rounded-md border border-dashed text-[10px] text-gray-400">No picture</div>}
              <label className="cursor-pointer rounded-md border px-3 py-1.5 text-xs hover:bg-gray-50">
                {uploading ? 'Uploading…' : image ? 'Change' : 'Upload'}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploading} onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              {image && <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setImage('')}>Remove</button>}
            </div>
            <p className="mt-1 text-xs text-gray-500">Shown on its classes in the LMS. JPG, PNG or WebP, up to 2 MB.</p>
          </div>
          <div className="flex gap-2">
            {['weekly', 'monthly'].map(r => <Button key={r} type="button" size="sm" variant={f.repeat === r ? 'default' : 'outline'} className="flex-1" onClick={() => set('repeat', r)}>{r === 'weekly' ? 'Weekly' : 'Monthly'}</Button>)}
          </div>
          {f.repeat === 'weekly' ? (
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => <Button key={d} type="button" size="sm" variant={f.weekdays.includes(i) ? 'default' : 'outline'} onClick={() => set('weekdays', f.weekdays.includes(i) ? f.weekdays.filter(x => x !== i) : [...f.weekdays, i].sort())}>{d}</Button>)}
            </div>
          ) : (
            <div><Label>Day of the month</Label><Input type="number" min={1} max={31} value={f.monthDay} placeholder={String(Number(f.startDate.slice(8)) || 1)} onChange={e => set('monthDay', e.target.value === '' ? '' : Number(e.target.value))} /><p className="mt-1 text-xs text-gray-500">A shorter month takes its last day.</p></div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div><Label>From</Label><Input type="date" value={f.startDate} onChange={e => set('startDate', e.target.value)} /></div>
            <div><Label>Until</Label><Input type="date" value={f.endDate} onChange={e => set('endDate', e.target.value)} /></div>
            <div><Label>Time (Dubai)</Label><Input type="time" value={f.time} onChange={e => set('time', e.target.value)} /></div>
            <div><Label>Length</Label>
              <select className="mt-1 w-full rounded-md border px-3 py-2 text-sm" value={f.durationMins} onChange={e => set('durationMins', Number(e.target.value))}>{[30, 45, 60, 90, 120].map(n => <option key={n} value={n}>{n} min</option>)}</select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!f.isOnline} onChange={e => set('isOnline', !e.target.checked)} />In person (no Meet link)</label>
          {!f.isOnline && <Input value={f.location} onChange={e => set('location', e.target.value)} placeholder="Where — room or office" />}
          {!program && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label>Students — only they see it{students.length ? ` (${students.length})` : ''}</Label>
                {students.length > 0 && <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => { setStudents([]); setVia({}); setGroups([]); }}>Clear all</button>}
              </div>
              <div className="mt-1"><AudiencePicker selected={groups} onAdd={addGroup} onRemove={removeGroup} /></div>
              {students.length > 490 && <p className="mt-1 text-xs text-amber-700">A program takes at most 490 students — take some off.</p>}
              {students.some(s => s.lms === false) && <p className="mt-1 text-xs text-amber-700">{students.filter(s => s.lms === false).length} without an LMS account join as guests — they get the program by email and WhatsApp with the Google Meet link, and each class's link before it starts.</p>}
              <div className="my-1.5 flex max-h-40 flex-wrap gap-1.5 overflow-auto">
                {students.map(s => <span key={s.email} className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-xs', s.lms === false ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-800')}>{s.name}{s.lms === false && <span className="rounded bg-amber-200/70 px-1 text-[10px] font-semibold" title="No LMS account — joins as a guest: the program by email and WhatsApp, with the Meet link">No LMS</span>}{!s.yours && s.csName ? <span className="text-blue-400">· {s.csName}</span> : null}<button type="button" aria-label={`Remove ${s.name}`} onClick={() => dropOne(s.email)}><X className="h-3 w-3" /></button></span>)}
              </div>
              <StudentPicker teams={picked} exclude={students.map(s => s.email)} onPick={pickOne} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !ready} onClick={submit} className="bg-blue-600 hover:bg-blue-700">{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}{program ? 'Save' : 'Make program'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
