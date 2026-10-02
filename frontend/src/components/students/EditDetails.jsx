import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Pencil } from 'lucide-react';
import { isAdminRole } from '@/components/utils/roles';
import { isStudentOf } from '@/components/students/common';
import { LANGUAGES, NO_LANGUAGE } from '@/components/students/languages';

/* ────────────────────────────────────────────────────────────────────────────
   A student's own details — name, email, phone, country and the language they
   study in — changed from the Students list or the student page by the people
   who look after them: their CS (or a CS they are Common with), the people
   above them and admins (the server checks, functions/studentDetails.ts).
   Each change is in the student's history. The full Edit Student form stays
   for admins.
──────────────────────────────────────────────────────────────────────────── */

/** Who the server lets change a student's details — anyone else gets no button. */
export const mayEditDetails = (user, student) =>
  !!user && (isAdminRole(user.app_role) || isStudentOf(student, user.id) || ['chief_mentor', 'cs_manager'].includes(user.app_role));

const FIELDS = [
  { key: 'full_name', label: 'Name', type: 'text' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'country', label: 'Country', type: 'text' },
  { key: 'language', label: 'Language', type: 'language' },
];
const stop = (e) => e.stopPropagation();   // the button sits in clickable table rows

/** A pencil (or a labelled button) that opens the details form. */
export function EditDetailsButton({ student, currentUser, label }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  if (!mayEditDetails(currentUser, student)) return null;

  const start = (e) => {
    stop(e);
    setForm(Object.fromEntries(FIELDS.map(f => [f.key, student?.[f.key] ?? ''])));
    setOpen(true);
  };
  const save = async () => {
    setSaving(true);
    try {
      const res = (await base44.functions.invoke('updateStudentDetails', { studentId: student.id, ...form })).data;
      toast.success(res?.unchanged ? 'Nothing changed' : `${form.full_name || 'Student'} saved`);
      queryClient.invalidateQueries({ queryKey: ['students'] });
      queryClient.invalidateQueries({ queryKey: ['student', student.id] });
      queryClient.invalidateQueries({ queryKey: ['student-history', student.id] });
      setOpen(false);
    } catch (e) {
      toast.error(e?.message || 'Could not save the details');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {label ? (
        <Button variant="outline" className="h-9" onClick={start}>
          <Pencil className="mr-2 h-4 w-4" />{label}
        </Button>
      ) : (
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Edit details" aria-label={`Edit ${student.full_name || 'student'}`} onClick={start}>
          <Pencil className="h-4 w-4" />
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="max-w-md" onClick={stop}>
          <DialogHeader>
            <DialogTitle>Edit {student.student_code}</DialogTitle>
            <DialogDescription>Name, email, phone, country and language. The change goes in the student's history.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {FIELDS.map(f => (
              <div key={f.key}>
                <Label htmlFor={`edit-${f.key}`}>{f.label}</Label>
                {f.type === 'language' ? (
                  <Select value={form.language || NO_LANGUAGE} onValueChange={(v) => setForm(x => ({ ...x, language: v === NO_LANGUAGE ? '' : v }))}>
                    <SelectTrigger id={`edit-${f.key}`} className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_LANGUAGE}>Not set</SelectItem>
                      {LANGUAGES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id={`edit-${f.key}`}
                    type={f.type}
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm(v => ({ ...v, [f.key]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
                    className="mt-1"
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !String(form.full_name ?? '').trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
