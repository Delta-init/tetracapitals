import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ExternalLink, Loader2, Paperclip, Send, Upload } from 'lucide-react';
import { Mt5LoginField, MT5_LOGIN, mt5LoginOf } from '@/components/students/mt5Accounts';

/* ────────────────────────────────────────────────────────────────────────────
   "Bonus pending" (the user, 2026-10-10; backend/src/students/bonusPending.ts): a student with a bonus not decided
   yet, its amount in USD, and where it waits —
     Needs call + MT5           promised at the sales close, not sent yet: it goes to be credited once a call that
                                connected is logged with their MT5;
     With finance               Delta finance is approving the payment;
     Waiting for broker admin   a broker admin or a Super Admin credits it in MT5 and approves it: finance approved
                                it, or it is a sales-close / course-upgrade bonus credit, or finance doesn't have it.
   Several: their count and total, and the earliest stage (needs a call, then with finance, then the broker admin); the tooltip says
   how many are where. On the Students tables, the student page and the export.
   "Needs call + MT5" opens "Send bonus for credit" (the user, 2026-10-12; backend functions/salesBonusSend.ts): the
   bonus, what finance sent for its invoice (receipts, collected), the MT5 to credit — Send puts it on MT5 Approvals
   for the broker admin, no call needed. An invoice finance sent no receipt for needs one uploaded.
──────────────────────────────────────────────────────────────────────────── */

export const BONUS_STAGES = {
  sent_back: { label: 'Sent back — correct it', cls: 'border-rose-300 bg-rose-100 text-rose-800', note: 'Sent back to the CS to correct (by a broker admin or by accounts) — it waits for the correction, not for a broker admin' },
  // Its course still owes: the sales bonus waits for the full payment (the user, 2026-10-17).
  after_payment: { label: 'After full payment', cls: 'border-violet-200 bg-violet-50 text-violet-800', note: 'Promised at the sales close, but the course is not paid in full yet — the bonus is sent, and approved, once the balance is paid' },
  needs_call: { label: 'Needs call + MT5', cls: 'border-rose-200 bg-rose-50 text-rose-800', note: 'Promised at the sales close — it goes to be credited once a call that connected is logged with their MT5' },
  with_finance: { label: 'With finance', cls: 'border-sky-200 bg-sky-50 text-sky-800', note: 'Delta finance is approving the payment' },
  waiting_broker: { label: 'Waiting for broker admin', cls: 'border-amber-200 bg-amber-50 text-amber-800', note: 'A broker admin or a Super Admin credits it in MT5 and approves it' },
};
const STAGE_KEYS = ['sent_back', 'after_payment', 'needs_call', 'with_finance', 'waiting_broker'];

const usd = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** "1 with finance ($500), 2 waiting for broker admin ($1,000)" */
const breakdown = (b) => STAGE_KEYS
  .filter(k => b?.[k]?.count)
  .map(k => `${b[k].count} ${BONUS_STAGES[k].label.toLowerCase()} (${usd(b[k].total_usd)})`)
  .join(', ');

/** For the export: "$500 · With finance" — several: "2 bonuses · $800 · 1 with finance ($500), 1 waiting for broker admin ($300)". */
export function bonusPendingText(b) {
  if (!b?.count) return '';
  if (b.count === 1) return `${usd(b.total_usd)} · ${(BONUS_STAGES[b.stage] || BONUS_STAGES.waiting_broker).label}`;
  return `${b.count} bonuses · ${usd(b.total_usd)} · ${breakdown(b)}`;
}

/**
 * The badge: "Bonus pending $500 · With finance" — nothing for a student with none. `onClick` makes it a button;
 * with `student` ({ id, full_name }), "Needs call + MT5" opens Send bonus for credit instead.
 */
export function BonusPendingBadge({ info, className = '', onClick, student }) {
  const [sending, setSending] = useState(false);
  if (!info?.count) return null;
  const stage = BONUS_STAGES[info.stage] || BONUS_STAGES.waiting_broker;
  const canSend = !!student?.id && info.needs_call?.count > 0;
  let since = '';
  try { since = info.since ? format(new Date(info.since), 'd MMM yyyy') : ''; } catch { since = ''; }
  const title = [
    `${info.count === 1 ? 'A bonus' : `${info.count} bonuses`} not decided yet — ${usd(info.total_usd)}`,
    info.count === 1 ? stage.note : breakdown(info),
    since ? `${info.count === 1 ? 'since' : 'the oldest since'} ${since}` : '',
    canSend ? 'Click to send it for credit with their MT5' : '',
  ].filter(Boolean).join(' · ');
  const cls = `inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 align-middle text-[11px] font-semibold ${stage.cls} ${className}`;
  const body = (
    <>
      <span>Bonus pending {usd(info.total_usd)}{info.count > 1 ? ` (${info.count})` : ''}</span>
      <span className="font-normal opacity-80">· {stage.label}</span>
      {canSend && <Send className="h-3 w-3" />}
    </>
  );
  const click = canSend ? (e) => { e.preventDefault(); e.stopPropagation(); setSending(true); } : onClick;
  return (
    // A table row behind it opens the student: clicks in here stay here.
    <span className="contents" onClick={canSend ? (e) => e.stopPropagation() : undefined}>
      {click
        ? <button type="button" title={title} onClick={click} className={`${cls} hover:brightness-95`}>{body}</button>
        : <span title={title} className={cls}>{body}</span>}
      {sending && <SendSalesBonusDialog student={student} onClose={() => setSending(false)} />}
    </span>
  );
}

const money = (n, cur) => (n == null ? '—' : cur === 'USD' || !cur ? usd(n) : `${cur} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);

/** Bonuses held until their course is paid in full (2026-10-17): what is left to pay on each. */
function AfterPayment({ list }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
      <p className="font-medium">The sales bonus is sent once the course is paid in full.</p>
      {list.map(b => (
        <p key={b.invoice_id} className="text-xs">
          {b.course || 'Course'}{b.invoice_number ? ` · ${b.invoice_number}` : ''} — {money(b.amount, b.currency)} bonus · <b>{b.owed}</b> still owed
        </p>
      ))}
    </div>
  );
}

/** Send bonus for credit: the bonus, what finance sent, the MT5 — and a receipt where finance sent none. */
function SendSalesBonusDialog({ student, onClose }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['sales-bonus-to-send', student.id],
    queryFn: async () => (await base44.functions.invoke('getSalesBonusToSend', { studentId: student.id })).data,
    retry: false,
  });
  const [mt5, setMt5] = useState('');
  const [uploads, setUploads] = useState({});   // invoice_id → { url, name } | { uploading } | { error }
  const [busy, setBusy] = useState(false);
  const bonuses = data?.bonuses || [];
  const needs = bonuses.filter(b => !b.receipts?.length);
  const missing = needs.filter(b => !uploads[b.invoice_id]?.url);
  const login = mt5LoginOf(mt5);
  const upload = async (b, file) => {
    if (!file) return;
    setUploads(u => ({ ...u, [b.invoice_id]: { uploading: true } }));
    try {
      const res = await base44.integrations.Core.UploadFile({ file });
      setUploads(u => ({ ...u, [b.invoice_id]: { url: res.file_url, name: res.name || file.name } }));
    } catch (e) {
      setUploads(u => ({ ...u, [b.invoice_id]: { error: e?.message || 'Could not upload that file' } }));
    }
  };
  const send = async () => {
    setBusy(true);
    try {
      const receipts = Object.fromEntries(Object.entries(uploads).filter(([, v]) => v?.url).map(([k, v]) => [k, { url: v.url, name: v.name }]));
      const r = (await base44.functions.invoke('sendSalesBonusCredit', { studentId: student.id, mt5Login: login, receipts })).data;
      toast.success(`${r?.sent > 1 ? `${r.sent} bonuses` : 'Bonus'} sent for credit in MT5 ${login} — now with the broker admin`);
      ['students', 'funding-transactions', 'bonus-approvals', 'nav-counts', 'mt5-accounts', 'student-mt5'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e) {
      toast.error(/unknown function|not found|404/i.test(String(e?.message)) ? 'This needs the server update (the API deploy)' : (e?.message || "Couldn't send it"));
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send bonus for credit</DialogTitle>
          <DialogDescription>
            {student.full_name} — promised at the sales close. Send puts it on MT5 Approvals for the broker admin to credit; no call needed.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Getting what finance sent…</div>
        ) : error ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(error?.message)) ? 'This needs the server update (the API deploy).' : error.message}</p>
        ) : !bonuses.length ? (
          data?.after_payment?.length ? <AfterPayment list={data.after_payment} /> : <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">Nothing is waiting — it was sent already.</p>
        ) : (
          <div className="space-y-3 text-sm">
            {data?.after_payment?.length > 0 && <AfterPayment list={data.after_payment} />}
            {bonuses.map(b => {
              const up = uploads[b.invoice_id];
              return (
                <div key={b.invoice_id} className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-slate-900">{b.course || 'Course'}</div>
                      <div className="text-xs text-slate-500">{b.invoice_number ? `Invoice ${b.invoice_number}` : 'From finance'}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-emerald-700">{money(b.amount, b.currency)}</div>
                      <div className="text-[11px] text-slate-500">{b.currency === 'USD' ? `AED ${Number(b.aed).toLocaleString('en-US')}` : usd(b.usd)}</div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
                    <div>Collected by the counsellor: <b>{money(b.collected, b.fee_currency)}</b>{b.collected_method ? ` · ${b.collected_method}` : ''}{b.total ? ` of ${money(b.total, b.fee_currency)}` : ''}</div>
                    {b.payments?.length > 0 && (
                      <div className="mt-0.5">{b.payments.map((p, i) => `${i + 1}. ${p.method || 'Payment'} ${money(p.amount, b.fee_currency)}${p.paid_on ? ` on ${p.paid_on}` : ''}`).join(' · ')}</div>
                    )}
                  </div>
                  {b.receipts?.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {b.receipts.map(r => (
                        <a key={r.url} href={r.url} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50">
                          <ExternalLink className="h-3 w-3" /> {r.label}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-rose-700">Finance sent no receipt for this — upload it (required)</p>
                      <label className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs ${up?.url ? 'border-emerald-300 text-emerald-700' : 'border-rose-300 text-rose-700'} hover:bg-slate-50`}>
                        {up?.uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : up?.url ? <Paperclip className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
                        {up?.uploading ? 'Uploading…' : up?.url ? `${up.name || 'Receipt'} — replace` : 'Attach the payment receipt — photo or PDF'}
                        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => upload(b, e.target.files?.[0])} />
                      </label>
                      {up?.error && <p className="text-xs text-rose-600">{up.error}</p>}
                    </div>
                  )}
                </div>
              );
            })}
            <Mt5LoginField studentId={student.id} value={mt5} onChange={setMt5} id="send-bonus-mt5"
              label="MT5 login to credit *" newNote="saved to their page" />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={send} disabled={busy || !bonuses.length || !MT5_LOGIN.test(login) || missing.length > 0 || needs.some(b => uploads[b.invoice_id]?.uploading)}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send for credit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One student's pending bonuses, for their page (getStudentBonusPending) — refreshed with their funding requests. */
export function useStudentBonusPending(studentId, enabled = true) {
  return useQuery({
    queryKey: ['funding-transactions', studentId, 'bonus-pending'],
    queryFn: async () => (await base44.functions.invoke('getStudentBonusPending', { studentId })).data?.bonus_pending ?? null,
    enabled: !!studentId && enabled,
    retry: false,
  });
}
