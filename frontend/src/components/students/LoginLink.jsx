import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, Copy, KeyRound, Loader2, MessageCircle } from 'lucide-react';
import { copyText, when } from '@/components/messages/MessageLogUi';

/* ────────────────────────────────────────────────────────────────────────────
   A student's login link (the user, 2026-10-29): the LMS's one-time link —
   one tap signs them into their account, no password, once, within 24 hours;
   a new one cancels the last unused one. Copy it, or send it on your own
   WhatsApp. For whoever may Act as them (backend lmsEnrolmentRequests.ts
   createStudentLoginLink); the LMS records who made it.
──────────────────────────────────────────────────────────────────────────── */

const message = (name, url) =>
  `Hi ${String(name || '').trim().split(/\s+/)[0] || 'there'}, here is your link to sign in to Delta LMS — tap it and you're in, no password needed:\n${url}\n\nIt works once, within 24 hours.`;

export function LoginLinkButton({ student, className }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null);
  const [sending, setSending] = useState(false);
  const make = async () => {
    setBusy(true);
    try { setLink((await base44.functions.invoke('createStudentLoginLink', { studentId: student.id })).data); }
    catch (e) { toast.error(/unknown function|not found/i.test(String(e?.message)) ? 'Login links come with the server update (the API deploy).' : e?.message || 'Could not make the link'); }
    finally { setBusy(false); }
  };
  // Their number as the WhatsApp tab has it (international), when this person's WhatsApp can send.
  const wa = useQuery({
    queryKey: ['student-whatsapp', student?.id], enabled: open && !!student?.id, staleTime: 30_000,
    queryFn: async () => (await base44.functions.invoke('getStudentWhatsApp', { studentId: student.id })).data,
  }).data;
  const phone = wa?.can_send ? wa.numbers?.[0] : null;
  const sendWhatsApp = async () => {
    setSending(true);
    try {
      await base44.functions.invoke('sendWhatsApp', { chat: phone, text: message(student.full_name, link.url) });
      toast.success('Sent on your WhatsApp');
    } catch (e) { toast.error(e?.message || 'Not sent — copy the link and send it yourself'); }
    finally { setSending(false); }
  };
  return (
    <>
      <Button variant="outline" className={className} onClick={() => { setLink(null); setOpen(true); }}>
        <KeyRound className="mr-2 h-4 w-4" />Login link
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Login link for {student?.full_name || 'the student'}</DialogTitle>
            <DialogDescription>One tap signs them into their LMS account — no email or password. It works once, within 24 hours. Making a new one cancels the last one they haven't used.</DialogDescription>
          </DialogHeader>
          {!link ? (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Send it only to the student. Whoever opens it is signed in as them.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <code className="min-w-0 flex-1 select-all break-all rounded border bg-slate-50 px-2 py-1.5 text-xs text-slate-800">{link.url}</code>
                <Button size="sm" variant="outline" onClick={() => copyText(link.url, 'Link copied')}><Copy className="h-4 w-4" /></Button>
              </div>
              <p className="text-xs text-slate-500">Works until {when(link.expiresAt)}, for one sign-in. Don't open it yourself — that would use it up.</p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            {!link ? (
              <Button onClick={make} disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}Make the link</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => copyText(message(student.full_name, link.url), 'Message copied')}><Copy className="mr-2 h-4 w-4" />Copy with a message</Button>
                {phone && <Button onClick={sendWhatsApp} disabled={sending} className="bg-[#25D366] text-white hover:bg-[#1ebe5a]">{sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}Send on my WhatsApp</Button>}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
