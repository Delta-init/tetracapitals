import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, Copy, Link2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   What the Message Logs page and the student page share (the user,
   2026-10-29): a message's status, a WhatsApp message as the student read it
   with its button's link, and an email opened as they got it with the links
   in it. A one-tap link (join / sign-in) signs in as the student: it is copy
   text, never a link to click (backend functions/messageLogs.ts).
──────────────────────────────────────────────────────────────────────────── */

export const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '—');

const STATUS = {
  sent: ['Sent', 'border-emerald-200 bg-emerald-50 text-emerald-700'],
  pending: ['Waiting', 'border-amber-200 bg-amber-50 text-amber-800'],
  waiting: ['Waiting', 'border-amber-200 bg-amber-50 text-amber-800'],
  failed: ['Not sent', 'border-rose-200 bg-rose-50 text-rose-700'],
  not_sent: ['Not sent', 'border-rose-200 bg-rose-50 text-rose-700'],
};
export function StatusBadge({ status }) {
  const [label, cls] = STATUS[status] || [status || '—', 'border-slate-200 bg-slate-50 text-slate-600'];
  return <Badge variant="outline" className={cn('font-medium', cls)}>{label}</Badge>;
}

export async function copyText(text, what = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast.success(what); }
  catch { toast.error('Could not copy — select the text and copy it'); }
}

const LOGIN_STATE = {
  valid: ['Works', 'border-emerald-200 bg-emerald-50 text-emerald-700'],
  used_up: ['Sign-ins used up', 'border-slate-200 bg-slate-100 text-slate-600'],
  expired: ['Expired', 'border-slate-200 bg-slate-100 text-slate-600'],
};

/** A message's link: plain links to open; a one-tap login as copy text, with where it stands. */
export function MessageLink({ url, login }) {
  if (!url) return null;
  const masked = url.includes('••••');
  if (!login) {
    return (
      <div className="mt-2 flex min-w-0 items-center gap-1.5 text-xs">
        <Link2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        {masked
          ? <span className="truncate text-slate-500" title="Only whoever may act as this student sees this link">{url}</span>
          : <a href={url} target="_blank" rel="noreferrer noopener" className="truncate text-blue-600 hover:underline">{url}</a>}
      </div>
    );
  }
  const [label, cls] = LOGIN_STATE[login.state] || [login.state, 'border-slate-200 bg-slate-50 text-slate-600'];
  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-700">{login.kind === 'join' ? 'Join link' : 'Sign-in link'}</span>
        <Badge variant="outline" className={cls}>{label}</Badge>
        <span className="text-slate-500">
          {login.signIns ?? 0} of {login.maxSignIns ?? 3} sign-ins used{login.expiresAt ? ` · ${login.state === 'expired' ? 'expired' : 'expires'} ${when(login.expiresAt)}` : ''}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <code className="min-w-0 flex-1 select-all truncate rounded bg-white px-1.5 py-1 text-[11px] text-slate-700">{url}</code>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2" onClick={() => copyText(url, 'Link copied')}><Copy className="h-3.5 w-3.5" /></Button>
      </div>
      <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-800">
        <AlertTriangle className="h-3 w-3" />Opening it signs in as the student{login.kind === 'join' ? ' and marks them joined' : ''} — don't open it yourself.
      </p>
    </div>
  );
}

/** One WhatsApp message the LMS sent, as the student read it. */
export function WhatsAppEntry({ row, showStudent = false, student }) {
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900">{row.label || row.templateName}</span>
          <StatusBadge status={row.status} />
          {showStudent && student}
        </div>
        <span className="text-xs text-slate-500">{when(row.sentAt || row.createdAt)} · to +{String(row.to || '').replace(/^\+/, '')}</span>
      </div>
      {row.text
        ? <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">{row.text}</p>
        : !!row.values?.length && <p className="mt-1.5 text-sm text-slate-600">{row.values.map(v => `${v.name}: ${v.value}`).join(' · ')}</p>}
      {row.error && <p className="mt-1 text-xs text-rose-700">{row.error}{row.attempts > 1 ? ` (${row.attempts} tries)` : ''}</p>}
      <MessageLink url={row.button} login={row.login} />
    </div>
  );
}

/** The links in an email's HTML, each once — what its buttons and links really open. */
export function linksIn(html) {
  if (!html || typeof DOMParser === 'undefined') return [];
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const seen = new Set();
    const out = [];
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href) || seen.has(href)) continue;
      seen.add(href);
      out.push({ href, text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) });
    }
    return out;
  } catch { return []; }
}

/** An email opened as the student got it, and its links listed under it. `load` fetches { subject, html, text, at }. */
export function EmailDialog({ open, title, description, queryKey, load, onClose }) {
  const { data, isLoading, error } = useQuery({ queryKey, queryFn: load, enabled: !!open, retry: false, staleTime: 60_000 });
  const links = useMemo(() => linksIn(data?.html), [data?.html]);
  return (
    <Dialog open={!!open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">{data?.subject || title || 'Email'}</DialogTitle>
          <DialogDescription>{description || (data?.at ? when(data.at) : '')}</DialogDescription>
        </DialogHeader>
        {isLoading ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          : error ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error.message}</p>
          : data?.html ? <iframe title="The email" sandbox="" srcDoc={data.html} className="h-[55vh] w-full rounded-md border bg-white" />
          : <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-md border bg-slate-50 p-3 text-sm">{data?.text || '(empty)'}</pre>}
        {links.length > 0 && (
          <div className="rounded-lg border border-slate-200 p-2">
            <div className="mb-1 text-xs font-semibold text-slate-600">Links in this email</div>
            <ul className="max-h-40 space-y-1 overflow-auto">
              {links.map(l => (
                <li key={l.href} className="flex items-center gap-1.5 text-xs">
                  <code className="min-w-0 flex-1 select-all truncate rounded bg-slate-50 px-1.5 py-1 text-[11px] text-slate-700" title={l.text}>{l.href}</code>
                  <Button type="button" size="sm" variant="outline" className="h-7 px-2" onClick={() => copyText(l.href, 'Link copied')}><Copy className="h-3.5 w-3.5" /></Button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-slate-500">A sign-in or join link in an email signs in as the student — copy it, don't open it.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function useOpen() {
  const [open, setOpen] = useState(null);
  return [open, setOpen, () => setOpen(null)];
}
