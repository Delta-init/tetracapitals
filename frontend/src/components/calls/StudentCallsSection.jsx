import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PhoneIncoming } from 'lucide-react';
import { CallPerson, CallResult, RecordingPlayer, SyncNote, fmtDuration, fmtTalkTotal, fmtWhen } from './callUi';

const FIRST = 8;

/** A student's calls through 3CX on their page: when, in or out, answered or missed, who, how long, the recording. */
export default function StudentCallsSection({ student }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['calls', 'student', student?.id],
    queryFn: async () => (await base44.functions.invoke('getCalls', { studentId: student.id })).data,
    enabled: !!student?.id,
    refetchInterval: 60_000,
  });
  const [all, setAll] = useState(false);
  const calls = data?.calls || [];
  const stats = data?.stats;
  const list = all ? calls : calls.slice(0, FIRST);

  const summary = stats?.calls
    ? [
      `${stats.calls} call${stats.calls === 1 ? '' : 's'}`,
      stats.answered && `${stats.answered} answered`,
      stats.missed && `${stats.missed} missed`,
      stats.no_answer && `${stats.no_answer} not answered by them`,
      stats.talk_seconds && `${fmtTalkTotal(stats.talk_seconds)} talking`,
    ].filter(Boolean).join(' · ')
    : null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base text-brand-navy"><PhoneIncoming className="h-4 w-4" /> Calls</CardTitle>
            <div className="mt-1 text-sm text-slate-500">{summary || 'Calls with this student through 3CX'}</div>
          </div>
          <SyncNote threecx={data?.threecx} />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-rose-600">{error.message || 'Could not load the calls'}</p>
        ) : calls.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No calls with this student yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50/80">
                  {['When', 'Call', 'Who', 'Talk', 'Ring', 'Recording'].map(h => (
                    <th key={h} className={`whitespace-nowrap px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 ${h === 'Talk' || h === 'Ring' ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map(c => (
                  <tr key={c.id} className="border-b border-slate-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{fmtWhen(c.started_at)}</td>
                    <td className="px-3 py-2.5"><CallResult call={c} /></td>
                    <td className="px-3 py-2.5"><CallPerson call={c} /></td>
                    <td className="tabular whitespace-nowrap px-3 py-2.5 text-right text-slate-700">{c.talk_seconds ? fmtDuration(c.talk_seconds) : <span className="text-slate-300">—</span>}</td>
                    <td className="tabular whitespace-nowrap px-3 py-2.5 text-right text-slate-500">{c.ring_seconds ? fmtDuration(c.ring_seconds) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2"><RecordingPlayer call={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {calls.length > FIRST && (
              <div className="border-t px-3 py-2 text-center">
                <Button variant="ghost" size="sm" onClick={() => setAll(a => !a)}>{all ? 'Show fewer' : `Show all ${calls.length} calls`}</Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
