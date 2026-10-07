import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Loader2, X } from 'lucide-react';
import SearchableSelect from '@/components/common/SearchableSelect';
import { isAdminRole } from '@/components/utils/roles';
import { CommonBadge, isStudentOf } from '@/components/students/common';

/* ────────────────────────────────────────────────────────────────────────────
   Student tags (backend/src/students/tags.ts): Old, Closed and Common follow
   the student by themselves; "Closed - <course>" and an admin's own tags are
   put on by the student's CS, the people above them and admins. Putting a
   "Closed - <course>" on marks the student enrolled.
──────────────────────────────────────────────────────────────────────────── */

const CLOSED_PREFIX = 'Closed - ';

/** The tag list (name, color, kind, active) — made complete by the server each time it is read. */
export function useStudentTagCatalog() {
  return useQuery({
    queryKey: ['student-tags'],
    queryFn: async () => (await base44.functions.invoke('getStudentTags', {})).data?.tags || [],
    staleTime: 5 * 60_000,
  });
}

/** The tags a student shows — as tagNamesOf() in backend/src/students/tags.ts. */
export function tagNamesOf(s) {
  const own = (Array.isArray(s?.tags) ? s.tags : []).filter(t => typeof t === 'string' && t);
  const auto = [];
  if (s?.enrolment_status === 'old') auto.push('Old');
  if (s?.enrolment_status === 'closed' && !own.some(t => t.startsWith(CLOSED_PREFIX))) auto.push('Closed');
  if ((Array.isArray(s?.common_cs) ? s.common_cs : []).some(c => c?.id && c.id !== s.primary_mentor_id)) auto.push('Common');
  return [...auto, ...own];
}

const colorOf = (catalog, name) => catalog.find(t => t.name === name)?.color || '#64748b';

export function TagChip({ name, color, onRemove, busy }) {
  return (
    // Never wider than where it sits (a phone's student page): a long name ends in "…", whole on hover.
    <Badge variant="outline" className="max-w-full gap-1 whitespace-nowrap text-xs font-medium" title={name}
      style={{ backgroundColor: `${color}1a`, color, borderColor: `${color}55` }}>
      <span className="min-w-0 truncate">{name}</span>
      {onRemove && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} disabled={busy}
          className="-mr-1 shrink-0 rounded-full p-0.5 hover:bg-black/10" aria-label={`Remove tag ${name}`}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </button>
      )}
    </Badge>
  );
}

/** A student's tags in a table cell; Common opens who else has them. */
export function StudentTagChips({ student, catalog = [] }) {
  const names = tagNamesOf(student);
  if (!names.length) return <span className="text-slate-300">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {names.map(n => (n === 'Common'
        ? <CommonBadge key={n} student={student} />
        : <TagChip key={n} name={n} color={colorOf(catalog, n)} />))}
    </div>
  );
}

/** Shown to whoever the server would let change it (as Enrolment); anyone else just sees the tags. */
const mayChange = (user, student) =>
  !!user && (isAdminRole(user.app_role) || isStudentOf(student, user.id) || ['chief_mentor', 'cs_manager'].includes(user.app_role));

/** The student page's Tags: their tags, × on the ones put on by hand, and a picker to add one. */
export function StudentTagsEditor({ student, currentUser }) {
  const queryClient = useQueryClient();
  const { data: catalog = [] } = useStudentTagCatalog();
  const [busy, setBusy] = useState(null);
  const names = tagNamesOf(student);
  const own = new Set(Array.isArray(student?.tags) ? student.tags : []);
  const canChange = mayChange(currentUser, student);
  // Courses come through finance: a CS sees course tags but neither adds nor removes one (the server says the same).
  const courseLocked = currentUser?.app_role === 'cs';

  const change = async (tag, on) => {
    setBusy(tag);
    try {
      const res = await base44.functions.invoke('setStudentTag', { studentId: student.id, tag, on });
      toast.success(on ? `Tagged ${tag}${res.data?.enrolment_status === 'closed' && tag.startsWith(CLOSED_PREFIX) ? ' — enrolled' : ''}` : `Removed ${tag}`);
      queryClient.invalidateQueries({ queryKey: ['student', student.id] });
      queryClient.invalidateQueries({ queryKey: ['student-history', student.id] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
    } catch (e) {
      toast.error(e?.message || 'Could not change the tag');
    } finally {
      setBusy(null);
    }
  };

  const addable = catalog
    .filter(t => t.kind !== 'auto' && t.active !== false && !own.has(t.name) && !(courseLocked && t.kind === 'closed'))
    .map(t => ({ value: t.name, label: t.name }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-slate-500">Tags</span>
      {names.length === 0 && <span className="text-sm text-slate-400">None</span>}
      {names.map(n => (n === 'Common'
        ? <CommonBadge key={n} student={student} />
        : <TagChip key={n} name={n} color={colorOf(catalog, n)} busy={busy === n}
            onRemove={canChange && own.has(n) && !(courseLocked && n.startsWith(CLOSED_PREFIX)) ? () => change(n, false) : undefined} />))}
      {canChange && addable.length > 0 && (
        <div className="w-56">
          <SearchableSelect value="" onValueChange={(v) => v && v !== '__none__' && change(v, true)} options={addable}
            placeholder={busy ? 'Saving…' : 'Add a tag…'} searchPlaceholder="Search tags…" disabled={!!busy} />
        </div>
      )}
    </div>
  );
}
