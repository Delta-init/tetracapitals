import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Download, Loader2, Search } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { localFromAed, localFromUsd, localNumberFromAed, displayCurrency, AED_PER_USD } from '@/components/utils/displayCurrency';
import { downloadExcel } from '@/components/utils/excelExport';

/* ────────────────────────────────────────────────────────────────────────────
   What is behind a number of a report (the user, 2026-10-27: "breakdown needed
   every count"): the same report asked for the requests that make that one
   number — the server picks them by the same rules it counts by, so the list
   always agrees with the number (backend functions/reports.ts pickOf).
──────────────────────────────────────────────────────────────────────────── */

export const STAGE = {
  pending: ['Pending', 'bg-amber-50 text-amber-700'],
  approved: ['Approved', 'bg-emerald-50 text-emerald-700'],
  rejected: ['Rejected', 'bg-rose-50 text-rose-700'],
  after_payment: ['After full payment', 'bg-amber-50 text-amber-700'],
  needs_call: ['Needs call + MT5', 'bg-amber-50 text-amber-700'],
  with_finance: ['With finance', 'bg-sky-50 text-sky-700'],
  waiting_broker: ['Broker admin', 'bg-violet-50 text-violet-700'],
  sent_back: ['Sent back to correct', 'bg-orange-50 text-orange-700'],
};
const TYPE = { DEPOSIT: 'Deposit', WITHDRAWAL: 'Withdrawal', BONUS: 'Bonus' };
const BONUS = { sales_close: 'sales close', course_upgrade: 'course upgrade', course_payment: 'course payment' };
const PART = { first_half: 'first half', rest: 'rest' };
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '—');
const hours = (h) => (h == null ? '—' : h < 48 ? `${Math.round(h * 10) / 10} h` : `${Math.round((h / 24) * 10) / 10} days`);
const typeOf = (r) => [TYPE[r.type] || r.type, BONUS[r.bonus], PART[r.part]].filter(Boolean).join(' · ');

/**
 * open: { title, bucket, view: 'total' | 'person' | 'team' | 'month', key } or null; fn and ask: the report's own
 * function and filters.
 */
export default function ReportDetails({ open, onClose, fn, ask }) {
  const [q, setQ] = useState('');
  const details = open ? { bucket: open.bucket, view: open.view, key: open.key } : null;
  const res = useQuery({
    queryKey: ['report-details', fn, ask, details],
    queryFn: async () => (await base44.functions.invoke(fn, { ...ask, details })).data,
    enabled: !!open,
    retry: false,
  });
  const all = res.data?.details;
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => (all || []).filter(r => !needle
    || [r.student_name, r.student_code, r.raised_by, r.team, typeOf(r), STAGE[r.stage]?.[0]].some(v => String(v || '').toLowerCase().includes(needle))), [all, needle]);
  const sum = (k) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  // An older API answers with the report itself, not the list.
  const stale = res.data && !Array.isArray(all);

  const exportIt = async () => {
    try {
      await downloadExcel({
        fileName: `${open.title}.xlsx`, sheet: 'Breakdown',
        columns: [{ header: 'Raised' }, { header: 'Student' }, { header: 'Code' }, { header: 'Type' }, { header: 'Where it stands' },
          { header: `MT5 bonus / amount (${displayCurrency()})`, type: 'number' }, { header: `Paid (${displayCurrency()})`, type: 'number' },
          { header: 'Raised by' }, { header: 'Team' }, { header: 'Decided' }, { header: 'Time to decide (hours)', type: 'number' }],
        rows: rows.map(r => [when(r.at), r.student_name || '', r.student_code || '', typeOf(r), STAGE[r.stage]?.[0] || r.stage,
          localNumberFromAed((Number(r.usd) || 0) * AED_PER_USD), localNumberFromAed(r.aed), r.raised_by, r.team, when(r.decided_at), r.hours ?? null]),
      });
    } catch (err) {
      toast.error(err?.message || "The export didn't work");
    }
  };

  return (
    <Dialog open={!!open} onOpenChange={(v) => { if (!v) { onClose(); setQ(''); } }}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>{open?.title}</DialogTitle>
          <DialogDescription>
            {all ? `${rows.length.toLocaleString('en-US')}${needle ? ` of ${all.length.toLocaleString('en-US')}` : ''} · ${localFromUsd(sum('usd'), { decimals: true })} MT5 bonus / amount · ${localFromAed(sum('aed'), { decimals: true })} paid` : 'What makes this number'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Student, person, type…" className="h-9 w-64 pl-8" />
          </div>
          <Button variant="outline" size="sm" className="ml-auto" onClick={exportIt} disabled={!rows.length}><Download className="mr-1.5 h-4 w-4" />Export</Button>
        </div>
        {res.isLoading ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : res.isError || stale ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {stale || /unknown function|not found|404/i.test(String(res.error?.message)) ? 'This breakdown needs the server update (the API deploy).' : (res.error?.message || "The breakdown couldn't be loaded.")}
          </p>
        ) : !rows.length ? (
          <p className="py-10 text-center text-sm text-slate-400">Nothing here.</p>
        ) : (
          <div className="max-h-[65vh] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  {['Raised', 'Student', 'Type', 'Where it stands', 'MT5 bonus / amount', 'Paid', 'Raised by', 'Decided'].map(h => (
                    <th key={h} className={`whitespace-nowrap px-3 py-2.5 ${['MT5 bonus / amount', 'Paid'].includes(h) ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(r => {
                  const [label, tone] = STAGE[r.stage] || [r.stage || r.status, 'bg-slate-100 text-slate-600'];
                  return (
                    <tr key={r.id} className="align-top hover:bg-slate-50/60">
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">{when(r.at)}</td>
                      <td className="px-3 py-2">
                        {r.student_id
                          ? <Link to={`${createPageUrl('StudentDetail')}?id=${r.student_id}`} className="font-medium text-brand-navy hover:underline">{r.student_name || 'A student'}</Link>
                          : <span className="text-slate-400">—</span>}
                        {r.student_code && <div className="text-xs text-slate-400">{r.student_code}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">{typeOf(r)}{r.promised && <div className="text-xs text-slate-400">promised, not raised yet</div>}</td>
                      <td className="whitespace-nowrap px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>{label}</span></td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{localFromUsd(r.usd, { decimals: true })}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">{r.aed ? localFromAed(r.aed, { decimals: true }) : '—'}</td>
                      <td className="px-3 py-2 text-slate-700">{r.raised_by}<div className="text-xs text-slate-400">{r.team}</div></td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">{when(r.decided_at)}{r.hours != null && <div className="text-xs text-slate-400">after {hours(r.hours)}</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
