import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { aed, dayText, coursesOf, InvoiceStatus } from "@/components/students/ZohoInvoicesCard";
import { ReceiptsButton, methodsText } from "./payments";

/* ────────────────────────────────────────────────────────────────────────────
   The student's payments, beside a request being verified (the user,
   2026-10-07): their Zoho Books invoices, Delta finance's course fees and their
   other funding requests — to check this one against, without leaving the
   Process Funding Request window.
──────────────────────────────────────────────────────────────────────────── */

/** The student's Zoho Books invoices: { invoices, totals } — null while loading; { unavailable } before the API has them. */
export function useStudentZohoInvoices(studentId) {
  return useQuery({
    queryKey: ["zoho-invoices", "student", studentId],
    queryFn: async () => {
      try {
        return (await base44.functions.invoke("getStudentZohoInvoices", { studentId })).data;
      } catch (e) {
        return { invoices: [], totals: null, unavailable: e?.message || "Not available" };
      }
    },
    enabled: !!studentId,
  });
}

/** How many there are, for the tab's label. */
export const paymentsCount = (zoho, fees, others) => (zoho?.invoices?.length || 0) + (fees?.length || 0) + (others?.length || 0);

const usd = (n) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_CLS = { APPROVED: "border-emerald-200 bg-emerald-50 text-emerald-700", REJECTED: "border-rose-200 bg-rose-50 text-rose-700", PENDING: "border-amber-200 bg-amber-50 text-amber-800" };
const minor = (n) => (Number(n) || 0) / 100;

function Section({ title, sub, children }) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        {sub && <p className="text-xs text-gray-500">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export default function StudentPayments({ studentName, fees = [], others = [], zoho, loading }) {
  const invoices = zoho?.invoices || [];
  const t = zoho?.totals;
  return (
    <div className="space-y-5">
      <Section
        title={`Zoho Books invoices (${invoices.length})`}
        sub={zoho?.unavailable ? "Not available yet — the server isn't updated for Zoho invoices." : t ? `Total ${aed(t.total)} · Paid ${aed(t.paid)}${t.balance > 0 ? ` · Owed ${aed(t.balance)}` : ""}${t.overdue ? ` · ${t.overdue} overdue` : ""}` : "Jan 2024 – Jun 2026"}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          : !invoices.length ? <p className="text-sm text-gray-500">None for {studentName || "this student"}.</p>
          : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                  <tr><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Courses</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">Owed</th><th className="px-3 py-2">Status</th></tr>
                </thead>
                <tbody className="divide-y">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className={inv.status === "Overdue" ? "bg-rose-50/40" : ""}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{inv.number}</td>
                      <td className="whitespace-nowrap px-3 py-2">{dayText(inv.date)}</td>
                      <td className="min-w-[140px] px-3 py-2">{coursesOf(inv)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{aed(inv.total, inv.currency)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-emerald-700">{aed(inv.paid, inv.currency)}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right ${inv.balance > 0 ? "font-semibold text-rose-700" : "text-gray-500"}`}>{aed(inv.balance, inv.currency)}</td>
                      <td className="px-3 py-2"><InvoiceStatus status={inv.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Section>

      {fees.length > 0 && (
        <Section title={`Delta finance course fees (${fees.length})`} sub="As finance approved them">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                <tr><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Course</th><th className="px-3 py-2 text-right">Fee</th><th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">Balance</th></tr>
              </thead>
              <tbody className="divide-y">
                {fees.map((f, i) => (
                  <tr key={f.invoice_id || i}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{f.invoice_number || "—"}</td>
                    <td className="px-3 py-2">{f.course || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{f.fee_minor != null ? aed(minor(f.fee_minor), f.currency || "AED") : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-emerald-700">{f.paid_minor != null ? aed(minor(f.paid_minor), f.currency || "AED") : "—"}</td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right ${Number(f.balance_minor) > 0 ? "font-semibold text-rose-700" : "text-gray-500"}`}>{f.balance_minor != null ? aed(minor(f.balance_minor), f.currency || "AED") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title={`Their other funding requests (${others.length})`} sub="Deposits, withdrawals and bonuses in Tetra Commission — not this one">
        {!others.length ? <p className="text-sm text-gray-500">None.</p> : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Method</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Receipt</th></tr>
              </thead>
              <tbody className="divide-y">
                {others.map((tx) => (
                  <tr key={tx.id}>
                    <td className="whitespace-nowrap px-3 py-2">{dayText(String(tx.requested_at || tx.created_date || "").slice(0, 10))}</td>
                    <td className="px-3 py-2">{tx.type}{tx.tags?.length ? <span className="block text-xs text-gray-500">{tx.tags.join(", ")}</span> : null}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{usd(tx.amount_usd)}{Number(tx.amount_aed) > 0 && <span className="block text-xs text-gray-500">{aed(tx.amount_aed)}</span>}</td>
                    <td className="px-3 py-2">{methodsText(tx) || "—"}</td>
                    <td className="px-3 py-2"><Badge variant="outline" className={STATUS_CLS[tx.status] || ""}>{tx.status}</Badge>{tx.status === "REJECTED" && tx.rejection_reason && <span className="block max-w-[180px] text-xs text-rose-700">{tx.rejection_reason}</span>}</td>
                    <td className="px-3 py-2"><ReceiptsButton tx={tx} title={tx.student_name} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
