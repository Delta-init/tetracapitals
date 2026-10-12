import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { BookOpen, Loader2, Lock, LockOpen } from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────────
   What this course payment will open in the LMS (the user, 2026-10-12) — on
   the New Funding Request form's course payment and a Course Upgrade's
   "Record payment": for each LMS course, the modules open now and how many
   will be open once the payment is approved (backend functions/lmsPreview.ts,
   the same rule as the automatic opening). A preview only — modules open after
   approval. Says nothing when the person can't see the student's LMS courses.
──────────────────────────────────────────────────────────────────────────── */

const aed = (n) => `AED ${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** body: { studentId, products, kind, planAed, todayAed } or { upgradeId, payAed }. */
export default function LmsModulesPreview({ body, className = '' }) {
  // Asked again a moment after the amount stops changing.
  const [asked, setAsked] = useState(body);
  const key = JSON.stringify(body);
  useEffect(() => { const t = setTimeout(() => setAsked(body), 500); return () => clearTimeout(t); }, [key]);
  const q = useQuery({
    queryKey: ['lms-preview', asked],
    queryFn: async () => (await base44.functions.invoke('previewCourseLms', asked)).data,
    enabled: !!asked && !!(asked.upgradeId || (asked.studentId && asked.products?.length)),
    retry: false,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const d = q.data;
  if (q.isError && /forbidden|not allowed|only|403/i.test(String(q.error?.message))) return null;   // not theirs to see

  return (
    <div className={`rounded-xl border border-indigo-200 bg-indigo-50/50 px-4 py-3 text-sm ${className}`}>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-800">
        <BookOpen className="h-4 w-4" />LMS modules — once this payment is approved
        {q.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />}
      </p>
      {!d ? (
        q.isError ? <p className="mt-1.5 text-xs text-slate-500">{q.error?.message || "The LMS couldn't be asked."}</p>
          : <p className="mt-1.5 text-xs text-slate-500">Asking the LMS…</p>
      ) : d.unmapped ? (
        <p className="mt-1.5 text-xs text-slate-600">This product has no LMS course — nothing opens in the LMS.</p>
      ) : d.configured === false ? (
        <p className="mt-1.5 text-xs text-slate-500">The LMS isn't connected on this server.</p>
      ) : d.account === false ? (
        <p className="mt-1.5 text-xs text-slate-500">No Delta LMS account found for this student{d.why ? ` (${d.why})` : ''} — the modules open once they have one.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-600">
            Paid {aed(d.paidAed)}{d.totalAed ? ` of ${aed(d.totalAed)}` : ''} with this payment — <b>{Math.round(d.share * 100)}%</b>
            {d.share >= 1 ? ', so every module opens.' : ', so that share of each course opens (rounded up).'}
            {d.pendingAed > 0 && <span className="text-slate-500"> {aed(d.pendingAed)} more is waiting for approval and isn't counted yet.</span>}
          </p>
          <ul className="mt-2 space-y-2">
            {d.courses.map((c) => (
              <li key={c.title} className="rounded-lg bg-white px-3 py-2 ring-1 ring-indigo-100">
                {c.missing ? (
                  <span className="text-xs text-slate-500">{c.title} — not one of this student's academy's LMS courses.</span>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">{c.title}</span>
                      <span className="text-xs text-slate-600">
                        {c.onCourse ? `${c.openNow} of ${c.total} open now` : 'Not on it yet — will be given'}
                        {' → '}<b className="text-indigo-800">{c.openAfter} of {c.total} open</b>
                        {c.firstModules ? <span className="text-slate-400"> (this product opens up to {c.firstModules})</span> : null}
                      </span>
                    </div>
                    {c.unlock.length > 0 ? (
                      <p className="mt-1 flex items-start gap-1 text-xs text-emerald-700"><LockOpen className="mt-0.5 h-3 w-3 shrink-0" />Unlocks: {c.unlock.join(', ')}</p>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">Nothing new unlocks with this payment.</p>
                    )}
                    {c.stillLocked > 0 && <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><Lock className="h-3 w-3" />{c.stillLocked} still locked until more is paid</p>}
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
