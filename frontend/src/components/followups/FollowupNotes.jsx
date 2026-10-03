import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, MessageSquareQuote, StickyNote } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   Everything the client said, and every note, on a student's follow-ups — as
   the Sales CRM keeps notes: each entry as it was written, newest first, with
   who and when, never overwritten (backend/src/functions/studentFollowups.ts,
   historyOf). A note can be written here any time, between calls.
──────────────────────────────────────────────────────────────────────────── */

const SHOWN = 5;
export const whenWritten = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/** One entry: the words, then who, when, and the follow-up it was on. */
export function HistoryEntry({ e, quote = false, showFollowup = true }) {
  const where = showFollowup && e.outcome ? `${e.outcome}${e.stage ? ` (${e.stage})` : ''}` : e.stage || '';
  return (
    <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="whitespace-pre-wrap text-sm text-slate-800">{quote ? `“${e.text}”` : e.text}</p>
      <p className="mt-1 text-xs text-slate-400">
        {[e.by_name, whenWritten(e.at), where].filter(Boolean).join(' · ')}
        {e.earlier && <span className="italic"> · written before every entry was kept</span>}
      </p>
    </li>
  );
}

function List({ icon: Icon, title, entries, quote, empty, children }) {
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, SHOWN);
  return (
    <div className="min-w-0 space-y-2">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Icon className="h-4 w-4 text-slate-400" /> {title}
        {entries.length > 0 && <span className="rounded-full bg-brand-cyan/15 px-2 py-0.5 text-xs font-medium text-brand-navy">{entries.length}</span>}
      </p>
      {children}
      {entries.length === 0
        ? <p className="py-3 text-sm text-slate-400">{empty}</p>
        : (
          <ul className="space-y-2">
            {shown.map((e, i) => <HistoryEntry key={`${e.at}-${i}`} e={e} quote={quote} />)}
          </ul>
        )}
      {entries.length > SHOWN && (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAll(a => !a)}>
          {all ? 'Show fewer' : `Show all ${entries.length}`}
        </Button>
      )}
    </div>
  );
}

export default function FollowupNotes({ studentId, history, canWrite }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const add = useMutation({
    mutationFn: async () => (await base44.functions.invoke('addFollowupNote', { studentId, notes: note.trim() })).data,
    onSuccess: () => { setNote(''); toast.success('Note added'); qc.invalidateQueries({ queryKey: ['followups'] }); },
    onError: (e) => toast.error(e?.message || 'The note was not added'),
  });
  const said = history?.client_said || [];
  const notes = history?.notes || [];
  return (
    <div className="grid gap-5 px-5 lg:grid-cols-2">
      <List icon={MessageSquareQuote} title="What the client said" entries={said} quote
        empty="Nothing yet — it's kept each time a follow-up is opened or logged." />
      <List icon={StickyNote} title="Notes" entries={notes} empty="No notes yet.">
        {canWrite && (
          <div className="space-y-2">
            <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={2000} placeholder="Write a note…" className="bg-white text-sm" />
            <div className="flex justify-end">
              <Button size="sm" disabled={!note.trim() || add.isPending} onClick={() => add.mutate()}>
                {add.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add note
              </Button>
            </div>
          </div>
        )}
      </List>
    </div>
  );
}
