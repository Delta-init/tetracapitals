import { useState } from 'react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { ExternalLink, Loader2, LogIn } from 'lucide-react';
import { isMentorRole, readsClosedOnly } from '@/components/utils/roles';
import { isStudentOf } from '@/components/students/common';

/* ────────────────────────────────────────────────────────────────────────────
   View as student (the user, 2026-10-06): the student's own Delta LMS as they
   see it, in a new tab — read-only, so nothing can be changed there, and the
   LMS shows whose view it is on a banner. The link works once, for a minute;
   the view lasts 30 minutes, and the LMS's admins can see and end it. Only
   the student's own CS — both, for a Common student — not their leaders; the
   Super Admin anyone's (backend/src/functions/lmsEnrolmentRequests.ts
   viewStudentInLms).
──────────────────────────────────────────────────────────────────────────── */

/** Whether someone may view students in the LMS at all: the Super Admin, CSs and their leaders — not the Sales role. */
export const canViewInLms = (user) =>
  !!user && (user.app_role === 'super_admin' || (isMentorRole(user.app_role) && !readsClosedOnly(user)));

/** Whether someone may view this student in the LMS: the Super Admin, or the student's own CS (or a CS they're Common with). */
export const mayViewInLms = (user, student) =>
  canViewInLms(user) && (user.app_role === 'super_admin' || isStudentOf(student, user.id));

const WAITING = `<!doctype html><title>Opening the LMS…</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;font:15px system-ui,sans-serif;color:#64748b">Opening the student's LMS…</body>`;

/** Opens a student's LMS — by their record here (studentId), or by the LMS address for a request from someone who isn't here. */
export function ViewInLmsButton({ studentId, email, name, label = 'View as student', className, size, variant = 'outline' }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    // The tab opens now, while the click still counts — one opened after the LMS answers is blocked as a pop-up.
    const tab = window.open('', '_blank');
    try { tab?.document.write(WAITING); tab?.document.close(); } catch { /* nothing to show it in */ }
    setBusy(true);
    try {
      const { data } = await base44.functions.invoke('viewStudentInLms', studentId ? { studentId } : { email });
      const until = data?.sessionExpiresAt
        ? new Date(data.sessionExpiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
      const opened = `${name || 'The student'}'s LMS — read-only${until ? `, until ${until}` : ''}`;
      if (tab && !tab.closed) {
        tab.opener = null;
        tab.location.replace(data.url);
        toast.success(`${opened}, in a new tab`);
      } else {
        // The browser kept the tab from opening: this click is a fresh one, and the link is good for a minute.
        toast(opened, {
          description: 'Your browser held the new tab back — the link works once, for a minute',
          action: { label: 'Open', onClick: () => window.open(data.url, '_blank', 'noopener') },
          duration: 60_000,
        });
      }
    } catch (e) {
      tab?.close();
      toast.error(e?.message || "The student's LMS could not be opened");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={open}
      disabled={busy}
      title="Their own LMS as they see it, in a new tab — read-only: nothing can be changed there"
    >
      {busy ? <Loader2 className="animate-spin" /> : <LogIn />}
      {label}
      <ExternalLink className="!size-3 opacity-50" />
    </Button>
  );
}
