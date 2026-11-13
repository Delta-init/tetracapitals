import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Search } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Paged, TablePagination } from '@/components/common/TablePagination';
import { cn } from '@/lib/utils';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { INTENTS } from './MeetingOutcomeGate';
import { when } from './meetingsUi';

/* ────────────────────────────────────────────────────────────────────────────
   Payment verification (the user, 2026-11-09) — Meetings done's second tab:
   each "interested" meeting with the mentor's expectation (unverified), the
   CS's verification (filled right there) and the actual payment from finance
   (backend functions/paymentVerification.ts). Tabs by where each stands, and
   search / mentor / CS / intention filters. A confirmed date moves the
   student's follow-up to it.
──────────────────────────────────────────────────────────────────────────── */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const errorText = (e, fallback) => e?.response?.data?.error || e?.data?.error || e?.message || fallback;
const INTENT = Object.fromEntries(INTENTS);
const SHORT_INTENT = { explicit_plan: 'Explicit plan', interested_no_commitment: 'No firm commitment', not_discussed: 'Not discussed' };
const VIEWS = [['unverified', 'Unverified', 'bg-amber-50 text-amber-700'], ['verified', 'Verified', 'bg-emerald-50 text-emerald-700'], ['changed', 'Date changed', 'bg-sky-50 text-sky-700'], ['declined', 'Declined', 'bg-rose-50 text-rose-700'], ['paid', 'Paid', 'bg-emerald-100 text-emerald-800']];
const VIEW = Object.fromEntries(VIEWS.map(([k, l, c]) => [k, [l, c]]));
const CONFIRM = [['confirmed', 'Date confirmed by student'], ['changed', 'Student gave a different date'], ['declined', 'Student declined / not paying'], ['unreachable', 'Not reachable yet']];
const selectCls = 'h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm';
const dayText = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const Line = ({ k, v }) => <p className="flex justify-between gap-2 text-sm"><span className="text-slate-500">{k}</span><span className="text-right text-slate-900">{v || '—'}</span></p>;

function VerifyForm({ r, modes, canVerify }) {
  const qc = useQueryClient();
  const v = r.verification;
  const [f, setF] = useState({ confirmation: '', date: '', mode: '', reason: '', note: '' });
  useEffect(() => {
    setF({ confirmation: v?.confirmation || '', date: v?.date || r.expectation.date || '', mode: v?.mode || r.expectation.mode || '', reason: v?.reason || '', note: v?.note || '' });
  }, [r.id, v?.at]);
  const save = useMutation({
    mutationFn: () => fn('verifyMeetingPayment', { meetingId: r.meeting_id, studentId: r.student.id, ...f }),
    onSuccess: () => { toast.success(f.date && ['confirmed', 'changed'].includes(f.confirmation) ? `Saved — their follow-up moved to ${dayText(f.date)}` : 'Saved'); qc.invalidateQueries({ queryKey: ['payment-verifications'] }); qc.invalidateQueries({ queryKey: ['payment-verify-count'] }); },
    onError: (e) => toast.error(errorText(e, "That didn't save")),
  });
  if (!canVerify) {
    return v ? <><Line k="Student said" v={CONFIRM.find(c => c[0] === v.confirmation)?.[1]} />{v.date && <Line k="Date" v={dayText(v.date)} />}{v.mode && <Line k="Method" v={v.mode} />}{v.reason && <Line k="Why" v={v.reason} />}<p className="mt-1 text-xs text-slate-400">by {v.by}</p></> : <p className="text-sm text-slate-500">Not verified yet.</p>;
  }
  const needsDate = ['confirmed', 'changed'].includes(f.confirmation);
  const ready = f.confirmation && (!needsDate || f.date) && (f.confirmation !== 'declined' || f.reason.trim().length >= 3);
  return (
    <div className="space-y-2">
      <select className={selectCls} value={f.confirmation} onChange={e => setF(x => ({ ...x, confirmation: e.target.value }))} aria-label="Student confirmation">
        <option value="">Student confirmation…</option>
        {CONFIRM.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {needsDate && (
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" className="h-9" value={f.date} onChange={e => setF(x => ({ ...x, date: e.target.value }))} aria-label="Confirmed payment date" />
          <select className={selectCls} value={f.mode} onChange={e => setF(x => ({ ...x, mode: e.target.value }))} aria-label="Confirmed payment method">
            <option value="">Method…</option>
            {modes.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}
      {f.confirmation === 'declined' && <Input className="h-9" value={f.reason} onChange={e => setF(x => ({ ...x, reason: e.target.value }))} placeholder="Why won't they pay? *" />}
      {f.confirmation && <Textarea rows={2} value={f.note} onChange={e => setF(x => ({ ...x, note: e.target.value }))} placeholder="Note (optional)" />}
      <Button size="sm" className="w-full" disabled={!ready || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {v ? 'Update verification' : 'Save verification'}</Button>
      {v && <p className="text-xs text-slate-400">Last by {v.by} · {when(v.at)}</p>}
    </div>
  );
}

export default function PaymentVerificationTab({ days }) {
  const { data: me } = useQuery({ queryKey: ['me', 'effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()), staleTime: 5 * 60_000 });
  const canVerify = ['cs', 'cs_manager', 'super_admin', 'admin'].includes(me?.app_role);
  const q = useQuery({ queryKey: ['payment-verifications', days], queryFn: () => fn('getPaymentVerifications', days), placeholderData: (p) => p });
  const opts = useQuery({ queryKey: ['meeting-outcome-options'], queryFn: () => fn('getMeetingOutcomeOptions', {}), staleTime: 10 * 60_000, retry: false });
  // The LMS's list; the one here only until it loads — POS and Razorpay added to it 2026-11-13 (the owner).
  const modes = opts.data?.paymentModes ?? ['Cash', 'Card', 'POS', 'Bank Transfer', 'Tabby', 'Tamara', 'INR Transfer', 'Razorpay', 'Payment link'];
  const [tab, setTab] = useState('unverified');
  const [search, setSearch] = useState('');
  const [mentor, setMentor] = useState('');
  const [cs, setCs] = useState('');
  const [intent, setIntent] = useState('');
  const all = q.data?.rows ?? [];
  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => all.filter(r => (tab === 'all' || r.view === tab) && (!mentor || r.mentor?.name === mentor) && (!cs || r.student?.cs === cs) && (!intent || r.expectation.intent === intent)
    && (!needle || [r.student?.name, r.student?.code, r.mentor?.name, r.student?.cs, r.expectation.course].some(x => String(x || '').toLowerCase().includes(needle)))), [all, tab, mentor, cs, intent, needle]);
  const uniq = (f) => [...new Set(all.map(f).filter(Boolean))].sort();
  const counts = q.data?.counts ?? {};
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {[['all', 'All', ''], ...VIEWS].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn('rounded-full border px-3 py-1 text-sm font-medium', tab === k ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
            {l}{counts[k] ? <span className={cn('ml-1.5 text-xs', tab === k ? 'text-white/80' : 'text-slate-400')}>{counts[k]}</span> : null}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><Input className="h-9 w-56 pl-8" placeholder="Student, code, mentor, CS, course" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <select className={cn(selectCls, 'w-44')} value={mentor} onChange={e => setMentor(e.target.value)}><option value="">Any mentor</option>{uniq(r => r.mentor?.name).map(x => <option key={x}>{x}</option>)}</select>
        <select className={cn(selectCls, 'w-44')} value={cs} onChange={e => setCs(e.target.value)}><option value="">Any CS</option>{uniq(r => r.student?.cs).map(x => <option key={x}>{x}</option>)}</select>
        <select className={cn(selectCls, 'w-52')} value={intent} onChange={e => setIntent(e.target.value)}><option value="">Any intention</option>{INTENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {q.isFetching && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      </div>
      {q.isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        : q.isError ? <p className="py-10 text-center text-sm text-amber-700">{/unknown function|not found|404/i.test(String(q.error?.message)) ? 'This needs the server update (the API deploy).' : q.error?.message}</p>
          : !rows.length ? <p className="py-12 text-center text-sm text-slate-400">No meetings here for these days — an "Interested" outcome lands here.</p>
            : (
              <Paged items={rows} resetKey={tab + needle + mentor + cs + intent + JSON.stringify(days)}>
                {(page, bar) => (<>
                  <div className="space-y-3">
                    {page.map(r => {
                      const [vl, vc] = VIEW[r.view] || [r.view, 'bg-slate-100 text-slate-600'];
                      return (
                        <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <Link to={`${createPageUrl('StudentDetail')}?id=${r.student.id}&tab=meetings`} className="font-semibold text-brand-navy hover:underline">{r.student.name}</Link>
                              <span className="ml-1.5 font-mono text-xs text-slate-400">{r.student.code}</span>
                              <p className="text-xs text-slate-500">Meeting {when(r.starts_at)} with {r.mentor?.name || 'the mentor'} · CS {r.student.cs || '—'}{r.student.team ? ` · ${r.student.team}` : ''} · Interested{r.expectation.course ? ` — ${r.expectation.course}` : ''}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {r.promise && r.view !== 'paid' && r.view !== 'declined' && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', r.promise.status === 'overdue' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700')}>{r.promise.status === 'overdue' ? 'Overdue' : 'Due'} {dayText(r.promise.date)}</span>}
                              <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', vc)}>{r.view === 'unverified' ? 'Pending follow-up' : vl}</span>
                            </div>
                          </div>
                          <div className="grid gap-3 md:grid-cols-3">
                            <div className="rounded-xl bg-slate-50 p-3">
                              <p className="mb-1.5 text-sm font-semibold text-slate-900">Mentor's expectation <span className="ml-1 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Unverified</span></p>
                              <Line k="Expected date" v={dayText(r.expectation.date)} />
                              <Line k="Expected method" v={r.expectation.mode} />
                              <Line k="Commitment" v={SHORT_INTENT[r.expectation.intent] || INTENT[r.expectation.intent]} />
                            </div>
                            <div className="rounded-xl border border-slate-200 p-3">
                              <p className="mb-1.5 text-sm font-semibold text-slate-900">CS verification</p>
                              <VerifyForm r={r} modes={modes} canVerify={canVerify} />
                            </div>
                            <div className="rounded-xl bg-slate-50 p-3">
                              <p className="mb-1.5 text-sm font-semibold text-slate-900">Actual payment <span className="text-xs font-normal text-slate-500">finance</span></p>
                              {r.payment
                                ? <><Line k="Amount" v={`AED ${Math.round(r.payment.aed).toLocaleString('en-US')}`} /><Line k="Course" v={r.payment.product} /><Line k="Status" v={r.payment.status === 'approved' ? 'Approved' : 'Waiting approval'} /></>
                                : <p className="text-sm text-slate-500">Not paid yet</p>}
                              <p className="mt-2 text-xs text-slate-400">Only approved finance payments count.</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <TablePagination {...bar} />
                </>)}
              </Paged>
            )}
    </div>
  );
}
