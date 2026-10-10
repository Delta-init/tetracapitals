import React, { useState, useMemo } from 'react';
import { PageTitle } from '@/components/common/PageHeader';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LayoutDashboard, Users, DollarSign } from 'lucide-react';
import { getEffectiveUser } from '@/components/utils/ImpersonationContext';
import { isMentorRole } from '@/components/utils/roles';
import { FIELDS_BY_CATEGORY, isNumeric, activityCategory } from '@/components/activity/activityFields';
import { TablePagination, usePagination } from '@/components/common/TablePagination';

// Viewers who see the WHOLE company (not just their own downline).
const ADMIN_VIEWERS = ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'admin_supervisor', 'finance_admin'];

const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const firstOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);

// Columns shown per team (sum of the field over the range; score is averaged).
const PA_COLS = [
  ['calls_done', 'Calls'], ['calls_connected', 'Connected'], ['whatsapp_followup', 'WhatsApp'],
  ['meetings_done', 'Meetings'], ['deposit_usd', 'Deposit', 'money'],
  ['dslp_closings', 'DSLP'], ['dqmp_closings', 'DQMP'], ['dgmp_closings', 'DGMP'], ['mmv2_closings', 'MM V2'],
];
const MENTOR_COLS = [
  ['classes_taken', 'Classes'], ['sales_meetings', 'Sales Mtgs'], ['students_screened', 'Screened'],
  ['meetings_deposit_course', 'Meetings'], ['followups_done', 'Follow-Ups'], ['deposit_usd', 'Deposit', 'money'],
  ['dslp_closings', 'DSLP'], ['dqmp_closings', 'DQMP'], ['dgmp_closings', 'DGMP'], ['mmv2_closings', 'MM V2'],
];

export default function TeamDashboard() {
  const { data: currentUser } = useQuery({ queryKey: ['me-effective'], queryFn: async () => getEffectiveUser(await base44.auth.me()) });
  const [start, setStart] = useState(firstOfMonth());
  const [end, setEnd] = useState(today());

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['activity-logs-all'],
    queryFn: () => base44.entities.ActivityLog.list('-date'),
    enabled: !!currentUser,
  });
  // The team roster comes from the hierarchy (Up Head), so team members show up
  // even before they've logged any activity.
  const { data: users = [] } = useQuery({
    queryKey: ['users-all-activity'],
    queryFn: () => base44.entities.User.list(),
    enabled: !!currentUser,
  });

  const { pa, mentor, totals, directory } = useMemo(() => {
    // Everyone under the current user in the Up Head tree (their downline).
    const childrenOf = {};
    for (const u of users) { const p = u.up_head_id; if (p) (childrenOf[p] = childrenOf[p] || []).push(u.id); }
    const downline = new Set();
    const queue = [currentUser?.id];
    while (queue.length) {
      const c = queue.shift();
      for (const k of (childrenOf[c] || [])) if (!downline.has(k)) { downline.add(k); queue.push(k); }
    }
    const isAdminViewer = currentUser && ADMIN_VIEWERS.includes(currentUser.app_role);

    // Team roster = staff (mentors / PA / custom) under this chief, or all staff
    // for an admin viewer. Excludes the viewer themselves and admin-only roles.
    const teamUsers = users.filter(u =>
      u.id !== currentUser?.id && isMentorRole(u.app_role) && (isAdminViewer || downline.has(u.id))
    );

    // Aggregate each team member's logs in range (zeros if none).
    const inRange = (d) => (!start || d >= start) && (!end || d <= end);
    const logsByStaff = {};
    for (const log of logs) {
      if (!log.date || !inRange(log.date)) continue;
      (logsByStaff[log.staff_id] = logsByStaff[log.staff_id] || []).push(log);
    }
    const rows = teamUsers.map(u => {
      const category = activityCategory(u.app_role);
      const g = { name: u.full_name || '—', category, entries: 0, sums: {}, scoreSum: 0, scoreCount: 0 };
      for (const log of (logsByStaff[u.id] || [])) {
        g.entries += 1;
        for (const f of (FIELDS_BY_CATEGORY[category] || [])) {
          if (isNumeric(f.type)) g.sums[f.key] = (g.sums[f.key] || 0) + (Number(log[f.key]) || 0);
        }
        if (log.daily_score !== undefined && log.daily_score !== null && log.daily_score !== '') {
          g.scoreSum += Number(log.daily_score) || 0; g.scoreCount += 1;
        }
      }
      return { ...g, avgScore: g.scoreCount ? g.scoreSum / g.scoreCount : 0 };
    });
    // Team directory (Name / Role / Reports To / Category), from the hierarchy.
    const humanRole = (r) => String(r || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const directory = teamUsers.map(u => ({
      name: u.full_name || '—',
      role: humanRole(u.app_role),
      reportsTo: u.up_head_name || '—',
      category: activityCategory(u.app_role) === 'pa' ? 'PA / CSE' : 'Mentor',
    })).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    const pa = rows.filter(r => r.category === 'pa').sort((a, b) => b.avgScore - a.avgScore);
    const mentor = rows.filter(r => r.category !== 'pa').sort((a, b) => b.avgScore - a.avgScore);
    const sumKey = (list, k) => list.reduce((s, r) => s + (r.sums[k] || 0), 0);
    const totals = {
      totalCalls: sumKey(pa, 'calls_done'),
      totalDeposit: sumKey(pa, 'deposit_usd') + sumKey(mentor, 'deposit_usd'),
      dslp: sumKey(pa, 'dslp_closings') + sumKey(mentor, 'dslp_closings'),
      dqmp: sumKey(pa, 'dqmp_closings') + sumKey(mentor, 'dqmp_closings'),
      dgmp: sumKey(pa, 'dgmp_closings') + sumKey(mentor, 'dgmp_closings'),
      mmv2: sumKey(pa, 'mmv2_closings') + sumKey(mentor, 'mmv2_closings'),
      classes: sumKey(mentor, 'classes_taken'),
      screened: sumKey(mentor, 'students_screened'),
      courseValue: sumKey(pa, 'course_value_usd'),
    };
    return { pa, mentor, totals, directory };
  }, [logs, users, start, end, currentUser?.id, currentUser?.app_role]);

  const maxScore = Math.max(1, ...[...pa, ...mentor].map(r => r.avgScore));

  // Paging lives here, not in Team: Team is redefined on every render.
  const { pageItems: directoryRows, bar: directoryBar } = usePagination(directory);
  const { pageItems: mentorRows, bar: mentorBar } = usePagination(mentor, { resetKey: `${start}|${end}`, urlKey: 'mentors_page' });
  const { pageItems: paRows, bar: paBar } = usePagination(pa, { resetKey: `${start}|${end}`, urlKey: 'pa_page' });

  const Team = ({ title, rows, pageRows, bar, cols, icon }) => (
    <Card>
      <CardHeader className="border-b"><CardTitle className="text-lg flex items-center gap-2">{icon} {title} <span className="text-sm font-normal text-gray-400">({rows.length})</span></CardTitle></CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                {title.includes('PA') && <th className="text-right px-3 py-3 font-semibold text-gray-600">Conn %</th>}
                {cols.map(([k, label]) => <th key={k} className="text-right px-3 py-3 font-semibold text-gray-600 whitespace-nowrap">{label}</th>)}
                <th className="text-right px-3 py-3 font-semibold text-gray-600">Avg Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={cols.length + 3} className="text-center py-8 text-gray-400">No activity in this range.</td></tr>
              ) : pageRows.map((r, i) => (
                <tr key={i} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                  {title.includes('PA') && <td className="px-3 py-3 text-right">{(r.sums.calls_done ? (r.sums.calls_connected / r.sums.calls_done) * 100 : 0).toFixed(1)}%</td>}
                  {cols.map(([k, label, type]) => <td key={k} className="px-3 py-3 text-right">{type === 'money' ? money(r.sums[k]) : (r.sums[k] || 0)}</td>)}
                  <td className="px-3 py-3 text-right font-bold text-indigo-700">{r.avgScore.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <TablePagination {...bar} />
      </CardContent>
    </Card>
  );

  if (!currentUser) return <div className="p-8 text-center text-gray-500">Loading…</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-100/20 p-6">
      <div className="w-full max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <PageTitle eyebrow="Overview" icon={LayoutDashboard}>Team Dashboard</PageTitle>
            <p className="mt-2 max-w-3xl text-sm text-slate-500 sm:text-base">Your whole team’s activity, rolled up for the selected date range.</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <input type="date" value={start} onChange={e => setStart(e.target.value)} className="h-9 rounded-md border border-input bg-white px-3" />
            <span className="text-gray-400">to</span>
            <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="h-9 rounded-md border border-input bg-white px-3" />
          </div>
        </div>

        {/* Team Directory — who's on the team, from the hierarchy */}
        <Card>
          <CardHeader className="border-b"><CardTitle className="text-lg flex items-center gap-2"><Users className="h-5 w-5 text-indigo-600" /> Team Directory <span className="text-sm font-normal text-gray-400">({directory.length})</span></CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Name</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Role</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Reports To</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {directory.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-8 text-gray-400">No team members assigned. Set their “Up Head” to you in Personnel.</td></tr>
                  ) : directoryRows.map((m, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                      <td className="px-4 py-3 text-gray-700">{m.role}</td>
                      <td className="px-4 py-3 text-gray-500">{m.reportsTo}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${m.category === 'PA / CSE' ? 'bg-teal-100 text-teal-800' : 'bg-indigo-100 text-indigo-800'}`}>{m.category}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination {...directoryBar} />
          </CardContent>
        </Card>

        {/* Company totals */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            ['Total Calls', totals.totalCalls, 'bg-blue-50 border-blue-200', 'text-blue-600', 'text-blue-700'],
            ['Total Deposits', money(totals.totalDeposit), 'bg-emerald-50 border-emerald-200', 'text-emerald-600', 'text-emerald-700'],
            ['Course Value Closed', money(totals.courseValue), 'bg-purple-50 border-purple-200', 'text-purple-600', 'text-purple-700'],
            ['Classes Taken', totals.classes, 'bg-orange-50 border-orange-200', 'text-orange-600', 'text-orange-700'],
          ].map(([label, val, box, lc, vc]) => (
            <div key={label} className={`${box} border rounded-xl p-4`}>
              <p className={`text-xs ${lc} font-medium uppercase`}>{label}</p>
              <p className={`text-2xl font-bold ${vc} mt-1`}>{val}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[['DSLP', totals.dslp], ['DQMP', totals.dqmp], ['DGMP', totals.dgmp], ['MM V2', totals.mmv2], ['Students Screened', totals.screened]].map(([l, v]) => (
            <div key={l} className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-500 font-medium uppercase">{l}</p>
              <p className="text-2xl font-bold text-gray-800 mt-1">{v}</p>
            </div>
          ))}
        </div>

        {isLoading ? <div className="text-center py-10 text-gray-400">Loading…</div> : (
          <>
            <Team title="Mentor Team" rows={mentor} pageRows={mentorRows} bar={mentorBar} cols={MENTOR_COLS} icon={<Users className="h-5 w-5 text-indigo-600" />} />
            <Team title="PA / CSE Team" rows={pa} pageRows={paRows} bar={paBar} cols={PA_COLS} icon={<Users className="h-5 w-5 text-teal-600" />} />

            {/* Avg daily score chart */}
            <Card>
              <CardHeader className="border-b"><CardTitle className="text-lg">Average Daily Score</CardTitle></CardHeader>
              <CardContent className="p-6 space-y-2">
                {[...mentor, ...pa].length === 0 ? <p className="text-gray-400 text-sm">No data.</p> :
                  [...mentor, ...pa].sort((a, b) => b.avgScore - a.avgScore).map((r, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="w-40 truncate text-sm text-gray-700">{r.name}</span>
                      <div className="flex-1 bg-gray-100 rounded h-5 overflow-hidden">
                        <div className="h-full bg-indigo-500" style={{ width: `${(r.avgScore / maxScore) * 100}%` }} />
                      </div>
                      <span className="w-12 text-right text-sm font-semibold text-indigo-700">{r.avgScore.toFixed(1)}</span>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
