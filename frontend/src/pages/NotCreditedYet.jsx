import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import PageHeader from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, CheckCircle2, ExternalLink, FileSpreadsheet, Loader2, Plus, Search, XCircle } from 'lucide-react';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { downloadExcel } from '@/components/utils/excelExport';
import { ReceiptsButton } from '@/components/funding/payments';
import { RaiseCreditRequestDialog, RAISERS } from '@/components/funding/CreditRequests';

/* ────────────────────────────────────────────────────────────────────────────
   Not Credited Yet (the user, 2026-10-13; backend functions/creditRequests.ts):
   a student's bonus still not in their MT5, raised by a CS, CS Manager or
   Super Admin. Broker admins (and Super Admins) answer it — Credited (with the
   transaction ID), Already credited (when / where) or Reject (why); a linked
   bonus request still waiting on MT5 Approvals is approved with it. Whoever
   raised it and the student's CS are told. A CS sees their own students' and
   the ones they raised; everyone else here sees them all.
──────────────────────────────────────────────────────────────────────────── */

const TABS = [
  { key: 'open', label: 'Open', cls: 'border-amber-300 bg-amber-50 text-amber-800' },
  { key: 'credited', label: 'Credited', cls: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  { key: 'already_credited', label: 'Already credited', cls: 'border-teal-300 bg-teal-50 text-teal-700' },
  { key: 'rejected', label: 'Rejected', cls: 'border-rose-300 bg-rose-50 text-rose-700' },
];
const money = (n, cur) => (cur === 'AED' ? `AED ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const dubaiStart = (day, plus = 0) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return undefined; const d = new Date(`${day}T00:00:00+04:00`); d.setUTCDate(d.getUTCDate() + plus); return d.toISOString(); };
const why = (e) => (/unknown function|not found|404/i.test(String(e?.message)) ? 'This page needs the server update (the API deploy).' : e?.message);

export default function NotCreditedYet() {
  const qc = useQueryClient();
  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const [tab, setTab] = useState('open');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [raising, setRaising] = useState(false);
  const [deciding, setDeciding] = useState(null);   // { row, action }
  const [exporting, setExporting] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const body = { status: tab, search: q, from: dubaiStart(from), to: dubaiStart(to, 1) };
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['credit-requests', tab, q, from, to],
    queryFn: async () => (await base44.functions.invoke('listCreditRequests', body)).data,
    enabled: !!currentUser,
    placeholderData: (p) => p,
    retry: false,
  });
  const rows = data?.rows || [];
  const mayDecide = !!data?.may_decide;
  const mayRaise = RAISERS.includes(currentUser?.app_role);
  const refresh = () => ['credit-requests', 'nav-counts', 'bonus-approvals', 'funding-transactions'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));

  const exportExcel = async () => {
    setExporting(true);
    try {
      const all = (await base44.functions.invoke('listCreditRequests', body)).data?.rows || [];
      await downloadExcel({
        fileName: `not_credited_yet_${tab}_${new Date().toISOString().slice(0, 10)}.xlsx`, sheet: 'Not credited yet',
        columns: [
          { header: 'Raised', type: 'datetime' }, { header: 'Student' }, { header: 'Code' }, { header: 'CS' }, { header: 'Team' }, { header: 'MT5' },
          { header: 'Amount', type: 'number' }, { header: 'Currency' }, { header: 'USD', type: 'number' }, { header: 'Bonus request' }, { header: 'Raised by' }, { header: 'What is missing', width: 50 },
          { header: 'Status' }, { header: 'Answered by' }, { header: 'Answered', type: 'datetime' }, { header: 'Transaction ID' }, { header: 'Note / reason', width: 40 },
        ],
        rows: all.map(r => [r.raised_at, r.student_name, r.student_code, r.cs_name, r.team_name, r.mt5_login, r.amount, r.currency, r.amount_usd,
          r.funding_tx ? `${r.funding_tx.status} ${money(r.funding_tx.amount_usd)} ${String(r.funding_tx.requested_at || '').slice(0, 10)}` : '', r.raised_by_name, r.note,
          TABS.find(t => t.key === r.status)?.label || r.status, r.decided?.by_name || '', r.decided?.at || null, r.decided?.transaction_id || '', r.decided?.note || r.decided?.reason || '']),
      });
    } catch (e) {
      toast.error(e?.message || 'Could not make the Excel file');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <PageHeader eyebrow="Funding" title="Not Credited Yet" icon={AlertTriangle}
          description={mayDecide
            ? 'Bonuses a CS says are still not in the student\'s MT5. Credit it and give the transaction ID, say it was already credited, or reject it — they are told either way.'
            : 'Bonuses you told the broker admins are still not in the student\'s MT5, and what they answered.'}
          actions={<div className="flex gap-2">
            {mayRaise && <Button onClick={() => setRaising(true)}><Plus className="mr-1.5 h-4 w-4" />Bonus not credited</Button>}
            <Button variant="outline" onClick={exportExcel} disabled={exporting || !rows.length}>{exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}Excel</Button>
          </div>} />

        <div className="flex flex-wrap items-center gap-2">
          {TABS.map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`rounded-full border px-3 py-1 text-sm ${tab === t.key ? t.cls + ' font-semibold' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
              {t.label} <span className="tabular-nums opacity-70">{data?.counts?.[t.key] ?? ''}</span>
            </button>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Student, MT5, CS, transaction…" className="h-9 w-64 pl-8" />
            </div>
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[140px] text-xs" aria-label="From" />
            <span className="text-xs text-slate-500">to</span>
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9 w-[140px] text-xs" aria-label="To" />
          </div>
        </div>

        <Card className="border-gray-200">
          <CardContent className="p-0">
            {error ? <p className="m-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{why(error)}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Raised</th>
                      <th className="px-4 py-3 font-semibold">Student</th>
                      <th className="px-4 py-3 font-semibold">MT5</th>
                      <th className="px-4 py-3 text-right font-semibold">Bonus</th>
                      <th className="px-4 py-3 font-semibold">Bonus request</th>
                      <th className="px-4 py-3 font-semibold">What is missing</th>
                      <th className="px-4 py-3 font-semibold">{tab === 'open' ? '' : 'Answer'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {isLoading && <tr><td colSpan={7} className="px-4 py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-gray-400" /></td></tr>}
                    {!isLoading && !rows.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">{tab === 'open' ? 'Nothing is waiting.' : 'None here.'}</td></tr>}
                    {rows.map(r => (
                      <tr key={r.id} className="align-top">
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{when(r.raised_at)}<div className="text-slate-400">by {r.raised_by_name}</div></td>
                        <td className="min-w-[180px] px-4 py-3">
                          <Link to={`${createPageUrl('StudentDetail')}?id=${r.student_id}`} className="font-medium text-blue-700 hover:underline">{r.student_name || '—'}</Link>
                          <div className="text-xs text-slate-500">{[r.student_code, r.cs_name, r.team_name].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-sm">{r.mt5_login}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">{money(r.amount, r.currency)}{r.currency !== 'USD' && <div className="text-xs font-normal text-slate-500">{money(r.amount_usd)}</div>}</td>
                        <td className="min-w-[170px] px-4 py-3 text-xs">
                          {r.funding_tx ? (
                            <div className="space-y-0.5">
                              <div><span className="font-medium">{money(r.funding_tx.amount_usd)}</span> · {r.funding_tx.status.toLowerCase()}{r.funding_tx.with_finance ? ' (with finance)' : ''}</div>
                              <div className="text-slate-500">{String(r.funding_tx.requested_at || '').slice(0, 10)}{r.funding_tx.course ? ` · ${r.funding_tx.course}` : ''}{r.funding_tx.bonus_credit === 'sales_close' ? ' · sales close' : ''}</div>
                              {r.funding_tx.transaction_id && <div className="font-mono text-slate-500">{r.funding_tx.transaction_id}</div>}
                              <ReceiptsButton tx={r.funding_tx} title={r.student_name} />
                            </div>
                          ) : <span className="text-slate-400">None raised</span>}
                        </td>
                        <td className="min-w-[220px] max-w-[320px] px-4 py-3 text-xs text-slate-700">
                          {r.note}
                          {r.screenshot_url && <a href={r.screenshot_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-blue-700 hover:underline"><ExternalLink className="h-3 w-3" />Screenshot</a>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs">
                          {r.status === 'open' ? (
                            mayDecide ? (
                              <div className="flex flex-col items-stretch gap-1.5">
                                <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700" onClick={() => setDeciding({ row: r, action: 'credited' })}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Credited</Button>
                                <Button size="sm" variant="outline" className="h-8 border-teal-300 text-teal-700" onClick={() => setDeciding({ row: r, action: 'already_credited' })}>Already credited</Button>
                                <Button size="sm" variant="ghost" className="h-8 text-rose-700" onClick={() => setDeciding({ row: r, action: 'rejected' })}><XCircle className="mr-1 h-3.5 w-3.5" />Reject</Button>
                              </div>
                            ) : <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">With the broker admins</span>
                          ) : (
                            <div className="max-w-[240px] space-y-0.5 whitespace-normal">
                              <span className={`rounded-full border px-2 py-0.5 font-semibold ${TABS.find(t => t.key === r.status)?.cls}`}>{TABS.find(t => t.key === r.status)?.label}</span>
                              <div className="text-slate-500">{when(r.decided?.at)} · {r.decided?.by_name}</div>
                              {r.decided?.transaction_id && <div className="font-mono text-slate-600">{r.decided.transaction_id}{r.decided.mt5_login && r.decided.mt5_login !== r.mt5_login ? ` · MT5 ${r.decided.mt5_login}` : ''}</div>}
                              {(r.decided?.note || r.decided?.reason) && <div className="text-slate-600">{r.decided.note || r.decided.reason}</div>}
                              {r.decided?.linked === 'approved' && <div className="text-emerald-700">Its bonus request approved too</div>}
                              {r.decided?.linked === 'with_finance' && <div className="text-amber-700">Its bonus request is still with finance</div>}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {isFetching && !isLoading && <div className="px-4 py-2 text-xs text-slate-400">Updating…</div>}
          </CardContent>
        </Card>
      </div>
      {raising && <RaiseCreditRequestDialog currentUser={currentUser} onClose={() => setRaising(false)} />}
      {deciding && <DecideDialog key={`${deciding.row.id}-${deciding.action}`} {...deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); refresh(); }} />}
    </div>
  );
}

/** Credited (transaction ID), Already credited (when / where) or Reject (why). */
function DecideDialog({ row, action, onClose, onDone }) {
  const [txn, setTxn] = useState('');
  const [mt5, setMt5] = useState(row.mt5_login || '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const title = action === 'credited' ? 'Mark credited' : action === 'already_credited' ? 'Already credited' : 'Reject';
  const ok = action === 'credited' ? txn.trim() && /^\d{4,15}$/.test(mt5.trim()) : text.trim().length >= 3;
  const linkedPending = row.funding_tx?.status === 'PENDING' && !row.funding_tx?.with_finance;
  const save = async () => {
    setBusy(true);
    try {
      const r = (await base44.functions.invoke('decideCreditRequest', {
        id: row.id, action, transactionId: txn.trim(), mt5Login: mt5.trim(),
        ...(action === 'rejected' ? { reason: text.trim() } : { note: text.trim() }),
      })).data;
      toast.success(`${title} — ${row.student_name}${r?.linked === 'approved' ? '; its bonus request approved too' : ''}`);
      onDone();
    } catch (e) {
      toast.error(why(e) || "Couldn't save it");
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{row.student_name} · {money(row.amount, row.currency)} · MT5 {row.mt5_login} — raised by {row.raised_by_name}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{row.note}</p>
          {action === 'credited' && (
            <>
              <div className="space-y-1.5"><Label>Transaction ID *</Label><Input value={txn} onChange={(e) => setTxn(e.target.value)} autoFocus /></div>
              <div className="space-y-1.5"><Label>Credited in MT5 *</Label><Input inputMode="numeric" value={mt5} onChange={(e) => setMt5(e.target.value)} className="font-mono" /></div>
            </>
          )}
          {action === 'already_credited' && (
            <div className="space-y-1.5"><Label>Transaction ID (optional)</Label><Input value={txn} onChange={(e) => setTxn(e.target.value)} placeholder="The earlier one, if you have it" /></div>
          )}
          <div className="space-y-1.5">
            <Label>{action === 'rejected' ? 'Why *' : action === 'already_credited' ? 'When / where it was credited *' : 'Note (optional)'}</Label>
            <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          {action !== 'rejected' && linkedPending && <p className="text-xs text-emerald-700">Its bonus request ({money(row.funding_tx.amount_usd)}) is waiting on MT5 Approvals — it is approved with this.</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={!ok || busy} className={action === 'rejected' ? 'bg-rose-600 hover:bg-rose-700' : ''}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{title}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
