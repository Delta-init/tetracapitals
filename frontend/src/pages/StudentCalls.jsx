import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import StatsCard from '@/components/dashboard/StatsCard';
import SearchableSelect from '@/components/common/SearchableSelect';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  CheckCircle2, Clock, Download, Loader2, Mic, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOff, PlugZap, RefreshCw, Search, Users, XCircle,
} from 'lucide-react';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { createPageUrl } from '@/utils';
import { CallPerson, CallResult, RecordingPlayer, SyncNote, RESULTS, fmtDuration, fmtTalkTotal, fmtWhen } from '@/components/calls/callUi';

const RANGES = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days']];
const PAGE = 200;
const EVERYONE = '__none__';

/**
 * Calls with students, from 3CX — in or out, answered or missed, who took it,
 * how long, and the recording; updated every 5 minutes. Same people as
 * Follow-ups: a CS sees their own students' calls; CS Managers and Chief
 * Mentors their people's too; admin roles everyone (the server enforces it).
 */
export default function StudentCalls() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const [range, setRange] = useState('7');
  const [status, setStatus] = useState('all');
  const [direction, setDirection] = useState('all');
  const [person, setPerson] = useState(EVERYONE);
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['calls', 'list', range, status, direction, person],
    queryFn: async () => (await base44.functions.invoke('getCalls', {
      range,
      status: status === 'all' ? '' : status,
      direction: direction === 'all' ? '' : direction,
      person: person === EVERYONE ? '' : person,
    })).data,
    enabled: !!currentUser,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
  useEffect(() => setShown(PAGE), [range, status, direction, person, q]);

  const calls = data?.calls || [];
  const stats = data?.stats || {};
  const people = data?.people || [];
  const needle = q.trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  const rows = needle
    ? calls.filter(c =>
      [c.student_name, c.student_code, c.user_name, c.agent_name, c.extension].some(v => String(v || '').toLowerCase().includes(needle)) ||
      (digits.length >= 3 && String(c.number || '').replace(/\D/g, '').includes(digits)))
    : calls;
  const personOptions = useMemo(
    () => people.map(p => ({ value: p.key, label: `${p.name}${p.extension && !p.name.includes(p.extension) ? ` · Ext ${p.extension}` : ''} (${p.calls})` })),
    [people],
  );
  const named = people.filter(p => p.key !== '-');

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = (await base44.functions.invoke('syncCallsNow', {})).data;
      if (r?.message) toast.info(r.message);
      else toast.success(r?.inserted ? `${r.inserted} new call${r.inserted === 1 ? '' : 's'} with students` : 'Up to date — no new calls with students');
      queryClient.invalidateQueries({ queryKey: ['calls'] });
    } catch (e) {
      toast.error(e?.message || 'The sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const exportCsv = () => {
    const head = ['When', 'Student', 'Code', 'Number', 'Direction', 'Result', 'Who', 'Extension', 'Talk (seconds)', 'Ring (seconds)', 'Recorded'];
    const lines = [head, ...rows.map(c => [
      new Date(c.started_at).toLocaleString('en-GB'), c.student_name, c.student_code, c.number, c.direction === 'in' ? 'Incoming' : 'Outgoing',
      RESULTS[c.status]?.label || c.status, c.user_name || c.agent_name, c.extension, c.talk_seconds, c.ring_seconds, c.recordings ? 'yes' : 'no',
    ])];
    const csv = lines.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `calls_${range === 'today' ? 'today' : `${range}_days`}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const TH = ({ children, right }) => <th className={`whitespace-nowrap px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
  const dash = <span className="text-slate-300">—</span>;

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <PageTitle eyebrow="Students" icon={PhoneIncoming}>Calls</PageTitle>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
              Every call with a student through 3CX — in or out, answered or missed, who took it, how long, and the recording.
            </p>
          </div>
          {data?.can_sync && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setTesting(true)}><PlugZap className="h-4 w-4" /> Test 3CX</Button>
              <Button onClick={syncNow} disabled={syncing}>{syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync now</Button>
            </div>
          )}
        </div>

        <SyncNote threecx={data?.threecx} />

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <StatsCard title="Calls" value={(stats.calls ?? 0).toLocaleString('en-US')} icon={PhoneCall} color="blue" delay={0.02} />
          <StatsCard title="Answered" value={(stats.answered ?? 0).toLocaleString('en-US')} icon={CheckCircle2} color="emerald" delay={0.05} />
          <StatsCard title="Missed" value={(stats.missed ?? 0).toLocaleString('en-US')} icon={PhoneMissed} color="red" trend="They called, nobody answered" delay={0.08} />
          <StatsCard title="No answer" value={(stats.no_answer ?? 0).toLocaleString('en-US')} icon={PhoneOff} color="amber" trend="We called, they didn't pick up" delay={0.11} />
          <StatsCard title="Talk time" value={fmtTalkTotal(stats.talk_seconds)} icon={Clock} color="cyan" delay={0.14} />
          <StatsCard title="Recorded" value={(stats.recorded ?? 0).toLocaleString('en-US')} icon={Mic} color="purple" delay={0.17} />
        </div>

        {named.length > 1 && (
          <Card className="overflow-hidden">
            <CardHeader className="border-b py-4">
              <CardTitle className="flex items-center gap-2 text-base text-brand-navy"><Users className="h-4 w-4" /> By person</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[360px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b bg-slate-50">
                      <TH>Person</TH><TH right>Calls</TH><TH right>Answered</TH><TH right>Missed</TH><TH right>No answer</TH><TH right>Talk time</TH><TH right>Average call</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map(p => (
                      <tr key={p.key}
                        title={person === p.key ? 'Show everyone' : `Show only ${p.name}'s calls`}
                        onClick={() => setPerson(person === p.key ? EVERYONE : p.key)}
                        className={`cursor-pointer border-b border-slate-100 hover:bg-cyan-50/40 ${person === p.key ? 'bg-cyan-50' : ''}`}>
                        <td className="px-3 py-2.5">
                          <div className={p.key === '-' ? 'text-slate-500' : 'font-medium text-slate-800'}>{p.name}</div>
                          {p.extension && !p.name.includes(p.extension) && <div className="text-xs text-slate-400">Ext {p.extension}{!p.user_id && ' · not linked to a portal user'}</div>}
                        </td>
                        <td className="tabular px-3 py-2.5 text-right font-medium text-slate-800">{p.calls}</td>
                        <td className="tabular px-3 py-2.5 text-right text-emerald-700">{p.answered || dash}</td>
                        <td className="tabular px-3 py-2.5 text-right text-rose-600">{p.missed || dash}</td>
                        <td className="tabular px-3 py-2.5 text-right text-amber-700">{p.no_answer || dash}</td>
                        <td className="tabular px-3 py-2.5 text-right text-slate-700">{p.talk_seconds ? fmtTalkTotal(p.talk_seconds) : dash}</td>
                        <td className="tabular px-3 py-2.5 text-right text-slate-500">{p.answered ? fmtDuration(p.talk_seconds / p.answered) : dash}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="overflow-hidden">
          <CardHeader className="space-y-3 border-b">
            <div className="flex items-center gap-3">
              <Tabs value={range} onValueChange={setRange}>
                <TabsList>{RANGES.map(([k, label]) => <TabsTrigger key={k} value={k}>{label}</TabsTrigger>)}</TabsList>
              </Tabs>
              {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={status} onValueChange={(v) => v && setStatus(v)}>
                <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All results</SelectItem>
                  {Object.entries(RESULTS).map(([k, r]) => <SelectItem key={k} value={k}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={direction} onValueChange={(v) => v && setDirection(v)}>
                <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">In and out</SelectItem>
                  <SelectItem value="in">Incoming</SelectItem>
                  <SelectItem value="out">Outgoing</SelectItem>
                </SelectContent>
              </Select>
              {named.length > 1 && (
                <div className="w-64">
                  <SearchableSelect value={person} onValueChange={(v) => v && setPerson(v)} options={personOptions}
                    noneLabel="Everyone" noneValue={EVERYONE} placeholder="Everyone" searchPlaceholder="Name or extension…" />
                </div>
              )}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Student, number, person…" className="h-9 w-64 pl-9" />
              </div>
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" /> CSV</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50/80">
                    <TH>When</TH><TH>Student</TH><TH>Call</TH><TH>Who</TH><TH right>Talk</TH><TH right>Ring</TH><TH>Recording</TH>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={7} className="py-12 text-center text-slate-400">Loading calls…</td></tr>
                  ) : error ? (
                    <tr><td colSpan={7} className="py-12 text-center text-rose-600">{error.message || 'Could not load the calls'}</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={7} className="py-12 text-center text-slate-400">{calls.length ? 'No calls match the search.' : 'No calls with students in this period.'}</td></tr>
                  ) : rows.slice(0, shown).map(c => (
                    <tr key={c.id}
                      className="cursor-pointer border-b border-slate-100 align-top hover:bg-cyan-50/40"
                      onClick={(e) => { if (!e.target.closest('button, a, audio')) navigate(`${createPageUrl('StudentDetail')}?id=${c.student_id}`); }}>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{fmtWhen(c.started_at)}</td>
                      <td className="px-3 py-2.5">
                        <Link to={`${createPageUrl('StudentDetail')}?id=${c.student_id}`} className="font-medium text-slate-900 hover:text-blue-600">{c.student_name || 'Student'}</Link>
                        <div className="whitespace-nowrap text-xs text-slate-400"><span className="font-mono">{c.student_code}</span>{c.student_code && c.number ? ' · ' : ''}{c.number}</div>
                      </td>
                      <td className="px-3 py-2.5"><CallResult call={c} /></td>
                      <td className="px-3 py-2.5"><CallPerson call={c} /></td>
                      <td className="tabular whitespace-nowrap px-3 py-2.5 text-right text-slate-700">{c.talk_seconds ? fmtDuration(c.talk_seconds) : dash}</td>
                      <td className="tabular whitespace-nowrap px-3 py-2.5 text-right text-slate-500">{c.ring_seconds ? fmtDuration(c.ring_seconds) : dash}</td>
                      <td className="px-3 py-2"><RecordingPlayer call={c} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(rows.length > shown || data?.truncated) && (
              <div className="flex flex-col items-center gap-1 border-t px-3 py-3 text-center">
                {rows.length > shown && <Button variant="ghost" size="sm" onClick={() => setShown(s => s + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</Button>}
                {data?.truncated && (
                  <p className="text-xs text-slate-400">
                    The newest {calls.length.toLocaleString('en-US')} of {data.total.toLocaleString('en-US')} calls are listed — the totals above count them all. Pick a shorter period or a filter to list the rest.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ThreecxTestDialog open={testing} onClose={() => setTesting(false)} />
    </div>
  );
}

/** Super Admin: the 3CX connection step by step, with a few rows as 3CX sends them and as they were read. */
function ThreecxTestDialog({ open, onClose }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const run = async () => {
    setBusy(true); setResult(null);
    try {
      setResult((await base44.functions.invoke('testThreecx', {})).data);
    } catch (e) {
      setResult({ ok: false, steps: [{ name: 'Test', ok: false, detail: e?.message || 'Could not run the test' }] });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { if (open) run(); }, [open]);
  const pre = 'max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-brand-navy">3CX connection</DialogTitle>
          <DialogDescription>
            Signs in with the API key on the server, reads 3CX's users (filling in extensions by email) and the last 24 hours of calls, and opens one recording. Nothing in 3CX is changed.
          </DialogDescription>
        </DialogHeader>
        {busy ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Talking to 3CX…</p>
        ) : result && (
          <div className="space-y-4">
            <ol className="space-y-2.5">
              {result.steps.map(s => (
                <li key={s.name} className="flex items-start gap-2.5">
                  {s.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-600" />}
                  <div>
                    <div className="text-sm font-medium text-slate-800">{s.name}</div>
                    <div className="break-words text-sm text-slate-600">{s.detail}</div>
                  </div>
                </li>
              ))}
            </ol>
            {result.parsed?.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium text-slate-700">Calls with students, as read ({result.parsed.length})</summary>
                <pre className={`mt-2 ${pre}`}>{JSON.stringify(result.parsed, null, 2)}</pre>
              </details>
            )}
            {result.sample?.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium text-slate-700">Rows as 3CX sends them ({result.sample.length})</summary>
                <pre className={`mt-2 ${pre}`}>{JSON.stringify(result.sample, null, 2)}</pre>
              </details>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={run} disabled={busy}><RefreshCw className="h-4 w-4" /> Run again</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
