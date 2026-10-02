import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Receipt, Gift } from "lucide-react";
import { format } from "date-fns";
import { SalesCrmBadge, salesCrmOfFee } from "@/components/students/salesCrm";

/* Amounts arrive in the smallest unit (cents / fils), the way finance keeps them; one the source did not give is a dash. */
const money = (minor, currency) =>
  minor === null || minor === undefined || minor === ""
    ? "—"
    : `${currency || ""} ${(Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();

const fromTracker = (f) => f?.source === "cs_tracker";

/**
 * What each of the student's courses cost and what was paid — one row per
 * invoice from Delta finance, as it approved them (the finance student intake,
 * backend/src/finance/students.ts), and one per row of the CS enrolment tracker
 * (scripts/import-enrolment-tracker.ts), marked with the CS tab it came from.
 *
 * For information. Finance is the record of payments, so this is the picture
 * at approval rather than a running balance; and the bonus is what the
 * counsellor promised at the close, not a BONUS request — it credits nobody.
 */
export default function CourseFeesCard({ fees }) {
  if (!Array.isArray(fees) || fees.length === 0) return null;
  const tracker = fees.some(fromTracker), finance = fees.some(f => !fromTracker(f));
  return (
    <Card className="border-gray-200">
      <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-amber-50 to-orange-50">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-amber-600" />
          Course fees ({fees.length})
        </CardTitle>
        <p className="text-xs text-gray-500">
          {finance && tracker ? "From Delta finance and the CS enrolment tracker" : tracker ? "From the CS enrolment tracker" : "From Delta finance, as approved"} — for information.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left p-3 text-sm font-semibold text-gray-700">Course</th>
                <th className="text-left p-3 text-sm font-semibold text-gray-700">Language</th>
                <th className="text-right p-3 text-sm font-semibold text-gray-700">Fee</th>
                <th className="text-right p-3 text-sm font-semibold text-gray-700">Paid</th>
                <th className="text-right p-3 text-sm font-semibold text-gray-700">Balance</th>
                <th className="text-left p-3 text-sm font-semibold text-gray-700">Bonus</th>
                <th className="text-left p-3 text-sm font-semibold text-gray-700">{tracker ? "Receipt / note" : "Receipt"}</th>
              </tr>
            </thead>
            <tbody>
              {fees.map((f) => (
                <tr key={f.invoice_id} className="border-b last:border-0 hover:bg-gray-50 align-top">
                  <td className="p-3 text-sm">
                    <div className="font-medium text-gray-900">{f.course || "—"}</div>
                    {fromTracker(f) ? (
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                        <span>CS tracker · {f.tracker_cs || f.tracker_tab}</span>
                        {f.payment_status && (
                          <Badge variant="outline" className={f.payment_status === "Closed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>
                            {f.payment_status}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                        <span>
                          {[f.invoice_number && `Invoice ${f.invoice_number}`, f.recorded_at && format(new Date(f.recorded_at), "MMM d, yyyy")]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {/* Which sales CRM sold this course */}
                        <SalesCrmBadge crm={salesCrmOfFee(f)} />
                      </div>
                    )}
                  </td>
                  {/* What this course is studied in, from the close in the sales CRM */}
                  <td className="p-3 text-sm whitespace-nowrap text-gray-700">{f.language || <span className="text-gray-400">—</span>}</td>
                  <td className="p-3 text-sm text-right whitespace-nowrap">{money(f.fee_minor, f.currency)}</td>
                  <td className="p-3 text-sm text-right whitespace-nowrap text-emerald-700">{money(f.paid_minor, f.currency)}</td>
                  <td className={`p-3 text-sm text-right whitespace-nowrap font-semibold ${f.balance_minor > 0 ? "text-amber-700" : f.balance_minor === null || f.balance_minor === undefined ? "text-gray-400" : "text-emerald-700"}`}>
                    {money(f.balance_minor, f.currency)}
                  </td>
                  <td className="p-3 text-sm whitespace-nowrap">
                    {f.bonus_given === true ? (
                      <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 gap-1">
                        <Gift className="h-3 w-3" />
                        {money(f.bonus_minor, f.bonus_currency || f.currency)}
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
                    ) : f.remarks ? (
                      <span className="text-xs text-gray-600">{f.remarks}</span>
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
