import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RotateCcw } from 'lucide-react';
import { ClosedByCell } from '@/components/students/closedBy';

/*
 * Onboarding verification (backend/src/students/bonusVerification.ts): a student promised an MT5 bonus at the sales
 * close is onboarded only once a broker admin or a Super Admin approves that bonus. Pending is amber, rejected red
 * (the CS can submit it again), approved green; a student promised no bonus needs no verification.
 */
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const money = (b) => (b.currency === 'USD' ? `$${Number(b.amount).toLocaleString('en-US')}` : `${b.currency} ${Number(b.amount).toLocaleString('en-US')}`);

const STATES = {
  none: { label: 'No bonus', cls: 'bg-slate-100 text-slate-500' },
  not_requested: { label: 'Bonus not raised yet', cls: 'bg-amber-50 text-amber-700' },
  pending: { label: 'Verification pending', cls: 'bg-amber-100 text-amber-800' },
  rejected: { label: 'Rejected', cls: 'bg-rose-100 text-rose-700' },
  approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-700' },
};

/** One student's verification, as one pill: theirs overall, or one bonus's. */
export function VerificationBadge({ state, title }) {
  const s = STATES[state] || STATES.none;
  return <span title={title} className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>{s.label}</span>;
}

/** The student's verification in a cell: the overall pill, or each bonus when there are several. */
export function VerificationCell({ row }) {
  const bonuses = row.bonuses || [];
  if (!bonuses.length) return <VerificationBadge state="none" />;
  // A bonus raised but not decided reads "Verification pending"; one the call log hasn't raised yet says so.
  const one = bonuses.length === 1 ? bonuses[0] : null;
  return (
    <div className="space-y-1">
      {(one ? [one] : bonuses).map((b) => (
        <div key={b.invoice_id} className="flex items-center gap-1.5">
          <VerificationBadge state={b.state} title={b.reason ? `Rejected: ${b.reason}` : undefined} />
          <span className="text-xs text-slate-500">{money(b)}</span>
        </div>
      ))}
    </div>
  );
}

/** Pending, rejected or approved: the students welcomed whose bonus decides their onboarding. */
export function VerificationTable({ list, kind, onResubmit }) {
  const TH = ({ children }) => <th className="whitespace-nowrap px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">{children}</th>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-slate-50/80">
            <TH>Student</TH><TH>CS</TH><TH>Closed By</TH><TH>Bonus</TH><TH>Status</TH>
            <TH>{kind === 'pending' ? 'Raised' : 'Decided'}</TH>
            {kind === 'rejected' && <TH>Reason</TH>}
            <TH>Welcome sent</TH>
            {kind === 'rejected' && <TH />}
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (s.bonuses || []).filter((b) => kind === 'approved' || b.state !== 'approved' || (s.bonuses || []).length === 1).map((b) => (
            <tr key={`${s.id}-${b.invoice_id}`} className="border-b border-slate-100 align-top hover:bg-slate-50/60">
              <td className="px-3 py-2.5">
                <Link to={`${createPageUrl('StudentDetail')}?id=${s.id}`} className="font-medium text-slate-900 hover:text-blue-600">{s.full_name || 'Student'}</Link>
                <div className="font-mono text-xs text-slate-400">{s.student_code}</div>
                {b.course && <div className="mt-0.5 max-w-[240px] text-xs text-slate-500">{b.course}{b.invoice_number ? ` · ${b.invoice_number}` : ''}</div>}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5">
                <div className="text-slate-700">{s.primary_mentor_name || <span className="text-slate-400">No CS</span>}</div>
                {s.team_name && <div className="text-xs text-slate-400">{s.team_name}</div>}
              </td>
              <td className="px-3 py-2.5"><ClosedByCell student={s} /></td>
              <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-700">{money(b)}</td>
              <td className="whitespace-nowrap px-3 py-2.5">
                <VerificationBadge state={b.state} />
                {b.resubmitted ? <div className="mt-0.5 text-[11px] text-slate-400">Submitted again{b.resubmitted > 1 ? ` ×${b.resubmitted}` : ''}</div> : null}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">
                {kind === 'pending'
                  ? (b.requested_at ? when(b.requested_at) : <span title="Raised by the call log once their MT5 is known">Not raised yet</span>)
                  : <>{when(b.decided_at)}{b.decided_by ? <div className="text-slate-400">{b.decided_by}</div> : null}</>}
              </td>
              {kind === 'rejected' && <td className="max-w-[260px] px-3 py-2.5 text-xs text-rose-700">{b.reason || '—'}</td>}
              <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">{when(s.onboarded_at) || '—'}{s.onboarded_by_name ? <div className="text-slate-400">{s.onboarded_by_name}</div> : null}</td>
              {kind === 'rejected' && (
                <td className="whitespace-nowrap px-3 py-2.5">
                  {b.state === 'rejected' && b.request_id && (
                    <Button size="sm" variant="outline" onClick={() => onResubmit({ student: s, bonus: b })}>
                      <RotateCcw className="h-3.5 w-3.5" /> Submit again
                    </Button>
                  )}
                </td>
              )}
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

/** A rejected bonus, back to the broker admins — with what was put right, and another MT5 login when that was it. */
export function ResubmitBonusDialog({ target, onOpenChange }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [mt5, setMt5] = useState('');
  const [busy, setBusy] = useState(false);
  if (!target) return null;
  const { student, bonus } = target;
  const submit = async () => {
    setBusy(true);
    try {
      await base44.functions.invoke('resubmitSalesBonus', { transactionId: bonus.request_id, note, ...(mt5.trim() ? { mt5Login: mt5 } : {}) });
      toast.success(`${student.full_name || 'Their'} bonus submitted again — waiting for a broker admin`);
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setNote(''); setMt5('');
      onOpenChange(false);
    } catch (e) {
      toast.error(e?.message || 'Could not submit it again');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Submit the bonus again</DialogTitle>
          <DialogDescription>
            {student.full_name} · {money(bonus)}{bonus.reason ? ` — rejected: ${bonus.reason}` : ''}. It goes back to the broker admins; their onboarding waits for it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="resubmit-note">What was put right</Label>
            <Textarea id="resubmit-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="A clearer receipt is attached" rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resubmit-mt5">Another MT5 login (only if the account was wrong)</Label>
            <Input id="resubmit-mt5" value={mt5} onChange={(e) => setMt5(e.target.value)} inputMode="numeric" placeholder="7001234" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}><RotateCcw className="h-4 w-4" /> {busy ? 'Submitting…' : 'Submit again'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
