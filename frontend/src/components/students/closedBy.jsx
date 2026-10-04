import { Handshake } from 'lucide-react';
import { SALES_CRMS } from '@/components/students/salesCrm';

/* ────────────────────────────────────────────────────────────────────────────
   Who closed a student: the sales person in a sales CRM — Delta's, Draw's or
   the Remote team's — who sold them their course. student.closed_by, a list
   (two courses can be two people's), from finance with each close
   (backend/src/students/closedBy.ts). Shown under the Enrolled switch in the
   Students table and on the student page, for everyone who sees the student.
──────────────────────────────────────────────────────────────────────────── */

export const closersOf = (s) => (Array.isArray(s?.closed_by) ? s.closed_by : []).filter(c => c?.email);

/** Did this person close this student? (The Sales role sees only these.) */
export const closedByMe = (s, user) => {
  const me = String(user?.email ?? '').trim().toLowerCase();
  return !!me && closersOf(s).some(c => String(c.email).toLowerCase() === me);
};

const nameOf = (c) => c.name || c.email;
const describe = (c) => `${nameOf(c)} <${c.email}>${SALES_CRMS[c.crm] ? ` — ${SALES_CRMS[c.crm].label}` : ''}`;

/** "Closed by Aisha" — one line under the Enrolled switch; nothing when nobody is known. */
export function ClosedByLine({ student }) {
  const list = closersOf(student);
  if (!list.length) return null;
  return (
    <div className="mt-1 max-w-[280px] truncate text-[11px] leading-tight text-slate-500" title={list.map(describe).join('\n')}>
      <Handshake className="mr-1 inline h-3 w-3 align-[-2px] text-amber-600" />
      Closed by {list.map(nameOf).join(', ')}
    </div>
  );
}

/** The student page's "Closed By": each person, with their email and CRM. */
export function ClosedByList({ student }) {
  const list = closersOf(student);
  if (!list.length) return <p className="mt-1 text-base text-gray-900">-</p>;
  return (
    <div className="mt-1 space-y-0.5">
      {list.map(c => (
        <p key={c.email} className="text-base font-semibold text-gray-900">
          {nameOf(c)}
          <span className="ml-1.5 text-xs font-normal text-gray-500">{c.email}{SALES_CRMS[c.crm] ? ` · ${SALES_CRMS[c.crm].label}` : ''}</span>
        </p>
      ))}
    </div>
  );
}
