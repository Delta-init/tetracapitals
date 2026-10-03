import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FileText, Loader2, Mic, Paperclip, SendHorizontal, Smile, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
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

/* Voice notes, recorded here. The server sends Opus as a WhatsApp voice note — Firefox records it in Ogg; Chrome,
   Edge and a current Safari in WebM (the server re-wraps it); an older Safari only records MP4, which goes as plain
   audio. Five minutes at most. */
const VOICE_TYPES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
const VOICE_EXT = { 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mp4': 'm4a' };
const MAX_VOICE_S = 300;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const canRecord = () => typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** The microphone while a voice note is recorded: start, the seconds so far, and finish (keep → the recording, or null). */
function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef(null);   // { recorder, stream, chunks, timer }
  const release = (r) => { clearInterval(r?.timer); r?.stream?.getTracks().forEach(t => t.stop()); };
  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = VOICE_TYPES.find(t => window.MediaRecorder.isTypeSupported?.(t));
    let recorder;
    // Speech needs little: 32 kbps keeps five minutes near a megabyte.
    try { recorder = new window.MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 }); } catch (e) { stream.getTracks().forEach(t => t.stop()); throw e; }
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.start(250);
    const began = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - began) / 1000)), 250);
    rec.current = { recorder, stream, chunks, timer };
    setSeconds(0);
    setRecording(true);
  };
  const finish = (keep) => new Promise((resolve) => {
    const r = rec.current;
    if (!r) { resolve(null); return; }
    rec.current = null;
    const done = () => {
      release(r);
      setRecording(false);
      setSeconds(0);
      const type = (r.recorder.mimeType || r.chunks[0]?.type || 'audio/webm');
      resolve(keep && r.chunks.length ? new Blob(r.chunks, { type }) : null);
    };
    if (r.recorder.state === 'inactive') done();
    else { r.recorder.onstop = done; r.recorder.stop(); }
  });
  useEffect(() => () => release(rec.current), []);
  return { recording, seconds, start, finish };
}

/** The file about to go: a photo shows itself, anything else its name and size. */
function Attachment({ file, onRemove, disabled }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file?.type?.startsWith('image/')) { setUrl(''); return undefined; }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="flex items-center gap-3 border-t bg-white px-3 py-2">
      {url
        ? <img src={url} alt="" className="h-14 w-14 shrink-0 rounded-md border object-cover" />
        : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border bg-slate-50 text-slate-400"><FileText className="h-6 w-6" /></span>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{file.name || 'Pasted image'}</p>
        <p className="text-xs text-slate-400">{fmtSize(file.size)} · what you write below goes with it</p>
      </div>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={disabled} onClick={onRemove} aria-label="Remove the file">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

/**
 * Write a message, attach a file, or record a voice note. A file — picked with the clip, pasted (a screenshot) or
 * dropped on the box — waits above the box to be checked, with what is written as its caption, until Send (up to
 * 25 MB). With nothing written the microphone takes Send's place, as on WhatsApp: tap it to record, then send or
 * throw the recording away. Enter sends; Shift+Enter is a new line; the smiley opens emojis where the cursor is.
 */
export function Composer({ onSendText, onSendFile, disabled, placeholder = 'Write a message' }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);
  const textRef = useRef(null);
  const voice = useVoiceRecorder();
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
  const run = async (fn, clear = true) => {
    setBusy(true);
    try { await fn(); if (clear) { setText(''); setFile(null); } } catch { /* the caller says what went wrong */ } finally { setBusy(false); }
  };
  const attach = (f) => {
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) { toast.error(`${f.name || 'That file'} is ${fmtSize(f.size)} — files up to 25 MB`); return; }
    setFile(f);
    textRef.current?.focus();
  };
  const send = () => {
    if (busy) return;
    const t = text.trim();
    if (file) void run(() => onSendFile(file, t));
    else if (t) void run(() => onSendText(t));
  };
  const pick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    attach(f);
  };
  // A screenshot pasted in becomes the attachment; pasted text stays text.
  const paste = (e) => {
    const f = [...(e.clipboardData?.files || [])][0];
    if (f) { e.preventDefault(); attach(f); }
  };
  const record = async () => {
    try { await voice.start(); } catch (e) {
      toast.error(e?.name === 'NotAllowedError' ? 'Allow the microphone for this site to record a voice note' : `Can't record here — ${e?.message || 'no microphone'}`);
    }
  };
  const sendVoice = async () => {
    const blob = await voice.finish(true);
    if (!blob) return;
    const type = blob.type.split(';')[0];
    const note = new File([blob], `voice-note.${VOICE_EXT[type] || 'webm'}`, { type: blob.type });
    void run(() => onSendFile(note, '', true), false);
  };
  // Five minutes is a voice note's limit here: it goes as it is.
  useEffect(() => { if (voice.recording && voice.seconds >= MAX_VOICE_S) void sendVoice(); });

  if (voice.recording) {
    return (
      <div className="flex items-center gap-2 border-t bg-slate-50 p-2">
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-rose-600 hover:text-rose-700" onClick={() => void voice.finish(false)} aria-label="Throw the recording away">
          <Trash2 className="h-4 w-4" />
        </Button>
        <div className="flex flex-1 items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm text-slate-700">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
          Recording <span className={`tabular-nums ${voice.seconds >= MAX_VOICE_S - 30 ? 'text-rose-600' : 'text-slate-500'}`}>{clock(voice.seconds)}</span>
          <span className="ml-auto hidden text-xs text-slate-400 sm:inline">up to {clock(MAX_VOICE_S)}</span>
        </div>
        <Button type="button" size="icon" className="h-9 w-9 shrink-0" style={{ backgroundColor: WA_GREEN }} onClick={() => void sendVoice()} aria-label="Send the voice note">
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const canSend = !!file || !!text.trim();
  return (
    <div
      className={dragging ? 'ring-2 ring-inset ring-emerald-400' : undefined}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { const f = e.dataTransfer?.files?.[0]; setDragging(false); if (f) { e.preventDefault(); attach(f); } }}
    >
    {file && <Attachment file={file} onRemove={() => setFile(null)} disabled={busy} />}
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
      <Textarea ref={textRef} value={text} onChange={(e) => setText(e.target.value)} rows={1} disabled={disabled || busy} placeholder={file ? 'Add a caption (optional)' : placeholder}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        onPaste={paste}
        className="max-h-32 min-h-9 resize-none bg-white py-2" />
      {canSend || busy || !canRecord() ? (
        <Button type="button" size="icon" className="h-9 w-9 shrink-0" style={{ backgroundColor: WA_GREEN }} disabled={disabled || busy || !canSend} onClick={send} aria-label="Send">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
        </Button>
      ) : (
        <Button type="button" size="icon" className="h-9 w-9 shrink-0" style={{ backgroundColor: WA_GREEN }} disabled={disabled} onClick={() => void record()} aria-label="Record a voice note" title="Record a voice note">
          <Mic className="h-4 w-4" />
        </Button>
      )}
    </div>
    </div>
  );
}
