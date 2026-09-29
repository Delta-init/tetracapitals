import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PhoneCall, Plus } from 'lucide-react';
import { StatusBadge, StageBadge, CallLink, LogFollowupDialog, NewFollowupDialog, fmtDate, money } from './followupUi';

/** A student's follow-ups on their page: each open / closed outcome, the full log, click-to-call. */
export default function StudentFollowupsSection({ student }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['followups', 'student', student?.id],
    queryFn: async () => (await base44.functions.invoke('getFollowups', { studentId: student.id })).data,
    enabled: !!student?.id,
  });
  const [logging, setLogging] = useState(null);
  const [creating, setCreating] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['followups'] });

  const followups = data?.followups || [];
  const events = data?.events || [];
  const outcomeOf = Object.fromEntries(followups.map(f => [f.id, f.target_outcome]));

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base text-brand-navy"><PhoneCall className="h-4 w-4" /> Follow-ups</CardTitle>
            <div className="mt-1 text-sm"><CallLink phone={student?.phone} /></div>
          </div>
          {data?.can_create && <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New follow-up</Button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-0">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : followups.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No follow-ups for this student yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50/80">
                  {['Target Outcome', 'Stage', 'Last Contact', 'Next Follow-up', 'Status', 'Count', 'What Client Said', 'Reason', 'Converted', 'Deal Value', ''].map((h, i) => (
                    <th key={i} className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {followups.map(f => (
                  <tr key={f.id} className="border-b border-slate-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-800">{f.target_outcome}</td>
                    <td className="px-3 py-2.5"><StageBadge stage={f.stage} /></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{fmtDate(f.last_contact_date)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{fmtDate(f.next_followup_date)}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={f.followup_status} /></td>
                    <td className="tabular px-3 py-2.5 text-slate-700">{f.followup_count}</td>
                    <td className="max-w-[240px] px-3 py-2.5 text-slate-600">{f.client_said || '—'}</td>
                    <td className="max-w-[180px] px-3 py-2.5 text-slate-600">{f.objection_reason || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{f.converted_date ? fmtDate(f.converted_date) : '—'}{f.auto_converted && <div className="text-[11px] text-emerald-600">automatic</div>}</td>
                    <td className="tabular whitespace-nowrap px-3 py-2.5 font-medium">{money(f.deal_value)}</td>
                    <td className="px-3 py-2.5 text-right">{f.can_edit && <Button size="sm" variant="outline" onClick={() => setLogging({ ...f, phone: student?.phone })}>Log</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {events.length > 0 && (
          <div className="px-5 pb-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Follow-up log</p>
            <ol className="relative ml-2 space-y-3 border-l border-slate-200 pl-5">
              {events.map((e, i) => (
                <li key={e._id || i} className="relative">
                  <span className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${e.kind === 'auto_converted' ? 'bg-emerald-400' : i === 0 ? 'bg-brand-cyan' : 'bg-slate-300'}`} />
                  <p className="text-sm text-slate-800"><span className="font-medium">{outcomeOf[e.followup_id] || ''}</span>{outcomeOf[e.followup_id] ? ' · ' : ''}{e.text}</p>
                  {e.client_said && e.kind === 'logged' && <p className="text-sm text-slate-500">“{e.client_said}”</p>}
                  <p className="text-xs text-slate-400">{new Date(e.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {e.by_name}</p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </CardContent>
      <LogFollowupDialog followup={logging} onClose={() => setLogging(null)} onSaved={refresh} />
      <NewFollowupDialog open={creating} onClose={() => setCreating(false)} onSaved={refresh} student={student ? { id: student.id, full_name: student.full_name } : null} />
    </Card>
  );
}
