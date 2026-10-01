import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { FileText, Loader2, Paperclip, SendHorizontal } from 'lucide-react';
import { apiUrl } from '@/api/base44Client';

/* ────────────────────────────────────────────────────────────────────────────
   The pieces both WhatsApp screens share — the WhatsApp page and the student
   page's card: a chat's messages, and the box to write one.
──────────────────────────────────────────────────────────────────────────── */

export const WA_GREEN = '#25D366';
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const dayOf = (iso) => (iso ? new Date(iso).toDateString() : '');
const dayLabel = (iso) => {
  if (!iso) return '';
  const d = new Date(iso), today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const shortTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? time(iso) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

function Media({ media }) {
  if (!media) return null;
  const src = media.url ? apiUrl(media.url) : '';
  if (!src) return <p className="text-xs italic opacity-70">{media.type === 'document' ? media.file_name || 'Document' : 'File'} — not kept (too large)</p>;
  if (media.type === 'image' || media.type === 'sticker') {
    return <a href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt="" className="mb-1 max-h-64 max-w-full rounded-md object-contain" /></a>;
  }
  if (media.type === 'video') return <video src={src} controls className="mb-1 max-h-64 max-w-full rounded-md" />;
  if (media.type === 'audio') return <audio src={src} controls className="mb-1 w-60 max-w-full" />;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="mb-1 inline-flex items-center gap-1.5 rounded-md bg-black/5 px-2 py-1.5 text-xs font-medium hover:bg-black/10">
      <FileText className="h-4 w-4" />{media.file_name || 'Document'}
    </a>
  );
}

export function MessageBubble({ m }) {
  const out = m.direction === 'out';
  const label = m.media && ['📷 Photo', '🎥 Video', '🎵 Audio', '🎤 Voice note', '🔖 Sticker'].includes(m.body);
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${out ? 'rounded-br-md bg-[#d9fdd3] text-slate-900' : 'rounded-bl-md bg-white text-slate-900'}`}>
        <Media media={m.media} />
        {!label && m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
        <p className="mt-0.5 text-right text-[10px] text-slate-500">
          {out && m.sent_by_name ? `${m.sent_by_name} · ` : ''}{time(m.at)}
        </p>
      </div>
    </div>
  );
}

/** A chat's messages, with a line for each day, kept scrolled to the newest. */
export function Thread({ messages = [], empty = 'No messages yet', className = '' }) {
  const end = useRef(null);
  const last = messages[messages.length - 1]?.id;
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [last]);
  return (
    <div className={`space-y-2 overflow-y-auto bg-[#efeae2] p-3 ${className}`}>
      {messages.length === 0 && <p className="py-10 text-center text-sm text-slate-500">{empty}</p>}
      {messages.map((m, i) => (
        <React.Fragment key={m.id}>
          {dayOf(m.at) !== dayOf(messages[i - 1]?.at) && (
            <div className="flex justify-center"><span className="rounded-md bg-white/90 px-2 py-0.5 text-[11px] text-slate-500 shadow-sm">{dayLabel(m.at)}</span></div>
          )}
          <MessageBubble m={m} />
        </React.Fragment>
      ))}
      <div ref={end} />
    </div>
  );
}

/** Write a message, or attach a file (up to 25 MB, with what is written as its caption). Enter sends; Shift+Enter is a new line. */
export function Composer({ onSendText, onSendFile, disabled, placeholder = 'Write a message' }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const run = async (fn) => {
    setBusy(true);
    try { await fn(); setText(''); } catch { /* the caller says what went wrong */ } finally { setBusy(false); }
  };
  const send = () => { const t = text.trim(); if (t && !busy) void run(() => onSendText(t)); };
  const pick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void run(() => onSendFile(f, text.trim()));
  };
  return (
    <div className="flex items-end gap-2 border-t bg-slate-50 p-2">
      <input ref={fileRef} type="file" className="hidden" onChange={pick} />
      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" disabled={disabled || busy} onClick={() => fileRef.current?.click()} aria-label="Attach a file">
        <Paperclip className="h-4 w-4" />
      </Button>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} disabled={disabled || busy} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        className="max-h-32 min-h-9 resize-none bg-white py-2" />
      <Button type="button" size="icon" className="h-9 w-9 shrink-0" style={{ backgroundColor: WA_GREEN }} disabled={disabled || busy || !text.trim()} onClick={send} aria-label="Send">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
      </Button>
    </div>
  );
}
