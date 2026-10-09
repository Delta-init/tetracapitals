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
import { CalendarClock, Loader2, Plus, Repeat, Search, Square, UserMinus, UserPlus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

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

export default function Programs() {
  const { data, isLoading, error } = useQuery({ queryKey: ['programs'], queryFn: () => fn('listPrograms', {}), staleTime: 15_000 });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const [showStopped, setShowStopped] = useState(false);
  const list = (data?.programs ?? []).filter(p => showStopped || p.status === 'active');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <PageTitle eyebrow="Students" icon={Repeat}>Programs</PageTitle>
          <p className="mt-1 text-sm text-gray-500">A class that repeats weekly or monthly for the students you pick — only they see it in the LMS and get its reminders.</p>
        </div>
        {data?.canCreate && <Button onClick={() => setCreating(true)} className="bg-blue-600 hover:bg-blue-700"><Plus className="mr-1 h-4 w-4" />New program</Button>}
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={showStopped} onChange={e => setShowStopped(e.target.checked)} />Show stopped</label>
      {isLoading && <div className="space-y-3">{[0, 1].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>}
      {error && <p className="text-sm text-red-600">{errText(error)}</p>}
      {list.map(p => <ProgramCard key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />)}
      {!isLoading && !error && !list.length && <Card><CardContent className="py-10 text-center text-sm text-gray-500">No programs yet{data?.canCreate ? ' — make one with “New program”.' : '.'}</CardContent></Card>}
      {creating && <ProgramDialog onClose={() => setCreating(false)} />}
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

function ProgramCard({ p, open, onToggle }) {
  const change = useProgramAction('changeProgramStudents', 'Students changed');
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
            <p className="mt-0.5 text-xs text-gray-400">Made by {p.createdByName || p.createdByEmail || 'the LMS'}{p.source === 'lms' ? ' (in the LMS)' : ''}</p>
          </div>
          <div className="text-right text-xs text-gray-600">
            <p className="font-medium text-gray-800">{p.mentor?.name ?? '—'}</p>
            <p>{p.students.length} student{p.students.length === 1 ? '' : 's'} · {upcoming.length} to come</p>
            {p.nextClassAt && <p className="flex items-center justify-end gap-1"><CalendarClock className="h-3.5 w-3.5" />{when(p.nextClassAt)}</p>}
          </div>
        </button>
        {open && (
          <div className="mt-4 space-y-4 border-t pt-4">
            <div>
              <p className="mb-2 text-xs font-medium uppercase text-gray-500">Students</p>
              <div className="flex flex-wrap gap-2">
                {p.students.map(s => (
                  <span key={s.email} title={`${s.email}${s.csName ? ` · CS ${s.csName}` : ''}`} className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-xs', s.yours ? 'bg-blue-50 text-blue-800' : 'bg-gray-100 text-gray-700')}>
                    {s.name}{!s.yours && s.csName ? <span className="text-gray-400">· {s.csName}</span> : null}
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
            <div>
              <p className="mb-2 text-xs font-medium uppercase text-gray-500">Classes</p>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {p.classes.map(c => <span key={c.id} className={cn('rounded px-1.5 py-0.5', c.status === 'cancelled' ? 'bg-gray-100 text-gray-400 line-through' : new Date(c.startsAt).getTime() < Date.now() ? 'bg-gray-100 text-gray-500' : 'bg-blue-50 text-blue-700')}>{when(c.startsAt)}</span>)}
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

/* Your (team's) students first; "Any CS's student" searches everyone, to add one by one. */
function StudentPicker({ onPick, exclude = [] }) {
  const [q, setQ] = useState('');
  const [everyone, setEveryone] = useState(false);
  const enabled = everyone ? q.trim().length >= 2 : true;
  const { data, isFetching } = useQuery({
    queryKey: ['program-students', q.trim(), everyone], enabled, staleTime: 30_000,
    queryFn: () => fn('searchProgramStudents', { q: q.trim(), everyone }),
  });
  const hits = (data?.students ?? []).filter(s => !exclude.includes(s.email)).slice(0, 30);
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder={everyone ? 'Any CS’s student — name, email or code…' : 'Your students — name, email or code…'} className="pl-8" />
        </div>
        <Button type="button" size="sm" variant={everyone ? 'default' : 'outline'} onClick={() => setEveryone(v => !v)} className="whitespace-nowrap">{everyone ? 'Any CS’s student' : 'Only mine'}</Button>
      </div>
      {enabled && (
        <div className="max-h-48 overflow-auto rounded-md border">
          {isFetching && <p className="flex items-center gap-1 px-3 py-2 text-xs text-gray-500"><Loader2 className="h-3 w-3 animate-spin" />Searching…</p>}
          {!isFetching && !hits.length && <p className="px-3 py-2 text-xs text-gray-500">{everyone ? 'No student found' : 'None of your students match — try “Any CS’s student”.'}</p>}
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

function ProgramDialog({ program, onClose }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const { data: sched } = useQuery({
    queryKey: ['program-mentors'], staleTime: 5 * 60_000, enabled: !program,
    queryFn: () => fn('getMentorSchedule', { from: new Date().toISOString(), to: new Date(Date.now() + 864e5).toISOString() }),
  });
  const mentors = useMemo(() => (sched?.mentors ?? []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name))), [sched]);
  const create = useProgramAction('createProgram', 'Program made — the students are booked on every class');
  const reschedule = useProgramAction('rescheduleProgram', 'Program changed');
  const [f, setF] = useState({
    title: program?.title ?? '', description: program?.description ?? '', mentorEmail: program?.mentor?.email ?? '',
    repeat: program?.repeat ?? 'weekly', weekdays: program?.weekdays ?? [], monthDay: program?.monthDay ?? '',
    startDate: program?.startDate ?? today, endDate: program?.endDate ?? '', time: program?.time ?? '19:00', durationMins: program?.durationMins ?? 60,
    isOnline: program?.isOnline ?? true, location: program?.location ?? '',
  });
  const [students, setStudents] = useState([]);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const busy = create.isPending || reschedule.isPending;
  const ready = f.title.trim().length >= 3 && f.endDate && (f.repeat === 'monthly' || f.weekdays.length) && (f.isOnline || f.location.trim().length >= 2) && (program || (f.mentorEmail && students.length));
  const submit = () => {
    const sched = { repeat: f.repeat, weekdays: f.repeat === 'weekly' ? f.weekdays : [], monthDay: f.repeat === 'monthly' && f.monthDay !== '' ? Number(f.monthDay) : null, startDate: f.startDate, endDate: f.endDate, time: f.time, durationMins: Number(f.durationMins), title: f.title.trim(), description: f.description.trim(), isOnline: f.isOnline, location: f.location.trim() };
    const m = program
      ? reschedule.mutateAsync({ id: program.id, ...sched })
      : create.mutateAsync({ ...sched, mentorEmail: f.mentorEmail, studentEmails: students.map(s => s.email) });
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
          {!program && (
            <div><Label>Mentor</Label>
              <select className="mt-1 w-full rounded-md border px-3 py-2 text-sm" value={f.mentorEmail} onChange={e => set('mentorEmail', e.target.value)}>
                <option value="">{sched ? 'Pick the mentor…' : 'Loading mentors…'}</option>
                {mentors.map(m => <option key={m.email} value={String(m.email).toLowerCase()}>{m.name}</option>)}
              </select>
            </div>
          )}
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
              <Label>Students — only they see it</Label>
              <div className="my-1.5 flex flex-wrap gap-1.5">
                {students.map(s => <span key={s.email} className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-800">{s.name}{!s.yours && s.csName ? <span className="text-blue-400">· {s.csName}</span> : null}<button type="button" aria-label={`Remove ${s.name}`} onClick={() => setStudents(students.filter(x => x.email !== s.email))}><X className="h-3 w-3" /></button></span>)}
              </div>
              <StudentPicker exclude={students.map(s => s.email)} onPick={s => setStudents(xs => xs.some(x => x.email === s.email) ? xs : [...xs, s])} />
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
