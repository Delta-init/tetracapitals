import React from 'react';
import { Badge } from '@/components/ui/badge';

/* ────────────────────────────────────────────────────────────────────────────
   Which sales CRM sold a student's course — Delta's Sales CRM, the Remote CRM,
   Draw or the Banglore CRM — as finance says (backend/src/students/salesCrm.ts). The same tag
   finance and the Delta LMS show: on the student (the CRM they first came
   through) and on each course's fees.

   A student from finance from before it said came through Delta's Sales CRM,
   as every one of those did; anybody else has no tag.
──────────────────────────────────────────────────────────────────────────── */
export const SALES_CRMS = {
  delta: { label: 'Sales CRM', cls: 'border-sky-200 bg-sky-50 text-sky-700' },
  // Not amber: that is "Old" beside it.
  remote: { label: 'Remote CRM', cls: 'border-orange-200 bg-orange-50 text-orange-700' },
  draw: { label: 'Draw', cls: 'border-violet-200 bg-violet-50 text-violet-700' },
  // Finance's code, spelt so (2026-10-10) — without it a Banglore CRM student would read as the Sales CRM's.
  banglore: { label: 'Banglore CRM', cls: 'border-teal-200 bg-teal-50 text-teal-700' },
};

/** The student's CRM: as finance said, or Delta's for one of finance's from before. */
export const salesCrmOfStudent = (s) => (SALES_CRMS[s?.sales_crm] ? s.sales_crm : s?.finance_invoice_id ? 'delta' : '');

/** A course's fees: as finance said, or Delta's for a finance row from before. Tracker rows have none. */
export const salesCrmOfFee = (f) => (SALES_CRMS[f?.sales_crm] ? f.sales_crm : f?.source === 'cs_tracker' ? '' : 'delta');

export function SalesCrmBadge({ crm, className = '' }) {
  const m = SALES_CRMS[crm];
  if (!m) return null;
  return (
    <Badge variant="outline" className={`${m.cls} ${className}`} title={`Sold through the ${m.label}`}>
      {m.label}
    </Badge>
  );
}
