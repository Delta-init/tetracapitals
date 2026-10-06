import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { PageTitle } from '@/components/common/PageHeader';
import { TablePagination } from '@/components/common/TablePagination';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CheckCircle2, ClipboardCheck, ExternalLink, Eye, FileText, Loader2, RefreshCw, Search, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   LMS Requests — the Delta LMS's enrolment requests (the user, 2026-10-06): a
   student signs up and waits to be let in, as on the LMS admin's Requests page.
   A CS sees their own students' (leaders their people's); the Super Admin every
   Forex applicant's, in the portal or not (backend/src/functions/
   lmsEnrolmentRequests.ts). Approve lets them in on Forex — the LMS tells them by
   email and WhatsApp; Reject turns a waiting request away with a reason they're
   emailed. Done in the LMS from your own LMS account, else Delta's support
   account with your name.
──────────────────────────────────────────────────────────────────────────── */

const TABS = [
  { key: 'pending', label: 'Waiting', title: 'Waiting to be let in' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];
const STATUS = {
  pending: { label: 'Waiting', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  approved: { label: 'Approved', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  rejected: { label: 'Rejected', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
};
const FIELD_LABELS = {
  gender: 'Gender', dateOfBirth: 'Date of birth', nationality: 'Nationality', homeCountry: 'Country of residence',
  occupation: 'Occupation', idType: 'ID type', idNumber: 'ID number', emiratesId: 'Emirates ID', countryAttendance: 'Attending from',
  villa: 'Villa / flat', city: 'City', addressCountry: 'Address country', emergencyContact: 'Emergency contact',
  experienceLevel: 'Trading experience', preferredStartDate: 'Preferred start', hearAboutUs: 'Heard about us', referralName: 'Referred by',
  paymentMethod: 'Payment method',
};
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const Empty = ({ children }) => <p className="px-4 py-10 text-center text-sm text-slate-400">{children}</p>;
const call = async (name, body) => (await base44.functions.invoke(name, body)).data;

/** Approve or reject — the confirm, and for a rejection the reason the student is emailed. */
function DecisionDialog({ decision, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  if (!decision) return null;
  const { kind, request: r } = decision;
  const reject = kind === 'reject';
  const submit = async () => {
    if (reject && (reason.trim().length < 5 || reason.trim().length > 1000)) {
      toast.error('Give a reason of 5 to 1000 characters — the student is told it');
      return;
    }
    setBusy(true);
    try {
      const out = await call(reject ? 'rejectLmsEnrolmentRequest' : 'approveLmsEnrolmentRequest', { userId: r.id, email: r.email, ...(reject ? { reason: reason.trim() } : {}) });
      const from = out?.from === 'shared' ? " — from Delta's support account, with your name" : out?.from === 'own' ? ' — from your LMS account' : '';
      toast.success(reject ? `${r.name || r.email}'s request rejected${from}` : out?.already ? `${r.name || r.email} was already in on Forex` : `${r.name || r.email} is in on Forex${from}`);
      onDone();
      onClose();
      setReason('');
    } catch (e) {
      toast.error(e?.message || 'The LMS could not take that');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{reject ? 'Reject this request?' : 'Approve this request?'}</DialogTitle>
          <DialogDescription>
            {reject
              ? `${r.name || r.email} stays out of the LMS's courses and is emailed your reason.`
              : `${r.name || r.email} is let in on Forex in the LMS now, and told by email and WhatsApp.`}
          </DialogDescription>
        </DialogHeader>
        {reject && (
          <div className="space-y-2">
            <Label htmlFor="lms-reject-reason">Reason *</Label>
            <Textarea id="lms-reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={1000}
              placeholder="What they need to put right — they're emailed this" />
            <p className="text-xs text-slate-400">{reason.trim().length}/1000 — at least 5</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy} className={reject ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {reject ? 'Reject' : 'Approve on Forex'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One request, as the LMS admin's card shows it: the application, and the ID scans through a 5-minute link. */
function RequestDialog({ request, onClose, onDecide }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['lms-enrolment-request', request?.id],
    queryFn: () => call('getLmsEnrolmentRequest', { userId: request.id, email: request.email }),
    enabled: !!request,
  });
  const [opening, setOpening] = useState('');
  if (!request) return null;
  const r = data?.request ?? request;
  const s = STATUS[r.status] || STATUS.pending;
  const open = async (field) => {
    setOpening(field);
    try {
      const { url } = await call('getLmsEnrolmentDocument', { userId: r.id, email: r.email, field });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(e?.message || 'The document could not be opened');
    } finally {
      setOpening('');
    }
  };
  const application = Object.entries(r.application ?? {});
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {r.name || r.email} <Badge variant="outline" className={s.cls}>{s.label}</Badge>
          </DialogTitle>
          <DialogDescription>{[r.email, r.phone, r.academy].filter(Boolean).join(' · ')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            <p><span className="text-slate-500">Applied to:</span> {r.programs?.join(', ') || '—'}</p>
            <p><span className="text-slate-500">Applied:</span> {when(r.appliedAt) || '—'}</p>
            {r.categories?.length > 0 && <p><span className="text-slate-500">In on:</span> {r.categories.join(', ')}</p>}
            {r.decidedBy && <p><span className="text-slate-500">{r.status === 'approved' ? 'Approved by' : 'Rejected by'}:</span> {r.decidedBy}{r.decidedAt ? ` · ${when(r.decidedAt)}` : ''}</p>}
            {r.reason && <p className="sm:col-span-2"><span className="text-slate-500">Reason:</span> {r.reason}</p>}
          </div>
          {isLoading ? <Skeleton className="h-24 w-full" /> : error ? (
            <p className="text-rose-600">{error.message || 'The application could not be loaded'}</p>
          ) : application.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Application</p>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {application.map(([k, v]) => (
                  <div key={k} className="min-w-0"><dt className="text-xs text-slate-500">{FIELD_LABELS[k] || k}</dt><dd className="break-words font-medium text-slate-800">{v}</dd></div>
                ))}
              </dl>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {r.documents?.passport && (
              <Button variant="outline" size="sm" onClick={() => open('passport')} disabled={!!opening}>
                {opening === 'passport' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />} Passport <ExternalLink className="ml-1 h-3 w-3" />
              </Button>
            )}
            {r.documents?.idDoc && (
              <Button variant="outline" size="sm" onClick={() => open('idDoc')} disabled={!!opening}>
                {opening === 'idDoc' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />} ID document <ExternalLink className="ml-1 h-3 w-3" />
              </Button>
            )}
            {!r.documents?.passport && !r.documents?.idDoc && <span className="text-xs text-slate-400">No ID documents sent</span>}
            {(r.documents?.passport || r.documents?.idDoc) && <span className="text-xs text-slate-400">Opens a link that works for 5 minutes</span>}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {r.status === 'pending' && (
            <Button variant="outline" className="border-rose-300 text-rose-700 hover:bg-rose-50" onClick={() => onDecide('reject', r)}>
              <XCircle className="mr-1.5 h-4 w-4" /> Reject
            </Button>
          )}
          {r.status !== 'approved' && (
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => onDecide('approve', r)}>
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve on Forex
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LmsRequests() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('pending');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [viewing, setViewing] = useState(null);
  const [decision, setDecision] = useState(null);   // { kind: 'approve' | 'reject', request }

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ['lms-enrolment-requests', tab, page],
    queryFn: () => call('getLmsEnrolmentRequests', { status: tab, page }),
    staleTime: 30_000,
    placeholderData: (previous) => previous,   // the page stays while the next one comes
  });
  const { data: count } = useQuery({
    queryKey: ['nav-lms-request-count'],
    queryFn: () => call('getLmsEnrolmentRequestCount', {}),
    staleTime: 60_000,
  });
  const requests = useMemo(() => data?.requests ?? [], [data]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((r) => !q || [r.name, r.email, r.phone, r.country, r.student?.code, r.student?.cs, ...(r.programs || [])]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }, [requests, query]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['lms-enrolment-requests'] });
    queryClient.invalidateQueries({ queryKey: ['nav-lms-request-count'] });
    queryClient.invalidateQueries({ queryKey: ['lms-enrolment-request'] });
  };
  const decide = (kind, request) => { setViewing(null); setDecision({ kind, request }); };

  const notice = isLoading ? '' : error ? (error.message || 'The requests could not be loaded')
    : !data?.configured ? "The LMS isn't linked to this server, so there are no requests to show."
      : !data.available ? (data.message || 'The LMS could not be asked') : '';
  const whose = data?.reach === 'all' ? 'every Forex applicant' : 'your students';

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <PageTitle eyebrow="Students" icon={ClipboardCheck}>LMS Requests</PageTitle>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
              Enrolment requests in the Delta LMS — {whose}. Approve lets them in on Forex, and the LMS tells them by email and
              WhatsApp; Reject turns them away with your reason, which they're emailed.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, email, phone, STU code…" className="pl-8" />
            </div>
            <Button variant="outline" size="icon" title="Ask the LMS again" disabled={isFetching} onClick={() => refetch()}>
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              title={t.title}
              onClick={() => { setTab(t.key); setPage(1); }}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors',
                tab === t.key ? 'border-brand-navy bg-brand-navy text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {t.label}
              {t.key === 'pending' && count?.pending != null && (
                <span className={cn('ml-1 tabular-nums', tab === t.key ? 'text-white/80' : 'text-slate-400')}>{count.pending}</span>
              )}
            </button>
          ))}
        </div>

        <Card className="overflow-hidden border-gray-200">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : notice ? <Empty>{notice}</Empty> : shown.length === 0 ? (
              <Empty>{requests.length === 0 ? (tab === 'pending' ? 'Nobody is waiting to be let in.' : 'No requests here.') : 'No request matches that search.'}</Empty>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <th className="px-4 py-2.5">Applied</th>
                        <th className="px-4 py-2.5">Student</th>
                        <th className="px-4 py-2.5">Applied to</th>
                        <th className="px-4 py-2.5">Phone · Country</th>
                        <th className="px-4 py-2.5">Here</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((r) => {
                        const s = STATUS[r.status] || STATUS.pending;
                        return (
                          <tr key={r.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                            <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{when(r.appliedAt)}</td>
                            <td className="px-4 py-2.5">
                              <div className="font-medium text-slate-900">{r.name || '—'}</div>
                              <div className="text-xs text-slate-500">{r.email}</div>
                              {r.academy && <div className="text-[11px] text-slate-400">{r.academy}</div>}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex max-w-[220px] flex-wrap gap-1">
                                {(r.programs?.length ? r.programs : ['—']).map((p) => <span key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{p}</span>)}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                              <div>{r.phone || '—'}</div>
                              <div className="text-xs text-slate-400">{r.country}</div>
                            </td>
                            <td className="px-4 py-2.5">
                              {r.student ? (
                                <Link to={`${createPageUrl('StudentDetail')}?id=${r.student.id}`} className="hover:text-blue-600">
                                  <div className="font-mono text-xs text-blue-600">{r.student.code || 'Student'}</div>
                                  <div className="text-xs text-slate-500">{[r.student.cs, r.student.team].filter(Boolean).join(' · ')}</div>
                                </Link>
                              ) : <span className="text-xs text-slate-400">Not in the portal</span>}
                            </td>
                            <td className="px-4 py-2.5">
                              <Badge variant="outline" className={s.cls}>{s.label}</Badge>
                              {r.decidedBy && <div className="mt-1 text-xs text-slate-500">{r.decidedBy}{r.decidedAt ? ` · ${when(r.decidedAt)}` : ''}</div>}
                              {r.reason && <div className="mt-0.5 max-w-[240px] text-xs text-rose-700">{r.reason}</div>}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex justify-end gap-1.5">
                                <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs" onClick={() => setViewing(r)}>
                                  <Eye className="h-3.5 w-3.5" /> View
                                </Button>
                                {r.status !== 'approved' && (
                                  <Button size="sm" className="h-8 gap-1 bg-emerald-600 px-2 text-xs hover:bg-emerald-700" onClick={() => decide('approve', r)}>
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                                  </Button>
                                )}
                                {r.status === 'pending' && (
                                  <Button size="sm" variant="outline" className="h-8 gap-1 border-rose-300 px-2 text-xs text-rose-700 hover:bg-rose-50" onClick={() => decide('reject', r)}>
                                    <XCircle className="h-3.5 w-3.5" /> Reject
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <TablePagination page={page} pageSize={data?.perPage || 50} total={data?.total || 0} onPageChange={setPage} busy={isFetching} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
      {/* Each opens fresh for its request — a reason half-typed for one never reaches another */}
      {viewing && <RequestDialog key={viewing.id} request={viewing} onClose={() => setViewing(null)} onDecide={decide} />}
      {decision && <DecisionDialog key={`${decision.kind}-${decision.request.id}`} decision={decision} onClose={() => setDecision(null)} onDone={refresh} />}
    </div>
  );
}
