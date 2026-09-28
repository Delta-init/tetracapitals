import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Users, Search, UserCircle2 } from 'lucide-react';
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
      // A lone person who isn't a Chief and has nobody under them isn't really a
      // team yet — bucket them as "unassigned" (no Up Head set).
      if (members.length === 1 && root?.app_role !== 'chief_mentor') { unassigned.push(members[0]); continue; }
      members.sort((a, b) => (tierIndex(a.app_role) - tierIndex(b.app_role)) || String(a.full_name || '').localeCompare(String(b.full_name || '')));
      teams.push({ rootId: rid, name: root?.full_name || '—', root, members });
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-100/20 p-6">
      <div className="w-full max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Users className="h-7 w-7 text-indigo-600" /> Teams
            </h1>
            <p className="text-gray-600 mt-1 text-sm">
              {isAdmin
                ? 'Every team, grouped by its Chief Mentor. A team is the chain CS → CS Manager → Junior → Senior → Chief (set via Up Head in Personnel).'
                : 'Your team — everyone connected through the Up Head chain.'}
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, role…" className="pl-9 h-9" />
          </div>
        </div>

        {isAdmin && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4"><p className="text-xs text-indigo-600 font-medium uppercase">Teams</p><p className="text-2xl font-bold text-indigo-700 mt-1">{teams.length}</p></div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4"><p className="text-xs text-blue-600 font-medium uppercase">People on a team</p><p className="text-2xl font-bold text-blue-700 mt-1">{totalMembers}</p></div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4"><p className="text-xs text-amber-600 font-medium uppercase">Unassigned (no Up Head)</p><p className="text-2xl font-bold text-amber-700 mt-1">{unassigned.length}</p></div>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-16 text-gray-400">Loading teams…</div>
        ) : visibleTeams.length === 0 && visibleUnassigned.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-gray-400">
            {needle ? 'No matches.' : 'No teams yet. Set each person’s Up Head in Personnel to build the chain.'}
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
                  <CardHeader className="border-b bg-gradient-to-r from-indigo-50 to-purple-50">
                    <CardTitle className="text-lg flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2"><UserCircle2 className="h-5 w-5 text-purple-600" /> {team.name}</span>
                      <Badge variant="secondary">{team.members.length} member{team.members.length !== 1 ? 's' : ''}</Badge>
                    </CardTitle>
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
                  <p className="text-xs text-amber-700 mt-1">No Up Head set — assign one in Personnel to place them on a team.</p>
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
      </div>
    </div>
  );
}
