import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/common/PageHeader';
import { TablePagination, useUrlPage, useResetPage } from '@/components/common/TablePagination';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, ArrowRightLeft, ExternalLink, FileSpreadsheet, FileText, Link2, Loader2, Search, Sparkles, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { createPageUrl } from '@/utils';
import { downloadExcel } from '@/components/utils/excelExport';
import { aed, dayText, coursesOf, InvoiceStatus } from '@/components/students/ZohoInvoicesCard';

/* ────────────────────────────────────────────────────────────────────────────
   Invoices (the user, 2026-10-07): the Zoho Books invoices, Jan 2024 – Jun 2026,
   each with the student it is for. A CS sees only their own students', a leader
   their team's, an admin everyone's (backend/src/functions/zohoInvoices.ts).
   Not linked — no sure match to a student — is a Super Admin's / Admin's / CS
   Manager's to link by hand (CS Managers see every invoice, 2026-10-13). 2026-10-13: each Not linked one with the student it is most likely
   for (Strong / Likely / Weak — backend students/zohoSuggest.ts), linked in one
   click, and a filter by it; the Link window shows the student picked with
   their Zoho and Delta finance invoices before linking; and Finance invoices —
   the students' Delta finance course fees — as a tab of its own.
──────────────────────────────────────────────────────────────────────────── */

const NOT_LINKED_WHY = {
  'name only': 'Only the name matches a student',
  'email and phone disagree': 'Email and phone are two different students',
  'several students': 'Email or phone is on several students',
  'no match': 'Not in the portal',
  'taken off by hand': 'Taken off a student by hand',
};

const STRENGTH = {
  strong: { label: 'Strong', cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  likely: { label: 'Likely', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  weak: { label: 'Weak', cls: 'border-slate-200 bg-slate-50 text-slate-600' },
};
export const StrengthChip = ({ strength }) => strength
  ? <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${STRENGTH[strength]?.cls}`}>{STRENGTH[strength]?.label}</span> : null;

export default function ZohoInvoices() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('linked');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [year, setYear] = useState('all');
  const [status, setStatus] = useState('all');
  const [course, setCourse] = useState('all');
  const [cs, setCs] = useState('all');
  const [suggested, setSuggested] = useState('all');
  const finance = tab === 'finance';
  // The page and rows per page live in the address (?page=, ?limit=) — Back and a refresh land on the same page.
  const { page, setPage, pageSize, setPageSize } = useUrlPage();
  const [linking, setLinking] = useState(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const filters = { tab, search: q, year, status, course, cs, ...(tab === 'not_linked' && suggested !== 'all' ? { suggested } : {}) };
  const key = JSON.stringify(filters);
  useResetPage(key, setPage);

  const { data: options } = useQuery({
    queryKey: ['zoho-invoices', 'options'],
    queryFn: async () => (await base44.functions.invoke('getZohoInvoiceOptions', {})).data,
    staleTime: 5 * 60_000,
  });
  const { data: list, isLoading, isFetching } = useQuery({
    queryKey: ['zoho-invoices', 'page', key, page, pageSize],
    queryFn: async () => (await base44.functions.invoke(finance ? 'listFinanceInvoices' : 'listZohoInvoices', { ...filters, page, pageSize })).data,
    placeholderData: (prev) => prev,
  });
  const rows = list?.rows || [];
  const t = list?.totals;
  const mayLink = options?.not_linked !== undefined;

  const exportExcel = async () => {
    setExporting(true);
    try {
      if (finance) {
        const all = (await base44.functions.invoke('listFinanceInvoices', { ...filters, all: true })).data;
        await downloadExcel({
          fileName: `finance_invoices_${new Date().toISOString().slice(0, 10)}.xlsx`,
          sheet: 'Finance invoices',
          columns: [
            { header: 'Invoice' }, { header: 'Date', type: 'date' }, { header: 'Student' }, { header: 'Code' }, { header: 'CS' }, { header: 'Course', width: 32 },
            { header: 'Currency' }, { header: 'Total', type: 'number' }, { header: 'Paid', type: 'number' }, { header: 'Balance', type: 'number' },
            { header: 'Collected', type: 'number' }, { header: 'Bonus', type: 'number' }, { header: 'Receipts', width: 50 },
          ],
          rows: (all?.rows || []).map(r => [r.number, r.date, r.student_name || (r.suggestions?.[0] ? `Suggested (${r.suggestions[0].strength}): ${r.suggestions[0].student_code} ${r.suggestions[0].full_name}` : ''), r.student_code, r.cs_name, r.course, r.currency, r.total, r.paid, r.balance, r.collected, r.bonus, (r.receipts || []).join(' ')]),
        });
        return;
      }
      const all = (await base44.functions.invoke('listZohoInvoices', { ...filters, all: true })).data;
      await downloadExcel({
        fileName: `zoho_invoices_${tab}_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheet: 'Invoices',
        columns: [
          { header: 'Invoice' }, { header: 'Date', type: 'date' }, { header: 'Student' }, { header: 'Code' }, { header: 'CS' },
          { header: 'Customer (Zoho)' }, { header: 'Email' }, { header: 'Phone' }, { header: 'Courses', width: 40 },
          { header: 'Total', type: 'number' }, { header: 'Paid', type: 'number' }, { header: 'Balance', type: 'number' }, { header: 'Status' }, { header: 'Sales person' },
        ],
        rows: (all?.rows || []).map(r => [r.number, r.date, r.student_name, r.student_code, r.cs_name, r.customer?.name, r.customer?.email, r.customer?.phone,
          coursesOf(r), r.total, r.paid, r.balance, r.status, r.sales_person]),
      });
    } catch (e) {
      toast.error(e?.message || 'Could not make the Excel file');
    } finally {
      setExporting(false);
    }
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['zoho-invoices'] });
  const linkTo = async (inv, s) => {
    try {
      await base44.functions.invoke('linkZohoInvoice', { invoiceId: inv.id, studentId: s.student_id });
      toast.success(`${inv.number} linked to ${s.full_name}`);
      refresh();
    } catch (e) {
      toast.error(e?.message || 'Could not link it');
    }
  };
  const unlink = async (inv) => {
    try {
      await base44.functions.invoke('linkZohoInvoice', { invoiceId: inv.id, studentId: null });
      toast.success(`${inv.number} taken off ${inv.student_name || 'the student'} — it is under Not linked`);
      refresh();
    } catch (e) {
      toast.error(e?.message || 'Could not take it off');
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <PageHeader
          eyebrow="Students"
          title="Invoices"
          icon={FileText}
          description="Zoho Books invoices, Jan 2024 – Jun 2026 — your students' only; each with its courses, what was paid and what is still owed."
          actions={<Button variant="outline" onClick={exportExcel} disabled={exporting || !list?.total}>
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}Excel
          </Button>}
        />

        {t && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[['Invoices', t.count.toLocaleString()], ['Total', aed(t.total)], ['Paid', aed(t.paid)], ['Owed', aed(t.balance)], ['Overdue', t.overdue.toLocaleString()]].map(([label, value]) => (
              <Card key={label} className="border-gray-200"><CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
                <p className={`mt-1 text-lg font-semibold ${label === 'Owed' || label === 'Overdue' ? 'text-rose-700' : 'text-gray-900'}`}>{value}</p>
              </CardContent></Card>
            ))}
          </div>
        )}

        <Card className="border-gray-200">
          <CardContent className="space-y-3 p-4">
            <Tabs value={tab} onValueChange={(v) => { setTab(v); setCourse('all'); setCs('all'); }}>
              <TabsList>
                <TabsTrigger value="linked">{mayLink ? 'Linked to a student' : 'Zoho invoices'}</TabsTrigger>
                {mayLink && <TabsTrigger value="not_linked">Not linked ({(options?.not_linked ?? 0).toLocaleString()})</TabsTrigger>}
                <TabsTrigger value="finance">Finance invoices</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex flex-col gap-3 md:flex-row md:flex-wrap">
              <div className="relative flex-1 md:min-w-[260px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice number, name, email or phone…" className="pl-10" />
              </div>
              <Select value={year} onValueChange={(v) => v && setYear(v)}>
                <SelectTrigger className="w-full md:w-36"><SelectValue placeholder="Year" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every year</SelectItem>
                  {(options?.years || []).map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
              {tab === 'not_linked' && (
                <Select value={suggested} onValueChange={(v) => v && setSuggested(v)}>
                  <SelectTrigger className="w-full md:w-52"><SelectValue placeholder="Suggested student" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any suggestion or none</SelectItem>
                    {['strong', 'likely', 'weak'].map(k => <SelectItem key={k} value={k}>{STRENGTH[k].label} suggestion{list?.suggested_counts ? ` (${list.suggested_counts[k]})` : ''}</SelectItem>)}
                    <SelectItem value="any">Any suggestion</SelectItem>
                    <SelectItem value="none">No suggestion{list?.suggested_counts ? ` (${list.suggested_counts.none})` : ''}</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {!finance && <Select value={status} onValueChange={(v) => v && setStatus(v)}>
                <SelectTrigger className="w-full md:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any status</SelectItem>
                  <SelectItem value="Overdue">Overdue</SelectItem>
                  <SelectItem value="Closed">Closed</SelectItem>
                </SelectContent>
              </Select>}
              <Select value={course} onValueChange={(v) => v && setCourse(v)}>
                <SelectTrigger className="w-full md:w-56"><SelectValue placeholder="Course" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every course</SelectItem>
                  {((finance ? list?.courses : options?.courses) || []).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              {tab !== 'not_linked' && (((finance ? list?.mentors : options?.mentors)?.length) || 0) > 1 && (
                <Select value={cs} onValueChange={(v) => v && setCs(v)}>
                  <SelectTrigger className="w-full md:w-48"><SelectValue placeholder="CS" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Every CS</SelectItem>
                    {((finance ? list?.mentors : options?.mentors) || []).map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200">
          <CardContent className="p-0">
            {finance ? <FinanceTable rows={rows} isLoading={isLoading} /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Invoice</th>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">{tab === 'linked' ? 'Student' : 'Customer (Zoho)'}</th>
                    <th className="px-4 py-3 font-semibold">Courses</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 text-right font-semibold">Paid</th>
                    <th className="px-4 py-3 text-right font-semibold">Balance</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    {mayLink && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {isLoading && <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-500"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
                  {!isLoading && !rows.length && <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-500">No invoices match.</td></tr>}
                  {rows.map(inv => (
                    <tr key={inv.id} className={inv.status === 'Overdue' ? 'bg-rose-50/40' : ''}>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-800">{inv.number}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-gray-700">{dayText(inv.date)}</td>
                      <td className="min-w-[200px] px-4 py-2.5">
                        {tab === 'linked' ? (
                          <>
                            <Link to={`${createPageUrl('StudentDetail')}?id=${inv.student_id}&tab=courses`} className="font-medium text-blue-700 hover:underline">{inv.student_name || '—'}</Link>
                            <div className="text-xs text-gray-500">{[inv.student_code, inv.cs_name].filter(Boolean).join(' · ')}</div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium text-gray-900">{inv.customer?.name}</div>
                            <div className="break-all text-xs text-gray-500">{[inv.customer?.email, inv.customer?.phone].filter(Boolean).join(' · ')}</div>
                            <div className="text-xs text-amber-700">{NOT_LINKED_WHY[inv.not_linked_why] || inv.not_linked_why}</div>
                            {inv.suggestions?.[0] && (
                              <div className="mt-1.5 rounded-md border border-dashed border-slate-200 px-2 py-1 text-xs">
                                <div className="flex items-center gap-1.5">
                                  <Sparkles className="h-3 w-3 text-violet-500" />
                                  <StrengthChip strength={inv.suggestions[0].strength} />
                                  <Link to={`${createPageUrl('StudentDetail')}?id=${inv.suggestions[0].student_id}&tab=courses`} className="font-medium text-blue-700 hover:underline">
                                    {inv.suggestions[0].student_code} {inv.suggestions[0].full_name}
                                  </Link>
                                </div>
                                <div className="text-slate-500">{[inv.suggestions[0].email, inv.suggestions[0].cs].filter(Boolean).join(' · ')} — {inv.suggestions[0].how.join(' + ')}</div>
                                {inv.suggestions.length > 1 && <div className="text-slate-400">+{inv.suggestions.length - 1} more in the Link window</div>}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="min-w-[180px] px-4 py-2.5 text-gray-700">{coursesOf(inv)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-900">{aed(inv.total, inv.currency)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right text-emerald-700">{aed(inv.paid, inv.currency)}</td>
                      <td className={`whitespace-nowrap px-4 py-2.5 text-right ${inv.balance > 0 ? 'font-semibold text-rose-700' : 'text-gray-500'}`}>{aed(inv.balance, inv.currency)}</td>
                      <td className="px-4 py-2.5"><InvoiceStatus status={inv.status} /></td>
                      {mayLink && (
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">
                          {tab === 'linked'
                            ? <>
                                {/* To another student in one step (the user, 2026-10-07) — kept so when the import runs again */}
                                <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setLinking(inv)} title="Move it to another student"><ArrowRightLeft className="h-3.5 w-3.5" />Move</Button>
                                <Button size="sm" variant="ghost" className="ml-1 h-7 gap-1 px-2 text-xs text-gray-500" onClick={() => unlink(inv)} title="Take it off this student"><Unlink className="h-3.5 w-3.5" />Unlink</Button>
                              </>
                            : <div className="flex flex-col items-end gap-1">
                                {inv.suggestions?.[0] && (
                                  <Button size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => linkTo(inv, inv.suggestions[0])} title={`Link to ${inv.suggestions[0].full_name}`}>
                                    <Link2 className="h-3.5 w-3.5" />Link to {inv.suggestions[0].student_code}
                                  </Button>
                                )}
                                <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setLinking(inv)}><Search className="h-3.5 w-3.5" />{inv.suggestions?.[0] ? 'Check / other student' : 'Link to a student'}</Button>
                              </div>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
            <div className="p-3">
              <TablePagination page={list?.page || page} pageSize={pageSize} total={list?.total || 0} onPageChange={setPage} onPageSizeChange={setPageSize} busy={isFetching} />
            </div>
          </CardContent>
        </Card>
      </div>
      {linking && <LinkDialog invoice={linking} onClose={() => setLinking(null)} onLinked={() => { setLinking(null); refresh(); }} />}
    </div>
  );
}

/** The students' Delta finance invoices (course fees) — the Finance invoices tab. */
function FinanceTable({ rows, isLoading }) {
  const money = (n, cur) => (n == null ? '—' : aed(n, cur));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Invoice</th>
            <th className="px-4 py-3 font-semibold">Date</th>
            <th className="px-4 py-3 font-semibold">Student</th>
            <th className="px-4 py-3 font-semibold">Course</th>
            <th className="px-4 py-3 text-right font-semibold">Total</th>
            <th className="px-4 py-3 text-right font-semibold">Paid</th>
            <th className="px-4 py-3 text-right font-semibold">Balance</th>
            <th className="px-4 py-3 text-right font-semibold">Collected</th>
            <th className="px-4 py-3 font-semibold">Receipts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {isLoading && <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-500"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
          {!isLoading && !rows.length && <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-500">No finance invoices match.</td></tr>}
          {rows.map((f, i) => (
            <tr key={`${f.student_id}-${f.invoice_id || f.number}-${i}`}>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-800">
                {f.number || '—'}
                {f.source === 'cs_tracker' && <div className="font-sans text-[10px] text-slate-400">CS tracker</div>}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-gray-700">{f.date ? dayText(f.date) : '—'}</td>
              <td className="min-w-[200px] px-4 py-2.5">
                <Link to={`${createPageUrl('StudentDetail')}?id=${f.student_id}&tab=courses`} className="font-medium text-blue-700 hover:underline">{f.student_name || '—'}</Link>
                <div className="text-xs text-gray-500">{[f.student_code, f.cs_name].filter(Boolean).join(' · ')}</div>
              </td>
              <td className="min-w-[160px] px-4 py-2.5 text-gray-700">
                {f.course || '—'}
                {f.bonus > 0 && <div className="text-[11px] text-emerald-700">Bonus {money(f.bonus, f.bonus_currency)}</div>}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-900">{money(f.total, f.currency)}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right text-emerald-700">{money(f.paid, f.currency)}</td>
              <td className={`whitespace-nowrap px-4 py-2.5 text-right ${f.balance > 0 ? 'font-semibold text-rose-700' : 'text-gray-500'}`}>{money(f.balance, f.currency)}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right text-gray-700">
                {money(f.collected, f.currency)}
                {f.collected_method && <div className="text-[11px] text-slate-400">{f.collected_method}</div>}
              </td>
              <td className="px-4 py-2.5">
                {f.receipts?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {f.receipts.map((u, k) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-blue-700 hover:bg-blue-50">
                        <ExternalLink className="h-3 w-3" />{f.receipts.length > 1 ? k + 1 : 'View'}
                      </a>
                    ))}
                  </div>
                ) : <span className="text-xs text-slate-400">None</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A student's Zoho and Delta finance invoices, in the Link window — so a second copy is seen before linking. */
function StudentInvoices({ studentId, invoice }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['zoho-invoices', 'student-for-link', studentId],
    queryFn: async () => (await base44.functions.invoke('getStudentInvoicesForLink', { studentId })).data,
  });
  if (isLoading) return <div className="flex items-center gap-2 py-4 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Their invoices…</div>;
  if (error) return <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{/unknown function|not found|404/i.test(String(error?.message)) ? 'Their invoices show after the server update (the API deploy).' : error.message}</p>;
  const zoho = data?.zoho || [], fin = data?.finance || [];
  const sameNumber = zoho.find(z => z.number === invoice.number);
  return (
    <div className="space-y-2 text-xs">
      {sameNumber && <p className="rounded-md bg-rose-50 px-2 py-1.5 font-medium text-rose-700">{invoice.number} is already theirs.</p>}
      <div>
        <p className="mb-1 font-semibold uppercase tracking-wider text-slate-500">Zoho invoices ({zoho.length})</p>
        {zoho.length ? zoho.map(z => (
          <div key={z.id} className="flex justify-between gap-2 border-b border-slate-100 py-1">
            <span><span className="font-mono">{z.number}</span> · {dayText(z.date)} · {(z.courses || []).join(', ')}</span>
            <span className="whitespace-nowrap">{aed(z.total, z.currency)} <span className="text-slate-400">({z.status})</span></span>
          </div>
        )) : <p className="text-slate-400">None</p>}
      </div>
      <div>
        <p className="mb-1 font-semibold uppercase tracking-wider text-slate-500">Delta finance invoices ({fin.length})</p>
        {fin.length ? fin.map((f, i) => (
          <div key={`${f.invoice_id}-${i}`} className="flex justify-between gap-2 border-b border-slate-100 py-1">
            <span><span className="font-mono">{f.number || '—'}</span>{f.date ? ` · ${dayText(f.date)}` : ''} · {f.course || '—'}{f.source === 'cs_tracker' ? ' · CS tracker' : ''}</span>
            <span className="whitespace-nowrap">{aed(f.total, f.currency)} · paid {aed(f.paid, f.currency)}</span>
          </div>
        )) : <p className="text-slate-400">None</p>}
      </div>
    </div>
  );
}

/** Pick the student an invoice is for — the suggested ones first, or searched by name, email or code; the student
 *  picked is shown with their Zoho and finance invoices before it is linked. A Not linked invoice is linked; a linked
 *  one is moved from its student to the one picked. */
function LinkDialog({ invoice, onClose, onLinked }) {
  const moving = !!invoice.student_id;
  const [q, setQ] = useState(invoice.suggestions?.length ? '' : (invoice.customer?.email || invoice.customer?.name || ''));
  const [picked, setPicked] = useState(null);   // { id, full_name, student_code, email, cs }
  const [busy, setBusy] = useState(false);
  const { data: found = [], isFetching } = useQuery({
    queryKey: ['zoho-invoices', 'link-search', q],
    queryFn: async () => (await base44.functions.invoke('searchStudents', { q })).data || [],
    enabled: q.trim().length >= 2,
  });
  const link = async () => {
    if (picked.id === invoice.student_id) { toast.info(`${invoice.number} is already ${picked.full_name}'s`); return; }
    setBusy(true);
    try {
      await base44.functions.invoke('linkZohoInvoice', { invoiceId: invoice.id, studentId: picked.id });
      toast.success(moving ? `${invoice.number} moved from ${invoice.student_name || 'their student'} to ${picked.full_name}` : `${invoice.number} linked to ${picked.full_name}`);
      onLinked();
    } catch (e) {
      toast.error(e?.message || (moving ? 'Could not move it' : 'Could not link it'));
      setBusy(false);
    }
  };
  const row = (key, s, extra) => (
    <button key={key} type="button" disabled={busy} onClick={() => setPicked(s)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-left hover:border-blue-300 hover:bg-blue-50/40 disabled:opacity-50">
      <span className="min-w-0">
        <span className="block truncate font-medium text-gray-900">{s.full_name}</span>
        <span className="block truncate text-xs text-gray-500">{[s.student_code, s.email, s.cs].filter(Boolean).join(' · ')}</span>
        {extra}
      </span>
      <Search className="h-4 w-4 shrink-0 text-blue-600" />
    </button>
  );
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{moving ? `Move ${invoice.number} to another student` : `Link ${invoice.number} to a student`}</DialogTitle>
          <DialogDescription>
            {moving && <span className="block font-medium text-slate-700">Now on {invoice.student_name || 'a student'}{invoice.student_code ? ` (${invoice.student_code})` : ''}</span>}
            {invoice.customer?.name} · {[invoice.customer?.email, invoice.customer?.phone].filter(Boolean).join(' · ')} · {aed(invoice.total, invoice.currency)} · {coursesOf(invoice)}
          </DialogDescription>
        </DialogHeader>
        {picked ? (
          <div className="space-y-3">
            <button type="button" onClick={() => setPicked(null)} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><ArrowLeft className="h-3 w-3" /> Another student</button>
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2">
              <div className="font-medium text-gray-900">{picked.full_name}</div>
              <div className="text-xs text-gray-500">{[picked.student_code, picked.email, picked.cs].filter(Boolean).join(' · ')}</div>
            </div>
            <StudentInvoices studentId={picked.id} invoice={invoice} />
            <Button className="w-full" onClick={link} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
              {moving ? 'Move' : 'Link'} {invoice.number} to {picked.full_name}
            </Button>
          </div>
        ) : (
          <>
            {invoice.suggestions?.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Suggested</p>
                {invoice.suggestions.map(s => row(`s-${s.student_id}`, { id: s.student_id, full_name: s.full_name, student_code: s.student_code, email: s.email, cs: s.cs },
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500"><StrengthChip strength={s.strength} /> {s.how.join(' + ')}</span>))}
              </div>
            )}
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Or search: student name, email or code…" autoFocus={!invoice.suggestions?.length} />
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {isFetching && <Loader2 className="mx-auto h-4 w-4 animate-spin text-gray-400" />}
              {!isFetching && q.trim().length >= 2 && !found.length && <p className="py-4 text-center text-sm text-gray-500">No student found — try their name or another email.</p>}
              {found.map(s => row(s.id, { id: s.id, full_name: s.full_name, student_code: s.student_code, email: s.email, cs: s.primary_mentor_name }))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
