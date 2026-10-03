import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FileText, Loader2, Paperclip, SendHorizontal, Smile } from 'lucide-react';
import { apiUrl } from '@/api/base44Client';

/* ────────────────────────────────────────────────────────────────────────────
   The pieces both WhatsApp screens share — the WhatsApp page and the student
   page's card: a chat's messages, and the box to write one.
──────────────────────────────────────────────────────────────────────────── */

export const WA_GREEN = '#25D366';
/** A number as WhatsApp wants it — as toIntl() in backend/src/whatsapp/service.ts: local UAE (5x…, 05x…) and Indian mobiles get their country code. */
export function toIntl(raw) {
  let d = String(raw || '').replace(/\D/g, '').replace(/^00/, '');
  if (/^05\d{8}$/.test(d)) d = `971${d.slice(1)}`;
  else if (/^5\d{8}$/.test(d)) d = `971${d}`;
  else if (/^[6-9]\d{9}$/.test(d)) d = `91${d}`;
  return d;
}
/** Each number in a student's phone field, ready for WhatsApp. */
export const numbersOf = (phone) => [...new Set(String(phone || '').replace(/\.0$/, '').split(/[\n\r/,;|]+| - /).map(toIntl).filter(x => x.length >= 9))];
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

const KIND = { image: '📷 Photo', sticker: '🔖 Sticker', video: '🎥 Video', audio: '🎵 Audio', document: '📄 Document' };

function Media({ media }) {
  const [broken, setBroken] = useState(false);
  if (!media) return null;
  const src = media.url ? apiUrl(media.url) : '';
  if (!src) return <p className="text-xs italic opacity-70">{media.type === 'document' ? media.file_name || 'Document' : 'File'} — not kept (too large)</p>;
  // A file the server no longer has shows as such, never as an empty space.
  if (broken) return <p className="text-xs italic opacity-70">{KIND[media.type] || 'File'} — couldn't load</p>;
  const fail = () => setBroken(true);
  if (media.type === 'sticker') return <img src={src} alt="Sticker" onError={fail} className="h-36 w-36 object-contain" />;
  if (media.type === 'image') {
    return <a href={src} target="_blank" rel="noopener noreferrer"><img src={src} alt="" onError={fail} className="mb-1 max-h-64 max-w-full rounded-md object-contain" /></a>;
  }
  if (media.type === 'video') return <video src={src} controls onError={fail} className="mb-1 max-h-64 max-w-full rounded-md" />;
  if (media.type === 'audio') return <audio src={src} controls onError={fail} className="mb-1 w-60 max-w-full" />;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="mb-1 inline-flex items-center gap-1.5 rounded-md bg-black/5 px-2 py-1.5 text-xs font-medium hover:bg-black/10">
      <FileText className="h-4 w-4" />{media.file_name || 'Document'}
    </a>
  );
}

export function MessageBubble({ m }) {
  const out = m.direction === 'out';
  const label = m.media && ['📷 Photo', '🎥 Video', '🎵 Audio', '🎤 Voice note', '🔖 Sticker'].includes(m.body);
  if (m.media?.type === 'sticker' && m.media.url) {
    // A sticker stands on its own, as on WhatsApp: no bubble, its time underneath.
    return (
      <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
        <div className={`flex max-w-[78%] flex-col ${out ? 'items-end' : 'items-start'}`}>
          <Media media={m.media} />
          <span className="mt-0.5 rounded-md bg-white/80 px-1.5 text-[10px] text-slate-500">
            {out && m.sent_by_name ? `${m.sent_by_name} · ` : ''}{time(m.at)}
          </span>
        </div>
      </div>
    );
  }
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

/** The emoji panel's emojis, by group (space-separated: some are several characters). */
const EMOJI = [
  ['Smileys', '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😋 😛 😜 🤪 🤓 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 😱 😨 😰 😥 😓 🤗 🤔 🤭 🤫 😶 😐 😑 😬 🙄 😯 😮 😲 🥱 😴 😪 😵 🤐 🥴 🤢 🤧 😷 🤒 🤕'],
  ['Hands', '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 👋 🤝 🙏 👏 🙌 👐 🤲 💪 ✍️'],
  ['Hearts', '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝'],
  ['Things', '🎉 🎊 🎁 🏆 🥇 ⭐ 🌟 ✨ 🔥 💯 ✅ ✔️ ❌ ⚠️ ❗ ❓ 💡 📌 📍 📅 ⏰ ⌛ 📞 📱 💻 📧 📝 📚 🎓 💰 💵 💳 📈 📉 🚀 🌙 ☀️ 🌹 ☕'],
].map(([name, list]) => ({ name, list: list.split(' ') }));

/**
 * Write a message, or attach a file (up to 25 MB, with what is written as its caption). Enter sends; Shift+Enter is a
 * new line; the smiley opens emojis, put in where the cursor is.
 */
export function Composer({ onSendText, onSendFile, disabled, placeholder = 'Write a message' }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const textRef = useRef(null);
  const addEmoji = (emoji) => {
    const box = textRef.current;
    const start = box?.selectionStart ?? text.length;
    const end = box?.selectionEnd ?? text.length;
    setText(t => t.slice(0, start) + emoji + t.slice(end));
    requestAnimationFrame(() => {
      if (!box) return;
      box.focus();
      box.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };
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
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" disabled={disabled || busy} aria-label="Emoji">
            <Smile className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-80 p-2">
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {EMOJI.map(g => (
              <div key={g.name}>
                <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{g.name}</p>
                <div className="grid grid-cols-8 gap-0.5">
                  {g.list.map(e => (
                    <button key={e} type="button" onClick={() => addEmoji(e)} className="rounded p-1 text-xl leading-none hover:bg-slate-100">{e}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" disabled={disabled || busy} onClick={() => fileRef.current?.click()} aria-label="Attach a file">
        <Paperclip className="h-4 w-4" />
      </Button>
      <Textarea ref={textRef} value={text} onChange={(e) => setText(e.target.value)} rows={1} disabled={disabled || busy} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        className="max-h-32 min-h-9 resize-none bg-white py-2" />
      <Button type="button" size="icon" className="h-9 w-9 shrink-0" style={{ backgroundColor: WA_GREEN }} disabled={disabled || busy || !text.trim()} onClick={send} aria-label="Send">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
      </Button>
    </div>
  );
}
