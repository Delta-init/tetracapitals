import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Check, Copy, Landmark, Loader2, Undo2, Upload, User } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   Sent back for correction (the user, 2026-10-12; backend
   functions/fundingCorrections.ts): a broker admin who finds the student's
   email or the MT5 login wrong sends the request back to the CS — it stays
   pending; the CS corrects just that and it goes straight back to MT5
   Approvals, never through finance again.

   Sent back to the CS or to finance (the user, 2026-11-19): the amount and the
   receipt too. A bonus finance approved can go to finance to check its money
   again; a CS who corrects the amount or the receipt of one sends it through
   finance again on the way back.
──────────────────────────────────────────────────────────────────────────── */

export const FIELDS = { email: "Student's email", mt5: 'MT5 login', amount: 'Amount', receipt: 'Receipt', other: 'Something else' };
/** What finance is asked to check again: the money and its proof. */
const FINANCE_FIELDS = ['amount', 'receipt', 'other'];
/** A bonus finance approved, now with the broker admins — one that can go back to finance. */
export const financeApprovedBonus = (tx) =>
  tx?.type === 'BONUS' && !tx?.bonus_credit && tx?.finance_approval?.state === 'decided' && tx?.finance_approval?.decision === 'approved';
/** The amount as the request was typed: its currency and figure. */
const typedOf = (tx) => {
  const currency = ['AED', 'USD', 'INR'].includes(String(tx?.amount_currency || '').toUpperCase()) ? String(tx.amount_currency).toUpperCase() : 'USD';
  const n = Number(tx?.amount_original) > 0 ? Number(tx.amount_original) : currency === 'AED' ? Number(tx?.amount_aed) || 0 : Number(tx?.amount_usd) || 0;
  return { currency, amount: Math.round(n * 100) / 100 };
};
const money = (n, currency) => `${currency === 'USD' ? '$' : `${currency} `}${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

/**
 * The broker admin's "Send back": to the CS / sales who raised it, or — a bonus finance approved — to finance to check
 * its money again (2026-11-19). What is wrong, and a note (finance's always).
 */
export function SendBackDialog({ tx, onClose }) {
  const refresh = useRefresh();
  const canFinance = financeApprovedBonus(tx);
  const [to, setTo] = useState('cs');
  const [fields, setFields] = useState([]);
  const [note, setNote] = useState('');
  const shown = to === 'finance' ? FINANCE_FIELDS : Object.keys(FIELDS);
  const picked = fields.filter(f => shown.includes(f));
  const noteNeeded = to === 'finance' || picked.includes('other');
  const typed = typedOf(tx);
  const save = useMutation({
    mutationFn: async () => (await base44.functions.invoke('sendFundingBack', { id: tx.id, to, fields: picked, note })).data,
    onSuccess: () => {
      toast.success(to === 'finance' ? 'Sent to finance to check again' : 'Sent back to the CS to correct');
      refresh(); onClose();
    },
    onError: (e) => toast.error(e?.message || "Couldn't send it back"),
  });
  const toggle = (f) => setFields(fs => (fs.includes(f) ? fs.filter(x => x !== f) : [...fs, f]));
  const option = (key, Icon, title, sub) => (
    <button type="button" onClick={() => setTo(key)} aria-pressed={to === key}
      className={`rounded-lg border px-3 py-2 text-left text-xs ${to === key ? 'border-brand-navy bg-brand-navy/5 ring-1 ring-brand-navy' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
      <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800"><Icon className="h-4 w-4" />{title}</span>
      <span className="text-slate-500">{sub}</span>
    </button>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send back</DialogTitle>
          <DialogDescription>
            {tx.student?.full_name || tx.student_name} · {tx.type} {money(typed.amount, typed.currency)}{canFinance ? ' · approved by finance' : ''} — not rejected: it stays pending.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <p className="mb-1.5 font-medium">Send to</p>
            <div className={`grid gap-2 ${canFinance ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {option('cs', User, 'CS / sales who raised it', 'Email, MT5, amount, receipt')}
              {canFinance && option('finance', Landmark, 'Finance', 'Check the payment again')}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {to === 'finance'
              ? <>Finance takes its payment back off the invoice, checks it against the receipt — at a corrected amount if need be — and it comes back here when they approve it.</>
              : <>Email now: <b>{tx.student?.email || '—'}</b> · MT5 now: <b className="font-mono">{tx.mt5_login || '—'}</b>{canFinance ? ' · a new amount or receipt from the CS goes through finance again' : ''}</>}
          </div>
          <div>
            <p className="mb-1.5 font-medium">{to === 'finance' ? 'What should finance check?' : 'What is wrong?'}</p>
            <div className="flex flex-wrap gap-2">
              {shown.map((k) => (
                <button key={k} type="button" onClick={() => toggle(k)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${picked.includes(k) ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{FIELDS[k]}</button>
              ))}
            </div>
          </div>
          <label className="block">Note for {to === 'finance' ? 'finance' : 'the CS'}{noteNeeded ? ' *' : ' (optional)'}
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1"
              placeholder={to === 'finance' ? 'The receipt shows AED 4,500, not 2,250' : 'The MT5 account is registered to a different email'} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!picked.length || (noteNeeded && !note.trim()) || save.isPending}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : to === 'finance' ? <Landmark className="mr-2 h-4 w-4" /> : <Undo2 className="mr-2 h-4 w-4" />}
            {to === 'finance' ? 'Send to finance' : 'Send back to CS'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The CS's correction — then straight back to MT5 Approvals. The student's email and the MT5 login are always there
 * to change, whatever was ticked (the user, 2026-10-28: an email typed into the note was never saved); what was sent
 * back is marked. Only a box that was changed is sent.
 */
function CorrectDialog({ tx, email, onClose }) {
  const refresh = useRefresh();
  const asks = tx.returned?.fields || [];
  const typed = typedOf(tx);
  const several = Array.isArray(tx.payments) && tx.payments.length > 1;
  const start = { email: email || tx.returned?.email || '', mt5: tx.mt5_login || '', amount: typed.amount ? String(typed.amount) : '' };
  const [form, setForm] = useState({ ...start, note: '' });
  const [receipt, setReceipt] = useState(null);
  const [uploading, setUploading] = useState(false);
  const emailChanged = form.email.trim().toLowerCase() !== start.email.trim().toLowerCase() && form.email.trim() !== '';
  const mt5Changed = form.mt5.trim() !== String(start.mt5).trim() && form.mt5.trim() !== '';
  const amountNum = Number(String(form.amount).replace(/,/g, ''));
  const amountChanged = form.amount.trim() !== '' && Math.round(amountNum * 100) !== Math.round(typed.amount * 100);
  const amountBad = amountChanged && !(amountNum > 0);
  // A new amount or receipt on a bonus finance approved: finance checks it again before it comes back (2026-11-19).
  const toFinance = financeApprovedBonus(tx) && (amountChanged || !!receipt);
  // An email in the note that isn't in the email box: likely meant for it.
  const noteEmail = (form.note.match(/[^\s,;<>()"“”]+@[^\s,;<>()"“”]+\.[a-z]{2,}/i) || [])[0];
  const missedEmail = noteEmail && noteEmail.toLowerCase() !== form.email.trim().toLowerCase() ? noteEmail : null;
  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setReceipt({ url: file_url, name: file.name });
    } catch (e) {
      toast.error(e?.message || "Couldn't upload the receipt");
    } finally {
      setUploading(false);
    }
  };
  const save = useMutation({
    mutationFn: async () => (await base44.functions.invoke('correctFundingRequest', {
      id: tx.id, note: form.note,
      ...(emailChanged ? { email: form.email } : {}),
      ...(mt5Changed ? { mt5Login: form.mt5 } : {}),
      ...(amountChanged ? { amount: amountNum } : {}),
      ...(receipt ? { receiptUrl: receipt.url, receiptName: receipt.name } : {}),
    })).data,
    onSuccess: (d) => { toast.success(d?.with_finance ? 'Corrected — with finance to check again' : 'Corrected — back with the broker admin'); refresh(); onClose(); },
    onError: (e) => toast.error(e?.message || "Couldn't save the correction"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Correct and send back</DialogTitle>
          <DialogDescription>
            {tx.returned?.by_name} sent it back: {asks.map(f => FIELDS[f]?.toLowerCase() || f).join(', ')}{tx.returned?.note ? ` — “${tx.returned.note}”` : ''}.{' '}
            {financeApprovedBonus(tx)
              ? 'An email or MT5 fix goes straight back to them; a new amount or receipt goes to finance to check again first.'
              : 'It goes straight back to them, not through finance.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block">Student's email{asks.includes('email') && <span className="ml-1 text-xs font-medium text-rose-600">sent back</span>}
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`mt-1 ${asks.includes('email') ? 'border-rose-300' : ''}`} />
            <span className="text-xs text-slate-500">{emailChanged ? 'Will be saved on the student — as Edit details saves it.' : 'Change it here if it is wrong — not in the note.'}</span>
          </label>
          <label className="block">MT5 login{asks.includes('mt5') && <span className="ml-1 text-xs font-medium text-rose-600">sent back</span>}
            <Input inputMode="numeric" value={form.mt5} onChange={(e) => setForm({ ...form, mt5: e.target.value })} className={`mt-1 font-mono ${asks.includes('mt5') ? 'border-rose-300' : ''}`} />
          </label>
          {several ? (
            <p className="rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
              Paid in {tx.payments.length} payments — their amounts and receipts can't be changed here. Ask the broker admin to send it to finance.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">Amount ({typed.currency}){asks.includes('amount') && <span className="ml-1 text-xs font-medium text-rose-600">sent back</span>}
                <Input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className={`mt-1 ${asks.includes('amount') ? 'border-rose-300' : ''} ${amountBad ? 'border-rose-500' : ''}`} />
                <span className={`text-xs ${amountBad ? 'text-rose-600' : 'text-slate-500'}`}>
                  {amountBad ? 'A number above 0' : amountChanged ? `Was ${money(typed.amount, typed.currency)}` : 'As the receipt shows'}
                </span>
              </label>
              <div>
                <p>Receipt{asks.includes('receipt') && <span className="ml-1 text-xs font-medium text-rose-600">sent back</span>}</p>
                <label className={`mt-1 flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2 text-xs ${asks.includes('receipt') ? 'border-rose-300' : 'border-slate-200'} hover:bg-slate-50`}>
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  <span className="truncate">{receipt ? receipt.name : 'Replace'}</span>
                  <input type="file" accept="image/*,application/pdf" className="hidden" disabled={uploading} onChange={(e) => upload(e.target.files?.[0])} />
                </label>
                {tx.screenshot_url && !receipt && (
                  <a href={tx.screenshot_url} target="_blank" rel="noreferrer" className="text-xs text-brand-navy underline">Current receipt</a>
                )}
              </div>
            </div>
          )}
          {toFinance && (
            <p className="rounded-md bg-sky-50 px-2.5 py-1.5 text-xs text-sky-800">
              <Landmark className="mr-1 inline h-3.5 w-3.5" />A new amount or receipt goes to Delta Finance to check again, then back to the broker admin.
            </p>
          )}
          <label className="block">Note{asks.length === 1 && asks[0] === 'other' ? ' *' : ' (optional)'}
            <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="mt-1" placeholder="Why it is right, or what else you changed" />
          </label>
          {missedEmail && (
            <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
              The note has {missedEmail} — a note isn't saved on the student.{' '}
              <button type="button" className="font-semibold underline" onClick={() => setForm({ ...form, email: missedEmail })}>Use it as the email</button>
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || uploading || amountBad}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{toFinance ? 'Send to finance' : 'Send to broker admin'}
          </Button>
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
      <div className={`${compact ? 'mt-1' : 'mt-1.5'} rounded-md border border-rose-300 bg-rose-50 px-2 py-1.5 text-xs text-rose-800`}>
        <div className="font-medium">Sent back by {tx.returned.by_name} · {when(tx.returned.at)}</div>
        <div>{(tx.returned.fields || []).map(f => FIELDS[f] || f).join(', ')} {tx.returned.note ? `— “${tx.returned.note}”` : 'looks wrong'}</div>
        <Button size="sm" className="mt-1 h-7 bg-rose-600 px-2 text-xs hover:bg-rose-700" onClick={() => setOpen(true)}>Correct</Button>
        {open && <CorrectDialog tx={tx} email={email} onClose={() => setOpen(false)} />}
      </div>
    );
  }
  // With finance to check again (2026-11-19): nothing for the CS to do unless finance sends it to them.
  if (tx.rechecking?.at) {
    return (
      <div className={`${compact ? 'mt-1' : 'mt-1.5'} rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs text-sky-800`}>
        <div className="font-medium"><Landmark className="mr-1 inline h-3.5 w-3.5" />With finance to check again</div>
        <div>
          {tx.rechecking.from === 'cs' ? `Corrected by ${tx.rechecking.by_name}` : `Sent by ${tx.rechecking.by_name}`} · {when(tx.rechecking.at)}
          {(tx.rechecking.fields || []).length ? ` — ${(tx.rechecking.fields || []).map(f => FIELDS[f] || f).join(', ')}` : ''}
          {tx.rechecking.note ? `: “${tx.rechecking.note}”` : ''}
        </div>
      </div>
    );
  }
  if (tx.corrected?.at) return <div className="mt-1 text-xs text-emerald-700">Corrected by {tx.corrected.by_name} · back with the broker admin</div>;
  return null;
}

/** On MT5 Approvals' Sent back tab: where it went and why (the CS, or finance to check again). */
export function SentBackCell({ tx }) {
  if (tx?.rechecking?.at) {
    return (
      <div className="text-xs">
        <div className="text-sky-700"><Landmark className="mr-1 inline h-3.5 w-3.5" />With finance · sent {when(tx.rechecking.at)} by {tx.rechecking.by_name}{tx.rechecking.from === 'cs' ? ' (CS correction)' : ''}</div>
        <div className="text-slate-500">{(tx.rechecking.fields || []).map(f => FIELDS[f] || f).join(', ')}{tx.rechecking.note ? ` — “${tx.rechecking.note}”` : ''}</div>
      </div>
    );
  }
  return (
    <div className="text-xs">
      <div className="text-orange-700">Sent back to the CS {when(tx?.returned?.at)} by {tx?.returned?.by_name}</div>
      <div className="text-slate-500">{(tx?.returned?.fields || []).map(f => FIELDS[f] || f).join(', ')}{tx?.returned?.note ? ` — “${tx.returned.note}”` : ''}</div>
    </div>
  );
}
