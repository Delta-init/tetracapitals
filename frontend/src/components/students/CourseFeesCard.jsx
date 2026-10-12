import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Receipt, Gift } from "lucide-react";
import { format } from "date-fns";
import { SalesCrmBadge, salesCrmOfFee, bonusCurrencyOfFee } from "@/components/students/salesCrm";
import { BangaloreBadge } from "@/components/common/LocationFilter";

/* Amounts arrive in the smallest unit (cents / fils), the way finance keeps them; one the source did not give is a dash. */
const money = (minor, currency) =>
  minor === null || minor === undefined || minor === ""
    ? "—"
    : `${currency || ""} ${(Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();

const fromTracker = (f) => f?.source === "cs_tracker";
const fmtDay = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const uaeToday = () => new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
const daysFrom = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const CLOSED = { void: "Voided", deleted: "Deleted" };

/** Finance's live figures under the balance: the next instalment's due date and how near it is — or why nothing is owed. */
function NextDue({ f }) {
  if (CLOSED[f.status]) return <div className="mt-0.5 text-xs font-normal text-gray-500">{CLOSED[f.status]} in finance</div>;
  if (!(f.balance_minor > 0)) return f.status === "paid" ? <div className="mt-0.5 text-xs font-normal text-emerald-600">Paid in full</div> : null;
  if (!f.next_due_on) return null;
  const d = daysFrom(uaeToday(), f.next_due_on);
  const cls = d < 0 ? "text-rose-600" : d <= 3 ? "text-amber-700" : "text-gray-500";
  return (
    <div className={`mt-0.5 text-xs font-normal ${cls}`}>
      Next due {fmtDay(f.next_due_on)} · {d < 0 ? `${-d} day${d === -1 ? "" : "s"} overdue` : d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"} left`}
    </div>
  );
}

/** Under what was paid: how many payments finance has, and the latest one's date. */
function PaymentsLine({ f }) {
  const list = Array.isArray(f.payments) ? f.payments : [];
  if (!list.length) return null;
  const last = list.map(p => p?.paid_on).filter(Boolean).sort().pop();
  return <div className="mt-0.5 text-xs font-normal text-gray-500">{list.length} payment{list.length === 1 ? "" : "s"}{last ? ` · last ${fmtDay(last)}` : ""}</div>;
}

/**
 * What each of the student's courses cost and what was paid — one row per
 * invoice from Delta finance, as it approved them (the finance student intake,
 * backend/src/finance/students.ts), and one per row of the CS enrolment tracker
 * (scripts/import-enrolment-tracker.ts), marked with the CS tab it came from.
 *
 * Finance is the record of payments. Since 2026-10-11 it sends every change to
 * an enrolment's money here (backend/src/finance/feeUpdates.ts): what was paid,
 * the balance, the next instalment's due date — 29 days after the latest
 * payment — and the payments, so a finance row is live; one from before it
 * shows the picture at approval. The bonus is what the counsellor promised at
 * the close, not a BONUS request — it credits nobody.
 */
export default function CourseFeesCard({ fees }) {
  if (!Array.isArray(fees) || fees.length === 0) return null;
  const tracker = fees.some(fromTracker), finance = fees.some(f => !fromTracker(f));
  const live = fees.some(f => !fromTracker(f) && f.updated_at);
  return (
    <Card className="border-gray-200">
      <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-amber-50 to-orange-50">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-amber-600" />
          Course fees ({fees.length})
        </CardTitle>
        <p className="text-xs text-gray-500">
          {finance && tracker ? "From Delta finance and the CS enrolment tracker" : tracker ? "From the CS enrolment tracker" : live ? "From Delta finance — updated as payments are recorded" : "From Delta finance, as approved"} — for information.
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
                        {/* The academy picked at the close — said only for Bangalore */}
                        <BangaloreBadge location={f.academy} />
                      </div>
                    )}
                  </td>
                  {/* What this course is studied in, from the close in the sales CRM */}
                  <td className="p-3 text-sm whitespace-nowrap text-gray-700">{f.language || <span className="text-gray-400">—</span>}</td>
                  <td className="p-3 text-sm text-right whitespace-nowrap">{money(f.fee_minor, f.currency)}</td>
                  <td className="p-3 text-sm text-right whitespace-nowrap text-emerald-700">
                    {money(f.paid_minor, f.currency)}
                    {!fromTracker(f) && <PaymentsLine f={f} />}
                    {/* What the counsellor declared collected, and what accounts recorded (finance, 2026-10-12) */}
                    {f.collected_minor != null && <div className="text-[11px] font-normal text-slate-500">Collected by counsellor {money(f.collected_minor, f.currency)}{f.collected_method ? ` · ${f.collected_method}` : ''}</div>}
                    {f.recorded_minor != null && <div className="text-[11px] font-normal text-slate-400">Recorded {money(f.recorded_minor, f.currency)}</div>}
                  </td>
                  <td className={`p-3 text-sm text-right whitespace-nowrap font-semibold ${CLOSED[f.status] ? "text-gray-400 line-through" : f.balance_minor > 0 ? "text-amber-700" : f.balance_minor === null || f.balance_minor === undefined ? "text-gray-400" : "text-emerald-700"}`}>
                    {money(f.balance_minor, f.currency)}
                    {!fromTracker(f) && <NextDue f={f} />}
                  </td>
                  <td className="p-3 text-sm whitespace-nowrap">
                    {f.bonus_given === true ? (
                      <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 gap-1">
                        <Gift className="h-3 w-3" />
                        {money(f.bonus_minor, bonusCurrencyOfFee(f))}
                      </Badge>
                    ) : f.bonus_given === false ? (
                      <span className="text-gray-500">No</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="p-3 text-sm">
                    {/* Each payment's receipt, as the salesperson uploaded it (finance, 2026-10-12) */}
                    {f.declared_payments?.some(p => p.receipt_url) ? (
                      <div className="space-y-0.5">
                        {f.declared_payments.filter(p => p.receipt_url).map((p, i) => (
                          <a key={i} href={p.receipt_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 whitespace-nowrap text-blue-600 hover:underline">
                            <Receipt className="h-3.5 w-3.5" />{p.method || 'Receipt'}{p.amount_minor ? ` · ${money(p.amount_minor, f.currency)}` : ''}
                          </a>
                        ))}
                      </div>
                    ) : f.receipt_url ? (
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
