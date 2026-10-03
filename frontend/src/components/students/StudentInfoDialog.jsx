import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Mail, MessageCircle } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { CallButton } from '@/components/followups/CallFlow';

/* ────────────────────────────────────────────────────────────────────────────
   A student at a glance, from a list that isn't their page (Support Tickets):
   who they are, every number to reach them on — each number in the portal's
   phone field, and what they gave the LMS when they registered — whose student
   they are, and the way to their page. `student` is the card the Support
   tickets list sends (backend/src/functions/lmsSupport.ts, studentCard).
──────────────────────────────────────────────────────────────────────────── */

const ENROLMENT = {
  open: { label: 'Open', cls: 'border-sky-200 bg-sky-50 text-sky-700' },
  closed: { label: 'Closed', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  old: { label: 'Old', cls: 'border-slate-200 bg-slate-100 text-slate-600' },
};
const whatsapp = (number) => `https://wa.me/${String(number || '').replace(/\D/g, '')}`;

/** One number, with the portal's Call (3CX or phone) and WhatsApp. */
function NumberRow({ label, number, student }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs text-slate-400">{label}</p>
        <p className="break-all font-medium text-slate-800">{number}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <CallButton student={{ id: student.id, full_name: student.name, phone: number }} />
        <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
          <a href={whatsapp(number)} target="_blank" rel="noreferrer"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</a>
        </Button>
      </div>
    </div>
  );
}

const Field = ({ label, children }) => (
  <div className="min-w-0">
    <p className="text-xs text-slate-400">{label}</p>
    <div className="break-words text-sm text-slate-800">{children || '—'}</div>
  </div>
);

export default function StudentInfoDialog({ student, onClose }) {
  const enrolment = ENROLMENT[student?.enrolment] || ENROLMENT.open;
  const lms = student?.lms;
  // The LMS number too, unless it is one the portal already has.
  const known = new Set((student?.phones || []).map((p) => p.replace(/\D/g, '').slice(-9)));
  const lmsPhone = lms?.phone && !known.has(lms.phone.replace(/\D/g, '').slice(-9)) ? lms.phone : '';
  return (
    <Dialog open={Boolean(student)} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {student && (
          <>
            <DialogHeader>
              <DialogTitle className="text-brand-navy">{student.name || student.code || 'Student'}</DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-2">
                  <span>{student.code}</span>
                  <Badge variant="outline" className={enrolment.cls}>Enrolment: {enrolment.label}</Badge>
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                {(student.phones || []).length === 0 && !lmsPhone && <p className="text-slate-400">No phone number on this student.</p>}
                {(student.phones || []).map((p, i) => (
                  <NumberRow key={p} label={student.phones.length > 1 ? `Phone ${i + 1}` : 'Phone'} number={p} student={student} />
                ))}
                {lmsPhone && <NumberRow label="Contact number (LMS registration)" number={lmsPhone} student={student} />}
                {lms?.emergencyContact && (
                  <div className="rounded-lg border border-slate-200 px-3 py-2">
                    <p className="text-xs text-slate-400">Emergency contact (LMS registration)</p>
                    <p className="break-words font-medium text-slate-800">{lms.emergencyContact}</p>
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Email">
                  {student.email ? <a href={`mailto:${student.email}`} className="inline-flex items-center gap-1 text-cyan-700 hover:underline"><Mail className="h-3.5 w-3.5" />{student.email}</a> : null}
                </Field>
                <Field label="Where">{[lms?.city, student.country].filter(Boolean).join(', ')}</Field>
                <Field label="CS">{student.cs}</Field>
                <Field label="Team">{student.team}</Field>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button asChild variant="outline" className="gap-1.5">
                <Link to={`${createPageUrl('StudentDetail')}?id=${student.id}`}><ExternalLink className="h-4 w-4" /> Open student page</Link>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
