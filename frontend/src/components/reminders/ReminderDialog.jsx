import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Search, X } from 'lucide-react';
import { DateField } from '@/components/followups/followupUi';

/* ────────────────────────────────────────────────────────────────────────────
   Setting a reminder, or changing one (the user, 2026-10-28; backend
   functions/reminders.ts): a title, a note, a date and time (Dubai), and a
   student if it is about one. From the Reminders page, or from a student's
   page with them filled in.
──────────────────────────────────────────────────────────────────────────── */

export const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const DUBAI_MS = 4 * 3_600_000;
/** An instant → its Dubai date and time, for the fields. */
const parts = (iso) => { const d = new Date(new Date(iso).getTime() + DUBAI_MS).toISOString(); return { date: d.slice(0, 10), time: d.slice(11, 16) }; };
const todayInDubai = () => new Date(Date.now() + DUBAI_MS).toISOString().slice(0, 10);
/** An hour from now, on the next quarter hour — the time a new one opens with. */
const soon = () => new Date(Math.ceil((Date.now() + 3_600_000) / 900_000) * 900_000).toISOString();
const QUICK = [['In 30 min', 30], ['In 1 hour', 60], ['In 3 hours', 180], ['Tomorrow 10:00', 'tomorrow']];

/** Students you can see whose name, code, email or phone match — the Students page's own search. */
async function findStudents(q) {
  const first = await fn('listStudents', { filters: { search: q }, pageSize: 25 });
  const team = first?.tabs?.includes('team') && first?.tab !== 'team' ? await fn('listStudents', { tab: 'team', filters: { search: q }, pageSize: 25 }) : null;
  const seen = new Set();
  return [...(first?.rows ?? []), ...(team?.rows ?? [])].filter(s => !seen.has(s.id) && seen.add(s.id)).slice(0, 8);
}

function StudentPick({ value, onChange }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  const found = useQuery({ queryKey: ['reminder-students', q], enabled: q.length >= 2, staleTime: 30_000, retry: false, queryFn: () => findStudents(q) });
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border bg-slate-50 px-3 py-2 text-sm">
        <span><span className="font-medium text-slate-800">{value.name}</span>{value.code && <span className="ml-1 text-slate-400">{value.code}</span>}</span>
        <button type="button" className="text-slate-400 hover:text-slate-700" onClick={() => onChange(null)} aria-label="No student"><X className="h-4 w-4" /></button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input value={text} onChange={e => setText(e.target.value)} placeholder="Name, code, email or phone — optional" className="pl-8" />
      </div>
      {q.length >= 2 && (
        <div className="max-h-48 overflow-auto rounded-md border bg-white">
          {found.isFetching && !found.data ? <p className="px-3 py-2 text-xs text-slate-400">Looking…</p>
            : !(found.data || []).length ? <p className="px-3 py-2 text-xs text-slate-400">No student matches</p>
              : found.data.map(s => (
                <button key={s.id} type="button" onClick={() => { onChange({ id: s.id, name: s.full_name, code: s.student_code }); setText(''); }}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50">
                  {s.full_name} <span className="text-xs text-slate-400">{s.student_code}{s.primary_mentor_name ? ` · ${s.primary_mentor_name}` : ''}</span>
                </button>
              ))}
        </div>
      )}
    </div>
  );
}

/**
 * open: true for a new one; reminder: the one to change (or null); student: { id, name, code } to fill in (a student's
 * page). onSaved(reminder) after it is kept.
 */
export default function ReminderDialog({ open, onOpenChange, reminder = null, student = null, onSaved }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [who, setWho] = useState(null);
  useEffect(() => {
    if (!open) return;
    const p = parts(reminder?.remind_at || soon());
    setTitle(reminder?.title ?? (student ? `Call ${student.name}` : ''));
    setNote(reminder?.note ?? '');
    setDate(p.date); setTime(p.time);
    setWho(reminder?.student_id ? { id: reminder.student_id, name: reminder.student_name, code: reminder.student_code } : student);
  }, [open, reminder, student]);

  const quick = (v) => {
    const at = v === 'tomorrow'
      ? new Date(`${new Date(Date.now() + DUBAI_MS + 86_400_000).toISOString().slice(0, 10)}T10:00:00+04:00`).toISOString()
      : new Date(Math.ceil((Date.now() + v * 60_000) / 60_000) * 60_000).toISOString();
    const p = parts(at); setDate(p.date); setTime(p.time);
  };
  const when = date && time ? new Date(`${date}T${time}:00+04:00`) : null;
  const save = useMutation({
    mutationFn: () => fn('saveReminder', { id: reminder?.id, title, note, remindAt: when.toISOString(), studentId: who?.id || '' }),
    onSuccess: (r) => {
      toast.success(reminder ? 'Reminder changed' : `Reminder set for ${when.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dubai' })}`);
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
      queryClient.invalidateQueries({ queryKey: ['nav-counts'] });
      onSaved?.(r?.reminder);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e?.message || "The reminder wasn't kept"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{reminder ? 'Change reminder' : 'New reminder'}</DialogTitle>
          <DialogDescription>You'll be told on the bell, your phone and here — 15 minutes before and at the time.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>What</Label><Input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="Call back about the course fee" autoFocus /></div>
          <div className="space-y-1.5">
            <Label>When <span className="font-normal text-slate-400">(Dubai time)</span></Label>
            <div className="flex gap-2">
              <DateField value={date} onChange={setDate} min={todayInDubai()} className="flex-1" />
              <Input type="time" value={time} onChange={e => setTime(e.target.value)} className="w-32" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map(([l, v]) => <button key={l} type="button" onClick={() => quick(v)} className="rounded-full border px-2.5 py-0.5 text-xs text-slate-600 hover:bg-slate-50">{l}</button>)}
            </div>
            {when && when.getTime() < Date.now() && <p className="text-xs text-amber-700">That time has passed — it will show as overdue.</p>}
          </div>
          <div className="space-y-1.5"><Label>Student <span className="font-normal text-slate-400">(optional)</span></Label><StudentPick value={who} onChange={setWho} /></div>
          <div className="space-y-1.5"><Label>Note <span className="font-normal text-slate-400">(optional)</span></Label><Textarea value={note} onChange={e => setNote(e.target.value)} maxLength={1000} rows={3} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!title.trim() || !when || save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{reminder ? 'Save' : 'Set reminder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
