import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SearchableSelect from '@/components/common/SearchableSelect';
import { ArrowLeft, Link2, Loader2, Maximize2, MessageCircle, Minimize2, Plus, Search, Smartphone, Unlink } from 'lucide-react';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { createPageUrl } from '@/utils';
import { Composer, Thread, WA_GREEN, shortTime, numbersOf } from '@/components/whatsapp/waUi';

/* ────────────────────────────────────────────────────────────────────────────
   WhatsApp: each CS links their own WhatsApp here (a QR, as WhatsApp Web) and
   chats with their students; a Chief Mentor, CS Manager or Super Admin picks
   one of their CSs and reads theirs. backend/src/functions/whatsapp.ts.
──────────────────────────────────────────────────────────────────────────── */

const call = async (name, body = {}) => (await base44.functions.invoke(name, body)).data;
const fmtPhone = (p) => (p ? `+${p}` : '');
const STATUS = {
  connected: { label: 'Linked', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  qr_ready: { label: 'Scan the QR', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  connecting: { label: 'Starting…', cls: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500' },
  disconnected: { label: 'Not linked', cls: 'bg-slate-50 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
};

function LinkPanel({ me, onChanged }) {
  const [busy, setBusy] = useState(false);
  const run = async (name) => {
    setBusy(true);
    try { await call(name); onChanged(); } catch (e) { toast.error(e?.message || 'WhatsApp did not answer'); } finally { setBusy(false); }
  };
  const s = STATUS[me.status] || STATUS.disconnected;
  return (
    <Card className="border-slate-200">
      <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-start gap-3">
          <div className="rounded-full p-2" style={{ backgroundColor: `${WA_GREEN}22` }}><Smartphone className="h-5 w-5" style={{ color: WA_GREEN }} /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-slate-900">Your WhatsApp</p>
              <Badge variant="outline" className={s.cls}>{s.label}</Badge>
              {me.status === 'connected' && <span className="text-sm text-slate-600">{fmtPhone(me.phone)}</span>}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {me.status === 'connected'
                ? 'Messages to and from your students show here and on their pages. Your phone stays your WhatsApp — this is one of its linked devices.'
                : me.status === 'qr_ready'
                  ? 'On your phone: WhatsApp → Settings → Linked devices → Link a device, then scan this code.'
                  : 'Link your own WhatsApp to chat with your students from the portal — normal one-to-one messages.'}
            </p>
          </div>
        </div>
        {me.status === 'qr_ready' && me.qr && <img src={me.qr} alt="WhatsApp QR code" className="h-48 w-48 self-center rounded-lg border bg-white p-1" />}
        {me.status === 'connecting' && <Loader2 className="h-6 w-6 animate-spin self-center text-sky-600" />}
        <div className="flex gap-2 self-center">
          {me.status === 'connected'
            ? <Button variant="outline" disabled={busy} onClick={() => confirm('Unlink your WhatsApp from the portal? Your chats so far stay here.') && run('disconnectWhatsApp')}><Unlink className="mr-1 h-4 w-4" />Unlink</Button>
            : me.status === 'disconnected'
              ? <Button disabled={busy} style={{ backgroundColor: WA_GREEN }} onClick={() => run('connectWhatsApp')}>{busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Smartphone className="mr-1 h-4 w-4" />}Link WhatsApp</Button>
              : <Button variant="ghost" disabled={busy} onClick={() => run('disconnectWhatsApp')}>Cancel</Button>}
        </div>
      </CardContent>
    </Card>
  );
}

function LinkStudentDialog({ open, onOpenChange, ownerId, chat, onLinked }) {
  const [studentId, setStudentId] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: students = [] } = useQuery({ queryKey: ['wa-link-students'], queryFn: () => base44.entities.Student.list('-created_date'), enabled: open, staleTime: 60_000 });
  const options = useMemo(() => students.map(s => ({ value: s.id, label: `${String(s.full_name || '').trim()} · ${s.student_code || ''}${s.phone ? ` · ${String(s.phone).replace(/^[\s'`"]+/, '')}` : ''}` })), [students]);
  useEffect(() => { if (open) setStudentId(''); }, [open]);
  const save = async () => {
    setBusy(true);
    try {
      const res = await call('linkWhatsAppChat', { ownerId, chat: chat?.chat, studentId });
      toast.success(`Linked to ${res.student?.name || 'the student'}`);
      onLinked();
      onOpenChange(false);
    } catch (e) { toast.error(e?.message || 'Could not link'); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link this chat to a student</DialogTitle>
          <DialogDescription>{chat?.whatsapp_name || chat?.name} {chat?.phone ? `(${fmtPhone(chat.phone)})` : ''} — this number is on no student's record. Its messages, earlier and later, will show under the student.</DialogDescription>
        </DialogHeader>
        <SearchableSelect value={studentId} onValueChange={(v) => setStudentId(v === '__none__' ? '' : v)} options={options} placeholder="Choose a student…" searchPlaceholder="Name, code or phone…" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !studentId}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Link</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function WhatsApp() {
  const queryClient = useQueryClient();
  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const { data: st, isLoading } = useQuery({
    queryKey: ['wa-status'],
    queryFn: () => call('getWhatsAppStatus'),
    enabled: !!currentUser,
    refetchInterval: (q) => (['connecting', 'qr_ready'].includes(q.state.data?.me?.status) ? 2000 : 15000),
  });
  const [ownerId, setOwnerId] = useState('');
  const location = useLocation();
  const [chatId, setChatId] = useState(() => new URLSearchParams(window.location.search).get('chat') || '');
  // A WhatsApp notification opens its chat (/WhatsApp?chat=…), also when the page is already open.
  useEffect(() => {
    const c = new URLSearchParams(location.search).get('chat');
    if (c) { setOwnerId(''); setChatId(c); }
  }, [location.search]);
  const [q, setQ] = useState('');
  const [newNumber, setNewNumber] = useState(null);
  const [draft, setDraft] = useState(null);       // a chat started from a student, before its first message
  const [picking, setPicking] = useState(null);   // a student with several numbers: which one
  const [linking, setLinking] = useState(false);
  // Full screen: the chats and the chat fill the window — the browser's own full screen where it has one; Esc leaves.
  const [full, setFull] = useState(false);
  const toggleFull = () => {
    if (!full) {
      setFull(true);
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      setFull(false);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
  };
  useEffect(() => {
    if (!full) return undefined;
    const left = () => { if (!document.fullscreenElement) setFull(false); };   // the browser's Esc
    const esc = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) setFull(false); };
    document.addEventListener('fullscreenchange', left);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('fullscreenchange', left); window.removeEventListener('keydown', esc); };
  }, [full]);
  useEffect(() => () => { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); }, []);

  const owners = st?.owners || [];
  const viewing = ownerId || (st?.can_link ? st?.me?.id : owners[0]?.id) || '';
  const mine = !!st && viewing === st.me?.id;
  const { data: chatsData } = useQuery({
    queryKey: ['wa-chats', viewing],
    queryFn: () => call('getWhatsAppChats', { ownerId: viewing }),
    enabled: !!viewing,
    refetchInterval: 5000,
  });
  const chats = chatsData?.chats || [];
  const chat = chats.find(c => c.chat === chatId) || (draft?.chat === chatId ? draft : null) || (chatId ? { chat: chatId, phone: /^\d+$/.test(chatId) ? chatId : '', name: /^\d+$/.test(chatId) ? `+${chatId}` : chatId, students: [], unread: 0 } : null);

  // Your students, to start a chat from: the dropdown above the chats.
  const { data: myStudents = [] } = useQuery({
    queryKey: ['wa-my-students', st?.me?.id],
    queryFn: () => base44.entities.Student.list('-created_date'),
    enabled: !!st?.can_link && mine,
    staleTime: 60_000,
  });
  const studentOptions = useMemo(() => myStudents
    .filter(s => s.primary_mentor_id === st?.me?.id || (s.common_cs || []).some(c => c.id === st?.me?.id))
    .map(s => ({ value: s.id, label: `${String(s.full_name || '').trim()} · ${s.student_code || ''}` })), [myStudents, st?.me?.id]);
  /** Their chat if there is one (linked to them, or on one of their numbers), else a new one on their number. */
  const openStudent = (id) => {
    const s = myStudents.find(x => x.id === id);
    if (!s) return;
    const brief = { id: s.id, code: s.student_code || '', name: String(s.full_name || '').trim() };
    const nums = numbersOf(s.phone);
    const existing = chats.find(c => c.students.some(x => x.id === s.id)) || chats.find(c => c.phone && nums.some(n => n.slice(-9) === c.phone.slice(-9)));
    setPicking(null);
    if (existing) { setChatId(existing.chat); return; }
    if (!nums.length) { toast.error(`No phone number on ${brief.name}'s record`); return; }
    if (nums.length > 1) { setPicking({ student: brief, numbers: nums }); return; }
    startDraft(brief, nums[0]);
  };
  const startDraft = (brief, number) => {
    setDraft({ chat: number, phone: number, name: brief.name, whatsapp_name: '', students: [brief], unread: 0 });
    setChatId(number);
    setPicking(null);
  };
  const { data: thread } = useQuery({
    queryKey: ['wa-messages', viewing, chatId],
    queryFn: () => call('getWhatsAppMessages', { ownerId: viewing, chat: chatId }),
    enabled: !!viewing && !!chatId,
    refetchInterval: 3000,
  });

  // Opening your own chat reads it (a manager reading a CS's chat leaves it unread for the CS).
  useEffect(() => {
    if (mine && chat?.unread > 0) {
      call('markWhatsAppRead', { chat: chat.chat }).then(() => queryClient.invalidateQueries({ queryKey: ['wa-chats', viewing] })).catch(() => {});
    }
  }, [mine, chat?.chat, chat?.unread, viewing, queryClient]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['wa-status'] });
    queryClient.invalidateQueries({ queryKey: ['wa-chats', viewing] });
    queryClient.invalidateQueries({ queryKey: ['wa-messages', viewing, chatId] });
  };
  const sendText = async (text) => {
    try {
      const res = await call('sendWhatsApp', { chat: chat.chat, text });
      if (res?.chat && res.chat !== chatId) setChatId(res.chat);
      refresh();
    } catch (e) { toast.error(e?.message || 'Not sent'); throw e; }
  };
  const sendFile = async (file, caption, voice = false) => {
    const form = new FormData();
    form.append('chat', chat.chat);
    form.append('caption', caption);
    form.append('file', file);
    if (voice) form.append('voice', '1');
    try {
      const res = (await base44.functions.invokeForm('sendWhatsAppFile', form)).data;
      if (res?.chat && res.chat !== chatId) setChatId(res.chat);
      refresh();
    } catch (e) { toast.error(e?.message || 'Not sent'); throw e; }
  };

  const needle = q.trim().toLowerCase();
  const shown = needle ? chats.filter(c => [c.name, c.whatsapp_name, c.phone, ...c.students.map(s => s.code)].some(v => String(v || '').toLowerCase().includes(needle))) : chats;
  const canSend = mine && chatsData?.can_send;

  if (!currentUser || isLoading) return <div className="p-8 text-center text-slate-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <div>
        <PageTitle eyebrow="Students" icon={MessageCircle}>WhatsApp</PageTitle>
        <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
          {st?.can_link ? 'Chat with your students from your own WhatsApp.' : 'The WhatsApp chats of the CSs you look after — read only; each CS sends from their own WhatsApp.'}
        </p>
      </div>

      {!st?.enabled && <Card><CardContent className="p-4 text-sm text-amber-800">WhatsApp is switched off on this server.</CardContent></Card>}
      {st?.enabled && st?.can_link && <LinkPanel me={st.me} onChanged={refresh} />}

      {owners.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500">Whose WhatsApp</span>
          <Select value={viewing} onValueChange={(v) => { setOwnerId(v); setChatId(''); }}>
            <SelectTrigger className="w-80"><SelectValue placeholder="Choose a CS" /></SelectTrigger>
            <SelectContent>
              {owners.map(o => (
                <SelectItem key={o.id} value={o.id}>
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${(STATUS[o.status] || STATUS.disconnected).dot}`} />
                    {o.name}{o.team ? ` · ${o.team}` : ''}{o.messages ? ` · ${o.messages} messages` : ''}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {viewing && (
        <Card className={`overflow-hidden border-slate-200 ${full ? 'fixed inset-0 z-50 !m-0 rounded-none border-0' : ''}`}>
          <div className={`grid ${full ? 'h-full' : 'h-[70vh] min-h-[480px]'} grid-cols-1 md:grid-cols-[340px_1fr]`}>
            {/* Chats */}
            <div className={`flex min-h-0 flex-col border-r ${chat ? 'hidden md:flex' : 'flex'}`}>
              <div className="space-y-2 border-b p-3">
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number or code" className="h-9 pl-8" />
                  </div>
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={toggleFull} title={full ? 'Exit full screen' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
                    {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </Button>
                </div>
                {mine && st?.can_link && (
                  <>
                    <SearchableSelect value="" onValueChange={(v) => v && v !== '__none__' && openStudent(v)} options={studentOptions}
                      placeholder={studentOptions.length ? 'Message a student…' : 'No students yet'} searchPlaceholder="Name or code…" disabled={!studentOptions.length} />
                    {picking && (
                      <div className="rounded-md border bg-slate-50 p-2 text-xs">
                        <p className="mb-1.5 text-slate-600">{picking.student.name} has {picking.numbers.length} numbers — which one?</p>
                        <div className="flex flex-wrap gap-1.5">
                          {picking.numbers.map(n => <Button key={n} size="sm" variant="outline" className="h-7 text-xs" onClick={() => startDraft(picking.student, n)}>+{n}</Button>)}
                        </div>
                      </div>
                    )}
                    {canSend && (newNumber === null
                      ? <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setNewNumber('')}><Plus className="mr-0.5 inline h-3 w-3" />or type a number</button>
                      : (
                        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const d = newNumber.replace(/\D/g, ''); if (d.length >= 9) { setChatId(d); setNewNumber(null); } }}>
                          <Input autoFocus value={newNumber} onChange={(e) => setNewNumber(e.target.value)} placeholder="Number with country code" className="h-8" />
                          <Button type="submit" size="sm" className="h-8">Open</Button>
                        </form>
                      ))}
                  </>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {shown.length === 0 && <p className="p-6 text-center text-sm text-slate-500">{chats.length ? 'No match' : mine && st?.me?.status !== 'connected' ? 'Link your WhatsApp to start' : 'No chats yet'}</p>}
                {shown.map(c => (
                  <button key={c.chat} type="button" onClick={() => setChatId(c.chat)}
                    className={`flex w-full items-start gap-3 border-b px-3 py-2.5 text-left hover:bg-slate-50 ${c.chat === chatId ? 'bg-emerald-50/60' : ''}`}>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-600">{(c.name || '?').replace(/^\+/, '').charAt(0).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-slate-900">{c.name}</p>
                        <span className={`shrink-0 text-[11px] ${c.unread ? 'font-semibold text-emerald-600' : 'text-slate-400'}`}>{shortTime(c.last?.at)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-slate-500">{c.last?.direction === 'out' ? '✓ ' : ''}{c.last?.body}</p>
                        {c.unread > 0 && <span className="shrink-0 rounded-full px-1.5 text-[11px] font-semibold text-white" style={{ backgroundColor: WA_GREEN }}>{c.unread}</span>}
                      </div>
                      {c.students.length > 0
                        ? <p className="truncate text-[11px] text-slate-400">{c.students.map(s => s.code).join(', ')}{c.phone ? ` · ${fmtPhone(c.phone)}` : ''}</p>
                        : <p className="text-[11px] text-amber-600">Not a student{c.phone ? ` · ${fmtPhone(c.phone)}` : ''}</p>}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* The chat */}
            <div className={`min-h-0 flex-col ${chat ? 'flex' : 'hidden md:flex'}`}>
              {!chat ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
                  <MessageCircle className="h-10 w-10" style={{ color: WA_GREEN }} />
                  <p className="text-sm">Choose a chat</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 border-b px-3 py-2">
                    <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={() => setChatId('')} aria-label="Back"><ArrowLeft className="h-4 w-4" /></Button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">{chat.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {fmtPhone(chat.phone)}{chat.whatsapp_name && chat.whatsapp_name !== chat.name ? ` · on WhatsApp: ${chat.whatsapp_name}` : ''}
                      </p>
                    </div>
                    {chat.students?.map(s => (
                      <Link key={s.id} to={`${createPageUrl('StudentDetail')}?id=${s.id}`} className="hidden sm:block">
                        <Badge variant="outline" className="hover:bg-slate-100">{s.code}</Badge>
                      </Link>
                    ))}
                    {chat.students?.length === 0 && thread?.messages?.length > 0 && (
                      <Button variant="outline" size="sm" onClick={() => setLinking(true)}><Link2 className="mr-1 h-4 w-4" />Link to a student</Button>
                    )}
                    {/* On a phone the chat list (with its own button) is hidden while a chat is open. */}
                    <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={toggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'}>
                      {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </Button>
                  </div>
                  <Thread messages={thread?.messages || []} className="min-h-0 flex-1" empty={canSend ? 'Write the first message' : 'No messages yet'} />
                  {canSend
                    ? <Composer onSendText={sendText} onSendFile={sendFile} />
                    : <p className="border-t bg-slate-50 p-3 text-center text-xs text-slate-500">{mine ? 'Link your WhatsApp to reply' : 'Read only — the CS replies from their own WhatsApp'}</p>}
                </>
              )}
            </div>
          </div>
        </Card>
      )}

      {owners.length === 0 && !st?.can_link && (
        <Card><CardContent className="p-6 text-center text-sm text-slate-500">No CS on your team has linked WhatsApp yet.</CardContent></Card>
      )}

      <LinkStudentDialog open={linking} onOpenChange={setLinking} ownerId={viewing} chat={chat} onLinked={refresh} />
    </div>
  );
}
