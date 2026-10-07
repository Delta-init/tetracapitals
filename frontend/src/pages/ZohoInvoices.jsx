import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/common/PageHeader';
import { TablePagination, DEFAULT_PAGE_SIZE } from '@/components/common/TablePagination';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowRightLeft, FileSpreadsheet, FileText, Link2, Loader2, Search, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { createPageUrl } from '@/utils';
import { downloadExcel } from '@/components/utils/excelExport';
import { aed, dayText, coursesOf, InvoiceStatus } from '@/components/students/ZohoInvoicesCard';

/* ────────────────────────────────────────────────────────────────────────────
   Invoices (the user, 2026-10-07): the Zoho Books invoices, Jan 2024 – Jun 2026,
   each with the student it is for. A CS sees only their own students', a leader
   their team's, an admin everyone's (backend/src/functions/zohoInvoices.ts).
   Not linked — no sure match to a student — is a Super Admin's / Admin's to link
   by hand.
──────────────────────────────────────────────────────────────────────────── */

const NOT_LINKED_WHY = {
  'name only': 'Only the name matches a student',
  'email and phone disagree': 'Email and phone are two different students',
  'several students': 'Email or phone is on several students',
  'no match': 'Not in the portal',
  'taken off by hand': 'Taken off a student by hand',
};

export default function ZohoInvoices() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('linked');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [year, setYear] = useState('all');
  const [status, setStatus] = useState('all');
  const [course, setCourse] = useState('all');
  const [cs, setCs] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [linking, setLinking] = useState(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);
  const filters = { tab, search: q, year, status, course, cs };
  const key = JSON.stringify(filters);
  useEffect(() => { setPage(1); }, [key, pageSize]);

  const { data: options } = useQuery({
    queryKey: ['zoho-invoices', 'options'],
    queryFn: async () => (await base44.functions.invoke('getZohoInvoiceOptions', {})).data,
    staleTime: 5 * 60_000,
  });
  const { data: list, isLoading, isFetching } = useQuery({
    queryKey: ['zoho-invoices', 'page', key, page, pageSize],
    queryFn: async () => (await base44.functions.invoke('listZohoInvoices', { ...filters, page, pageSize })).data,
    placeholderData: (prev) => prev,
  });
  const rows = list?.rows || [];
  const t = list?.totals;
  const mayLink = options?.not_linked !== undefined;

  const exportExcel = async () => {
    setExporting(true);
    try {
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
            {mayLink && (
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                  <TabsTrigger value="linked">Linked to a student</TabsTrigger>
                  <TabsTrigger value="not_linked">Not linked ({(options?.not_linked ?? 0).toLocaleString()})</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
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
              <Select value={status} onValueChange={(v) => v && setStatus(v)}>
                <SelectTrigger className="w-full md:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any status</SelectItem>
                  <SelectItem value="Overdue">Overdue</SelectItem>
                  <SelectItem value="Closed">Closed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={course} onValueChange={(v) => v && setCourse(v)}>
                <SelectTrigger className="w-full md:w-56"><SelectValue placeholder="Course" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every course</SelectItem>
                  {(options?.courses || []).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              {tab === 'linked' && (options?.mentors?.length || 0) > 1 && (
                <Select value={cs} onValueChange={(v) => v && setCs(v)}>
                  <SelectTrigger className="w-full md:w-48"><SelectValue placeholder="CS" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Every CS</SelectItem>
                    {options.mentors.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200">
          <CardContent className="p-0">
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
                            : <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setLinking(inv)}><Link2 className="h-3.5 w-3.5" />Link to a student</Button>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

/** Pick the student an invoice is for — searched by name, email or code; the customer's email to start. A Not linked
 *  invoice is linked; a linked one is moved from its student to the one picked. */
function LinkDialog({ invoice, onClose, onLinked }) {
  const moving = !!invoice.student_id;
  const [q, setQ] = useState(invoice.customer?.email || invoice.customer?.name || '');
  const [busy, setBusy] = useState(false);
  const { data: found = [], isFetching } = useQuery({
    queryKey: ['zoho-invoices', 'link-search', q],
    queryFn: async () => (await base44.functions.invoke('searchStudents', { q })).data || [],
    enabled: q.trim().length >= 2,
  });
  const link = async (s) => {
    if (s.id === invoice.student_id) { toast.info(`${invoice.number} is already ${s.full_name}'s`); return; }
    setBusy(true);
    try {
      await base44.functions.invoke('linkZohoInvoice', { invoiceId: invoice.id, studentId: s.id });
      toast.success(moving ? `${invoice.number} moved from ${invoice.student_name || 'their student'} to ${s.full_name}` : `${invoice.number} linked to ${s.full_name}`);
      onLinked();
    } catch (e) {
      toast.error(e?.message || (moving ? 'Could not move it' : 'Could not link it'));
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{moving ? `Move ${invoice.number} to another student` : `Link ${invoice.number} to a student`}</DialogTitle>
          <DialogDescription>
            {moving && <span className="block font-medium text-slate-700">Now on {invoice.student_name || 'a student'}{invoice.student_code ? ` (${invoice.student_code})` : ''}</span>}
            {invoice.customer?.name} · {[invoice.customer?.email, invoice.customer?.phone].filter(Boolean).join(' · ')} · {aed(invoice.total, invoice.currency)}
          </DialogDescription>
        </DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Student name, email or code…" autoFocus />
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {isFetching && <Loader2 className="mx-auto h-4 w-4 animate-spin text-gray-400" />}
          {!isFetching && q.trim().length >= 2 && !found.length && <p className="py-4 text-center text-sm text-gray-500">No student found — try their name or another email.</p>}
          {found.map(s => (
            <button key={s.id} type="button" disabled={busy} onClick={() => link(s)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2 text-left hover:border-blue-300 hover:bg-blue-50/40 disabled:opacity-50">
              <span className="min-w-0">
                <span className="block truncate font-medium text-gray-900">{s.full_name}</span>
                <span className="block truncate text-xs text-gray-500">{[s.student_code, s.email, s.primary_mentor_name].filter(Boolean).join(' · ')}</span>
              </span>
              <Link2 className="h-4 w-4 shrink-0 text-blue-600" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
