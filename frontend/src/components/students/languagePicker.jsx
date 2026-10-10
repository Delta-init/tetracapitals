import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ChevronDown, Loader2 } from 'lucide-react';
import { LANGUAGES } from '@/components/students/languages';
import { mayEditDetails } from '@/components/students/EditDetails';

/* ────────────────────────────────────────────────────────────────────────────
   The language a student studies in, changed straight from the Students table
   and the student page (the user, 2026-10-10) — the sales CRMs' four, or none;
   finance sets it at a close. Saved as one of their details
   (updateStudentDetails), so by the same people and in the history the same
   way; anyone else sees it.
──────────────────────────────────────────────────────────────────────────── */

const stop = (e) => e.stopPropagation();   // also in clickable table rows

export function LanguagePicker({ student, currentUser }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const lang = student?.language || '';
  const can = mayEditDetails(currentUser, student);
  const badge = (
    <Badge variant="outline" className={`gap-1 whitespace-nowrap ${lang ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-400'}`}>
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}{lang || 'Not set'}
      {can && <ChevronDown className="h-3 w-3 opacity-60" />}
    </Badge>
  );
  if (!can) return badge;
  const setTo = async (to) => {
    if (to === lang) return;
    setBusy(true);
    try {
      await base44.functions.invoke('updateStudentDetails', { studentId: student.id, language: to });
      queryClient.setQueriesData({ queryKey: ['students', 'page'] }, (d) => (d?.rows ? { ...d, rows: d.rows.map(s => (s.id === student.id ? { ...s, language: to } : s)) } : d));
      queryClient.invalidateQueries({ queryKey: ['students'] });
      queryClient.invalidateQueries({ queryKey: ['student', student.id] });
      queryClient.invalidateQueries({ queryKey: ['student-history', student.id] });
      toast.success(to ? `Language: ${to}` : 'Language cleared');
    } catch (err) {
      toast.error(err?.message || "The language couldn't be changed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={stop}>
        <button type="button" className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" title="Language" disabled={busy}>{badge}</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={stop}>
        {LANGUAGES.map(l => (
          <DropdownMenuItem key={l} onSelect={() => setTo(l)} className={l === lang ? 'font-semibold' : ''}>{l}</DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setTo('')} className={!lang ? 'font-semibold' : 'text-slate-500'}>Not set</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
