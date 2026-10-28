import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PageTitle } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlarmClock, AlertCircle, Bell, CalendarClock, Check, CheckCircle2, Clock, Loader2, Pencil, Plus, RotateCcw, Search, Timer, Trash2, UserRound, Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { createPageUrl } from '@/utils';
import ReminderDialog, { fn } from '@/components/reminders/ReminderDialog';

/* ────────────────────────────────────────────────────────────────────────────
   Reminders (the user, 2026-10-28: "a reminder page for everyone, like the
   sales portals"): your own, as the Delta sales CRM's page has them — Overdue,
   Due soon (30 minutes), Today, Upcoming and Done — set, changed, marked done
   (with what came of it) or deleted by you; told on the bell, your phone and
   here 15 minutes before and at the time. A Chief Mentor sees their team's, a
   CS Manager their location's and admins everyone's — view only (backend
   functions/reminders.ts).
──────────────────────────────────────────────────────────────────────────── */

const STATES = {
  overdue: { label: 'Overdue', Icon: AlertCircle, card: 'border-rose-200 bg-rose-50/60', badge: 'bg-rose-100 text-rose-700', icon: 'text-rose-500' },
  soon: { label: 'Due soon', Icon: Timer, card: 'border-amber-200 bg-amber-50/60', badge: 'bg-amber-100 text-amber-800', icon: 'text-amber-500' },
  today: { label: 'Today', Icon: Clock, card: 'border-sky-200 bg-sky-50/50', badge: 'bg-sky-100 text-sky-700', icon: 'text-sky-500' },
  upcoming: { label: 'Upcoming', Icon: CalendarClock, card: 'border-slate-200 bg-white', badge: 'bg-slate-100 text-slate-600', icon: 'text-slate-400' },
  done: { label: 'Done', Icon: CheckCircle2, card: 'border-slate-200 bg-slate-50/70', badge: 'bg-emerald-100 text-emerald-700', icon: 'text-emerald-500' },
};
const ORDER = ['overdue', 'soon', 'today', 'upcoming', 'done'];

const endOfDubaiDay = () => { const d = new Date(Date.now() + 4 * 3_600_000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - 4 * 3_600_000; };
export function stateOf(r) {
  if (r.done) return 'done';
  const at = new Date(r.remind_at).getTime(), now = Date.now();
  if (at < now) return 'overdue';
  if (at - now <= 30 * 60_000) return 'soon';
  return at < endOfDubaiDay() ? 'today' : 'upcoming';
}
const when = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Dubai' });
function relative(iso) {
  const diff = new Date(iso).getTime() - Date.now(), abs = Math.abs(diff);
  const m = Math.round(abs / 60_000), h = Math.round(abs / 3_600_000), d = Math.round(abs / 86_400_000);
  const n = m < 60 ? `${m} min` : h < 48 ? `${h} h` : `${d} days`;
  return m < 1 ? 'now' : diff > 0 ? `in ${n}` : `${n} ago`;
}

function ReminderCard({ r, mine, onEdit, onDone, onReopen, onDelete }) {
  const s = STATES[stateOf(r)];
  return (
    <div className={cn('rounded-xl border p-4 shadow-sm', s.card)}>
      <div className="flex items-start gap-3">
        <s.Icon className={cn('mt-0.5 h-5 w-5 shrink-0', s.icon)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn('font-medium text-slate-900', r.done && 'text-slate-500 line-through')}>{r.title}</p>
            <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', s.badge)}>{s.label}</span>
          </div>
          <p className="mt-0.5 text-sm text-slate-600">{when(r.remind_at)} <span className="text-slate-400">· {relative(r.remind_at)}</span></p>
          {r.student_id && (
            <Link to={`${createPageUrl('StudentDetail')}?id=${r.student_id}`} className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-brand-navy hover:underline">
              <UserRound className="h-3.5 w-3.5" />{r.student_name || 'A student'}{r.student_code && <span className="font-normal text-slate-400">{r.student_code}</span>}
            </Link>
          )}
          {r.note && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{r.note}</p>}
          {r.done && <p className="mt-1 text-xs text-emerald-700">Done {r.done_at ? when(r.done_at) : ''}{r.done_note ? ` — ${r.done_note}` : ''}</p>}
          {!mine && <p className="mt-1 text-xs text-slate-400">{r.owner_name}{r.team ? ` · ${r.team}` : ''}</p>}
        </div>
        {mine && (
          <div className="flex shrink-0 items-center gap-1">
            {r.done
              ? <Button size="sm" variant="ghost" onClick={onReopen} title="Not done after all"><RotateCcw className="h-4 w-4" /></Button>
              : <Button size="sm" variant="outline" onClick={onDone} className="h-8"><Check className="mr-1 h-4 w-4" />Done</Button>}
            {!r.done && <Button size="sm" variant="ghost" onClick={onEdit} title="Change"><Pencil className="h-4 w-4" /></Button>}
            <Button size="sm" variant="ghost" onClick={onDelete} title="Delete" className="text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The cards grouped Overdue … Done, each group's count on top. */
function Groups({ list, mine, actions, empty }) {
  const groups = useMemo(() => {
    const g = Object.fromEntries(ORDER.map(k => [k, []]));
    for (const r of list) g[stateOf(r)].push(r);
    g.done.sort((a, b) => String(b.done_at || b.remind_at).localeCompare(String(a.done_at || a.remind_at)));
    return g;
  }, [list]);
  if (!list.length) return <p className="rounded-xl border border-dashed p-10 text-center text-sm text-slate-400">{empty}</p>;
  return (
    <div className="space-y-6">
      {ORDER.filter(k => groups[k].length).map(k => (
        <section key={k} className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">{STATES[k].label}<span className="rounded-full bg-slate-100 px-2 text-xs text-slate-500">{groups[k].length}</span></h2>
          <div className="grid gap-2 lg:grid-cols-2">
            {groups[k].map(r => <ReminderCard key={r.id} r={r} mine={mine} {...(actions ? actions(r) : {})} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function Reminders() {
  const queryClient = useQueryClient();
  const [view, setView] = useState('mine');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);       // { reminder } or { } for a new one
  const [finishing, setFinishing] = useState(null);   // the reminder being marked done
  const [doneNote, setDoneNote] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [teamFilter, setTeamFilter] = useState({ person: 'all', team: 'all', state: 'active' });

  const mine = useQuery({ queryKey: ['reminders', 'mine'], queryFn: () => fn('getMyReminders', { state: 'all' }), refetchInterval: 60_000, retry: false });
  const scope = useQuery({ queryKey: ['reminders', 'scope'], queryFn: () => fn('getReminderTeamScope', {}), staleTime: 5 * 60_000, retry: false });
  const team = useQuery({
    queryKey: ['reminders', 'team', teamFilter], enabled: view === 'team', retry: false,
    queryFn: () => fn('getTeamReminders', { state: teamFilter.state, ...(teamFilter.person !== 'all' ? { person: teamFilter.person } : {}), ...(teamFilter.team !== 'all' ? { team: teamFilter.team } : {}) }),
  });
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['reminders'] }); queryClient.invalidateQueries({ queryKey: ['nav-counts'] }); };
  const done = useMutation({
    mutationFn: ({ r, isDone, note }) => fn('setReminderDone', { id: r.id, done: isDone, note }),
    onSuccess: (_, v) => { toast.success(v.isDone ? 'Marked done' : 'Opened again'); setFinishing(null); setDoneNote(''); refresh(); },
    onError: (e) => toast.error(e?.message || "That didn't work"),
  });
  const remove = useMutation({
    mutationFn: (r) => fn('deleteReminder', { id: r.id }),
    onSuccess: () => { toast.success('Reminder deleted'); setDeleting(null); refresh(); },
    onError: (e) => toast.error(e?.message || "That didn't work"),
  });

  const needle = q.trim().toLowerCase();
  const match = (r) => !needle || [r.title, r.note, r.student_name, r.student_code, r.owner_name].some(v => String(v || '').toLowerCase().includes(needle));
  const list = (view === 'team' ? team.data?.reminders : mine.data?.reminders) ?? [];
  const shown = list.filter(match);
  const counts = useMemo(() => {
    const c = Object.fromEntries(ORDER.map(k => [k, 0]));
    for (const r of mine.data?.reminders ?? []) c[stateOf(r)]++;
    return c;
  }, [mine.data]);
  const teamScope = scope.data?.scope;
  const loading = view === 'team' ? team.isLoading : mine.isLoading;
  const failed = view === 'team' ? team.error : mine.error;

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <PageTitle eyebrow="Overview" icon={AlarmClock}>Reminders</PageTitle>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">Set yourself a reminder — about a student or anything else. You'll be told on the bell, your phone and here, 15 minutes before and at the time.</p>
          </div>
          <Button onClick={() => setEditing({})}><Plus className="mr-1.5 h-4 w-4" />New reminder</Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {ORDER.map(k => {
            const S = STATES[k];
            return (
              <div key={k} className={cn('rounded-xl border p-3', S.card)}>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500"><S.Icon className={cn('h-3.5 w-3.5', S.icon)} />{S.label}</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{counts[k]}</p>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {teamScope && teamScope !== 'none' && (
            <div className="flex rounded-full border border-slate-200 bg-white p-0.5">
              {[['mine', 'My reminders', Bell], ['team', teamScope === 'all' ? 'All reminders' : 'Team reminders', Users]].map(([k, l, I]) => (
                <button key={k} type="button" onClick={() => setView(k)}
                  className={cn('inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium', view === k ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50')}><I className="h-3.5 w-3.5" />{l}</button>
              ))}
            </div>
          )}
          {view === 'team' && (
            <>
              <Select value={teamFilter.state} onValueChange={(v) => v && setTeamFilter(f => ({ ...f, state: v }))}>
                <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Not done</SelectItem><SelectItem value="done">Done</SelectItem><SelectItem value="all">All</SelectItem></SelectContent>
              </Select>
              {(team.data?.teams?.length ?? 0) > 1 && (
                <Select value={teamFilter.team} onValueChange={(v) => v && setTeamFilter(f => ({ ...f, team: v, person: 'all' }))}>
                  <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All teams</SelectItem>{team.data.teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <Select value={teamFilter.person} onValueChange={(v) => v && setTeamFilter(f => ({ ...f, person: v }))}>
                <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">Everyone</SelectItem>{(team.data?.people ?? []).map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </>
          )}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Title, student, note…" className="h-9 w-64 pl-8" />
          </div>
        </div>
        {view === 'team' && <p className="text-xs text-slate-400">View only — only whoever set a reminder changes it.</p>}

        {loading ? <p className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>
          : failed ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {/unknown function|not found|404/i.test(String(failed?.message)) ? 'Reminders need the server update (the API deploy).' : failed.message}
            </p>
          ) : (
            <Groups
              list={shown} mine={view === 'mine'}
              empty={needle ? 'No reminder matches.' : view === 'team' ? 'No reminders here.' : 'No reminders yet — set one with New reminder.'}
              actions={view === 'mine' ? (r) => ({
                onEdit: () => setEditing({ reminder: r }),
                onDone: () => { setFinishing(r); setDoneNote(''); },
                onReopen: () => done.mutate({ r, isDone: false }),
                onDelete: () => setDeleting(r),
              }) : null}
            />
          )}
      </div>

      <ReminderDialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)} reminder={editing?.reminder ?? null} />

      <Dialog open={!!finishing} onOpenChange={(v) => !v && setFinishing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Done — {finishing?.title}</DialogTitle><DialogDescription>What came of it? (optional)</DialogDescription></DialogHeader>
          <Textarea value={doneNote} onChange={e => setDoneNote(e.target.value)} rows={3} maxLength={1000} placeholder="Called — will pay on Sunday" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinishing(null)}>Cancel</Button>
            <Button onClick={() => done.mutate({ r: finishing, isDone: true, note: doneNote })} disabled={done.isPending}>{done.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Mark done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Delete this reminder?</DialogTitle><DialogDescription>{deleting?.title} — {deleting ? when(deleting.remind_at) : ''}</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Keep it</Button>
            <Button variant="destructive" onClick={() => remove.mutate(deleting)} disabled={remove.isPending}>{remove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
