import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, Copy, Link2, Loader2, MessageCircle } from 'lucide-react';
import { copyText, when } from '@/components/messages/MessageLogUi';

/* ────────────────────────────────────────────────────────────────────────────
   "Send join link" on a class card's student (the user, 2026-10-29): only when
   clicked, the LMS makes that student's one-tap join link for the class — it
   signs them in once, no password, and takes them into the class (attendance
   counts) — lasting until the class's join window closes. The message reads
   like the LMS's "Starts in 5 minutes" WhatsApp, with our link only;
   copy it, or send it on your own WhatsApp. Whoever may Act as the student
   (backend lmsEnrolmentRequests.ts createClassJoinLink).
──────────────────────────────────────────────────────────────────────────── */

const JOIN_AFTER_MIN = 15;
/** The class can still be joined: online, not cancelled or ended, before its join window closes. */
export const classJoinable = (c) => !!c && !c.inPerson && !['cancelled', 'ended'].includes(String(c.status))
  && Date.now() <= new Date(c.startsAt).getTime() + ((Number(c.durationMins) || 0) + JOIN_AFTER_MIN) * 60_000;

function messageOf(link) {
  const k = link.class || {};
  const first = String(link.student?.name || '').trim().split(/\s+/)[0] || 'there';
  const started = Date.now() >= new Date(k.startsAt).getTime();
  const whenText = new Date(k.startsAt).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Dubai' });
  const what = `*${k.title || 'your class'}*${k.course ? ` (${k.course}${k.mentor ? `, with ${k.mentor}` : ''})` : k.mentor ? ` with ${k.mentor}` : ''}`;
  return [
    started ? `Hi ${first}, your class ${what} has started.` : `Hi ${first}, your class ${what} starts ${whenText} (Dubai time).`,
    '',
    // Our link only (the user, 2026-10-29): no Meet link — joining through ours is what counts the attendance.
    `Tap to join — you'll be signed in and taken straight to the class:\n${link.joinUrl}`,
  ].join('\n');
}

export function ClassJoinLinkButton({ classId, student }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const wa = useQuery({
    queryKey: ['student-whatsapp', link?.studentId], enabled: !!link?.studentId, staleTime: 30_000,
    queryFn: async () => (await base44.functions.invoke('getStudentWhatsApp', { studentId: link.studentId })).data,
  }).data;
  const phone = wa?.can_send ? wa.numbers?.[0] : null;

  const make = async () => {
    setBusy(true);
    try {
      const made = (await base44.functions.invoke('createClassJoinLink', { classId, bookingId: student.bookingId, email: student.email })).data;
      setLink(made); setText(messageOf(made)); setOpen(true);
    } catch (e) {
      toast.error(/unknown function|not found/i.test(String(e?.message)) ? 'Join links come with the server update (the API deploy).' : e?.message || 'Could not make the join link');
    } finally { setBusy(false); }
  };
  const send = async () => {
    setSending(true);
    try { await base44.functions.invoke('sendWhatsApp', { chat: phone, text }); toast.success('Sent on your WhatsApp'); }
    catch (e) { toast.error(e?.message || 'Not sent — copy the message and send it yourself'); }
    finally { setSending(false); }
  };

  return (
    <>
      <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={make} disabled={busy}>
        {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1 h-3.5 w-3.5" />}Send join link
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Join link for {link?.student?.name || student.name}</DialogTitle>
            <DialogDescription>One tap signs them in — no password — and takes them into {link?.class?.title || 'the class'}. It works once, until {when(link?.expiresAt)}.</DialogDescription>
          </DialogHeader>
          {link && (
            <div className="space-y-2">
              <Textarea value={text} onChange={e => setText(e.target.value)} rows={9} className="text-sm" />
              <p className="flex items-start gap-1.5 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Send it only to the student — whoever opens the join link is signed in as them and marked joined. Don't open it yourself.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => copyText(text, 'Message copied')}><Copy className="mr-2 h-4 w-4" />Copy message</Button>
            {phone && (
              <Button onClick={send} disabled={sending || !text.trim()} className="bg-[#25D366] text-white hover:bg-[#1ebe5a]">
                {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}Send on my WhatsApp
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
