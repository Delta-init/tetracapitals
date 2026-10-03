import React, { useState } from 'react';
import { useQuery } from "@tanstack/react-query";
import ReferralRequestPopup from './ReferralRequestPopup';
import CoManageSearchModal from './CoManageSearchModal';
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import SearchableStudentSelect from '../common/SearchableStudentSelect';
import SearchableSelect from '../common/SearchableSelect';
import TagsPicker from './TagsPicker';
import { isMentorRole } from '../utils/roles';
import { teamMembersOf } from '../utils/teams';

const NONE = '__none__';
// "junior_mentor" -> "Junior Mentor"
const roleLabel = (r) => String(r || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const PAYMENT_METHODS = [
  'AED TRANSFER',
  'UPI',
  'CARD PAYMENT',
  'USDT',
  'INR TRANSFER',
  'Cash deposit',
  'Other'
];

/* ── Money in AED or USD, and what a course payment earns (the user, 2026-10-03) ──────────────────────────────
   An amount can be typed in AED or USD. It is kept in USD for commission and the reports (amount_usd), with what was
   typed, its AED and the rate — a fixed 3.67 — beside it. A Bonus is a course payment: every full AED 2,000 paid for
   a "with bonus" course is $500 bonus in the student's MT5, the rest waits on hold for the next payment, and the
   balance is the course fee (the Products page) less everything paid. Shared with the co-management form
   (ReferralRequestPopup) and the request lists. */
export const AED_PER_USD = 3.67;
export const BONUS_BLOCK_AED = 2000;
export const BONUS_PER_BLOCK_USD = 500;
const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmt = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const aedText = (n) => `AED ${fmt(n)}`;
export const usdText = (n) => `$${fmt(n)}`;

/** `amount` typed in `currency`, in both: { aed, usd }. */
export function convert(amount, currency) {
  const n = Number(amount) || 0;
  return currency === 'AED' ? { aed: cents(n), usd: cents(n / AED_PER_USD) } : { aed: cents(n * AED_PER_USD), usd: cents(n) };
}

/** A course's fee in AED: its own (the Products page), else its USD price at 3.67; null when neither is set. */
export function courseFeeAed(product) {
  if (Number(product?.fee_aed) > 0) return Number(product.fee_aed);
  if (Number(product?.amount_usd) > 0) return cents(Number(product.amount_usd) * AED_PER_USD);
  return null;
}

/** What the student paid for `course` before: their earlier course payments that weren't turned down. */
export const paidBefore = (transactions, course) => (transactions || [])
  .filter(t => t.type === 'BONUS' && !['REJECTED', 'CANCELLED'].includes(t.status) && t.course_payment?.product === course)
  .reduce((s, t) => s + (Number(t.course_payment.paid_today_aed) || 0), 0);

/** Today's payment on a course: paid till date, the MT5 bonus it earns now, what waits on hold, the balance. */
export function coursePayment({ feeAed, beforeAed, todayAed, withBonus }) {
  const total = cents(beforeAed + todayAed);
  // Bonus on no more than the course costs; a few fils of rounding never cost a block.
  const counted = (n) => (feeAed ? Math.min(n, feeAed) : n);
  const blocks = (n) => Math.floor((counted(n) + 0.005) / BONUS_BLOCK_AED);
  return {
    paid_before_aed: cents(beforeAed),
    paid_today_aed: cents(todayAed),
    paid_total_aed: total,
    bonus_usd: withBonus ? (blocks(total) - blocks(beforeAed)) * BONUS_PER_BLOCK_USD : 0,
    hold_aed: withBonus ? Math.max(0, cents(counted(total) - blocks(total) * BONUS_BLOCK_AED)) : 0,
    balance_aed: feeAed ? cents(Math.max(0, feeAed - total)) : null,
    over_aed: feeAed && total > feeAed ? cents(total - feeAed) : 0,
  };
}

/** The same, as one line — what the co-management path keeps of it (in the request's notes). */
export function paymentNote({ amount, currency, product, feeAed, payment }) {
  const money = convert(amount, currency);
  const parts = [`Paid ${currency === 'AED' ? aedText(money.aed) : usdText(money.usd)} (= ${currency === 'AED' ? usdText(money.usd) : aedText(money.aed)} at ${AED_PER_USD})`];
  if (product && payment) {
    parts.push(`${product.name}: fee ${feeAed ? aedText(feeAed) : 'not set'}, paid till date ${aedText(payment.paid_total_aed)}`);
    if (product.bonus_type !== 'without') parts.push(`MT5 bonus ${usdText(payment.bonus_usd)}`, `on hold ${aedText(payment.hold_aed)}`);
    if (payment.balance_aed != null) parts.push(`balance ${aedText(payment.balance_aed)}`);
  }
  return parts.join(' · ');
}

/** The amount box: AED or USD, and what it is in the other. */
export function CurrencyAmount({ id = 'amount', label, amount, currency, onAmount, onCurrency }) {
  const money = convert(amount, currency);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Select value={currency} onValueChange={onCurrency}>
          <SelectTrigger className="w-24 shrink-0" aria-label="Currency"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="AED">AED</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
          </SelectContent>
        </Select>
        <Input id={id} type="number" step="0.01" min="0.01" value={amount} onChange={(e) => onAmount(e.target.value)} placeholder="0.00" required />
      </div>
      <p className="text-xs text-muted-foreground">
        {Number(amount) > 0 ? `= ${currency === 'AED' ? usdText(money.usd) : aedText(money.aed)} · ` : ''}1 USD = {AED_PER_USD} AED
      </p>
    </div>
  );
}

const Stat = ({ label, value, hint, tone }) => (
  <div>
    <p className="text-[11px] text-gray-500">{label}</p>
    <p className={`font-semibold ${tone === 'green' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-gray-900'}`}>{value}</p>
    {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
  </div>
);

/** A course payment, worked out: the fee, paid before and till date, the MT5 bonus now, on hold, the balance. */
export function CoursePaymentPanel({ product, feeAed, payment, className = '' }) {
  if (!product || !payment) return null;
  const withBonus = product.bonus_type !== 'without';
  return (
    <div className={`rounded-lg border border-blue-100 bg-blue-50/40 p-3 ${className}`}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-800">{product.name} — with this payment</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <Stat label="Course fee" value={feeAed ? aedText(feeAed) : 'Not set'} hint={feeAed ? usdText(feeAed / AED_PER_USD) : 'an admin sets it on Products'} />
        <Stat label="Paid before" value={aedText(payment.paid_before_aed)} />
        <Stat label="Paid till date" value={aedText(payment.paid_total_aed)} />
        <Stat
          label="Bonus to credit in MT5"
          value={withBonus ? usdText(payment.bonus_usd) : 'No bonus'}
          tone="green"
          hint={withBonus ? `$${BONUS_PER_BLOCK_USD} per AED ${BONUS_BLOCK_AED.toLocaleString('en-US')} paid` : 'a without-bonus course'}
        />
        {withBonus && <Stat label="On hold" value={aedText(payment.hold_aed)} tone="amber" hint={payment.hold_aed > 0 ? 'joins the next payment' : ''} />}
        <Stat label="Balance pending" value={payment.balance_aed == null ? '—' : aedText(payment.balance_aed)} />
      </div>
      {payment.over_aed > 0 && <p className="mt-2 text-xs font-medium text-rose-600">That's {aedText(payment.over_aed)} more than the course fee — check the amount.</p>}
    </div>
  );
}

/** Under a request's amount in the lists: its AED and, for a course payment, the MT5 bonus, what's on hold, the balance. */
export function PaymentDetails({ tx }) {
  const cp = tx?.course_payment;
  if (!(Number(tx?.amount_aed) > 0) && !cp) return null;
  return (
    <div className="mt-0.5 space-y-0.5 whitespace-nowrap text-[11px] font-normal leading-tight text-gray-500">
      {Number(tx.amount_aed) > 0 && <div>{aedText(tx.amount_aed)}</div>}
      {cp && (cp.with_bonus ? <div className="font-medium text-emerald-700">MT5 bonus {usdText(cp.bonus_usd)}</div> : <div>No bonus</div>)}
      {cp && cp.hold_aed > 0 && <div className="text-amber-700">On hold {aedText(cp.hold_aed)}</div>}
      {cp && cp.balance_aed != null && <div>Balance {aedText(cp.balance_aed)}</div>}
    </div>
  );
}

export default function FundingRequestForm({ students, allStudents = [], currentUser, onSubmit, onCancel, isSubmitting }) {
  const [formData, setFormData] = useState({
    type: 'DEPOSIT',
    student_id: '',
    amount: '',       // as typed, in `currency`
    currency: 'USD',  // AED or USD — a Bonus (a course payment) starts in AED
    payment_method: '',
    mt5_login: '',
    screenshot_url: '',
    tags: [],          // only meaningful when type === 'BONUS'
    meeting_mentor_id: '', // mentor who conducted the meeting with the client
  });
  const [uploading, setUploading] = useState(false);
  const [referralStudent, setReferralStudent] = useState(null);
  const [showCoManageModal, setShowCoManageModal] = useState(false);

  // Tag catalog with per-tag amounts — for BONUS, the product's price fills in the amount (which can still be changed).
  const { data: bonusTags = [] } = useQuery({
    queryKey: ['transaction-tags-catalog'],
    queryFn: async () => (await base44.entities.TransactionTag.list('name')).filter(t => t.active !== false),
    staleTime: 5 * 60_000,
  });
  const tagAmount = (tagName) => bonusTags.find(t => t.name === tagName)?.amount_usd;

  // A Bonus is a course payment: what was paid for the course before, and what today's payment makes of it.
  const product = formData.type === 'BONUS' ? bonusTags.find(t => t.name === formData.tags[0]) || null : null;
  const { data: earlier = [], isFetching: loadingEarlier } = useQuery({
    queryKey: ['course-payments', formData.student_id, product?.name],
    queryFn: () => base44.entities.FundingTransaction.filter({ student_id: formData.student_id, type: 'BONUS' }),
    enabled: !!(formData.student_id && product),
  });
  const money = convert(formData.amount, formData.currency);
  const feeAed = courseFeeAed(product);
  const payment = product
    ? coursePayment({ feeAed, beforeAed: paidBefore(earlier, product.name), todayAed: money.aed, withBonus: product.bonus_type !== 'without' })
    : null;

  // Mentors (junior / senior / sub-junior / chief) for the "meeting conducted by"
  // picker — only from the submitter's own team (their Up Head chain). Admins
  // aren't on a team, so they see every mentor. Everyone can read the user list,
  // so staff roles like CS can load it.
  const { data: allUsers = [] } = useQuery({
    queryKey: ['users-mentor-options'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 5 * 60_000,
  });
  const mentorOptions = React.useMemo(() => {
    const pool = isMentorRole(currentUser?.app_role) ? teamMembersOf(currentUser, allUsers) : allUsers;
    return pool
      .filter(u => /mentor/.test(String(u.app_role || '')) && u.full_name)
      .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)))
      .map(u => ({ value: u.id, label: `${u.full_name} · ${roleLabel(u.app_role)}` }));
  }, [allUsers, currentUser]);

  const isMentor = isMentorRole(currentUser?.app_role);

  const handleStudentSelect = (studentId) => {
    const student = students.find(s => s.id === studentId);
    if (isMentor && student && student.primary_mentor_id !== currentUser.id) {
      let alreadyCoManaged = false;
      if (student.co_mentors_details) {
        try {
          const co = JSON.parse(student.co_mentors_details);
          alreadyCoManaged = Array.isArray(co) && co.some(m => m.mentor_id === currentUser.id);
        } catch (_) {}
      }
      if (!alreadyCoManaged) {
        setReferralStudent(student);
        return;
      }
    }
    setFormData(prev => ({ ...prev, student_id: studentId }));
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploading(true);
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        setFormData({ ...formData, screenshot_url: file_url });
        toast.success('Screenshot uploaded');
      } catch (error) {
        toast.error('Failed to upload screenshot');
      } finally {
        setUploading(false);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const selectedStudent = students.find(s => s.id === formData.student_id);
    if (!selectedStudent) {
      toast.error('Please select a student');
      return;
    }

    if (formData.type === 'BONUS' && (!formData.tags || formData.tags.length === 0)) {
      toast.error('Please pick a product for the bonus');
      return;
    }

    if (!(money.usd > 0)) {
      toast.error('Enter the amount');
      return;
    }
    if (product && loadingEarlier) {
      toast.error("Still loading the course's earlier payments — try again in a moment");
      return;
    }

    let primaryMentorId, primaryMentorName, seniorMentorId, seniorMentorName;
    if (currentUser.app_role === 'assistance' && currentUser.assigned_mentor_id) {
      primaryMentorId = currentUser.assigned_mentor_id;
      primaryMentorName = currentUser.assigned_mentor_name;
      seniorMentorId = selectedStudent.senior_mentor_id;
      seniorMentorName = selectedStudent.senior_mentor_name;
    } else {
      primaryMentorId = selectedStudent.primary_mentor_id;
      primaryMentorName = selectedStudent.primary_mentor_name;
      seniorMentorId = selectedStudent.senior_mentor_id;
      seniorMentorName = selectedStudent.senior_mentor_name;
    }

    const meetingMentor = formData.meeting_mentor_id && formData.meeting_mentor_id !== NONE
      ? allUsers.find(u => u.id === formData.meeting_mentor_id)
      : null;

    const dataToSubmit = {
      ...formData,
      meeting_mentor_id: meetingMentor?.id || null,
      meeting_mentor_name: meetingMentor?.full_name || null,
      // What was typed, in both currencies — amount_usd is what commission and the reports use.
      amount: undefined,
      currency: undefined,
      amount_currency: formData.currency,
      amount_original: Number(formData.amount) || 0,
      amount_aed: money.aed,
      amount_usd: money.usd,
      fx_rate_aed_per_usd: AED_PER_USD,
      ...(payment ? { course_payment: { product: product.name, fee_aed: feeAed, with_bonus: product.bonus_type !== 'without', ...payment } } : {}),
      status: 'PENDING',
      student_name: selectedStudent.full_name,
      student_code: selectedStudent.student_code,
      primary_mentor_id: primaryMentorId,
      primary_mentor_name: primaryMentorName,
      senior_mentor_id: seniorMentorId,
      senior_mentor_name: seniorMentorName,
      requested_by_id: currentUser.id,
      requested_by_name: currentUser.full_name,
      requested_at: new Date().toISOString(),
      initiating_mentor_id: currentUser.app_role === 'assistance' && currentUser.assigned_mentor_id
        ? currentUser.assigned_mentor_id
        : currentUser.id,
      initiating_mentor_name: currentUser.app_role === 'assistance' && currentUser.assigned_mentor_name
        ? currentUser.assigned_mentor_name
        : currentUser.full_name
    };

    onSubmit(dataToSubmit);
  };

  return (
    <>
      {showCoManageModal && (
        <CoManageSearchModal
          allStudents={allStudents}
          currentUser={currentUser}
          onSelectStudent={(student) => {
            setShowCoManageModal(false);
            setReferralStudent(student);
          }}
          onClose={() => setShowCoManageModal(false)}
        />
      )}
      {referralStudent && (
        <ReferralRequestPopup
          student={referralStudent}
          currentUser={currentUser}
          // Carry the type + tags chosen in the parent form into the referral so
          // BONUS (and its required tag) flows through the co-management path
          // the same way DEPOSIT does.
          transactionType={formData.type}
          initialTags={formData.tags}
          onClose={() => setReferralStudent(null)}
        />
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="type">Transaction Type *</Label>
            <Select
              value={formData.type}
              onValueChange={(value) => setFormData({ ...formData, type: value, tags: [], ...(value === 'BONUS' ? { currency: 'AED' } : {}) })}
              required
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DEPOSIT">Deposit</SelectItem>
                <SelectItem value="WITHDRAWAL">Withdrawal</SelectItem>
                <SelectItem value="BONUS">Bonus</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <SearchableStudentSelect
              students={students}
              value={formData.student_id}
              onValueChange={handleStudentSelect}
              label="Student"
              required
            />
            {isMentor && (
              <button
                type="button"
                onClick={() => setShowCoManageModal(true)}
                className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
              >
                Looking for a client managed by another mentor? → Request Co-Management
              </button>
            )}
          </div>

          {formData.type === 'BONUS' && (
            <div className="space-y-2 md:col-span-2">
              <Label>Product *</Label>
              <TagsPicker
                value={formData.tags}
                onChange={(picked) => {
                  // The picked product may BUNDLE lower products (e.g. buying the
                  // higher course includes the lower one). Auto-add those to the
                  // tags — included, not added on top. The amount is what the
                  // student paid today, not the product's price.
                  const primary = picked[0];
                  const picked0 = bonusTags.find(t => t.name === primary);
                  const included = Array.isArray(picked0?.includes)
                    ? picked0.includes.filter(n => n && n !== primary)
                    : [];
                  const allTags = primary ? [primary, ...included] : [];
                  setFormData({ ...formData, tags: allTags });
                }}
              />
              {formData.tags.length > 1 && (
                <p className="text-xs text-green-700 font-medium">
                  ✓ Automatically included (no extra charge): {formData.tags.slice(1).join(', ')}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Pick the course, then type what the student paid today — the MT5 bonus, what waits on hold and the balance work themselves out. Bundled products come along at no extra charge.
              </p>
            </div>
          )}

          <CurrencyAmount
            label={formData.type === 'BONUS' ? 'Payment received today *' : 'Amount *'}
            amount={formData.amount}
            currency={formData.currency}
            onAmount={(v) => setFormData(f => ({ ...f, amount: v }))}
            onCurrency={(v) => setFormData(f => ({ ...f, currency: v }))}
          />

          <div className="space-y-2">
            <Label htmlFor="payment_method">Payment Method *</Label>
            <Select
              value={formData.payment_method}
              onValueChange={(value) => setFormData({ ...formData, payment_method: value })}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Select payment method" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((method) => (
                  <SelectItem key={method} value={method}>
                    {method}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <CoursePaymentPanel product={product} feeAed={feeAed} payment={payment} className="md:col-span-2" />

          <div className="space-y-2">
            <Label>Meeting Conducted By (Mentor)</Label>
            <SearchableSelect
              value={formData.meeting_mentor_id || undefined}
              onValueChange={(v) => setFormData({ ...formData, meeting_mentor_id: v })}
              options={mentorOptions}
              placeholder="Select the mentor who took the meeting"
              searchPlaceholder="Search mentor by name or role…"
              noneLabel="— None —"
              noneValue={NONE}
            />
            {isMentorRole(currentUser?.app_role) && mentorOptions.length === 0 && (
              <p className="text-xs text-amber-600">No mentors on your team yet — ask an admin to set your Up Head in Personnel.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="mt5_login">MT5 Login (Optional)</Label>
            <Input
              id="mt5_login"
              value={formData.mt5_login}
              onChange={(e) => setFormData({ ...formData, mt5_login: e.target.value })}
              placeholder="Enter MT5 login"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="screenshot">Screenshot (Optional)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="screenshot"
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                disabled={uploading}
              />
              {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
            {formData.screenshot_url && (
              <p className="text-xs text-green-600">✓ Screenshot uploaded</p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || uploading}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              'Submit Request'
            )}
          </Button>
        </div>
      </form>
    </>
  );
}