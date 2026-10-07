import React, { useState } from 'react';
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EnterCoursesDialog, UpgradeDialog, PaymentDialog } from '../students/StudentCoursesCard';
import ReferralRequestPopup from './ReferralRequestPopup';
import CoManageSearchModal from './CoManageSearchModal';
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { GraduationCap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import SearchableStudentSelect from '../common/SearchableStudentSelect';
import SearchableSelect from '../common/SearchableSelect';
import TagsPicker from './TagsPicker';
import { isMentorRole } from '../utils/roles';
import { teamMembersOf } from '../utils/teams';
import { Mt5LoginField, MT5_LOGIN, mt5LoginOf } from '../students/mt5Accounts';
import { PaymentRows, newPayment, paymentsOf, paymentsTotal, paymentsMissing, paymentsToSave } from './payments';

const NONE = '__none__';
// "junior_mentor" -> "Junior Mentor"
const roleLabel = (r) => String(r || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// A withdrawal's method. Money in — a deposit or a bonus — is taken as payments, each with its own (./payments).
const PAYMENT_METHODS = [
  'AED TRANSFER',
  'UPI',
  'CARD PAYMENT',
  'USDT',
  'INR TRANSFER',
  'Cash deposit',
  'Other'
];

/* ── Money in AED, USD or INR, and what a course payment earns (the user, 2026-10-03; Delta_Fee_Structure.pdf) ─
   An amount can be typed in AED, USD or INR — USD to start, whatever the type or payment (the user, 2026-10-04; INR
   2026-10-06). It is kept in USD for commission and the reports (amount_usd), with what was typed, its AED and the
   rates beside it — fixed: 1 USD = 3.67 AED, 1 INR = 0.010 USD (INR reaches AED through USD).
   A Bonus is a course payment, for a course with a bonus set on the Products page (DWT, MSNR, DSLP Offer, DSLP Full):
     full payment — the course's price at once, and its whole bonus in the student's MT5 at once;
     partial      — instalments of AED 2,000 (as many as the course has): every full AED 2,000 paid is $500 bonus, the
                    rest waits on hold for the next payment, and the balance is the instalments' total less all paid.
                    Once instalments have started, the rest is paid that way too.
   Shared with the co-management form (ReferralRequestPopup) and the request lists. */
export const AED_PER_USD = 3.67;
/** 1 INR = 0.010 USD — fixed (the user, 2026-10-06). */
export const USD_PER_INR = 0.01;
export const INSTALMENT_AED = 2000;
export const BONUS_PER_INSTALMENT_USD = 500;
const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
/* An amount typed in USD can come out a little off in AED ($544.95 × 3.67 = AED 1,999.97) — never short of the price,
   an instalment or the balance for that much. */
const ROUNDING_AED = 1;
const fmt = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const aedText = (n) => `AED ${fmt(n)}`;
export const usdText = (n) => `$${fmt(n)}`;
export const inrText = (n) => `INR ${fmt(n)}`;
const moneyText = (n, currency) => (currency === 'AED' ? aedText(n) : currency === 'INR' ? inrText(n) : usdText(n));

/** `amount` typed in `currency` (AED, USD or INR), in AED and USD: { aed, usd }. */
export function convert(amount, currency) {
  const n = Number(amount) || 0;
  if (currency === 'AED') return { aed: cents(n), usd: cents(n / AED_PER_USD) };
  if (currency === 'INR') return { aed: cents(n * USD_PER_INR * AED_PER_USD), usd: cents(n * USD_PER_INR) };
  return { aed: cents(n * AED_PER_USD), usd: cents(n) };
}
/** What `money` (from convert) is in the currencies other than the one typed — "$500.00 · AED 1,835.00" for INR. */
const otherMoney = (money, currency) =>
  currency === 'AED' ? usdText(money.usd) : currency === 'INR' ? `${usdText(money.usd)} · ${aedText(money.aed)}` : aedText(money.aed);
/** The rate a typed amount went by. */
const rateText = (currency) => (currency === 'INR' ? `1 INR = ${USD_PER_INR.toFixed(3)} USD` : `1 USD = ${AED_PER_USD} AED`);

/** A course's terms (the Products page): its full price in AED or USD, its whole bonus, its AED 2,000 instalments. */
export function coursePlan(product) {
  const price = Number(product?.full_price) || 0;
  const currency = product?.full_price_currency === 'AED' ? 'AED' : 'USD';
  const instalments = Math.max(0, Math.floor(Number(product?.instalments) || 0));
  return {
    price,
    currency,
    priceMoney: convert(price, currency),
    bonusUsd: product?.bonus_type === 'without' ? 0 : Number(product?.bonus_usd) || 0,
    instalments,
    planAed: instalments * INSTALMENT_AED,
  };
}

/** The courses a Bonus can be for: the ones with a bonus set. */
export const hasBonusPlan = (product) => Number(product?.bonus_usd) > 0;

/** What a course takes now: full and/or partial — partial only with instalments, and only partial once they've started. */
export const paymentKinds = (plan, beforeAed) =>
  plan.instalments > 0 ? (beforeAed > 0 ? ['partial'] : ['full', 'partial']) : ['full'];

/** What the student paid for `course` before: their earlier course payments that weren't turned down. */
export const paidBefore = (transactions, course) => (transactions || [])
  .filter(t => t.type === 'BONUS' && !['REJECTED', 'CANCELLED'].includes(t.status) && t.course_payment?.product === course)
  .reduce((s, t) => s + (Number(t.course_payment.paid_today_aed) || 0), 0);

/**
 * Today's payment on a course. Full: the whole bonus at once, nothing left to pay. Partial: $500 per full AED 2,000
 * paid (never past the course's instalments), the rest on hold, the balance of the instalments' total.
 */
export function coursePayment({ plan, kind, beforeAed, todayAed }) {
  const paid = { kind, paid_before_aed: cents(beforeAed), paid_today_aed: cents(todayAed), paid_total_aed: cents(beforeAed + todayAed) };
  if (kind === 'full') {
    // Short of the price by more than rounding: shown, so a partial payment isn't taken for a full one.
    const short = plan.price ? cents(plan.priceMoney.aed - todayAed) : 0;
    return { ...paid, bonus_usd: plan.bonusUsd, hold_aed: 0, balance_aed: 0, short_aed: short > ROUNDING_AED ? short : 0, over_aed: 0 };
  }
  const fee = plan.planAed;
  const total = paid.paid_total_aed;
  // Rounding — or a payment typed in USD — never costs an instalment.
  const counted = (n) => (fee ? Math.min(n, fee) : n);
  const blocks = (n) => Math.floor((counted(n) + ROUNDING_AED) / INSTALMENT_AED);
  const withBonus = plan.bonusUsd > 0;
  return {
    ...paid,
    bonus_usd: withBonus ? (blocks(total) - blocks(beforeAed)) * BONUS_PER_INSTALMENT_USD : 0,
    hold_aed: withBonus ? Math.max(0, cents(counted(total) - blocks(total) * INSTALMENT_AED)) : 0,
    balance_aed: fee ? (fee - total <= ROUNDING_AED ? 0 : cents(fee - total)) : null,
    short_aed: 0,
    over_aed: fee && total > fee ? cents(total - fee) : 0,
  };
}

/** The same, as one line — what the co-management path keeps of it (in the request's notes). */
export function paymentNote({ amount, currency, product, plan, payment }) {
  const money = convert(amount, currency);
  const typed = currency === 'INR' ? inrText(Number(amount) || 0) : currency === 'AED' ? aedText(money.aed) : usdText(money.usd);
  const parts = [`Paid ${typed} (= ${otherMoney(money, currency)} at ${currency === 'INR' ? rateText('INR') : AED_PER_USD})`];
  if (product && plan && payment) {
    parts.push(payment.kind === 'full'
      ? `${product.name}: full payment (price ${moneyText(plan.price, plan.currency)})`
      : `${product.name}: partial payment, paid till date ${aedText(payment.paid_total_aed)} of ${aedText(plan.planAed)}`);
    if (plan.bonusUsd > 0) parts.push(`MT5 bonus ${usdText(payment.bonus_usd)}`);
    if (payment.kind === 'partial' && plan.bonusUsd > 0) parts.push(`on hold ${aedText(payment.hold_aed)}`);
    if (payment.balance_aed != null) parts.push(`balance ${aedText(payment.balance_aed)}`);
  }
  return parts.join(' · ');
}

/** The amount box: AED, USD or INR, and what it is in the others. */
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
            <SelectItem value="INR">INR</SelectItem>
          </SelectContent>
        </Select>
        <Input id={id} type="number" step="0.01" min="0.01" value={amount} onChange={(e) => onAmount(e.target.value)} placeholder="0.00" required />
      </div>
      <p className="text-xs text-muted-foreground">
        {Number(amount) > 0 ? `= ${otherMoney(money, currency)} · ` : ''}{rateText(currency)}
      </p>
    </div>
  );
}

/** Full payment or instalments — asked before the amount. */
export function PaymentKind({ value, kinds, onChange, started = false }) {
  const label = { full: 'Full payment', partial: 'Partial payment (instalments)' };
  return (
    <div className="space-y-2">
      <Label>Payment *</Label>
      <div className="flex flex-wrap gap-2">
        {kinds.map(k => (
          <Button key={k} type="button" size="sm" variant={value === k ? 'default' : 'outline'} onClick={() => onChange(k)} aria-pressed={value === k}>
            {label[k]}
          </Button>
        ))}
      </div>
      {started && <p className="text-xs text-muted-foreground">Instalments have started for this course — the rest is paid in instalments.</p>}
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

/** A course payment, worked out: full — the price and the whole bonus; partial — the instalments, paid, bonus, hold, balance. */
export function CoursePaymentPanel({ product, plan, payment, className = '' }) {
  if (!product || !plan || !payment) return null;
  const withBonus = plan.bonusUsd > 0;
  const full = payment.kind === 'full';
  const other = (m, currency) => (currency === 'AED' ? usdText(m.usd) : aedText(m.aed));
  return (
    <div className={`rounded-lg border border-blue-100 bg-blue-50/40 p-3 ${className}`}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-800">{product.name} — {full ? 'full payment' : 'partial payment'}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        {full
          ? <Stat label="Course price" value={plan.price ? moneyText(plan.price, plan.currency) : 'Not set'} hint={plan.price ? other(plan.priceMoney, plan.currency) : 'an admin sets it on Products'} />
          : <Stat label="Instalment plan" value={aedText(plan.planAed)} hint={`${plan.instalments} × ${aedText(INSTALMENT_AED)}`} />}
        {!full && <Stat label="Paid before" value={aedText(payment.paid_before_aed)} />}
        <Stat label={full ? 'Paid now' : 'Paid till date'} value={aedText(full ? payment.paid_today_aed : payment.paid_total_aed)} />
        <Stat
          label="Bonus to credit in MT5"
          value={withBonus ? usdText(payment.bonus_usd) : 'No bonus'}
          tone="green"
          hint={!withBonus ? 'a without-bonus course' : full ? 'the whole bonus, at once' : `$${BONUS_PER_INSTALMENT_USD} per ${aedText(INSTALMENT_AED)} paid`}
        />
        {!full && withBonus && <Stat label="On hold" value={aedText(payment.hold_aed)} tone="amber" hint={payment.hold_aed > 0 ? 'joins the next payment' : ''} />}
        <Stat label="Balance pending" value={payment.balance_aed == null ? '—' : aedText(payment.balance_aed)} />
      </div>
      {payment.short_aed > 0 && <p className="mt-2 text-xs font-medium text-rose-600">That's {aedText(payment.short_aed)} short of the full price — is this a partial payment?</p>}
      {payment.over_aed > 0 && <p className="mt-2 text-xs font-medium text-rose-600">That's {aedText(payment.over_aed)} more than the instalments' total — check the amount.</p>}
    </div>
  );
}

/** Under a request's amount in the lists: its AED and, for a course payment, full or partial, the MT5 bonus, hold, balance. */
export function PaymentDetails({ tx }) {
  const cp = tx?.course_payment;
  if (!(Number(tx?.amount_aed) > 0) && !cp && !tx?.bonus_credit) return null;
  return (
    <div className="mt-0.5 space-y-0.5 whitespace-nowrap text-[11px] font-normal leading-tight text-gray-500">
      {/* Typed in INR: that too, as it was paid. */}
      {tx.amount_currency === 'INR' && Number(tx.amount_original) > 0 && <div>{inrText(tx.amount_original)}</div>}
      {Number(tx.amount_aed) > 0 && <div>{aedText(tx.amount_aed)}</div>}
      {tx.bonus_credit && <div className="font-medium text-amber-700">Sales-close bonus credit · no commission</div>}
      {cp?.kind && <div>{cp.kind === 'full' ? 'Full payment' : 'Partial payment'}</div>}
      {cp && (cp.with_bonus ? <div className="font-medium text-emerald-700">MT5 bonus {usdText(cp.bonus_usd)}</div> : <div>No bonus</div>)}
      {cp && cp.hold_aed > 0 && <div className="text-amber-700">On hold {aedText(cp.hold_aed)}</div>}
      {cp && cp.balance_aed != null && <div>Balance {aedText(cp.balance_aed)}</div>}
    </div>
  );
}

/**
 * A rejected request, corrected (the user, 2026-10-07): the form starts from everything it had — every field can be
 * changed — and sends it as a new request naming it (`resubmit_of`; backend finance/funding.ts claimResubmit).
 */
const startFrom = (tx) => ({
  type: tx.type || 'DEPOSIT',
  student_id: tx.student_id || '',
  amount: tx.type === 'WITHDRAWAL' ? String(tx.amount_original || tx.amount_usd || '') : '',
  currency: tx.amount_currency || 'USD',
  payment_kind: tx.course_payment?.kind || '',
  payment_method: tx.payment_method || '',
  mt5_login: tx.mt5_login || '',
  screenshot_url: tx.screenshot_url || '',
  tags: Array.isArray(tx.tags) ? tx.tags : [],
  meeting_mentor_id: tx.meeting_mentor_id || '',
});
const paymentsFrom = (tx) => {
  const list = paymentsOf(tx);
  if (!list.length) return [newPayment()];
  // One payment from before there were several: the request's amount is its amount.
  const one = list.length === 1 ? String(tx.amount_original || tx.amount_usd || '') : '';
  return list.map(p => newPayment({
    method: p.method || '',
    amount: p.amount > 0 ? String(p.amount) : one,
    ...(p.collected_on ? { collected_on: p.collected_on } : {}),
    receipt_url: p.receipt_url || '',
    receipt_name: p.receipt_name || '',
  }));
};

export default function FundingRequestForm({ students, allStudents = [], currentUser, onSubmit, onCancel, isSubmitting, from = null }) {
  const [formData, setFormData] = useState(() => (from ? startFrom(from) : {
    type: 'DEPOSIT',
    student_id: '',
    amount: '',       // as typed, in `currency`
    currency: 'USD',  // AED, USD or INR — USD to start, whatever the type and payment
    payment_kind: '', // a Bonus: 'full' or 'partial' — asked once the course is picked
    payment_method: '',
    mt5_login: '',
    screenshot_url: '',
    tags: [],          // only meaningful when type === 'BONUS'
    meeting_mentor_id: '', // mentor who conducted the meeting with the client
  }));
  const [uploading, setUploading] = useState(false);
  const [referralStudent, setReferralStudent] = useState(null);
  const [showCoManageModal, setShowCoManageModal] = useState(false);
  // Money in — a deposit or a bonus — as payments, each with its method, amount and receipt; they add up to the amount.
  // A withdrawal has one amount and method, and no receipt yet.
  const [payments, setPayments] = useState(() => (from ? paymentsFrom(from) : [newPayment()]));
  const takesPayments = formData.type !== 'WITHDRAWAL';
  // A course upgrade's payment is recorded on the upgrade (CourseUpgradePanel), not as a funding request.
  const upgradeMode = formData.type === 'COURSE_UPGRADE';
  const { data: studentCourses } = useQuery({
    queryKey: ['student-courses', formData.student_id],
    queryFn: async () => (await base44.functions.invoke('getStudentCourses', { studentId: formData.student_id })).data,
    enabled: !!formData.student_id,
    retry: false,
  });
  const typed = takesPayments ? paymentsTotal(payments) : formData.amount;

  // Tag catalog with per-tag amounts — for BONUS, the product's price fills in the amount (which can still be changed).
  const { data: bonusTags = [] } = useQuery({
    queryKey: ['transaction-tags-catalog'],
    queryFn: async () => (await base44.entities.TransactionTag.list('name')).filter(t => t.active !== false),
    staleTime: 5 * 60_000,
  });
  const tagAmount = (tagName) => bonusTags.find(t => t.name === tagName)?.amount_usd;

  // A Bonus is a course payment: the course's terms, what was paid for it before, full or partial, and what today's
  // payment makes of it.
  const product = formData.type === 'BONUS' ? bonusTags.find(t => t.name === formData.tags[0]) || null : null;
  const { data: earlier = [], isFetching: loadingEarlier } = useQuery({
    queryKey: ['course-payments', formData.student_id, product?.name],
    queryFn: () => base44.entities.FundingTransaction.filter({ student_id: formData.student_id, type: 'BONUS' }),
    enabled: !!(formData.student_id && product),
  });
  const money = convert(typed, formData.currency);
  const plan = coursePlan(product);
  const beforeAed = product ? paidBefore(earlier, product.name) : 0;
  const kinds = paymentKinds(plan, beforeAed);
  const kind = kinds.length === 1 ? kinds[0] : formData.payment_kind;
  const payment = product && kind ? coursePayment({ plan, kind, beforeAed, todayAed: money.aed }) : null;
  /** The payments' amounts: `first` in the first, the others emptied — methods and receipts stay. */
  const setAmounts = (first) => setPayments(rows => rows.map((p, i) => ({ ...p, amount: i === 0 ? first : '' })));
  // Full: the course's price fills in the first payment, in USD. Partial: what was paid today — in USD unless an
  // amount was already typed.
  const chooseKind = (k) => {
    if (k === 'full') {
      setFormData(f => ({ ...f, payment_kind: k, ...(plan.price ? { currency: 'USD' } : {}) }));
      if (plan.price) setAmounts(String(plan.priceMoney.usd));
    } else {
      const restart = formData.payment_kind === 'full' || !paymentsTotal(payments);
      setFormData(f => ({ ...f, payment_kind: k, ...(restart ? { currency: 'USD' } : {}) }));
      if (restart) setAmounts('');
    }
  };

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
    // Another student: their own MT5, the primary one filled in once their accounts load (Mt5LoginField).
    setFormData(prev => ({ ...prev, student_id: studentId, ...(prev.student_id !== studentId ? { mt5_login: '' } : {}) }));
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploading(true);
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        setFormData(f => ({ ...f, screenshot_url: file_url }));
        toast.success('Receipt uploaded');
      } catch (error) {
        toast.error('Failed to upload the receipt');
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

    // One course, one way: while an upgrade is in progress its payments go under Course Upgrade, never as a Bonus too.
    if (formData.type === 'BONUS' && studentCourses?.active) {
      toast.error(`${selectedStudent.full_name || 'This student'} has a course upgrade in progress (${studentCourses.active.courseName}) — record the payment under Course Upgrade`);
      return;
    }
    if (formData.type === 'BONUS' && (!formData.tags || formData.tags.length === 0)) {
      toast.error('Please pick a product for the bonus');
      return;
    }
    if (product && !kind) {
      toast.error('Pick full or partial payment');
      return;
    }

    // Money in: every payment with its method, amount and receipt — then the total.
    const missing = takesPayments ? paymentsMissing(payments) : '';
    if (missing) {
      toast.error(missing);
      return;
    }
    if (!(money.usd > 0)) {
      toast.error('Enter the amount');
      return;
    }
    if (!takesPayments && !formData.payment_method) {
      toast.error('Select the payment method');
      return;
    }
    const mt5 = mt5LoginOf(formData.mt5_login);
    if (!mt5) {
      toast.error("Enter the student's MT5 login");
      return;
    }
    if (!MT5_LOGIN.test(mt5)) {
      toast.error('The MT5 login is its number — digits only');
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
      // Money in: every payment, and the first one's method and receipt where only one is read (./payments).
      ...(takesPayments ? {
        payments: paymentsToSave(payments, formData.currency),
        payment_method: payments[0].method,
        screenshot_url: payments[0].receipt_url,
      } : {}),
      mt5_login: mt5,
      meeting_mentor_id: meetingMentor?.id || null,
      meeting_mentor_name: meetingMentor?.full_name || null,
      // What was typed, in AED and USD too — amount_usd is what commission and the reports use.
      amount: undefined,
      currency: undefined,
      payment_kind: undefined,
      amount_currency: formData.currency,
      amount_original: Number(typed) || 0,
      amount_aed: money.aed,
      amount_usd: money.usd,
      fx_rate_aed_per_usd: AED_PER_USD,
      ...(formData.currency === 'INR' ? { fx_rate_usd_per_inr: USD_PER_INR } : {}),
      ...(payment ? {
        course_payment: {
          product: product.name, price: plan.price, price_currency: plan.currency, bonus_full_usd: plan.bonusUsd,
          instalments: plan.instalments, plan_aed: plan.planAed, with_bonus: plan.bonusUsd > 0, ...payment,
        },
      } : {}),
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
        : currentUser.full_name,
      // Correcting a rejected request: sent as a new one, naming it.
      ...(from ? { resubmit_of: from.id } : {}),
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
        {from && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm">
            <p className="font-medium text-rose-800">Rejected{from.rejection_reason ? `: ${from.rejection_reason}` : ''}</p>
            <p className="mt-0.5 text-xs text-rose-700">Correct anything below and send it again — it goes as a new request; the rejected one stays as it was.</p>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="type">Transaction Type *</Label>
            <Select
              value={formData.type}
              onValueChange={(value) => setFormData({ ...formData, type: value, tags: [] })}
              required
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DEPOSIT">Deposit</SelectItem>
                <SelectItem value="WITHDRAWAL">Withdrawal</SelectItem>
                <SelectItem value="BONUS">Bonus</SelectItem>
                <SelectItem value="COURSE_UPGRADE">Course Upgrade</SelectItem>
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

          {formData.student_id && <CurrentCourses studentId={formData.student_id} />}

          {upgradeMode && formData.student_id && (
            <CourseUpgradePanel student={students.find(st => st.id === formData.student_id)} data={studentCourses} onDone={onCancel} />
          )}
          {formData.type === 'BONUS' && studentCourses?.active && (
            <p className="md:col-span-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              A course upgrade is in progress for this student — record its payments under <b>Course Upgrade</b>, not as a Bonus.
            </p>
          )}
          {!upgradeMode && (<>

          {formData.type === 'BONUS' && (
            <div className="space-y-2 md:col-span-2">
              <Label>Product *</Label>
              <TagsPicker
                only={hasBonusPlan}
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
                  // Full payment only (no instalments): its price fills in the first payment. Otherwise full or partial
                  // is asked next.
                  const terms = coursePlan(picked0);
                  setFormData({ ...formData, tags: allTags, payment_kind: '', currency: 'USD' });
                  setAmounts(terms.instalments === 0 && terms.price ? String(terms.priceMoney.usd) : '');
                }}
              />
              {formData.tags.length > 1 && (
                <p className="text-xs text-green-700 font-medium">
                  ✓ Automatically included (no extra charge): {formData.tags.slice(1).join(', ')}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Pick the course, then full or partial payment — the MT5 bonus, what waits on hold and the balance work themselves out. Bundled products come along at no extra charge.
              </p>
            </div>
          )}

          {product && (
            <div className="md:col-span-2">
              <PaymentKind value={kind} kinds={kinds} onChange={chooseKind} started={plan.instalments > 0 && beforeAed > 0} />
            </div>
          )}

          {takesPayments ? (
            <div className="space-y-2 md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>{formData.type !== 'BONUS' ? 'Payments *' : kind === 'full' ? 'Full payment received *' : 'Payments received today *'}</Label>
                <Select value={formData.currency} onValueChange={(v) => setFormData(f => ({ ...f, currency: v }))}>
                  <SelectTrigger className="h-8 w-24" aria-label="Currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AED">AED</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="INR">INR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Part by card, part in cash: each payment with its method, amount and receipt, in the one currency */}
              <PaymentRows rows={payments} onChange={setPayments} currency={formData.currency} />
              <p className="text-xs text-muted-foreground">
                {typed > 0 ? `Total ${moneyText(typed, formData.currency)} = ${otherMoney(money, formData.currency)} · ` : ''}{rateText(formData.currency)}
              </p>
            </div>
          ) : (<>
            <CurrencyAmount
              label="Amount *"
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
          </>)}

          <CoursePaymentPanel product={product} plan={plan} payment={payment} className="md:col-span-2" />

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

          {/* The student's saved MT5 accounts to pick, the primary one filled in — or a new one, kept as theirs */}
          <Mt5LoginField
            studentId={formData.student_id}
            value={formData.mt5_login}
            onChange={(v) => setFormData(f => ({ ...f, mt5_login: v }))}
          />

          {/* A withdrawal's receipt, if there is one yet — money in has a receipt on each payment above */}
          {!takesPayments && (
            <div className="space-y-2">
              <Label htmlFor="screenshot">Receipt (Optional)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="screenshot"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
                {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
              </div>
              {formData.screenshot_url && <p className="text-xs text-green-600">✓ Receipt uploaded</p>}
            </div>
          )}
          </>)}
        </div>

        {!upgradeMode && <div className="flex justify-end gap-3 pt-4">
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
        </div>}
        {upgradeMode && (
          <div className="flex justify-end pt-2">
            <Button type="button" variant="outline" onClick={onCancel}>Close</Button>
          </div>
        )}
      </form>
    </>
  );
}
/** The student's current CSE courses (entered by their CS, and every upgrade paid since), and an upgrade in progress. */
function CurrentCourses({ studentId }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['student-courses', studentId],
    queryFn: async () => (await base44.functions.invoke('getStudentCourses', { studentId })).data,
    retry: false,
  });
  if (isError) return null;
  const aed = (n) => `AED ${Number(n || 0).toLocaleString('en-US')}`;
  const a = data?.active;
  return (
    <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <GraduationCap className="h-4 w-4 text-brand-navy" />
        <span className="font-medium">Current course{data?.owned?.length === 1 ? '' : 's'}:</span>
        {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          : !data?.entered ? <span className="text-muted-foreground">not entered yet — their CS enters them on the student&apos;s Courses tab</span>
          : data.owned.length ? data.owned.map((o) => (
            <span key={o.code} className="rounded-full border bg-white px-2 py-0.5 text-xs">{o.name} <span className="text-muted-foreground">· {aed(o.paidAed)}</span></span>
          ))
          : <span className="text-muted-foreground">none</span>}
      </div>
      {a && (
        <p className="mt-1 text-xs text-amber-700">
          Upgrading to {a.courseName} ({a.plan === 'full' ? 'full payment' : 'instalments'}) — paid {aed(a.progress.paidAed)} of {aed(a.quote.dueAed)}, balance {aed(a.progress.balanceAed)}
          {!a.progress.done && a.nextPaymentAed ? `, next ${aed(a.nextPaymentAed)}` : ''}
        </p>
      )}
    </div>
  );
}

/**
 * Course Upgrade (the user, 2026-10-08): the student's upgrade from here, as on their Courses tab — enter their
 * courses, start an upgrade (full or instalments), or record its next payment for Delta Finance to approve.
 */
function CourseUpgradePanel({ student, data, onDone }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(null);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['student-courses', student?.id] });
    queryClient.invalidateQueries({ queryKey: ['course-upgrades'] });
  };
  if (!student) return null;
  if (!data) return <p className="md:col-span-2 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading their courses…</p>;
  const a = data.active;
  const room = a ? Math.max(0, a.progress.balanceAed - a.pendingAed) : 0;
  const aed = (n) => `AED ${Number(n || 0).toLocaleString('en-US')}`;
  return (
    <div className="md:col-span-2 space-y-2 rounded-lg border border-sky-200 bg-sky-50/50 p-3 text-sm">
      {!data.canWork ? (
        <p className="text-muted-foreground">Only this student's CS, the people above them and admins can record their course upgrade.</p>
      ) : !data.entered ? (
        <>
          <p>Enter {student.full_name}'s current courses first — the upgrade is worked out from them.</p>
          <Button type="button" size="sm" onClick={() => setOpen('enter')}>Enter current courses</Button>
        </>
      ) : !a ? (
        <>
          <p>No upgrade in progress. Pick the course they're upgrading to — full payment or instalments.</p>
          <Button type="button" size="sm" disabled={!data.options.length} onClick={() => setOpen('start')}>Start upgrade</Button>
        </>
      ) : (
        <>
          <p>
            <b>{a.courseName}</b> ({a.plan === 'full' ? 'full payment' : 'instalments'}) — balance {aed(a.progress.balanceAed)}
            {a.pendingAed > 0 ? `, ${aed(a.pendingAed)} waiting for finance` : ''}. MT5 bonus earned ${Number(a.progress.bonusEarnedUsd).toLocaleString('en-US')} of ${Number(a.quote.bonusUsd).toLocaleString('en-US')}.
          </p>
          {room > 0
            ? <Button type="button" size="sm" onClick={() => setOpen('pay')}>Record payment{a.nextPaymentAed ? ` — next ${aed(Math.min(a.nextPaymentAed, room))}` : ''}</Button>
            : <p className="text-xs text-muted-foreground">Nothing left to record — the rest is with Delta Finance.</p>}
        </>
      )}
      {open === 'enter' && <EnterCoursesDialog student={student} owned={data.owned} onClose={() => setOpen(null)} onSaved={refresh} />}
      {open === 'start' && <UpgradeDialog student={student} options={data.options} onClose={() => setOpen(null)} onSaved={refresh} />}
      {open === 'pay' && a && <PaymentDialog upgrade={a} onClose={() => setOpen(null)} onSaved={() => { refresh(); onDone?.(); }} />}
    </div>
  );
}
