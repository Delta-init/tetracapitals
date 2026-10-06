import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Eye, Loader2, Paperclip, Plus, Upload, X } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   Several payments on one request (the user, 2026-10-06), as the sales CRM takes
   them at a close: a student may pay part by card and part in cash, and each
   payment has its own method, amount and receipt. Together they are the
   request's amount, in its one currency.

   A request keeps the list (`payments`: method, amount, currency, receipt_url,
   receipt_name) — and the first payment's method and receipt in payment_method
   and screenshot_url, for whatever reads only one: the filters, the reports, the
   server's bonus check and Delta Finance (which gets every payment in the notes,
   backend/src/finance/funding.ts). A request from before has no list: its one
   method and receipt are its payment.
──────────────────────────────────────────────────────────────────────────── */

/** How money came in: the portal's own, Pay by link (the student paid a payment link), and the sales CRMs' — the user,
 *  2026-10-06. */
export const SALES_CRM_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'Card', 'Easebuzz EMI', 'Tabby', 'Tamara', 'BillExPro'];
export const DEPOSIT_METHODS = ['AED TRANSFER', 'UPI', 'CARD PAYMENT', 'USDT', 'INR TRANSFER', 'Cash deposit', 'Pay by link', ...SALES_CRM_METHODS, 'Other'];
export const MAX_PAYMENTS = 10;

// A row's own id — random, not a counter, so no two rows ever share one (a counter restarts when the module reloads).
const rowId = () => `payment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const newPayment = (over = {}) => ({ id: rowId(), method: '', amount: '', receipt_url: '', receipt_name: '', ...over });
const amountOf = (p) => Math.max(0, Number(p?.amount) || 0);
export const paymentsTotal = (rows) => Math.round(rows.reduce((s, p) => s + amountOf(p), 0) * 100) / 100;

/** What the rows still need, the first thing first — '' once every payment has its method, amount and receipt. */
export function paymentsMissing(rows) {
  const one = rows.length === 1;
  for (const [i, p] of rows.entries()) {
    const its = one ? 'the' : `payment ${i + 1}'s`;
    if (p.uploading) return `Wait for ${its} receipt to finish uploading`;
    if (!p.method) return `Select ${one ? 'the payment' : its} method`;
    if (!(amountOf(p) > 0)) return `Enter ${its} amount`;
    if (!p.receipt_url) return `Upload ${its} receipt`;
  }
  return '';
}

/** The rows as a request keeps them, in its currency. */
export const paymentsToSave = (rows, currency) => rows.map(p => ({
  method: p.method,
  amount: amountOf(p),
  currency,
  receipt_url: p.receipt_url,
  receipt_name: p.receipt_name || '',
}));

/** A request's payments: its list, or — from before there were several — its one method and receipt. */
export function paymentsOf(tx) {
  if (Array.isArray(tx?.payments) && tx.payments.length) return tx.payments;
  return tx?.payment_method || tx?.screenshot_url ? [{ method: tx.payment_method || '', receipt_url: tx.screenshot_url || '' }] : [];
}
/** Its methods, each once: ['CARD PAYMENT', 'Cash deposit']. */
export const methodsOf = (tx) => [...new Set(paymentsOf(tx).map(p => p.method).filter(Boolean))];
/** "CARD PAYMENT + Cash deposit" */
export const methodsText = (tx) => methodsOf(tx).join(' + ');

const fmt = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const amountText = (amount, currency) => (currency === 'USD' ? `$${fmt(amount)}` : `${currency || ''} ${fmt(amount)}`.trim());

/** The payments taken: method · amount · receipt for each, and "Add another payment". */
export function PaymentRows({ rows, onChange, currency, methods = DEPOSIT_METHODS }) {
  const update = (id, patch) => onChange(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
  const attach = async (id, file) => {
    update(id, { uploading: true, upload_error: '' });
    try {
      const res = await base44.integrations.Core.UploadFile({ file });
      update(id, { uploading: false, receipt_url: res.file_url, receipt_name: res.name || file.name });
    } catch (e) {
      update(id, { uploading: false, upload_error: e?.message || 'Could not upload that file' });
    }
  };

  return (
    <div className="space-y-2">
      {rows.map((p, i) => (
        <div key={p.id} className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
          <div className="flex items-center gap-2">
            <span className="w-4 shrink-0 text-xs font-semibold text-slate-400">{i + 1}.</span>
            <Select value={p.method} onValueChange={(v) => update(p.id, { method: v })}>
              <SelectTrigger className="h-9 w-[150px] shrink-0 bg-white text-sm" aria-label={`Payment ${i + 1} method`}>
                <SelectValue placeholder="Paid by…" />
              </SelectTrigger>
              <SelectContent>
                {methods.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="relative min-w-0 flex-1">
              <Input
                type="number" step="0.01" min="0.01" inputMode="decimal"
                value={p.amount}
                onChange={(e) => update(p.id, { amount: e.target.value })}
                placeholder="Amount"
                className="h-9 bg-white pr-12"
                aria-label={`Payment ${i + 1} amount`}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{currency}</span>
            </div>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(prev => prev.filter(x => x.id !== p.id))}
                className="shrink-0 rounded p-1 text-slate-400 hover:text-rose-600"
                aria-label={`Remove payment ${i + 1}`}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {p.receipt_url ? (
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs">
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <a href={p.receipt_url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-blue-700 hover:underline">
                {p.receipt_name || 'Receipt'}
              </a>
              <button type="button" onClick={() => update(p.id, { receipt_url: '', receipt_name: '' })} className="shrink-0 text-slate-500 hover:text-rose-600">
                Replace
              </button>
            </div>
          ) : (
            <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500 hover:border-blue-400 hover:text-slate-700 ${p.uploading ? 'pointer-events-none opacity-60' : ''}`}>
              {p.uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {p.uploading ? 'Uploading…' : "Attach this payment's receipt — photo or PDF"}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                aria-label={`Payment ${i + 1} receipt`}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void attach(p.id, f);
                  e.target.value = '';
                }}
              />
            </label>
          )}
          {p.upload_error && <p className="text-xs text-rose-600">{p.upload_error}</p>}
        </div>
      ))}
      {rows.length < MAX_PAYMENTS && (
        <button
          type="button"
          onClick={() => onChange(prev => [...prev, newPayment()])}
          className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add another payment
        </button>
      )}
    </div>
  );
}

/** One receipt, shown: a photo here, a PDF in its viewer, anything else opened in a new tab. */
function ReceiptPreview({ url }) {
  const [failed, setFailed] = useState(false);
  if (/\.pdf($|\?)/i.test(url)) return <iframe src={url} title="Receipt" className="h-[65vh] w-full rounded-md border" />;
  if (failed) return <p className="text-sm text-gray-500">This receipt cannot be shown here — open it in a new tab.</p>;
  return <img src={url} alt="Receipt" className="max-h-[65vh] w-full rounded-md border object-contain" onError={() => setFailed(true)} />;
}

/** A request's receipts — every payment's — in one viewer, each with its method and amount; `start`: the one to show first. */
export function ReceiptsDialog({ tx, title, start, onClose }) {
  const list = paymentsOf(tx).filter(p => p.receipt_url);
  const [at, setAt] = useState(() => Math.max(0, list.findIndex(p => p.receipt_url === start)));
  const shown = list[Math.min(at, list.length - 1)];
  const label = (p) => [p.method, p.amount > 0 ? amountText(p.amount, p.currency) : ''].filter(Boolean).join(' · ');
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{list.length > 1 ? `Receipts (${list.length})` : 'Receipt'}{title ? ` · ${title}` : ''}</DialogTitle>
        </DialogHeader>
        {list.length > 1 && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {list.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setAt(i)}
                aria-pressed={i === at}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${i === at ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {i + 1}. {label(p) || 'Payment'}
              </button>
            ))}
          </div>
        )}
        {list.length === 1 && label(shown) && <p className="text-sm text-slate-600">{label(shown)}</p>}
        {shown && <ReceiptPreview key={shown.receipt_url} url={shown.receipt_url} />}
        {shown && <a href={shown.receipt_url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">Open in a new tab</a>}
      </DialogContent>
    </Dialog>
  );
}

/** "View" in a list's Receipt column — "View (2)" for two payments — or a dash. */
export function ReceiptsButton({ tx, title }) {
  const [open, setOpen] = useState(false);
  const count = paymentsOf(tx).filter(p => p.receipt_url).length;
  if (!count) return <span className="text-gray-400">-</span>;
  return (
    <>
      <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setOpen(true)}>
        <Eye className="h-3.5 w-3.5" /> View{count > 1 ? ` (${count})` : ''}
      </Button>
      {open && <ReceiptsDialog tx={tx} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The payments, listed — method, amount and receipt each — where a request is looked at closely (the approval). */
export function PaymentsList({ tx }) {
  const [open, setOpen] = useState(null);   // the receipt opened first
  const list = paymentsOf(tx);
  if (!list.length) return null;
  return (
    <div className="space-y-1.5">
      {list.map((p, i) => (
        <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm">
          {list.length > 1 && <span className="text-xs font-semibold text-slate-400">{i + 1}.</span>}
          <span className="font-medium text-slate-800">{p.method || '—'}</span>
          {p.amount > 0 && <span className="text-slate-600">{amountText(p.amount, p.currency)}</span>}
          {p.receipt_url
            ? <button type="button" onClick={() => setOpen(p.receipt_url)} className="ml-auto text-xs font-medium text-blue-600 hover:underline">View receipt</button>
            : <span className="ml-auto text-xs text-slate-400">No receipt</span>}
        </div>
      ))}
      {open && <ReceiptsDialog tx={tx} start={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
