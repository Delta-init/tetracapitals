import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";

/* ────────────────────────────────────────────────────────────────────────────
   A student's Zoho Books invoices, Jan 2024 – Jun 2026 (the user, 2026-10-07):
   in Courses & fees, kept apart from Delta finance's course fees. Each with its
   courses, total, what was paid and what is still owed. From the Zoho import
   (backend/src/scripts/import-zoho-invoices.ts; functions/zohoInvoices.ts).
──────────────────────────────────────────────────────────────────────────── */

export const aed = (n, currency = "AED") =>
  `${currency} ${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dayText = (d) => {
  const at = /^\d{4}-\d{2}-\d{2}/.test(d || "") ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : null;
  return at ? at.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
};
export const coursesOf = (inv) => [...new Set((inv.items || []).map((i) => i.name).filter(Boolean))].join(", ") || "—";
export function InvoiceStatus({ status }) {
  return status === "Overdue"
    ? <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">Overdue</Badge>
    : <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">{status || "—"}</Badge>;
}

export default function ZohoInvoicesCard({ studentId }) {
  const { data } = useQuery({
    queryKey: ["zoho-invoices", "student", studentId],
    queryFn: async () => (await base44.functions.invoke("getStudentZohoInvoices", { studentId })).data,
    enabled: !!studentId,
  });
  const invoices = data?.invoices || [];
  if (!invoices.length) return null;
  const t = data.totals;
  return (
    <Card className="border-gray-200">
      <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-sky-50 to-indigo-50">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <FileText className="h-5 w-5 text-sky-600" />
          Zoho Books invoices ({invoices.length})
        </CardTitle>
        <p className="text-xs text-gray-500">
          From Zoho Books, Jan 2024 – Jun 2026 · Total {aed(t.total)} · Paid {aed(t.paid)}
          {t.balance > 0 && <> · <span className="font-medium text-rose-700">Owed {aed(t.balance)}</span></>}
          {t.overdue > 0 && <> · {t.overdue} overdue</>}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Invoice</th>
                <th className="px-4 py-2 font-semibold">Date</th>
                <th className="px-4 py-2 font-semibold">Courses</th>
                <th className="px-4 py-2 text-right font-semibold">Total</th>
                <th className="px-4 py-2 text-right font-semibold">Paid</th>
                <th className="px-4 py-2 text-right font-semibold">Balance</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => (
                <tr key={inv.id} className={inv.status === "Overdue" ? "bg-rose-50/40" : ""}>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-gray-800">{inv.number}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-700">{dayText(inv.date)}</td>
                  <td className="min-w-[180px] px-4 py-2 text-gray-700">{coursesOf(inv)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-gray-900">{aed(inv.total, inv.currency)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-emerald-700">{aed(inv.paid, inv.currency)}</td>
                  <td className={`whitespace-nowrap px-4 py-2 text-right ${inv.balance > 0 ? "font-semibold text-rose-700" : "text-gray-500"}`}>{aed(inv.balance, inv.currency)}</td>
                  <td className="px-4 py-2"><InvoiceStatus status={inv.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
