import { Handshake } from 'lucide-react';
import { SALES_CRMS, SalesCrmBadge, salesCrmOfStudent } from '@/components/students/salesCrm';

/* ────────────────────────────────────────────────────────────────────────────
   Who closed a student: the sales person in a sales CRM — Delta's, Draw's or
   the Remote team's — who sold them their course. student.closed_by, a list
   (two courses can be two people's), from finance with each close
   (backend/src/students/closedBy.ts). Shown with the CRM each closed them in,
   for everyone who sees the student: under the Enrolled switch in the
   Students table and on the student page, on the student page's Closed By,
   and on the Not onboarded page.
──────────────────────────────────────────────────────────────────────────── */

export const closersOf = (s) => (Array.isArray(s?.closed_by) ? s.closed_by : []).filter(c => c?.email);

/** Did this person close this student? (The Sales role sees only these.) */
export const closedByMe = (s, user) => {
  const me = String(user?.email ?? '').trim().toLowerCase();
  return !!me && closersOf(s).some(c => String(c.email).toLowerCase() === me);
};

const nameOf = (c) => c.name || c.email;
const crmOf = (c) => SALES_CRMS[c.crm]?.label || '';
const describe = (c) => `${nameOf(c)} <${c.email}>${crmOf(c) ? ` — ${crmOf(c)}` : ''}`;

/** "Ria (Sales CRM), Bilal (Draw)" — for search and the CSV. */
export const closedByText = (s) => closersOf(s).map(c => `${nameOf(c)}${crmOf(c) ? ` (${crmOf(c)})` : ''}`).join(', ');

/** "Closed by Ria · Sales CRM" — one line under the Enrolled switch; nothing when nobody is known. */
export function ClosedByLine({ student }) {
  const list = closersOf(student);
  if (!list.length) return null;
  return (
    <div className="mt-1 max-w-[280px] truncate text-[11px] leading-tight text-slate-500" title={list.map(describe).join('\n')}>
      <Handshake className="mr-1 inline h-3 w-3 align-[-2px] text-amber-600" />
      Closed by {list.map((c, i) => (
        <span key={c.email}>
          {i > 0 && ', '}
          {nameOf(c)}{crmOf(c) && <span className="text-slate-400"> · {crmOf(c)}</span>}
        </span>
      ))}
    </div>
  );
}

/** A table cell: each person who closed them with their CRM's tag — or, nobody known, "—" and the CRM they came through. */
export function ClosedByCell({ student }) {
  const list = closersOf(student);
  if (!list.length) {
    return (
      <span className="inline-flex items-center gap-1.5 text-slate-400">—<SalesCrmBadge crm={salesCrmOfStudent(student)} className="px-1.5 py-0 text-[10px]" /></span>
    );
  }
  return (
    <div className="space-y-1">
      {list.map(c => (
        <div key={c.email} className="flex items-center gap-1.5 whitespace-nowrap" title={describe(c)}>
          <span className="text-slate-700">{nameOf(c)}</span>
          <SalesCrmBadge crm={c.crm} className="px-1.5 py-0 text-[10px]" />
        </div>
      ))}
    </div>
  );
}

/** The student page's "Closed By": each person with their CRM's tag, and their email. */
export function ClosedByList({ student }) {
  const list = closersOf(student);
  if (!list.length) return <p className="mt-1 text-base text-gray-900">-</p>;
  return (
    <div className="mt-1 space-y-1">
      {list.map(c => (
        <div key={c.email}>
          <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-gray-900">
            {nameOf(c)}
            <SalesCrmBadge crm={c.crm} />
          </p>
          <p className="text-xs text-gray-500">{c.email}</p>
        </div>
      ))}
    </div>
  );
}
