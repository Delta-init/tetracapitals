import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Check, Copy, Loader2, Undo2 } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   Sent back for correction (the user, 2026-10-12; backend
   functions/fundingCorrections.ts): a broker admin who finds the student's
   email or the MT5 login wrong sends the request back to the CS — it stays
   pending; the CS corrects just that and it goes straight back to MT5
   Approvals, never through finance again.
──────────────────────────────────────────────────────────────────────────── */

export const FIELDS = { email: "Student's email", mt5: 'MT5 login', other: 'Something else' };
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

function useRefresh() {
  const qc = useQueryClient();
  return () => ['bonus-approvals', 'nav-counts', 'funding-transactions', 'students', 'my-funding-requests'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
}

/** A value with a copy button — the student's email on MT5 Approvals. */
export function CopyText({ text, className = '' }) {
  const [done, setDone] = useState(false);
  if (!text) return <span className={`text-xs text-rose-600 ${className}`}>No email</span>;
  return (
    <span className={`inline-flex max-w-[240px] items-center gap-1 text-xs text-slate-600 ${className}`}>
      <span className="truncate" title={text}>{text}</span>
      <button type="button" title="Copy" className="text-slate-400 hover:text-slate-700"
        onClick={async (e) => { e.preventDefault(); e.stopPropagation(); try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ } }}>
        {done ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

/** The broker admin's "Send back to CS": what is wrong, and a note. */
export function SendBackDialog({ tx, onClose }) {
  const refresh = useRefresh();
  const [fields, setFields] = useState([]);
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: async () => (await base44.functions.invoke('sendFundingBack', { id: tx.id, fields, note })).data,
    onSuccess: () => { toast.success('Sent back to the CS to correct'); refresh(); onClose(); },
    onError: (e) => toast.error(e?.message || "Couldn't send it back"),
  });
  const toggle = (f) => setFields(fs => (fs.includes(f) ? fs.filter(x => x !== f) : [...fs, f]));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send back to the CS</DialogTitle>
          <DialogDescription>
            {tx.student?.full_name || tx.student_name} · {tx.type} ${Number(tx.amount_usd || 0).toLocaleString('en-US')} — not rejected: it stays pending, the CS corrects it and it comes straight back here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Email now: <b>{tx.student?.email || '—'}</b> · MT5 now: <b className="font-mono">{tx.mt5_login || '—'}</b>
          </div>
          <div>
            <p className="mb-1.5 font-medium">What is wrong?</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(FIELDS).map(([k, l]) => (
                <button key={k} type="button" onClick={() => toggle(k)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${fields.includes(k) ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>
              ))}
            </div>
          </div>
          <label className="block">Note for the CS{fields.includes('other') ? ' *' : ' (optional)'}
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1" placeholder="e.g. The MT5 account is registered to a different email" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!fields.length || (fields.includes('other') && !note.trim()) || save.isPending}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}Send back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The CS's correction: only what was sent back — then straight back to MT5 Approvals. */
function CorrectDialog({ tx, email, onClose }) {
  const refresh = useRefresh();
  const asks = tx.returned?.fields || [];
  const [form, setForm] = useState({ email: email || tx.returned?.email || '', mt5: tx.mt5_login || '', note: '' });
  const save = useMutation({
    mutationFn: async () => (await base44.functions.invoke('correctFundingRequest', {
      id: tx.id, note: form.note,
      ...(asks.includes('email') ? { email: form.email } : {}),
      ...(asks.includes('mt5') ? { mt5Login: form.mt5 } : {}),
    })).data,
    onSuccess: () => { toast.success('Corrected — back with the broker admin'); refresh(); onClose(); },
    onError: (e) => toast.error(e?.message || "Couldn't save the correction"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Correct and send back</DialogTitle>
          <DialogDescription>
            {tx.returned?.by_name} sent it back: {asks.map(f => FIELDS[f]?.toLowerCase() || f).join(', ')}{tx.returned?.note ? ` — “${tx.returned.note}”` : ''}. It goes straight back to them, not through finance.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {asks.includes('email') && (
            <label className="block">Student's email
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1" />
              <span className="text-xs text-slate-500">Saved on the student — as Edit details saves it.</span>
            </label>
          )}
          {asks.includes('mt5') && (
            <label className="block">MT5 login
              <Input inputMode="numeric" value={form.mt5} onChange={(e) => setForm({ ...form, mt5: e.target.value })} className="mt-1 font-mono" />
            </label>
          )}
          <label className="block">Note{asks.length === 1 && asks[0] === 'other' ? ' *' : ' (optional)'}
            <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="mt-1" placeholder="What you changed, or why it is right" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send to broker admin</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** On the CS's lists: "Sent back by … — Correct", or "Corrected by …" once done. `email`: the student's, to prefill. */
export function SentBackNotice({ tx, email, compact = false }) {
  const [open, setOpen] = useState(false);
  if (tx?.status !== 'PENDING') return null;
  if (tx.returned?.at) {
    return (
      <div className={`${compact ? 'mt-1' : 'mt-1.5'} rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800`}>
        <div className="font-medium">Sent back by {tx.returned.by_name} · {when(tx.returned.at)}</div>
        <div>{(tx.returned.fields || []).map(f => FIELDS[f] || f).join(', ')} {tx.returned.note ? `— “${tx.returned.note}”` : 'looks wrong'}</div>
        <Button size="sm" variant="outline" className="mt-1 h-7 px-2 text-xs" onClick={() => setOpen(true)}>Correct</Button>
        {open && <CorrectDialog tx={tx} email={email} onClose={() => setOpen(false)} />}
      </div>
    );
  }
  if (tx.corrected?.at) return <div className="mt-1 text-xs text-emerald-700">Corrected by {tx.corrected.by_name} · back with the broker admin</div>;
  return null;
}
