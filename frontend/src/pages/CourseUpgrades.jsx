import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { PageTitle } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowUpCircle, Loader2, Save, Search } from 'lucide-react';
import { aed, usd, scheduleText, UpgradeStatusBadge } from '@/components/students/StudentCoursesCard';
import { ReceiptsButton } from '@/components/funding/payments';

/* ────────────────────────────────────────────────────────────────────────────
   Course Upgrades (backend/src/functions/courseUpgrades.ts): every student's
   CSE upgrade in progress — what they pay, what's paid, the balance, the next
   payment, money on hold and the MT5 bonus. A CS sees their own students', the
   people above them their team's, admins everyone's. The Price list tab shows
   the prices upgrades are worked out from; a Super Admin edits them there.
──────────────────────────────────────────────────────────────────────────── */

export default function CourseUpgrades() {
  // The bonus course payments first (the user, 2026-10-13) — the upgrades and the price list after.
  const [tab, setTab] = useState('payments');
  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <PageTitle eyebrow="Students" icon={ArrowUpCircle}>Course Upgrades</PageTitle>
      <p className="mt-1 text-sm text-muted-foreground">Course payments raised as bonus requests, CSE upgrades — what each student pays, the balance and the MT5 bonus.</p>
      <Tabs value={tab} onValueChange={setTab} className="mt-4">
        <TabsList>
          <TabsTrigger value="payments">Course payments</TabsTrigger>
          <TabsTrigger value="upgrades">Upgrades</TabsTrigger>
          <TabsTrigger value="prices">Price list</TabsTrigger>
        </TabsList>
        <TabsContent value="payments"><CoursePaymentsTable /></TabsContent>
        <TabsContent value="upgrades"><UpgradesTable /></TabsContent>
        <TabsContent value="prices"><PriceList /></TabsContent>
      </Tabs>
    </div>
  );
}

const PAYMENT_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];
const STATUS_CLS = { APPROVED: 'bg-emerald-50 text-emerald-700', PENDING: 'bg-amber-50 text-amber-700', REJECTED: 'bg-rose-50 text-rose-700' };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/** The bonus course payments (a Bonus request with a course — backend listCoursePaymentRequests): a CS their own. */
function CoursePaymentsTable() {
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['course-payment-requests', status],
    queryFn: async () => (await base44.functions.invoke('listCoursePaymentRequests', { status })).data,
    retry: false,
  });
  const needle = q.trim().toLowerCase();
  const rows = (data?.rows || []).filter((r) => !needle || [r.student.name, r.student.code, r.student.cs, r.course, r.raised_by, r.transaction_id].some((x) => String(x || '').toLowerCase().includes(needle)));
  const total = rows.filter(r => r.status === 'APPROVED').reduce((s, r) => s + r.paid_today_aed, 0);
  return (
    <Card className="mt-3">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {PAYMENT_FILTERS.map((f) => (
            <Button key={f.key} size="sm" variant={status === f.key ? 'default' : 'outline'} onClick={() => setStatus(f.key)}>{f.label}</Button>
          ))}
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Student, code, CS, course…" className="pl-8" />
          </div>
        </div>
        {error ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(error?.message)) ? 'Course payments show here after the server update (the API deploy).' : error.message}</p>
        ) : isLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : (
          <>
            <p className="text-xs text-muted-foreground">{rows.length} shown · approved {aed(total)}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Requested</th><th className="py-2 pr-3">Student</th><th className="py-2 pr-3">Course</th>
                    <th className="py-2 pr-3">Received</th><th className="py-2 pr-3">Balance</th><th className="py-2 pr-3">MT5 bonus</th>
                    <th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Raised by</th><th className="py-2">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {!rows.length && <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">No course payments here.</td></tr>}
                  {rows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="whitespace-nowrap py-2 pr-3 text-xs">{day(r.requested_at)}{r.approved_at && <div className="text-muted-foreground">approved {day(r.approved_at)}</div>}</td>
                      <td className="py-2 pr-3">
                        <Link to={`${createPageUrl('StudentDetail')}?id=${r.student.id}`} className="font-medium hover:underline">{r.student.name || '—'}</Link>
                        <div className="text-xs text-muted-foreground">{[r.student.code, r.student.cs].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="py-2 pr-3">{r.course}<div className="text-xs text-muted-foreground">{r.kind === 'partial' ? 'Partial payment' : r.kind === 'full' ? 'Full payment' : ''}</div></td>
                      <td className="whitespace-nowrap py-2 pr-3 font-medium">{aed(r.paid_today_aed)}{(r.payments?.[0]?.method || r.payment_method) && <div className="text-xs font-normal text-muted-foreground">{r.payments?.[0]?.method || r.payment_method}</div>}{r.hold_aed > 0 && <div className="text-xs font-normal text-amber-700">on hold {aed(r.hold_aed)}</div>}</td>
                      <td className="whitespace-nowrap py-2 pr-3">{r.balance_aed == null ? '—' : aed(r.balance_aed)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-emerald-700">{usd(r.bonus_usd)}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[r.status] || 'bg-slate-100 text-slate-700'}`}>{r.status}</span>
                        {r.finance && <div className="mt-0.5 text-[11px] text-muted-foreground">{r.finance}</div>}
                        {r.status === 'REJECTED' && r.rejection_reason && <div className="mt-0.5 max-w-[200px] text-[11px] text-rose-700">{r.rejection_reason}</div>}
                        {r.transaction_id && <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{r.transaction_id}</div>}
                      </td>
                      <td className="py-2 pr-3 text-xs">{r.raised_by || '—'}</td>
                      <td className="py-2"><ReceiptsButton tx={{ payments: r.payments, screenshot_url: r.screenshot_url }} title={r.student.name} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const FILTERS = [
  { key: 'open', label: 'In progress' },
  { key: 'done', label: 'Paid' },
  { key: 'all', label: 'All' },
];

function UpgradesTable() {
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['course-upgrades', status],
    queryFn: async () => (await base44.functions.invoke('listCourseUpgrades', { status })).data,
  });
  const needle = q.trim().toLowerCase();
  const rows = (data?.rows || []).filter((r) => !needle || [r.student.name, r.student.code, r.student.cs, r.courseName].some((x) => String(x || '').toLowerCase().includes(needle)));
  return (
    <Card className="mt-3">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <Button key={f.key} size="sm" variant={status === f.key ? 'default' : 'outline'} onClick={() => setStatus(f.key)}>{f.label}</Button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Student, CS or course" className="h-9 pl-8" />
          </div>
        </div>
        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…</p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-rose-600">{error.message || 'Could not load the upgrades'}</p>
        ) : !rows.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No upgrades here. Start one from a student&apos;s Courses tab.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Student</th>
                  <th className="pb-2 pr-3 font-medium">Course</th>
                  <th className="pb-2 pr-3 text-right font-medium">To pay</th>
                  <th className="pb-2 pr-3 text-right font-medium">Paid</th>
                  <th className="pb-2 pr-3 text-right font-medium">Balance</th>
                  <th className="pb-2 pr-3 text-right font-medium">Next</th>
                  <th className="pb-2 pr-3 text-right font-medium">On hold</th>
                  <th className="pb-2 pr-3 text-right font-medium">MT5 bonus</th>
                  <th className="pb-2 pr-3 font-medium">LMS modules</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-3">
                      <Link to={`${createPageUrl('StudentDetail')}?id=${r.student.id}&tab=courses`} className="font-medium text-brand-navy hover:underline">{r.student.name}</Link>
                      <p className="text-xs text-muted-foreground">{r.student.code}{r.student.cs ? ` · ${r.student.cs}` : ''}</p>
                    </td>
                    <td className="py-2 pr-3">{r.courseName}<p className="text-xs text-muted-foreground">{r.plan === 'full' ? 'Full payment' : scheduleText(r.quote.schedule)}</p></td>
                    <td className="py-2 pr-3 text-right tabular-nums">{aed(r.quote.dueAed)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{aed(r.progress.paidAed)}</td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums">{aed(r.progress.balanceAed)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.progress.done ? '—' : aed(r.nextPaymentAed)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{aed(r.progress.onHoldAed)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{usd(r.progress.bonusEarnedUsd)} <span className="text-xs text-muted-foreground">of {usd(r.quote.bonusUsd)}</span></td>
                    <td className="py-2 pr-3 text-xs">{r.lms ? <span className="text-emerald-700">Done</span> : r.lmsDue ? <span className="font-medium text-amber-700">To do</span> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2"><UpgradeStatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PriceList() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['course-price-list'],
    queryFn: async () => (await base44.functions.invoke('getCoursePriceList', {})).data,
  });
  const [draft, setDraft] = useState({});
  useEffect(() => {
    if (data?.courses) setDraft(Object.fromEntries(data.courses.map((c) => [c.code, { fullAed: String(c.fullAed), planAed: c.planAed === null ? null : String(c.planAed) }])));
  }, [data]);
  const save = useMutation({
    mutationFn: async () => (await base44.functions.invoke('saveCoursePriceList', {
      courses: Object.entries(draft).map(([code, v]) => ({ code, fullAed: Number(v.fullAed), planAed: v.planAed === null ? null : Number(v.planAed) })),
    })).data,
    onSuccess: () => { toast.success('Price list saved'); queryClient.invalidateQueries({ queryKey: ['course-price-list'] }); },
    onError: (e) => toast.error(e?.message || 'Could not save the price list'),
  });
  if (isLoading || !data) return <p className="py-8 text-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…</p>;
  const edit = data.canEdit;
  const stepsBonus = (plan) => (plan ? (Number(plan) / 2000) * 500 : null);
  return (
    <Card className="mt-3">
      <CardContent className="p-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Course</th>
                <th className="pb-2 pr-3 font-medium">Full (AED)</th>
                <th className="pb-2 pr-3 font-medium">Installments (AED)</th>
                <th className="pb-2 pr-3 font-medium">MT5 bonus</th>
                <th className="pb-2 font-medium">Takes off</th>
              </tr>
            </thead>
            <tbody>
              {data.courses.map((c) => {
                const d = draft[c.code] || {};
                return (
                  <tr key={c.code} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{c.name}</td>
                    <td className="py-2 pr-3">{edit ? <Input type="number" className="h-8 w-28" value={d.fullAed ?? ''} onChange={(e) => setDraft((p) => ({ ...p, [c.code]: { ...p[c.code], fullAed: e.target.value } }))} /> : aed(c.fullAed)}</td>
                    <td className="py-2 pr-3">
                      {c.planAed === null ? <span className="text-muted-foreground">One-time{c.code === 'DWT' ? ' or Tabby' : ''}</span>
                        : edit ? <Input type="number" step="2000" className="h-8 w-28" value={d.planAed ?? ''} onChange={(e) => setDraft((p) => ({ ...p, [c.code]: { ...p[c.code], planAed: e.target.value } }))} />
                          : `${aed(c.planAed)} (${c.planAed / 2000} × 2,000)`}
                    </td>
                    <td className="py-2 pr-3">{c.flatBonusUsd ? `${usd(c.flatBonusUsd)} flat` : `${usd(stepsBonus(edit ? d.planAed : c.planAed))} (500 per 2,000)`}</td>
                    <td className="py-2 text-xs text-muted-foreground">{c.deducts.length ? c.deducts.join(', ') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{data.updatedAt ? `Last changed by ${data.updatedBy}` : 'The prices from the course price structure.'} An upgrade already started keeps the prices it was quoted at.</span>
          {edit && <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}Save prices</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
