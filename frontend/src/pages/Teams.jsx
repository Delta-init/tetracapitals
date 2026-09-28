import React, { useState, useMemo } from 'react';
import { PageTitle } from '@/components/common/PageHeader';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Users, Search, UserCircle2, Plus, Pencil, Trash2, Loader2, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import StatsCard from '@/components/dashboard/StatsCard';
import TeamDialog from '@/components/teams/TeamDialog';
import { logAction } from '@/components/utils/AuditLogger';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { isMentorRole } from '@/components/utils/roles';
import { teamRootId } from '@/components/utils/teams';

// Admin roles that may see EVERY team (not just their own).
const ADMIN_VIEWERS = ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'admin_supervisor', 'finance_admin'];

// Role tiers in chain order, top (Chief) to bottom (CS). Each team card lists
// its members grouped under these headings.
const TIERS = [
  { keys: ['chief_mentor'], label: 'Chief Mentor', cls: 'bg-purple-100 text-purple-800 border-purple-200', dot: 'bg-purple-500' },
  { keys: ['senior_mentor'], label: 'Senior Mentor', cls: 'bg-blue-100 text-blue-800 border-blue-200', dot: 'bg-blue-500' },
  { keys: ['junior_mentor'], label: 'Junior Mentor', cls: 'bg-amber-100 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  { keys: ['cs_manager'], label: 'CS Manager', cls: 'bg-teal-100 text-teal-800 border-teal-200', dot: 'bg-teal-500' },
  { keys: ['cs', 'assistance', 'subjunior_mentor'], label: 'CS / Staff', cls: 'bg-gray-100 text-gray-700 border-gray-200', dot: 'bg-gray-400' },
];
const tierIndex = (role) => { const i = TIERS.findIndex(t => t.keys.includes(role)); return i === -1 ? TIERS.length : i; };
const tierOf = (role) => TIERS[tierIndex(role)] || { label: (role || '—'), cls: 'bg-gray-100 text-gray-700 border-gray-200', dot: 'bg-gray-400' };

export default function Teams() {
  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users-teams'],
    queryFn: () => base44.entities.User.list(),
    enabled: !!currentUser,
  });
  const [q, setQ] = useState('');
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState({ open: false, mode: 'create', team: null });
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const { teams, unassigned, isAdmin } = useMemo(() => {
    const byId = {};
    for (const u of users) byId[u.id] = u;
    // Only staff-tier people belong to teams (mentors + custom roles like cs /
    // cs_manager / chief_mentor). Admins aren't part of a mentor team.
    const staff = users.filter(u => isMentorRole(u.app_role));

    const rootOf = (u) => teamRootId(u, byId);

    const grouped = {};
    for (const u of staff) { const rid = rootOf(u); (grouped[rid] = grouped[rid] || []).push(u); }

    const teams = [];
    const unassigned = [];
    for (const [rid, members] of Object.entries(grouped)) {
      const root = byId[rid];
      // A lone person with nobody under them isn't a team yet — bucket them as
      // "unassigned" — unless the team was named (created empty on purpose).
      if (members.length === 1 && !root?.team_name) { unassigned.push(members[0]); continue; }
      members.sort((a, b) => (tierIndex(a.app_role) - tierIndex(b.app_role)) || String(a.full_name || '').localeCompare(String(b.full_name || '')));
      teams.push({ rootId: rid, name: root?.team_name || root?.full_name || '—', root, members });
    }
    teams.sort((a, b) => b.members.length - a.members.length);
    unassigned.sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));

    const isAdmin = currentUser && ADMIN_VIEWERS.includes(currentUser.app_role);
    if (!isAdmin && currentUser) {
      // Non-admins: only the team they belong to. A Chief roots their own team.
      const myRoot = rootOf(currentUser);
      return { teams: teams.filter(t => t.rootId === myRoot), unassigned: [], isAdmin };
    }
    return { teams, unassigned, isAdmin };
  }, [users, currentUser]);

  // Search filters members within teams (and the team name).
  const needle = q.trim().toLowerCase();
  const match = (u) => !needle || String(u.full_name || '').toLowerCase().includes(needle) || String(u.email || '').toLowerCase().includes(needle) || String(u.app_role || '').toLowerCase().includes(needle);
  const visibleTeams = needle
    ? teams.map(t => ({ ...t, members: t.members.filter(match) })).filter(t => t.members.length > 0 || t.name.toLowerCase().includes(needle))
    : teams;
  const visibleUnassigned = needle ? unassigned.filter(match) : unassigned;

  const totalMembers = teams.reduce((s, t) => s + t.members.length, 0);

  const refresh = () => queryClient.invalidateQueries();

  // Disband a team: everyone below the leader loses their Up Head (back to
  // Unassigned) and the leader loses the team name.
  const deleteTeam = async () => {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    const { root, members, name } = toDelete;
    try {
      for (const m of members) {
        if (m.id === root.id) continue;
        if (!m.up_head_id) continue;
        await base44.entities.User.update(m.id, { up_head_id: '', up_head_name: '' });
        await logAction('delete_team', 'User', m.id, `Team "${name}" disbanded: removed ${m.full_name}`,
          { up_head_id: m.up_head_id, up_head_name: m.up_head_name }, { up_head_id: '', up_head_name: '' });
      }
      if (root.team_name) {
        await base44.entities.User.update(root.id, { team_name: '' });
        await logAction('delete_team', 'User', root.id, `Team "${name}" disbanded`, { team_name: root.team_name }, { team_name: '' });
      }
      setToDelete(null);
    } catch (e) {
      setDeleteError(`Stopped partway: ${e?.message || 'request failed'}. Some members may already be unassigned.`);
    } finally {
      setDeleting(false);
      refresh();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-100/20 p-6">
      <div className="w-full max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <PageTitle eyebrow="Overview" icon={Users}>Teams</PageTitle>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">
              {isAdmin
                ? 'Every team and its leader. A team is the Up Head chain CS → CS Manager → Junior → Senior → Chief — the same chain commission pays up.'
                : 'Your team — everyone connected through the Up Head chain.'}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-64">
              <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, role…" className="pl-9 h-9" />
            </div>
            {isAdmin && (
              <Button onClick={() => setDialog({ open: true, mode: 'create', team: null })} className="whitespace-nowrap">
                <Plus className="h-4 w-4" /> Create team
              </Button>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatsCard title="Teams" value={teams.length} icon={Users} color="blue" delay={0.05} />
            <StatsCard title="People on a team" value={totalMembers} icon={UserCircle2} color="cyan" delay={0.12} />
            <StatsCard title="Unassigned (no Up Head)" value={unassigned.length} icon={UserX} color="amber" delay={0.19} />
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-16 text-gray-400">Loading teams…</div>
        ) : visibleTeams.length === 0 && visibleUnassigned.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-gray-400">
            {needle ? 'No matches.' : 'No teams yet. Use Create team to build the first one.'}
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {visibleTeams.map(team => {
              // Members grouped by tier, in chain order (Chief first). Any role
              // outside the five tiers (e.g. a custom top role) falls into "Other"
              // so every counted member is shown.
              const known = new Set(TIERS.flatMap(t => t.keys));
              const byTier = TIERS.map(t => ({ tier: t, people: team.members.filter(m => t.keys.includes(m.app_role)) })).filter(g => g.people.length > 0);
              const others = team.members.filter(m => !known.has(m.app_role));
              if (others.length) byTier.push({ tier: { label: 'Other', dot: 'bg-slate-400' }, people: others });
              return (
                <Card key={team.rootId} className="overflow-hidden">
                  <CardHeader className="border-b bg-slate-50/70">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="flex items-center gap-2 text-lg text-brand-navy">
                          <UserCircle2 className="h-5 w-5 flex-shrink-0 text-blue-600" />
                          <span className="truncate">{team.name}</span>
                        </CardTitle>
                        <p className="mt-1 text-xs text-slate-500">
                          Led by <span className="font-semibold text-slate-700">{team.root?.full_name}</span>
                          {' · '}{team.members.length} member{team.members.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                      {isAdmin && (
                        <div className="flex flex-shrink-0 items-center gap-1">
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-brand-navy"
                            onClick={() => setDialog({ open: true, mode: 'edit', team })}
                            aria-label={`Edit ${team.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                            onClick={() => { setDeleteError(null); setToDelete(team); }}
                            aria-label={`Delete ${team.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 divide-y">
                    {byTier.map(({ tier, people }) => (
                      <div key={tier.label} className="px-4 py-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`h-2 w-2 rounded-full ${tier.dot}`} />
                          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{tier.label}</span>
                          <span className="text-xs text-gray-400">· {people.length}</span>
                        </div>
                        <div className="space-y-1.5">
                          {people.map(m => (
                            <div key={m.id} className="flex items-center justify-between gap-2 pl-4">
                              <span className="font-medium text-gray-900 text-sm">{m.full_name}</span>
                              <span className="text-xs text-gray-400 truncate">{m.up_head_name ? `↳ reports to ${m.up_head_name}` : 'top of chain'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}

            {visibleUnassigned.length > 0 && (
              <Card className="border-amber-200">
                <CardHeader className="border-b bg-amber-50">
                  <CardTitle className="text-lg flex items-center justify-between gap-2 text-amber-800">
                    <span>Unassigned</span>
                    <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">{visibleUnassigned.length}</Badge>
                  </CardTitle>
                  <p className="text-xs text-amber-700 mt-1">No Up Head set. Add them to a team with Create team, or with Edit on an existing team.</p>
                </CardHeader>
                <CardContent className="p-0 divide-y">
                  {visibleUnassigned.map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                      <span className="font-medium text-gray-900 text-sm">{m.full_name}</span>
                      <Badge variant="outline" className={tierOf(m.app_role).cls}>{tierOf(m.app_role).label}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <TeamDialog
          open={dialog.open}
          onOpenChange={(open) => setDialog(d => ({ ...d, open }))}
          mode={dialog.mode}
          team={dialog.team}
          users={users}
          unassigned={unassigned}
          onSaved={refresh}
        />

        <AlertDialog open={!!toDelete} onOpenChange={(o) => { if (!o && !deleting) setToDelete(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete team “{toDelete?.name}”?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm text-slate-500">
                  <p>
                    All {Math.max((toDelete?.members.length || 1) - 1, 0)} member(s) under {toDelete?.root?.full_name} will have
                    their Up Head cleared and move to Unassigned.
                  </p>
                  <p className="font-medium text-amber-700">
                    Commission for new transactions will no longer flow up this chain, and leaders will stop seeing these
                    members’ data. The old chain isn’t saved — you’d need to rebuild it by hand.
                  </p>
                  {deleteError && <p className="font-medium text-rose-600">{deleteError}</p>}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); deleteTeam(); }}
                disabled={deleting}
                className="bg-rose-600 hover:bg-rose-700"
              >
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />} Delete team
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
