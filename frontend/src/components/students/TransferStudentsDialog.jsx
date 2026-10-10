import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, ArrowRightLeft, Loader2 } from 'lucide-react';
import { BUILTIN_ROLE_NAMES } from '@/components/utils/roles';
import { listTeams } from '@/components/utils/teams';
import { logAction } from '@/components/utils/AuditLogger';

const ROUND_ROBIN = '__round_robin__';
const roleName = (r) => BUILTIN_ROLE_NAMES[r] || ({ cs: 'CS', cs_manager: 'CS Manager' }[r]) || String(r || '').replace(/_/g, ' ');

/**
 * Move the selected students to a team: to one person on it (anyone, CS first)
 * or spread evenly over the team's CS in turn. Only the primary mentor is
 * written; the server works out the student's team and records the move in
 * their history. By admins and every CS Manager (the user, 2026-10-10): the server's transferStudent checks, and
 * the people come from getTransferPeople — names, roles and teams only.
 */
export default function TransferStudentsDialog({ open, onOpenChange, students, onDone }) {
  const { data: users = [] } = useQuery({
    queryKey: ['transfer-people'],
    enabled: open,
    queryFn: async () => (await base44.functions.invoke('getTransferPeople', {})).data?.users || [],
  });
  const teams = useMemo(() => listTeams(users), [users]);
  const [teamId, setTeamId] = useState('');
  const [target, setTarget] = useState('');
  const [progress, setProgress] = useState(null); // { done, total }
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setTeamId(''); setTarget(''); setProgress(null); setError(null);
  }, [open]);

  const team = teams.find(t => t.id === teamId);
  const csPeople = team ? team.members.filter(m => m.app_role === 'cs') : [];
  const busy = !!progress && progress.done < progress.total && !error;

  // Who gets which student. Round robin keeps each student's order and deals
  // them out CS 1, CS 2, CS 3, CS 1… Students already with the target are skipped.
  const plan = useMemo(() => {
    if (!team || !target) return [];
    if (target === ROUND_ROBIN) {
      if (!csPeople.length) return [];
      return students.map((s, i) => ({ student: s, to: csPeople[i % csPeople.length] }));
    }
    const person = team.members.find(m => m.id === target);
    return person ? students.map(s => ({ student: s, to: person })) : [];
  }, [team, target, students, csPeople]);
  const moves = plan.filter(p => p.student.primary_mentor_id !== p.to.id);

  const perPerson = useMemo(() => {
    const m = new Map();
    for (const p of moves) m.set(p.to.full_name, (m.get(p.to.full_name) || 0) + 1);
    return [...m.entries()];
  }, [moves]);

  const run = async () => {
    setError(null);
    setProgress({ done: 0, total: moves.length });
    let done = 0;
    for (const { student, to } of moves) {
      try {
        await base44.functions.invoke('transferStudent', { studentId: student.id, toId: to.id });
        await logAction('transfer_student', 'Student', student.id,
          `Transferred ${student.full_name} from ${student.primary_mentor_name || 'no mentor'} to ${to.full_name} (${team.name})`,
          { primary_mentor_id: student.primary_mentor_id || '', primary_mentor_name: student.primary_mentor_name || '' },
          { primary_mentor_id: to.id, primary_mentor_name: to.full_name, team: team.name });
        done += 1;
        setProgress({ done, total: moves.length });
      } catch (e) {
        setError(`Stopped after ${done} of ${moves.length}: ${student.full_name} — ${e?.message || 'request failed'}. The ${done} already moved stay moved.`);
        onDone?.();
        return;
      }
    }
    onDone?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-brand-navy">Transfer {students.length} student{students.length === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription>
            Only future transactions follow the new mentor; past commission stays where it is. Every move is kept in the student’s history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Team</Label>
            <Select value={teamId || undefined} onValueChange={(v) => { if (v) { setTeamId(v); setTarget(''); } }}>
              <SelectTrigger><SelectValue placeholder={teams.length ? 'Select team' : 'No teams yet'} /></SelectTrigger>
              <SelectContent>
                {teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name} · {t.members.length}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {team && (
            <div className="space-y-2">
              <Label>Give to</Label>
              <Select value={target || undefined} onValueChange={(v) => v && setTarget(v)}>
                <SelectTrigger><SelectValue placeholder="Select person or round robin" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROUND_ROBIN} disabled={!csPeople.length}>
                    Round robin across the team’s CS ({csPeople.length})
                  </SelectItem>
                  {team.members.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.full_name} ({roleName(m.app_role)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {target && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm">
              {moves.length === 0 ? (
                <p className="text-slate-500">Everyone selected is already with {target === ROUND_ROBIN ? 'those CS' : 'that person'}.</p>
              ) : (
                <>
                  <p className="font-medium text-slate-700">
                    {moves.length} will move{plan.length - moves.length ? ` · ${plan.length - moves.length} already there, skipped` : ''}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-slate-500">
                    {perPerson.map(([name, n]) => <li key={name}>{name}: {n}</li>)}
                  </ul>
                </>
              )}
            </div>
          )}

          {progress && !error && (
            <p className="text-sm text-slate-500">Moving… {progress.done} / {progress.total}</p>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={busy || moves.length === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
            Transfer {moves.length || ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
