import { useQueries } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, PhoneIncoming } from 'lucide-react';
import { CallsTable } from './StudentCallsSection';
import { SyncNote, fmtTalkTotal } from './callUi';

/**
 * The 3CX calls of a chat's students in a popup — the WhatsApp chat header's Calls button (the user, 2026-10-27):
 * every call, newest first, with who took it and the recording. Calls are kept only for numbers on a student,
 * so a chat linked to nobody has none to show.
 *
 * Props: open, onOpenChange, students [{ id, code, name }], title
 */
export default function CallsDialog({ open, onOpenChange, students = [], title }) {
  const results = useQueries({
    queries: students.map(s => ({
      queryKey: ['calls', 'student', s.id],
      queryFn: async () => (await base44.functions.invoke('getCalls', { studentId: s.id })).data,
      enabled: open,
      refetchInterval: open ? 60_000 : false,
    })),
  });
  const loading = results.some(r => r.isLoading);
  const failed = results.find(r => r.error)?.error;
  const calls = results.flatMap(r => r.data?.calls || []).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
  const sum = (k) => results.reduce((t, r) => t + (r.data?.stats?.[k] ?? 0), 0);
  const summary = calls.length
    ? [`${sum('calls')} call${sum('calls') === 1 ? '' : 's'}`, sum('answered') && `${sum('answered')} answered`, sum('missed') && `${sum('missed')} missed`,
      sum('no_answer') && `${sum('no_answer')} not answered by them`, sum('talk_seconds') && `${fmtTalkTotal(sum('talk_seconds'))} talking`].filter(Boolean).join(' · ')
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PhoneIncoming className="h-4 w-4" /> Calls{title ? ` — ${title}` : ''}</DialogTitle>
          <DialogDescription>
            {students.length ? (summary || `3CX calls with ${students.map(s => s.code || s.name).join(', ')}`) : 'This chat is on no student yet.'}
          </DialogDescription>
        </DialogHeader>
        <SyncNote threecx={results.find(r => r.data)?.data?.threecx} />
        {!students.length ? (
          <p className="py-8 text-center text-sm text-slate-500">3CX calls are kept for students' numbers — link this chat to a student (Link to a student) to see their calls here.</p>
        ) : loading ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : failed ? (
          <p className="py-8 text-center text-sm text-rose-600">{failed.message || 'Could not load the calls'}</p>
        ) : !calls.length ? (
          <p className="py-8 text-center text-sm text-slate-400">No calls with {students.length === 1 ? 'this student' : 'these students'} yet.</p>
        ) : (
          <div className="max-h-[65vh] overflow-auto rounded-md border">
            <CallsTable calls={calls} withStudent={students.length > 1} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
