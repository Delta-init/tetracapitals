import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { courseLabel, productsByStudent } from '@/components/utils/studentProducts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { PageTitle } from '@/components/common/PageHeader';
import StatsCard from '@/components/dashboard/StatsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, ArrowLeft, ArrowRightLeft, Loader2, Search, ShieldAlert, UserCheck, Users, UsersRound } from 'lucide-react';
import { getEffectiveUser, isImpersonating, startImpersonation } from '@/components/utils/ImpersonationContext';
import { logAction } from '@/components/utils/AuditLogger';
import { BUILTIN_ROLE_NAMES, isAdminRole } from '@/components/utils/roles';
import { listTeams } from '@/components/utils/teams';
import { createPageUrl } from '@/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import StudentMovesPanel from '@/components/students/StudentMovesPanel';
import { CallButton } from '@/components/followups/CallFlow';
import { TablePagination, usePagination } from '@/components/common/TablePagination';

const ROUND_ROBIN = '__round_robin__';
const REASSIGNERS = ['super_admin', 'admin'];
const TIER_ORDER = ['chief_mentor', 'senior_mentor', 'junior_mentor', 'cs_manager', 'subjunior_mentor', 'cs'];
const roleName = (r) => BUILTIN_ROLE_NAMES[r] || ({ cs: 'CS', cs_manager: 'CS Manager' }[r]) || String(r || '').replace(/_/g, ' ');
const tierRank = (r) => { const i = TIER_ORDER.indexOf(r); return i === -1 ? TIER_ORDER.length : i; };

/**
 * One team, by its leader's id: /TeamDetail?id=<leaderId>.
 *
 * Admins and the team's leader see every student on the team and may move
 * them between the team's CS (reassignStudents enforces the same rules on the
 * server: Super Admin / Admin any team, the leader their own, CS targets only).
 * Other members of the team can open it but see only their own students.
 */
export default function TeamDetail() {
  const { search } = useLocation();
  const teamId = new URLSearchParams(search).get('id') || '';
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['users-teams'],
    queryFn: () => base44.entities.User.list(),
    enabled: !!currentUser,
  });
  const navigate = useNavigate();
  // Approved deposits → each student's products (tags such as DSLP, MMC).
  const { data: productTransactions = [] } = useQuery({
    queryKey: ['student-product-transactions'],
    queryFn: () => base44.entities.FundingTransaction.list('-requested_at'),
    enabled: !!currentUser,
  });
  const studentProducts = useMemo(() => productsByStudent(productTransactions), [productTransactions]);
  const { data: students = [], isLoading: loadingStudents } = useQuery({
    queryKey: ['team-students'],
    queryFn: () => base44.entities.Student.list('-created_date'),
    enabled: !!currentUser,
  });

  const team = useMemo(() => listTeams(users).find(t => t.id === teamId) || null, [users, teamId]);
  const memberIds = useMemo(() => new Set((team?.members || []).map(m => m.id)), [team]);

  const isAdmin = !!currentUser && isAdminRole(currentUser.app_role);
  const isLeader = !!currentUser && currentUser.id === teamId;
  const isMember = !!currentUser && memberIds.has(currentUser.id);
  const seesAll = isAdmin || isLeader;
  const canReassign = !!currentUser && (REASSIGNERS.includes(currentUser.app_role) || isLeader);

  const teamStudents = useMemo(() => {
    if (!team) return [];
    const all = students.filter(s => s.team_id === team.id || memberIds.has(s.primary_mentor_id));
    return seesAll ? all : all.filter(s => s.primary_mentor_id === currentUser?.id);
  }, [students, team, memberIds, seesAll, currentUser?.id]);

  const countByMentor = useMemo(() => {
    const m = {};
    for (const s of teamStudents) m[s.primary_mentor_id] = (m[s.primary_mentor_id] || 0) + 1;
    return m;
  }, [teamStudents]);

  const [q, setQ] = useState('');
  const [personFilter, setPersonFilter] = useState('all');
  const [selected, setSelected] = useState([]);
  const [dialogFor, setDialogFor] = useState(null); // array of students to reassign
  const viewAs = async (m) => {
    await logAction('other', 'User', m.id, `${currentUser.full_name} (team leader) started viewing as ${m.full_name} (${m.app_role})`,
      null, { impersonated_user: m.full_name, impersonated_role: m.app_role });
    startImpersonation(m, currentUser);
  };

  const needle = q.trim().toLowerCase();
  const visible = teamStudents.filter(s =>
    (personFilter === 'all' || s.primary_mentor_id === personFilter) &&
    (!needle || [s.full_name, s.email, s.student_code, s.primary_mentor_name].some(v => String(v || '').toLowerCase().includes(needle)))
  );
  const { pageItems: pageStudents, bar } = usePagination(visible, { resetKey: `${teamId}|${needle}|${personFilter}` });

  const members = useMemo(() => [...(team?.members || [])].sort((a, b) =>
    (tierRank(a.app_role) - tierRank(b.app_role)) || String(a.full_name || '').localeCompare(String(b.full_name || ''))), [team]);
  // Same order the server deals round robin in: account creation, then id.
  const csPeople = members
    .filter(m => m.app_role === 'cs' && m.status !== 'inactive')
    .sort((a, b) => `${a.created_date ?? ''}|${a.id}`.localeCompare(`${b.created_date ?? ''}|${b.id}`));

  if (!currentUser || loadingUsers) {
    return <div className="p-8 text-center text-slate-400">Loading team…</div>;
  }
  if (!team) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <Card><CardContent className="p-6 text-center space-y-3">
          <UsersRound className="h-10 w-10 text-slate-400 mx-auto" />
          <p className="font-semibold text-slate-700">Team not found</p>
          <Link to={createPageUrl('Teams')} className="text-sm text-blue-600 hover:underline">Back to Teams</Link>
        </CardContent></Card>
      </div>
    );
  }
  if (!isAdmin && !isMember) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <Card className="border-red-200"><CardContent className="p-6 text-center space-y-3">
          <ShieldAlert className="h-10 w-10 text-red-600 mx-auto" />
          <h2 className="text-lg font-semibold">No access</h2>
          <p className="text-sm text-slate-600">You can open only the team you are on.</p>
        </CardContent></Card>
      </div>
    );
  }

  const toggle = (id, on) => setSelected(prev => (on ? [...prev, id] : prev.filter(x => x !== id)));
  // The header box ticks this page; "Select all N" takes in the other pages.
  const allOn = pageStudents.length > 0 && pageStudents.every(s => selected.includes(s.id));
  const togglePage = (on) => {
    const ids = pageStudents.map(s => s.id);
    setSelected(prev => (on ? [...new Set([...prev, ...ids])] : prev.filter(id => !ids.includes(id))));
  };
  const selectedStudents = teamStudents.filter(s => selected.includes(s.id));
  const colCount = 9 + (canReassign ? 1 : 0);

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <Link to={createPageUrl('Teams')} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-navy">
          <ArrowLeft className="h-4 w-4" /> Teams
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <PageTitle eyebrow="Team" icon={UsersRound}>{team.name}</PageTitle>
            <p className="mt-2 text-sm text-slate-500 sm:text-base">
              Led by <span className="font-semibold text-slate-700">{team.leader?.full_name}</span>
              {!seesAll && ' · you are seeing your own students'}
            </p>
          </div>
          {canReassign && selectedStudents.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              {selectedStudents.length < visible.length && (
                <button type="button" className="text-sm font-medium text-blue-600 hover:underline" onClick={() => setSelected(visible.map(s => s.id))}>
                  Select all {visible.length}
                </button>
              )}
              <button type="button" className="text-sm text-slate-500 hover:underline" onClick={() => setSelected([])}>Clear</button>
              <Button onClick={() => setDialogFor(selectedStudents)}>
                <ArrowRightLeft className="h-4 w-4" /> Reassign {selectedStudents.length}
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatsCard title="Members" value={members.length} icon={Users} color="blue" delay={0.05} />
          <StatsCard title={seesAll ? 'Team students' : 'Your students'} value={teamStudents.length} icon={UserCheck} color="cyan" delay={0.12} />
          <StatsCard title="Active" value={teamStudents.filter(s => s.status === 'ACTIVE').length} icon={UserCheck} color="emerald" delay={0.19} />
        </div>

        <Tabs defaultValue="students" className="w-full">
          {seesAll && (
            <TabsList className="mb-4">
              <TabsTrigger value="students">Members &amp; students</TabsTrigger>
              <TabsTrigger value="moves">Transfers &amp; new</TabsTrigger>
            </TabsList>
          )}
          <TabsContent value="students" className="mt-0">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Members */}
          <Card className="lg:col-span-1">
            <CardHeader className="border-b"><CardTitle className="text-base text-brand-navy">Members</CardTitle></CardHeader>
            <CardContent className="p-0 divide-y">
              {members.map(m => {
                const count = seesAll || m.id === currentUser.id ? (countByMentor[m.id] || 0) : null;
                // The team's leader views as one of its CS (the server allows only their own team's, 2026-10-08).
                const canViewAs = isLeader && !isImpersonating() && m.app_role === 'cs' && m.status !== 'inactive';
                return (
                  <div key={m.id} className="flex items-center">
                  <button
                    type="button"
                    disabled={!seesAll}
                    onClick={() => setPersonFilter(personFilter === m.id ? 'all' : m.id)}
                    className={`flex min-w-0 flex-1 items-center justify-between gap-2 px-4 py-2.5 text-left transition-colors ${personFilter === m.id ? 'bg-brand-cyan/[0.08]' : seesAll ? 'hover:bg-slate-50' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {m.full_name}{m.id === currentUser.id && <span className="text-slate-400"> (you)</span>}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {roleName(m.app_role)}{m.id === team.id ? ' · leader' : ''}{m.up_head_name && m.id !== team.id ? ` · reports to ${m.up_head_name}` : ''}
                      </span>
                    </span>
                    {count !== null && <Badge variant="secondary" className="tabular">{count}</Badge>}
                  </button>
                  {canViewAs && (
                    <Button size="sm" variant="ghost" className="mr-2 h-7 shrink-0 px-2 text-xs" onClick={() => viewAs(m)} title={`See the portal as ${m.full_name} sees it`}>
                      View as
                    </Button>
                  )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Students */}
          <Card className="lg:col-span-2 overflow-hidden">
            <CardHeader className="border-b">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-base text-brand-navy">
                  Students <span className="font-normal text-slate-400">· {visible.length}</span>
                  {personFilter !== 'all' && (
                    <button className="ml-2 text-xs font-normal text-blue-600 hover:underline" onClick={() => setPersonFilter('all')}>
                      clear filter
                    </button>
                  )}
                </CardTitle>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, code…" className="h-9 pl-9" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50/80">
                      {canReassign && (
                        <th className="w-10 px-4 py-3">
                          <Checkbox checked={allOn} onCheckedChange={(on) => togglePage(!!on)} />
                        </th>
                      )}
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Code</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Student</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Mentor</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Course</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Products</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Level</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Created</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {loadingStudents ? (
                      <tr><td colSpan={colCount} className="py-10 text-center text-slate-400">Loading…</td></tr>
                    ) : visible.length === 0 ? (
                      <tr><td colSpan={colCount} className="py-10 text-center text-slate-400">No students{needle || personFilter !== 'all' ? ' match' : ' yet'}.</td></tr>
                    ) : pageStudents.map(s => (
                      <tr key={s.id} className="cursor-pointer border-b border-slate-100 hover:bg-brand-cyan/[0.04]" onClick={(e) => { if (!e.target.closest('button, a, input, [role="checkbox"]')) navigate(`${createPageUrl('StudentDetail')}?id=${s.id}`); }}>
                        {canReassign && (
                          <td className="px-4 py-2.5"><Checkbox checked={selected.includes(s.id)} onCheckedChange={(on) => toggle(s.id, on)} /></td>
                        )}
                        <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{s.student_code || '—'}</td>
                        <td className="px-4 py-2.5">
                          <Link to={`${createPageUrl('StudentDetail')}?id=${s.id}`} className="font-medium text-slate-900 hover:text-blue-600">{s.full_name}</Link>
                          <div className="text-xs text-slate-400">{s.email}</div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">{s.primary_mentor_name || '—'}</td>
                        <td className="max-w-[200px] px-4 py-2.5 text-slate-600">{courseLabel(s.lms_course) || <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-2.5">{(studentProducts[s.id] || []).length ? <div className="flex flex-wrap gap-1">{studentProducts[s.id].map(p => <Badge key={p} variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">{p}</Badge>)}</div> : <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-2.5 text-slate-600">{(s.student_level || 'LEVEL_1').replace('LEVEL_', 'Level ')}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className={s.status === 'ACTIVE' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}>{s.status || '—'}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">{s.created_date ? new Date(s.created_date).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <CallButton variant="icon" student={s} />
                            {canReassign && <Button variant="outline" size="sm" onClick={() => setDialogFor([s])}>Reassign</Button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination {...bar} />
            </CardContent>
          </Card>
        </div>
          </TabsContent>
          {seesAll && (
            <TabsContent value="moves" className="mt-0">
              {/* Students moved in / out / inside this team, and new students it was given */}
              <StudentMovesPanel teamId={team.id} title="Transfers & new students" />
            </TabsContent>
          )}
        </Tabs>
      </div>

      <ReassignDialog
        open={!!dialogFor}
        onOpenChange={(o) => { if (!o) setDialogFor(null); }}
        team={team}
        students={dialogFor || []}
        csPeople={csPeople}
        onDone={() => {
          queryClient.invalidateQueries({ queryKey: ['team-students'] });
          queryClient.invalidateQueries({ queryKey: ['students'] });
          setSelected([]);
        }}
      />
    </div>
  );
}

function ReassignDialog({ open, onOpenChange, team, students, csPeople, onDone }) {
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  React.useEffect(() => { if (open) { setTarget(''); setError(null); setBusy(false); } }, [open]);

  const plan = target === ROUND_ROBIN
    ? students.map((s, i) => ({ s, to: csPeople[i % csPeople.length] }))
    : students.map(s => ({ s, to: csPeople.find(c => c.id === target) })).filter(p => p.to);
  const moving = plan.filter(p => p.to && p.s.primary_mentor_id !== p.to.id);
  const perPerson = [...moving.reduce((m, p) => m.set(p.to.full_name, (m.get(p.to.full_name) || 0) + 1), new Map()).entries()];

  const run = async () => {
    setBusy(true); setError(null);
    try {
      await base44.functions.invoke('reassignStudents', {
        teamId: team.id,
        studentIds: students.map(s => s.id),
        ...(target === ROUND_ROBIN ? { roundRobin: true } : { toCsId: target }),
      });
      onDone?.();
      onOpenChange(false);
    } catch (e) {
      setError(e?.message || 'Reassign failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-brand-navy">
            Reassign {students.length === 1 ? students[0].full_name : `${students.length} students`}
          </DialogTitle>
          <DialogDescription>To another CS on {team.name}. Future transactions follow the new CS; past commission stays where it is.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>New CS</Label>
            <Select value={target || undefined} onValueChange={(v) => v && setTarget(v)}>
              <SelectTrigger><SelectValue placeholder={csPeople.length ? 'Select CS' : 'This team has no CS'} /></SelectTrigger>
              <SelectContent>
                {students.length > 1 && (
                  <SelectItem value={ROUND_ROBIN} disabled={!csPeople.length}>Round robin across the team’s CS ({csPeople.length})</SelectItem>
                )}
                {csPeople.map(c => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {target && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm">
              {moving.length === 0 ? (
                <p className="text-slate-500">Already with that CS — nothing to move.</p>
              ) : (
                <>
                  <p className="font-medium text-slate-700">{moving.length} will move{plan.length - moving.length ? ` · ${plan.length - moving.length} already there` : ''}</p>
                  <ul className="mt-1 space-y-0.5 text-slate-500">{perPerson.map(([n, c]) => <li key={n}>{n}: {c}</li>)}</ul>
                </>
              )}
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {error}
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={busy || moving.length === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />} Reassign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
