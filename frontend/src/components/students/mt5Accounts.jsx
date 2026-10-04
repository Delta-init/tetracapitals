import React, { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* ────────────────────────────────────────────────────────────────────────────
   A student's MT5 accounts (the user, 2026-10-04): in their details and the
   MT5 Accounts list on their page, and offered to pick on the funding forms
   — the primary one filled in, a new one typed as before. The server keeps
   each MT5 login it is given as the student's: from the call log, a funding
   request, a co-management request once approved (backend/src/students/mt5.ts).
   A login is its number, and one student's.
──────────────────────────────────────────────────────────────────────────── */

export const MT5_LOGIN = /^\d{4,15}$/;

/** A login as typed, spaces taken out. */
export const mt5LoginOf = (v) => String(v ?? '').replace(/\s+/g, '');

const primaryFirst = (rows) => [...(rows || [])].sort((a, b) => Number(b.is_primary === true) - Number(a.is_primary === true));

/** The student's MT5 accounts: the primary one first, then oldest first. */
export function useStudentMt5(studentId) {
  return useQuery({
    queryKey: ['mt5accounts', studentId],
    queryFn: () => base44.entities.MT5Account.filter({ student_id: studentId }, 'created_date'),
    enabled: !!studentId,
    select: primaryFirst,
  });
}

/** Their MT5 logins, the primary one marked — for the student's details. */
export function Mt5Logins({ studentId }) {
  const { data: accounts = [], isLoading } = useStudentMt5(studentId);
  if (!accounts.length) return <p className="mt-1 text-base text-gray-900">{isLoading ? '…' : '-'}</p>;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      {accounts.map(a => (
        <span key={a.id} className="inline-flex items-center gap-1.5">
          <span className="font-mono text-base font-semibold text-gray-900">{a.mt5_login}</span>
          {a.is_primary && <Badge variant="outline" className="border-blue-200 bg-blue-50 px-1.5 py-0 text-[10px] text-blue-700">Primary</Badge>}
        </span>
      ))}
    </div>
  );
}

/**
 * The MT5 login on a funding form: the student's saved accounts to pick — the primary one filled in once they load —
 * or a new one typed, which the server keeps as theirs (`newNote` says when).
 */
export function Mt5LoginField({ studentId, value, onChange, id = 'mt5_login', newNote = 'saved to their page with the request' }) {
  const { data: accounts = [], isFetched } = useStudentMt5(studentId);
  const logins = accounts.map(a => String(a.mt5_login));
  // Filled in once per student: a box emptied by hand stays empty.
  const filledFor = useRef(null);
  useEffect(() => {
    if (!studentId || !isFetched || filledFor.current === studentId) return;
    filledFor.current = studentId;
    if (!mt5LoginOf(value) && logins[0]) onChange(logins[0]);
  }, [studentId, isFetched]);

  const typed = mt5LoginOf(value);
  const hint = !studentId ? 'Pick the student — their saved MT5 accounts show here'
    : typed && !MT5_LOGIN.test(typed) ? 'The MT5 login is its number — digits only'
    : typed && !logins.includes(typed) ? `A new one — ${newNote}`
    : logins.length ? `Their saved MT5 account${logins.length > 1 ? 's' : ''} — pick one, or type a new one`
    : isFetched ? `None saved for them yet — the one you enter is ${newNote}` : '';
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>MT5 Login *</Label>
      {accounts.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Their saved MT5 accounts">
          {accounts.map(a => {
            const on = typed === String(a.mt5_login);
            return (
              <Button key={a.id} type="button" size="sm" variant={on ? 'default' : 'outline'} aria-pressed={on}
                onClick={() => onChange(String(a.mt5_login))} className="h-7 px-2.5 font-mono text-xs">
                {a.mt5_login}
                {a.is_primary && <span className="ml-1 font-sans text-[10px] opacity-70">primary</span>}
              </Button>
            );
          })}
        </div>
      )}
      <Input id={id} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={logins.length ? 'Or type a new one' : 'Enter MT5 login'} />
      {hint && <p className={`text-xs ${typed && !MT5_LOGIN.test(typed) ? 'text-rose-600' : 'text-muted-foreground'}`}>{hint}</p>}
    </div>
  );
}
