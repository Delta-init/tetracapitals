import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowRight, Download, Loader2, Route, Search } from 'lucide-react';
import { createPageUrl } from '@/utils';

export const KINDS = {
  inactivity: { label: 'Inactivity (90 days)', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  transfer: { label: 'Transfer', cls: 'border-blue-200 bg-blue-50 text-blue-700' },
  in_team: { label: 'Reassign in team', cls: 'border-cyan-200 bg-cyan-50 text-cyan-700' },
  intake: { label: 'New · intake', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  created: { label: 'New · added', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  imported: { label: 'New · imported', cls: 'border-violet-200 bg-violet-50 text-violet-700' },
};
const NEW_KINDS = ['intake', 'created', 'imported'];
const RANGES = { 30: 'Last 30 days', 90: 'Last 90 days', 365: 'Last 12 months', 1095: 'Last 3 years' };
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const who = (s) => (s ? `${s.name || '—'}${s.team ? ` · ${s.team}` : ''}` : '—');

/**
 * Every time students changed hands — new students given out (intake,
 * added, imported), transfers, in-team reassigns and inactivity moves — as a
 * list and as a team-to-team map. With `teamId` it shows only that team's
 * moves and splits them into in / out / inside / new.
 */
export default function StudentMovesPanel({ teamId = null, showMap = true, title = 'Student moves' }) {
  const [days, setDays] = useState('90');
  const [kind, setKind] = useState('all');
  const [team, setTeam] = useState('all');
  const [dir, setDir] = useState('all');
  const [q, setQ] = useState('');
  const [pathOf, setPathOf] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['student-moves', teamId, days],
    queryFn: async () => (await base44.functions.invoke('getStudentMoves', {
      teamId: teamId || undefined,
      from: new Date(Date.now() - Number(days) * 86_400_000).toISOString(),
    })).data,
  });
  const moves = data?.moves || [];
  const teamName = data?.team?.name;

  const dirOf = (m) => {
    if (!teamName) return null;
    if (NEW_KINDS.includes(m.kind)) return 'new';
    const f = m.from?.team === teamName, t = m.to?.team === teamName;
    return f && t ? 'inside' : t ? 'in' : f ? 'out' : 'inside';
  };

  const needle = q.trim().toLowerCase();
  const visible = moves.filter(m =>
    (kind === 'all' || (kind === 'new' ? NEW_KINDS.includes(m.kind) : m.kind === kind)) &&
    (team === 'all' || m.from?.team === team || m.to?.team === team) &&
    (dir === 'all' || dirOf(m) === dir) &&
    (!needle || [m.studentName, m.studentCode, m.from?.name, m.to?.name].some(v => String(v || '').toLowerCase().includes(needle)))
  );

  const counts = useMemo(() => {
    const c = {};
    for (const m of moves) c[m.kind] = (c[m.kind] || 0) + 1;
    return c;
  }, [moves]);

  const exportCsv = () => {
    const rows = [['Date', 'Kind', 'Student', 'Code', 'From', 'From team', 'To', 'To team', 'Now with', 'By']];
    for (const m of visible) rows.push([fmt(m.at), KINDS[m.kind]?.label || m.kind, m.studentName, m.studentCode, m.from?.name || '', m.from?.team || '', m.to?.name || '', m.to?.team || '', who(m.now), m.by || '']);
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `student_moves_${teamName ? teamName.replace(/\W+/g, '_') + '_' : ''}${days}d.csv`;
    a.click();
  };

  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={days} onValueChange={(v) => v && setDays(v)}>
        <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
        <SelectContent>{Object.entries(RANGES).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={kind} onValueChange={(v) => v && setKind(v)}>
        <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All kinds</SelectItem>
          <SelectItem value="new">New (intake / added / imported)</SelectItem>
          {Object.entries(KINDS).filter(([k]) => !NEW_KINDS.includes(k)).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {teamName ? (
        <Select value={dir} onValueChange={(v) => v && setDir(v)}>
          <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">In and out</SelectItem>
            <SelectItem value="in">Moved in</SelectItem>
            <SelectItem value="out">Moved out</SelectItem>
            <SelectItem value="inside">Inside team</SelectItem>
            <SelectItem value="new">New to team</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <Select value={team} onValueChange={(v) => v && setTeam(v)}>
          <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All teams</SelectItem>
            {(data?.teams || []).map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Student or person…" className="h-9 w-52 pl-9" />
      </div>
      <Button variant="outline" size="sm" onClick={exportCsv} disabled={!visible.length}><Download className="h-4 w-4" /> CSV</Button>
    </div>
  );

  const list = (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50/80">
            {['Date', 'Kind', 'Student', 'From', '', 'To', 'Now with', ''].map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={8} className="py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
          ) : error ? (
            <tr><td colSpan={8} className="py-10 text-center text-rose-600">{error.message || 'Could not load moves'}</td></tr>
          ) : visible.length === 0 ? (
            <tr><td colSpan={8} className="py-10 text-center text-slate-400">No moves in this period.</td></tr>
          ) : visible.slice(0, 500).map((m, i) => (
            <tr key={`${m.studentId}-${m.at}-${i}`} className="border-b border-slate-100 hover:bg-brand-cyan/[0.04]">
              <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{fmt(m.at)}</td>
              <td className="px-4 py-2.5"><Badge variant="outline" className={KINDS[m.kind]?.cls}>{KINDS[m.kind]?.label || m.kind}</Badge></td>
              <td className="px-4 py-2.5">
                <Link to={`${createPageUrl('StudentDetail')}?id=${m.studentId}`} className="font-medium text-slate-900 hover:text-blue-600">{m.studentName}</Link>
                <div className="font-mono text-xs text-slate-400">{m.studentCode}</div>
              </td>
              <td className="px-4 py-2.5 text-slate-600">{NEW_KINDS.includes(m.kind) ? <span className="text-slate-400">new</span> : who(m.from)}</td>
              <td className="px-1 py-2.5 text-slate-300"><ArrowRight className="h-4 w-4" /></td>
              <td className="px-4 py-2.5 font-medium text-slate-800">{who(m.to)}</td>
              <td className="px-4 py-2.5 text-slate-500">{m.now && m.now.id !== m.to?.id ? who(m.now) : <span className="text-slate-300">same</span>}</td>
              <td className="px-4 py-2.5 text-right">
                <Button variant="ghost" size="sm" onClick={() => setPathOf(m)} title="Full path"><Route className="h-4 w-4" /></Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {visible.length > 500 && <p className="px-4 py-2 text-xs text-slate-400">Showing the latest 500 of {visible.length}; narrow the filters or export CSV for all.</p>}
    </div>
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-base text-brand-navy">{title} <span className="font-normal text-slate-400">· {visible.length}</span></CardTitle>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {Object.entries(KINDS).map(([k, v]) => counts[k] ? <Badge key={k} variant="outline" className={v.cls}>{v.label}: {counts[k]}</Badge> : null)}
            </div>
          </div>
          {filters}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {showMap ? (
          <Tabs defaultValue="list" className="w-full">
            <div className="border-b px-4 py-2"><TabsList><TabsTrigger value="list">List</TabsTrigger><TabsTrigger value="map">Map</TabsTrigger></TabsList></div>
            <TabsContent value="list" className="mt-0">{list}</TabsContent>
            <TabsContent value="map" className="mt-0 p-4"><MovesMap moves={visible} /></TabsContent>
          </Tabs>
        ) : list}
      </CardContent>
      <StudentPathDialog move={pathOf} onClose={() => setPathOf(null)} />
    </Card>
  );
}

/**
 * Team-to-team map: sources on the left (teams students left, plus "New"),
 * destinations on the right, a band per flow sized by how many moved; the
 * same numbers as a grid underneath.
 */
function MovesMap({ moves }) {
  const flows = useMemo(() => {
    const m = new Map();
    for (const x of moves) {
      if (x.kind === 'in_team') continue;
      const from = NEW_KINDS.includes(x.kind) ? 'New students' : (x.from?.team || 'No team');
      const to = x.to?.team || 'No team';
      if (from === to) continue;
      const k = `${from}→${to}`;
      m.set(k, { from, to, n: (m.get(k)?.n || 0) + 1 });
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [moves]);

  if (!flows.length) return <p className="py-10 text-center text-sm text-slate-400">No moves between teams in this period.</p>;

  const sources = [...new Set(flows.map(f => f.from))].sort((a, b) => (a === 'New students' ? -1 : b === 'New students' ? 1 : a.localeCompare(b)));
  const targets = [...new Set(flows.map(f => f.to))].sort();
  const max = Math.max(...flows.map(f => f.n));
  const rowH = 44, W = 760, top = 20;
  const H = top * 2 + Math.max(sources.length, targets.length) * rowH;
  const yOf = (list, name) => top + list.indexOf(name) * rowH + rowH / 2;
  const x1 = 190, x2 = W - 190;
  const outTotal = (s) => flows.filter(f => f.from === s).reduce((a, f) => a + f.n, 0);
  const inTotal = (t) => flows.filter(f => f.to === t).reduce((a, f) => a + f.n, 0);

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[640px] w-full" role="img" aria-label="Student moves between teams">
          {flows.map((f, i) => {
            const ya = yOf(sources, f.from), yb = yOf(targets, f.to);
            const w = 2 + (f.n / max) * 16;
            const isNew = f.from === 'New students';
            return (
              <g key={i}>
                <path d={`M ${x1} ${ya} C ${(x1 + x2) / 2} ${ya}, ${(x1 + x2) / 2} ${yb}, ${x2} ${yb}`}
                  fill="none" stroke={isNew ? '#7CF0B5' : '#1ED2DE'} strokeOpacity="0.55" strokeWidth={w}>
                  <title>{`${f.from} → ${f.to}: ${f.n}`}</title>
                </path>
                <text x={(x1 + x2) / 2} y={(ya + yb) / 2 - w / 2 - 3} textAnchor="middle" className="fill-slate-500" fontSize="11">{f.n}</text>
              </g>
            );
          })}
          {sources.map(s => (
            <g key={'s' + s}>
              <rect x={10} y={yOf(sources, s) - 15} width={x1 - 10} height={30} rx={8} fill={s === 'New students' ? '#ecfdf5' : '#f1f5f9'} stroke="#e2e8f0" />
              <text x={20} y={yOf(sources, s) + 4} fontSize="12" className="fill-slate-700">{s.length > 20 ? s.slice(0, 19) + '…' : s}</text>
              <text x={x1 - 8} y={yOf(sources, s) + 4} fontSize="11" textAnchor="end" className="fill-slate-400">{outTotal(s)}</text>
            </g>
          ))}
          {targets.map(t => (
            <g key={'t' + t}>
              <rect x={x2} y={yOf(targets, t) - 15} width={W - 10 - x2} height={30} rx={8} fill="#eff6ff" stroke="#dbeafe" />
              <text x={x2 + 10} y={yOf(targets, t) + 4} fontSize="12" className="fill-slate-700">{t.length > 20 ? t.slice(0, 19) + '…' : t}</text>
              <text x={W - 18} y={yOf(targets, t) + 4} fontSize="11" textAnchor="end" className="fill-slate-400">{inTotal(t)}</text>
            </g>
          ))}
        </svg>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50/80">
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">From \ To</th>
              {targets.map(t => <th key={t} className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t}</th>)}
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">Total</th>
            </tr>
          </thead>
          <tbody>
            {sources.map(s => (
              <tr key={s} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-700">{s}</td>
                {targets.map(t => {
                  const n = flows.find(f => f.from === s && f.to === t)?.n;
                  return <td key={t} className={`tabular px-3 py-2 text-right ${n ? 'font-semibold text-brand-navy' : 'text-slate-300'}`}>{n || '·'}</td>;
                })}
                <td className="tabular px-3 py-2 text-right font-semibold text-slate-700">{outTotal(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Reassigns inside one team aren’t drawn; see the list for those.</p>
    </div>
  );
}

/** A student's whole path — every hand they passed through, from their history. */
function StudentPathDialog({ move, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['student-history', move?.studentId],
    queryFn: async () => (await base44.functions.invoke('getStudentHistory', { studentId: move.studentId })).data,
    enabled: !!move,
  });
  const events = (data?.events || []).filter(e => /assigned|mentor_changed|arrived|created|pool_changed|request/.test(e.type));
  return (
    <Dialog open={!!move} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-brand-navy">{move?.studentName} — full path</DialogTitle>
          <DialogDescription>
            Every person and team this student has been with, oldest first.
            {move?.now && <> Now with <strong>{who(move.now)}</strong>.</>}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></div>
        ) : events.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No history recorded for this student.</p>
        ) : (
          <ol className="relative ml-2 space-y-4 border-l border-slate-200 pl-5">
            {events.map((e, i) => (
              <li key={i} className="relative">
                <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${i === events.length - 1 ? 'bg-brand-cyan' : 'bg-slate-300'}`} />
                <p className="text-sm text-slate-800">{e.text}</p>
                <p className="text-xs text-slate-400">{fmt(e.at)}{e.by ? ` · by ${e.by}` : ''}</p>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
