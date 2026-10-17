import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
   The student's emails (the user, 2026-10-17): what the portal sent them
   (kept from 2026-10-17, a year) and what the LMS sent them (its queue — sent
   mail 30 days, failed or cleared until purged), newest first. Open one to
   read it as they got it. backend functions/studentEmails.ts.
──────────────────────────────────────────────────────────────────────────── */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '—');
const STATUS = {
  sent: ['Sent', 'border-emerald-200 bg-emerald-50 text-emerald-700'],
  waiting: ['Waiting', 'border-amber-200 bg-amber-50 text-amber-800'],
  failed: ['Not sent', 'border-rose-200 bg-rose-50 text-rose-700'],
  not_sent: ['Not sent', 'border-rose-200 bg-rose-50 text-rose-700'],
};

export default function StudentEmailsCard({ studentId }) {
  const [source, setSource] = useState('all');
  const [open, setOpen] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['student-emails', studentId], enabled: !!studentId, retry: false,
    queryFn: () => fn('getStudentEmails', { studentId }),
  });
  const rows = (data?.emails ?? []).filter(e => source === 'all' || e.source === source);
  const counts = { portal: (data?.emails ?? []).filter(e => e.source === 'portal').length, lms: (data?.emails ?? []).filter(e => e.source === 'lms').length };

  return (
    <Card className="border-gray-200">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-gray-100">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold"><Mail className="h-5 w-5 text-blue-600" />Emails</CardTitle>
        <div className="flex rounded-full border border-slate-200 bg-white p-0.5 text-xs">
          {[['all', `All ${data ? `(${(data.emails ?? []).length})` : ''}`], ['portal', `Portal (${counts.portal})`], ['lms', `LMS (${counts.lms})`]].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setSource(k)} className={cn('rounded-full px-3 py-1', source === k ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-slate-50')}>{l}</button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {error ? (
          <p className="m-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(error?.message)) ? 'Emails show after the server update (the API deploy).' : error.message}</p>
        ) : isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
        ) : (
          <>
            <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
              {data?.addresses?.length ? `To ${data.addresses.join(', ')}` : 'No email on their record'} · portal emails from 17 Oct 2026 · LMS emails: sent ones from the last {data?.lms?.keptDays ?? 30} days
              {data?.lms && !data.lms.available && <span className="ml-1 text-amber-700">· LMS: {data.lms.message}</span>}
            </p>
            {!rows.length ? <p className="p-6 text-center text-sm text-gray-500">No emails to show.</p> : (
              <div className="divide-y divide-gray-100">
                {rows.map(e => {
                  const [label, cls] = STATUS[e.status] ?? [e.status, 'border-gray-200 text-gray-600'];
                  return (
                    <button key={`${e.source}-${e.id}`} type="button" onClick={() => setOpen(e)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-gray-50">
                      <Badge variant="outline" className={cn('shrink-0 text-[10px]', e.source === 'lms' ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-sky-200 bg-sky-50 text-sky-700')}>{e.source === 'lms' ? 'LMS' : 'Portal'}</Badge>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">{e.subject || '(no subject)'}</span>
                      <Badge variant="outline" className={cn('shrink-0 text-[10px]', cls)}>{label}</Badge>
                      <span className="shrink-0 text-xs text-gray-500">{when(e.at)}</span>
                      <span className="basis-full text-xs text-gray-400">{[e.kind, e.by && e.by !== 'LMS' ? `by ${e.by}` : '', e.error ? `— ${e.error}` : ''].filter(Boolean).join(' · ')}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
      {open && <EmailDialog studentId={studentId} email={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function EmailDialog({ studentId, email, onClose }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['student-email', email.source, email.id], retry: false,
    queryFn: () => fn('getStudentEmail', { studentId, source: email.source, id: email.id }),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">{email.subject || '(no subject)'}</DialogTitle>
          <DialogDescription>{email.source === 'lms' ? 'From the LMS' : 'From the portal'} · to {email.to} · {when(email.at)}{email.error ? ` · ${email.error}` : ''}</DialogDescription>
        </DialogHeader>
        {isLoading ? <div className="flex items-center gap-2 py-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Opening…</div>
          : error ? <p className="text-sm text-red-600">{error.message}</p>
          : data?.html ? <iframe title="The email" sandbox="" srcDoc={data.html} className="h-[65vh] w-full rounded-md border bg-white" />
          : <pre className="whitespace-pre-wrap rounded-md border bg-gray-50 p-3 text-sm">{data?.text || '(empty)'}</pre>}
      </DialogContent>
    </Dialog>
  );
}
