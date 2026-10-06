import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KeyRound, Loader2, Lock, LockOpen, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ACCESS } from '@/components/students/LmsCourseList';

/* ────────────────────────────────────────────────────────────────────────────
   Course access (the user, 2026-10-06): the LMS admin's Edit Student → Course
   Access, here — put a student on a Forex course with the modules you pick
   locked, and open or lock a course's modules one by one. The Forex courses of
   their academy only, and never taken off them here: lock every module
   instead. A locked module can't be opened by the student — its lessons, and
   booking or joining its classes; opening one the fee keeps locked gives it
   without payment. Done in the LMS from your own LMS account, else Delta's
   support account with your name, and noted in the student's History
   (backend/src/functions/lmsCourseAccess.ts). A CS their own students, the
   Super Admin anyone's — as LMS Requests.
──────────────────────────────────────────────────────────────────────────── */

const call = async (name, body) => (await base44.functions.invoke(name, body)).data;
const HOW = { purchase: 'Bought', finance: 'Finance invoice', admin: 'By admin', script: 'By script', free: 'Free' };
const lockedOf = (modules) => new Set(modules.filter((m) => m.locked).map((m) => m.id));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** What `courses` a request takes, from the courses picked: [{ courseId, locked }]. */
export const picksToCourses = (picks) => [...picks].map(([courseId, locked]) => ({ courseId, locked: [...locked] }));

/** A course's modules in the order the student sees them, each open or locked at a click — with Open all / Lock all. */
export function ModuleSwitches({ modules, locked, onChange, disabled }) {
  if (!modules.length) return <p className="text-xs text-slate-400">No modules in this course yet.</p>;
  const toggle = (id) => {
    const next = new Set(locked);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{modules.length - locked.size} of {modules.length} modules open</span>
        <span className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={disabled || locked.size === 0} onClick={() => onChange(new Set())}>
            Open all
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={disabled || locked.size === modules.length}
            onClick={() => onChange(new Set(modules.map((m) => m.id)))}>
            Lock all
          </Button>
        </span>
      </div>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {modules.map((m, i) => {
          const isLocked = locked.has(m.id);
          return (
            <li key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="w-5 shrink-0 text-xs tabular-nums text-slate-400">{i + 1}</span>
              <span className={cn('min-w-0 flex-1 truncate', isLocked ? 'text-slate-400' : 'text-slate-800')} title={m.title}>{m.title}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggle(m.id)}
                aria-pressed={isLocked}
                title={isLocked ? 'Locked — click to open it' : 'Open — click to lock it'}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50',
                  isLocked ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                )}
              >
                {isLocked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
                {isLocked ? 'Locked' : 'Open'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The Forex courses to give, each ticked one with its modules to open or lock. `picks`: Map of courseId → Set of locked module ids. */
export function CoursesToGive({ offered, picks, onChange, disabled }) {
  if (!offered.length) return <p className="text-xs text-slate-400">No Forex course of their academy to give — they're on every one already, or there are none.</p>;
  const set = (courseId, locked) => {
    const next = new Map(picks);
    if (locked) next.set(courseId, locked); else next.delete(courseId);
    onChange(next);
  };
  return (
    <ul className="space-y-2">
      {offered.map((c) => {
        const on = picks.has(c.courseId);
        return (
          <li key={c.courseId} className={cn('rounded-lg border p-2.5', on ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200')}>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800">
              <Checkbox checked={on} disabled={disabled} onCheckedChange={(v) => set(c.courseId, v ? new Set() : null)} />
              <span className="min-w-0 flex-1">{c.title}</span>
              <span className="shrink-0 text-xs font-normal text-slate-400">{c.modules.length} modules</span>
            </label>
            {on && (
              <div className="mt-2 sm:pl-6">
                <ModuleSwitches modules={c.modules} locked={picks.get(c.courseId)} onChange={(l) => set(c.courseId, l)} disabled={disabled} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The window: their Forex courses with every module open or locked, and a Forex course of their academy to add. */
export function CourseAccessDialog({ studentId, email, name, onClose }) {
  const queryClient = useQueryClient();
  const who = studentId ? { studentId } : { email };
  const key = ['lms-course-access', studentId || email];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => call('getLmsCourseAccess', who), staleTime: 0 });
  const [saving, setSaving] = useState('');        // the enrolment being saved, or 'give'
  const [drafts, setDrafts] = useState({});        // enrolmentId → Set of locked module ids, while changed here
  const [adding, setAdding] = useState('');        // the course picked to add
  const [addLocked, setAddLocked] = useState(() => new Set());

  const courses = data?.courses ?? [];
  const offered = data?.offered ?? [];
  const dirty = courses.filter((c) => drafts[c.enrolmentId] && !sameSet(drafts[c.enrolmentId], lockedOf(c.modules)));

  const apply = (answer) => {
    queryClient.setQueryData(key, (prev) => ({ ...(prev || {}), configured: true, student: answer.student, courses: answer.courses, offered: answer.offered }));
    queryClient.invalidateQueries({ queryKey: ['student-lms-courses'] });
    queryClient.invalidateQueries({ queryKey: ['student-history'] });
  };
  const close = () => {
    if (saving) return;
    if (dirty.length && !window.confirm(`Leave without saving the modules of ${dirty.map((c) => c.title).join(', ')}?`)) return;
    onClose();
  };

  const save = async (course) => {
    const locked = drafts[course.enrolmentId];
    if (!locked) return;
    setSaving(course.enrolmentId);
    try {
      const out = await call('setLmsModuleAccess', { ...who, enrolmentId: course.enrolmentId, locked: [...locked] });
      apply(out);
      setDrafts(({ [course.enrolmentId]: _done, ...rest }) => rest);
      const what = [out.opened?.length ? `${out.opened.length} opened` : '', out.locked?.length ? `${out.locked.length} locked` : ''].filter(Boolean).join(', ');
      toast.success(out.changed ? `${out.course}: ${what}` : `${out.course}: nothing to change`);
    } catch (e) {
      toast.error(e?.message || 'The LMS could not take that');
    } finally {
      setSaving('');
    }
  };

  const give = async () => {
    if (!adding) return;
    setSaving('give');
    try {
      const out = await call('giveLmsCourses', { ...who, courses: [{ courseId: adding, locked: [...addLocked] }] });
      apply(out);
      setAdding('');
      setAddLocked(new Set());
      toast.success(out.given?.length ? `${out.given.join(', ')} given${name ? ` to ${name}` : ''}` : `${out.already?.join(', ')} was theirs already`);
    } catch (e) {
      toast.error(e?.message || 'The LMS could not take that');
    } finally {
      setSaving('');
    }
  };

  const picked = offered.find((c) => c.courseId === adding);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-indigo-600" />Course access{name ? ` — ${name}` : ''}</DialogTitle>
          <DialogDescription>
            Their Forex courses in the Delta LMS. A locked module can't be opened — its lessons, and booking or joining its classes. Saved in
            the LMS from your LMS account, or Delta's support account with your name.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
        ) : error ? (
          <p className="text-sm text-rose-600">{error.message || "Their courses couldn't be loaded"}</p>
        ) : !data?.configured ? (
          <p className="text-sm text-slate-500">The LMS isn't linked to this server.</p>
        ) : (
          <div className="space-y-4">
            {!data.student?.approved && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Not let in yet — they can open these courses once their LMS request is approved.
              </p>
            )}
            {courses.length === 0 ? (
              <p className="text-sm text-slate-500">On no Forex course yet.</p>
            ) : courses.map((course) => {
              const original = lockedOf(course.modules);
              const current = drafts[course.enrolmentId] ?? original;
              const changed = !sameSet(current, original);
              return (
                <section key={course.enrolmentId} className="rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">{course.title}</p>
                      <p className="text-xs text-slate-500">
                        {[HOW[course.how], ACCESS[course.access], `${course.progress || 0}% done`, course.status !== 'active' ? course.status : ''].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <span className="flex gap-1.5">
                      {changed && (
                        <Button type="button" size="sm" variant="ghost" disabled={!!saving}
                          onClick={() => setDrafts(({ [course.enrolmentId]: _undo, ...rest }) => rest)}>
                          Undo
                        </Button>
                      )}
                      <Button type="button" size="sm" disabled={!changed || !!saving} onClick={() => save(course)}>
                        {saving === course.enrolmentId && <Loader2 className="animate-spin" />}
                        Save
                      </Button>
                    </span>
                  </div>
                  {(course.access === 'partial' || course.access === 'unpaid') && (
                    <p className="mb-2 text-xs text-amber-700">{ACCESS[course.access]} — opening a module the fee keeps locked gives it without payment.</p>
                  )}
                  <ModuleSwitches modules={course.modules} locked={current} disabled={!!saving}
                    onChange={(l) => setDrafts((d) => ({ ...d, [course.enrolmentId]: l }))} />
                </section>
              );
            })}
            <section className="rounded-xl border border-dashed border-slate-300 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Plus className="h-4 w-4" />Add a course</p>
              {offered.length === 0 ? (
                <p className="text-xs text-slate-400">{courses.length ? 'They are on every Forex course of their academy.' : 'No Forex courses in their academy.'}</p>
              ) : (
                <div className="space-y-2">
                  <Select value={adding} onValueChange={(v) => { setAdding(v); setAddLocked(new Set()); }} disabled={!!saving}>
                    <SelectTrigger><SelectValue placeholder="Pick a Forex course…" /></SelectTrigger>
                    <SelectContent>
                      {offered.map((c) => <SelectItem key={c.courseId} value={c.courseId}>{c.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {picked && (
                    <>
                      <ModuleSwitches modules={picked.modules} locked={addLocked} onChange={setAddLocked} disabled={!!saving} />
                      <div className="flex justify-end">
                        <Button type="button" onClick={give} disabled={!!saving} className="bg-indigo-600 hover:bg-indigo-700">
                          {saving === 'give' && <Loader2 className="animate-spin" />}
                          Give {picked.title}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Opens the window — by their record here (studentId), or by the LMS address for a request from someone who isn't here. */
export function CourseAccessButton({ studentId, email, name, label = 'Course access', className, size, variant = 'outline' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)}
        title="Their Forex courses in the LMS — give one, open or lock its modules">
        <KeyRound />
        {label}
      </Button>
      {open && <CourseAccessDialog studentId={studentId} email={email} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}
