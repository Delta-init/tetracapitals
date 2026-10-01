import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Receipt, Gift } from "lucide-react";
import { format } from "date-fns";

/* Amounts arrive in the smallest unit (cents / fils), the way finance keeps them. */
const money = (minor, currency) =>
  `${currency || ""} ${(Number(minor || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();

/**
 * What each of the student's courses cost and what was paid, as Delta finance
 * approved it — one row per invoice, written by the finance student intake
 * (backend/src/finance/students.ts).
 *
 * For information. Finance is the record of payments, so this is the picture
 * at approval rather than a running balance; and the bonus is what the
 * counsellor promised at the close, not a BONUS request — it credits nobody.
 */
export default function CourseFeesCard({ fees }) {
  if (!Array.isArray(fees) || fees.length === 0) return null;
  return (
    <Card className="border-gray-200">
      <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-amber-50 to-orange-50">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-amber-600" />
          Course fees ({fees.length})
        </CardTitle>
        <p className="text-xs text-gray-500">From Delta finance, as approved — for information.</p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left p-3 text-sm font-semibold text-gray-700">Course</th>
                <th className="text-right p-3 text-sm font-semibold text-gray-700">Fee</th>
                <th className="text-right p-3 text-sm font-semibold text-gray-700">Paid</th>
                <th className="text-right p-3 text-sm font-semibold text-gray-700">Balance</th>
                <th className="text-left p-3 text-sm font-semibold text-gray-700">Bonus</th>
                <th className="text-left p-3 text-sm font-semibold text-gray-700">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {fees.map((f) => (
                <tr key={f.invoice_id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="p-3 text-sm">
                    <div className="font-medium text-gray-900">{f.course || "—"}</div>
                    <div className="text-xs text-gray-500">
                      {[f.invoice_number && `Invoice ${f.invoice_number}`, f.recorded_at && format(new Date(f.recorded_at), "MMM d, yyyy")]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                  <td className="p-3 text-sm text-right whitespace-nowrap">{money(f.fee_minor, f.currency)}</td>
                  <td className="p-3 text-sm text-right whitespace-nowrap text-emerald-700">{money(f.paid_minor, f.currency)}</td>
                  <td className={`p-3 text-sm text-right whitespace-nowrap font-semibold ${f.balance_minor > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                    {money(f.balance_minor, f.currency)}
                  </td>
                  <td className="p-3 text-sm whitespace-nowrap">
                    {f.bonus_given === true ? (
                      <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 gap-1">
                        <Gift className="h-3 w-3" />
                        {money(f.bonus_minor, f.currency)}
                      </Badge>
                    ) : f.bonus_given === false ? (
                      <span className="text-gray-500">No</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="p-3 text-sm">
                    {f.receipt_url ? (
                      <a
                        href={f.receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                      >
                        <Receipt className="h-3.5 w-3.5" />
                        View
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
