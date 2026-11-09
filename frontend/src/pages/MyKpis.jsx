import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowLeft, ArrowUp, Eye, Gauge, Loader2, Lock, Wrench } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/* My KPIs (the user, 2026-11-09). Mentor KPIs are planned, approved and worked out in Root only — here they are shown,
   view only: a mentor their own month (no ranking), a Chief their team, a CS Manager their location's mentors, an admin
   everyone. On a frozen month anyone who may see a mentor can ask for a correction; a root admin decides in Root.
   Observation only: not used for salary, commission, bonuses or penalties. */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const MENTOR_ROLES = ['chief_mentor', 'senior_mentor', 'junior_mentor', 'subjunior_mentor', 'assistance'];
const TEAM_ROLES = ['super_admin', 'admin', 'chief_mentor', 'cs_manager'];
const dubaiMonth = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 7);
const addMonths = (m, n) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm - 1 + n, 1)).toISOString().slice(0, 7); };
const months = () => { const out = []; for (let m = dubaiMonth(); m >= '2026-01' && out.length < 12; m = addMonths(m, -1)) out.push(m); return out; };
const monthLabel = (m) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
const when = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—');
const fmt = (v) => (v == null ? '—' : Number(v).toFixed(1));
const tone = (v) => (v == null ? 'text-slate-400' : v >= 85 ? 'text-emerald-600' : v >= 60 ? 'text-amber-600' : 'text-rose-600');
const bar = (v) => (v == null ? 'bg-slate-200' : v >= 85 ? 'bg-emerald-500' : v >= 60 ? 'bg-amber-500' : 'bg-rose-500');
const value = (v, unit) => {
  if (v == null) return '—';
  const n = unit === 'AED' || unit === 'USD' ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(Math.round(v * 10) / 10);
  return unit === '%' ? `${n}%` : unit === 'AED' || unit === 'USD' ? `${unit} ${n}` : `${n} ${unit}`;
};

function Notice({ data }) {
  if (data?.closed) return <Card><CardContent className="pt-6 text-sm text-slate-600">Mentor KPIs aren&apos;t open yet. They appear here once they are opened from Root.</CardContent></Card>;
  if (data?.missing) return <Card><CardContent className="pt-6 text-sm text-slate-600">No figures for this month — not in the month&apos;s Mentor Report, or no plan covered it.</CardContent></Card>;
  return null;
}

export default function MyKpis() {
  const { data: me } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const role = me?.app_role ?? '';
  const isMentor = MENTOR_ROLES.includes(role);
  const isTeam = TEAM_ROLES.includes(role);
  const [month, setMonth] = useState(dubaiMonth());
  const [view, setView] = useState(null); // a team member's address, or null for one's own / the team list

  const own = useQuery({ queryKey: ['my-kpis', 'own', month], queryFn: () => fn('getMyKpis', { month }), enabled: isMentor && !view, retry: false });
  const team = useQuery({ queryKey: ['my-kpis', 'team', month], queryFn: () => fn('getTeamKpis', { month }), enabled: isTeam && !view, retry: false });
  const one = useQuery({ queryKey: ['my-kpis', 'one', view, month], queryFn: () => fn('getMentorKpis', { email: view, month }), enabled: !!view, retry: false });

  const observation = (own.data ?? team.data ?? one.data)?.observationUntil;
  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <PageTitle eyebrow="Overview" icon={Gauge}>My KPIs</PageTitle>
        <div className="flex-1" />
        <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm">
          {months().map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        <Eye className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Observation mode{observation ? ` until ${when(observation)}` : ''}: not used for salary, commission, bonuses or penalties.
          The plan and the figures are set in Root; anything wrong in a finished month can be sent for a correction.
        </span>
      </div>

      {view ? (
        <>
          <button type="button" onClick={() => setView(null)} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <Detail q={one} month={month} />
        </>
      ) : (
        <>
          {isMentor && <Detail q={own} month={month} />}
          {isTeam && <Team q={team} onOpen={setView} />}
          {!isMentor && !isTeam && me && <Card><CardContent className="pt-6 text-sm text-slate-600">My KPIs are for mentors, Chiefs, CS Managers and admins.</CardContent></Card>}
        </>
      )}
    </div>
  );
}

function Team({ q, onOpen }) {
  if (q.isLoading) return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading the team…</div>;
  if (q.isError) return <Card><CardContent className="pt-6 text-sm text-rose-600">{q.error?.message ?? 'Could not load the team'}</CardContent></Card>;
  const d = q.data;
  if (d?.closed || d?.missing) return <Notice data={d} />;
  const cats = d?.categories ?? [];
  return (
    <Card>
      <CardContent className="overflow-x-auto p-0">
        <div className="border-b px-4 py-3 text-sm font-semibold text-slate-700">The team — {d?.mentors?.length ?? 0} mentors{d?.snapshot ? ` · frozen, version ${d.snapshot.version}` : ' · live'}</div>
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-slate-500">
              <th className="px-4 py-2 font-medium">Mentor</th>
              <th className="px-4 py-2 font-medium">Score</th>
              <th className="px-4 py-2 font-medium">Scored</th>
              {cats.map((c) => <th key={c.key} className="px-4 py-2 font-medium">{c.name} <span className="font-normal">{c.share}%</span></th>)}
            </tr>
          </thead>
          <tbody>
            {(d?.mentors ?? []).map((m) => (
              <tr key={m.email} onClick={() => onOpen(m.email)} className="cursor-pointer border-b last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2"><p className="font-medium text-slate-800">{m.name}</p><p className="text-xs text-slate-500">{m.roleLabel}</p></td>
                <td className={cn('px-4 py-2 font-semibold tabular-nums', tone(m.score))}>{fmt(m.score)}</td>
                <td className="px-4 py-2 tabular-nums text-slate-500">{m.coverage}%</td>
                {cats.map((c) => { const v = m.categories.find((x) => x.key === c.key)?.score ?? null; return <td key={c.key} className={cn('px-4 py-2 tabular-nums', tone(v))}>{fmt(v)}</td>; })}
              </tr>
            ))}
            {!d?.mentors?.length && <tr><td colSpan={3 + cats.length} className="px-4 py-8 text-center text-slate-500">No mentors in this month&apos;s figures.</td></tr>}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function Detail({ q, month }) {
  const [fixing, setFixing] = useState(null);
  if (q.isLoading) return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>;
  if (q.isError) return <Card><CardContent className="pt-6 text-sm text-rose-600">{q.error?.message ?? 'Could not load the KPIs'}</CardContent></Card>;
  const d = q.data;
  if (!d || d.closed || d.missing) return <Notice data={d} />;
  const m = d.mentor;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 pt-5">
          <div>
            <p className="text-lg font-semibold text-slate-800">{m.name}</p>
            <p className="text-sm text-slate-500">{m.roleLabel}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
              {d.snapshot ? <><Lock className="h-3 w-3" />{monthLabel(month)} is frozen (version {d.snapshot.version})</> : `${monthLabel(month)} so far — ${d.elapsed}% of the month gone`}
            </p>
          </div>
          <div className="flex-1" />
          <div className="text-right">
            <p className={cn('text-4xl font-semibold tabular-nums', tone(m.score))}>{fmt(m.score)}</p>
            <p className="text-xs text-slate-500">{m.coverage}% of the plan had data to score</p>
          </div>
          <div className="flex h-16 items-end gap-2">
            {(d.trend ?? []).map((t) => (
              <div key={t.month} className="flex w-10 flex-col items-center gap-1">
                <div className="flex h-12 w-full items-end rounded bg-slate-100"><div className={cn('w-full rounded', bar(t.score))} style={{ height: `${t.score ?? 0}%` }} /></div>
                <span className="text-[10px] text-slate-500">{monthLabel(t.month).slice(0, 3)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {m.categories.map((c) => (
        <Card key={c.key}>
          <CardContent className="space-y-3 pt-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {c.name}<span className="font-normal text-slate-500">{c.weight}% of the score</span>
              <span className="flex-1" /><span className={cn('tabular-nums', tone(c.score))}>{fmt(c.score)}</span>
            </div>
            {c.subs.map((s) => (
              <div key={s.key} className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{s.name}<span className="flex-1" /><span className={cn('tabular-nums', tone(s.score))}>{fmt(s.score)}</span></div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <tbody>
                      {s.kpis.map((k) => (
                        <tr key={k.metric} className="border-t align-top">
                          <td className="py-1.5 pr-2">
                            <p className="text-slate-800">{k.name}</p>
                            <p className="flex items-center gap-1 text-xs text-slate-500">
                              {k.direction === 'up' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{k.direction === 'up' ? 'more is better' : 'fewer is better'}
                            </p>
                          </td>
                          <td className="py-1.5 pr-2 tabular-nums">{value(k.value, k.unit)}</td>
                          <td className="py-1.5 pr-2 tabular-nums text-slate-500">
                            {k.target == null ? '—' : `of ${value(k.target, k.unit)}`}{k.targetFrom === 'mentor' ? ' (yours)' : ''}
                            {k.effectiveTarget != null && k.target != null && k.effectiveTarget !== k.target && <span className="block text-xs">{value(k.effectiveTarget, k.unit)} so far</span>}
                          </td>
                          <td className={cn('py-1.5 pr-2 tabular-nums', tone(k.score))}>{k.mode === 'scored' ? fmt(k.score) : ''}</td>
                          <td className="py-1.5 text-xs text-slate-500">
                            {k.status === 'scored' ? '' : d.statusLabels?.[k.status] ?? k.status}
                            {k.corrected && <span className="block text-indigo-600">Corrected: {k.corrected.reason}</span>}
                            {d.snapshot && k.status !== 'not_available' && (
                              <button type="button" onClick={() => setFixing(k)} className="mt-0.5 inline-flex items-center gap-1 text-slate-500 hover:text-slate-800">
                                <Wrench className="h-3 w-3" />Ask for a correction
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {(d.corrections ?? []).length > 0 && (
        <Card>
          <CardContent className="space-y-2 pt-4 text-sm">
            <p className="font-semibold text-slate-800">Corrections for {monthLabel(month)}</p>
            {d.corrections.map((c) => (
              <div key={c.id} className="border-t pt-2">
                <p>{c.metricName}: {c.action === 'leave_out' ? 'leave it out' : `set to ${c.value}`} — <span className={c.status === 'approved' ? 'text-emerald-600' : c.status === 'rejected' ? 'text-rose-600' : 'text-amber-600'}>
                  {c.status === 'approved' ? 'approved' : c.status === 'rejected' ? 'rejected' : 'waiting for Root'}</span></p>
                <p className="text-xs text-slate-500">{c.reason}{c.decisionNote ? ` · ${c.decisionNote}` : ''}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {fixing && <Correct k={fixing} month={month} email={m.email} onClose={() => setFixing(null)} />}
    </div>
  );
}

function Correct({ k, month, email, onClose }) {
  const qc = useQueryClient();
  const [action, setAction] = useState('set_value');
  const [val, setVal] = useState(k.value == null ? '' : String(k.value));
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [err, setErr] = useState('');
  const send = useMutation({
    mutationFn: () => fn('requestKpiCorrection', { month, email, metric: k.metric, action, value: action === 'set_value' ? Number(val) : null, reason, evidence }),
    onSuccess: (r) => {
      if (r?.closed) { setErr('Mentor KPIs aren\'t open right now.'); return; }
      toast.success('Sent to Root — a root admin decides');
      qc.invalidateQueries({ queryKey: ['my-kpis'] });
      onClose();
    },
    onError: (e) => setErr(e?.message ?? 'Not sent'),
  });
  const submit = () => {
    if (action === 'set_value' && (val.trim() === '' || !Number.isFinite(Number(val)) || Number(val) < 0)) return setErr('Enter the right value (0 or more).');
    if (!reason.trim()) return setErr("Say why it's wrong.");
    send.mutate();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ask for a correction — {k.name}</DialogTitle>
          <DialogDescription>{monthLabel(month)} shows {value(k.value, k.unit)}. A root admin approves or rejects it in Root.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <select value={action} onChange={(e) => { setAction(e.target.value); setErr(''); }} aria-label="Correction" className="h-9 w-full rounded-md border border-slate-300 bg-white px-2">
            <option value="set_value">The right value is…</option>
            <option value="leave_out">Leave this KPI out of the month</option>
          </select>
          {action === 'set_value' && <Input type="number" min={0} value={val} onChange={(e) => { setVal(e.target.value); setErr(''); }} aria-label="The right value" />}
          <Input value={reason} maxLength={500} onChange={(e) => { setReason(e.target.value); setErr(''); }} placeholder="Why it's wrong" aria-label="Why" />
          <Textarea rows={3} value={evidence} maxLength={2000} onChange={(e) => setEvidence(e.target.value)} placeholder="Evidence: what to check, links" aria-label="Evidence" />
          {err && <p className="text-rose-600">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={send.isPending} onClick={submit}>Send to Root</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
