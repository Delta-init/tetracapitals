import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Mail, MessageCircle, Search } from 'lucide-react';
import { useUrlState } from '@/components/utils/urlState';
import { TablePagination, useUrlPage, useResetPage } from '@/components/common/TablePagination';
import { EmailDialog, StatusBadge, WhatsAppEntry, when } from '@/components/messages/MessageLogUi';

/* ────────────────────────────────────────────────────────────────────────────
   Message Logs (the user, 2026-10-29): the emails and WhatsApp messages our
   students were sent, as the LMS's Email Logs and WhatsApp Logs pages — one
   page, two tabs, the same filters, the counts. A CS their students, leaders
   their team's or location's, Super Admins everyone's (backend
   functions/messageLogs.ts). Email: the portal's and the LMS's; WhatsApp: the
   LMS's (class reminders, join and sign-in links). The LMS keeps 30 days.
──────────────────────────────────────────────────────────────────────────── */

const fn = async (name, body) => (await base44.functions.invoke(name, body)).data;

function Counts({ title, c }) {
  if (!c) return null;
  return (
    <Card className="border-slate-200">
      <CardContent className="p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
        <div className="mt-1 text-2xl font-semibold text-brand-navy">{c.total}</div>
        <div className="mt-1 flex flex-wrap gap-3 text-xs">
          <span className="text-emerald-700">{c.sent} sent</span>
          <span className="text-rose-700">{c.failed} not sent</span>
          <span className="text-amber-700">{c.pending} waiting</span>
        </div>
      </CardContent>
    </Card>
  );
}

function StudentTag({ s, fallback }) {
  if (!s) return <span className="text-xs text-slate-500">{fallback}</span>;
  return (
    <Link to={`${createPageUrl('StudentDetail')}?id=${s.id}`} className="text-xs text-blue-600 hover:underline">
      {s.name || 'Student'}{s.code ? ` · ${s.code}` : ''}{s.cs_name ? ` · CS ${s.cs_name}` : ''}
    </Link>
  );
}

export default function MessageLogs() {
  const [tab, setTab] = useUrlState('tab', 'email');
  const [status, setStatus] = useUrlState('status', 'all');
  const [source, setSource] = useUrlState('source', 'all');
  const [template, setTemplate] = useUrlState('template', 'all');
  const [from, setFrom] = useUrlState('from', '');
  const [until, setUntil] = useUrlState('until', '');
  const [q, setQ] = useUrlState('q', '');
  const [typed, setTyped] = useState(q);
  useEffect(() => { const t = setTimeout(() => setQ(typed.trim()), 400); return () => clearTimeout(t); }, [typed]);
  const { page, pageSize, setPage, setPageSize } = useUrlPage();
  useResetPage(`${tab}|${status}|${source}|${template}|${from}|${until}|${q}`, setPage);
  const [open, setOpen] = useState(null);

  const email = tab === 'email';
  const body = {
    channel: tab, page, limit: pageSize, q,
    ...(status !== 'all' ? { status } : {}), ...(from ? { from } : {}), ...(until ? { until } : {}),
    ...(email && source !== 'all' ? { source } : {}), ...(!email && template !== 'all' ? { template } : {}),
  };
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['message-logs', body], queryFn: () => fn('getMessageLogs', body), retry: false, placeholderData: keepPreviousData,
  });
  // The counts come with page 1; kept while paging.
  const [summary, setSummary] = useState(null);
  const [templates, setTemplates] = useState([]);
  useEffect(() => { if (data?.summary !== undefined && data?.page === 1) setSummary(data.summary); }, [data]);
  useEffect(() => { if (data?.templates?.length) setTemplates(data.templates); }, [data?.templates]);
  useEffect(() => { setSummary(null); }, [tab]);
  const rows = data?.rows ?? [];
  const cap = Math.floor(500 / pageSize) * pageSize;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Message Logs</h1>
        <p className="text-sm text-slate-500">Emails and WhatsApp messages your students were sent — by the portal and the LMS. The LMS keeps its messages 30 days.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="email"><Mail className="mr-1.5 h-4 w-4" />Email</TabsTrigger>
          <TabsTrigger value="whatsapp"><MessageCircle className="mr-1.5 h-4 w-4" />WhatsApp</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-3 sm:grid-cols-2">
        <Counts title="Today" c={summary?.today} />
        <Counts title="Last 7 days" c={summary?.last7Days} />
      </div>

      <Card className="border-slate-200">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <label className="min-w-[200px] flex-1 text-xs text-slate-600">
            Search
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Student name, code, email or phone" className="pl-8" />
            </div>
          </label>
          <label className="text-xs text-slate-600">
            Status
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="mt-1 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any</SelectItem><SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Not sent</SelectItem><SelectItem value="pending">Waiting</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {email ? (
            <label className="text-xs text-slate-600">
              From
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="mt-1 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Portal + LMS</SelectItem><SelectItem value="portal">The portal</SelectItem><SelectItem value="lms">The LMS</SelectItem>
                </SelectContent>
              </Select>
            </label>
          ) : (
            <label className="text-xs text-slate-600">
              Template
              <Select value={template} onValueChange={setTemplate}>
                <SelectTrigger className="mt-1 w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every template</SelectItem>
                  {templates.map(t => <SelectItem key={t.name} value={t.name}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          )}
          <label className="text-xs text-slate-600">Day from<Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1 w-40" /></label>
          <label className="text-xs text-slate-600">to<Input type="date" value={until} onChange={e => setUntil(e.target.value)} className="mt-1 w-40" /></label>
        </CardContent>
      </Card>

      {data?.lms?.available === false && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">LMS messages aren't shown: {data.lms.message}</p>
      )}

      <Card className="overflow-hidden border-slate-200">
        <CardContent className="p-0">
          {isLoading ? <div className="flex items-center gap-2 p-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
            : error ? <p className="m-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{/unknown function|not found|404/i.test(String(error?.message)) ? 'Message Logs show after the server update (the API deploy).' : error.message}</p>
            : !rows.length ? <p className="p-6 text-sm text-slate-500">No messages match.</p>
            : email ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr><th className="px-4 py-2 font-medium">When</th><th className="px-4 py-2 font-medium">To</th><th className="px-4 py-2 font-medium">Subject</th><th className="px-4 py-2 font-medium">From</th><th className="px-4 py-2 font-medium">Status</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map(r => (
                      <tr key={`${r.source}:${r.id}`} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(r)}>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{when(r.at)}</td>
                        <td className="px-4 py-2.5"><div className="text-slate-800">{r.to}</div><StudentTag s={r.student} fallback="" /></td>
                        <td className="px-4 py-2.5"><div className="text-slate-900">{r.subject || '(no subject)'}</div>{r.error && <div className="text-xs text-rose-700">{r.error}</div>}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">{r.source === 'lms' ? 'LMS' : `Portal${r.by ? ` · ${r.by}` : ''}`}</td>
                        <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {rows.map(r => <WhatsAppEntry key={r.id} row={r} showStudent student={<StudentTag s={r.student} fallback={r.person?.name || ''} />} />)}
              </div>
            )}
        </CardContent>
      </Card>
      <TablePagination page={page} pageSize={pageSize} total={email ? Math.min(data?.total || 0, cap) : data?.total || 0}
        onPageChange={setPage} onPageSizeChange={setPageSize} busy={isFetching} />
      {email && (data?.total || 0) > cap && <p className="text-xs text-slate-500">Showing the newest {cap} of {data.total} — narrow it with the filters to see older ones.</p>}

      <EmailDialog
        open={open} title={open?.subject} onClose={() => setOpen(null)}
        description={open ? `${open.source === 'lms' ? 'From the LMS' : 'From the portal'} · to ${open.to} · ${when(open.at)}${open.error ? ` · ${open.error}` : ''}` : ''}
        queryKey={['message-log-email', open?.source, open?.id]}
        load={() => fn('getMessageLogEmail', { source: open.source, id: open.id, to: open.to })}
      />
    </div>
  );
}
