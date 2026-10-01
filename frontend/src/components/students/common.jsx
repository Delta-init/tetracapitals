import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Users } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   Common: a student on two CSs' own sheets stays with the first (their CS)
   and is also with the other — both see and work on them. Set by the CS-sheet
   import as students.common_cs: [{ id, name, team_name, at, sheet_row }].
   The tag says so; clicking it shows where they are.
──────────────────────────────────────────────────────────────────────────── */

/** The other CSs they are Common with (never their own CS twice). */
export const commonOf = (s) =>
  (Array.isArray(s?.common_cs) ? s.common_cs : []).filter(c => c?.id && c.id !== s.primary_mentor_id);
/** Is this `userId`'s student — their CS, or a CS they are Common with? */
export const isStudentOf = (s, userId) => !!userId && (s?.primary_mentor_id === userId || commonOf(s).some(c => c.id === userId));

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const stop = (e) => e.stopPropagation();   // the tag sits in clickable table rows

export function CommonBadge({ student, className = '' }) {
  const others = commonOf(student);
  if (!others.length) return null;
  const onSheet = (row, at) => [row ? `their sheet, row ${row}` : 'their sheet', day(at)].filter(Boolean).join(' · ');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={stop}
          title="With more than one CS — click to see where"
          className={`inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 ${className}`}
        >
          <Users className="h-3 w-3" />Common
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3" onClick={stop}>
        <p className="text-sm font-semibold text-slate-800">Common — with {others.length + 1} CSs</p>
        <p className="mb-2 text-xs text-slate-500">On each of their own sheets. All of them see and work on this student; the first is their CS.</p>
        <ul className="space-y-2 text-sm">
          <li className="rounded-md bg-slate-50 px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-800">{student.primary_mentor_name || 'No CS'}</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">CS</span>
            </div>
            <div className="text-xs text-slate-500">
              {student.team_name || 'No team'}{student.cs_sheet ? ` · ${onSheet(student.sheet_row, student.cs_sheet.at)}` : ''}
            </div>
          </li>
          {others.map(c => (
            <li key={c.id} className="rounded-md bg-amber-50/60 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-800">{c.name || 'A CS'}</span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-amber-700">Common</span>
              </div>
              <div className="text-xs text-slate-500">{c.team_name || 'No team'} · {onSheet(c.sheet_row, c.at)}</div>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
