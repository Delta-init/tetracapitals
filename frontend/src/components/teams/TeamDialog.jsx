import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Crown, Loader2, Trash2, UserPlus } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import SearchableSelect from '@/components/common/SearchableSelect';
import { isMentorRole } from '@/components/utils/roles';
import { LOCATIONS, teamLocationOf } from '@/components/utils/teams';
import { logAction } from '@/components/utils/AuditLogger';
import { EASE } from '@/components/motion';

// "junior_mentor" -> "Junior Mentor", "cs_manager" -> "CS Manager"
const roleLabel = (r) => String(r || '')
  .split('_')
  .map(w => (w === 'cs' ? 'CS' : w.charAt(0).toUpperCase() + w.slice(1)))
  .join(' ');

/**
 * Create or edit a team. A team is the Up Head chain rooted at its leader, so
 * saving writes each member's `up_head_id` / `up_head_name` (the same fields
 * Personnel edits) and the team's name onto the leader as `team_name`.
 *
 *   mode="create": team = null, pool = unassigned staff
 *   mode="edit":   team = { root, members } from the Teams page
 */
export default function TeamDialog({ open, onOpenChange, mode, team, users, unassigned, onSaved }) {
  const byId = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users]);
  const originalIds = useMemo(() => new Set((team?.members || []).map(m => m.id)), [team]);

  const [name, setName] = useState('');
  const [location, setLocation] = useState('dubai');   // Dubai / Bangalore — on the leader as team_location
  const [leaderId, setLeaderId] = useState('');
  const [rows, setRows] = useState([]); // [{ id, reportsTo }]
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    if (mode === 'edit' && team) {
      const ids = new Set(team.members.map(m => m.id));
      setName(team.root?.team_name || '');
      setLocation(teamLocationOf(team.root));
      setLeaderId(team.root.id);
      setRows(team.members
        .filter(m => m.id !== team.root.id)
        .map(m => ({ id: m.id, reportsTo: ids.has(m.up_head_id) ? m.up_head_id : team.root.id })));
    } else {
      setName('');
      setLocation('dubai');
      setLeaderId('');
      setRows([]);
    }
  }, [open, mode, team]);

  const inDialog = new Set([leaderId, ...rows.map(r => r.id)].filter(Boolean));
  // Taken off the team in this dialog — they go to Unassigned only when it is saved.
  const removed = mode === 'edit' ? [...originalIds].filter(id => !inDialog.has(id)) : [];

  // People who can join: anyone unassigned, plus (when editing) this team's
  // current members. People on other teams must be removed there first.
  const pool = useMemo(() => {
    const list = [...unassigned];
    if (mode === 'edit' && team) list.push(...team.members);
    const seen = new Set();
    return list.filter(u => isMentorRole(u.app_role) && !seen.has(u.id) && seen.add(u.id));
  }, [unassigned, mode, team]);

  const option = (u) => ({ value: u.id, label: `${u.full_name} — ${roleLabel(u.app_role)}` });
  // Only a Chief Mentor can lead a team, and a Chief always tops their own team,
  // so Chiefs are offered as leaders but never as plain members.
  const isChief = (u) => u.app_role === 'chief_mentor';
  const leaderOptions = pool.filter(isChief).map(option);
  const addOptions = pool.filter(u => !isChief(u) && !inDialog.has(u.id)).map(option);

  const chooseLeader = (id) => {
    if (!id || id === '__none__' || id === leaderId) return;
    const prev = leaderId;
    // When editing, the previous leader stays on the team, under the new one.
    // Otherwise the previous pick just goes back to the pool.
    const keepPrev = prev && mode === 'edit' && originalIds.has(prev);
    setRows(rs => {
      let next = rs
        .filter(r => r.id !== id) // the new leader is no longer a plain member
        .map(r => (r.reportsTo === prev && !keepPrev ? { ...r, reportsTo: id } : r));
      if (keepPrev) next = [{ id: prev, reportsTo: id }, ...next];
      return next;
    });
    setLeaderId(id);
  };

  const addMember = (id) => {
    if (!id || id === '__none__' || inDialog.has(id)) return;
    setRows(rs => [...rs, { id, reportsTo: leaderId }]);
  };

  const removeMember = (id) => {
    // Anyone who reported to the removed person moves up to the leader.
    setRows(rs => rs.filter(r => r.id !== id).map(r => (r.reportsTo === id ? { ...r, reportsTo: leaderId } : r)));
  };

  const setReportsTo = (id, to) => setRows(rs => rs.map(r => (r.id === id ? { ...r, reportsTo: to } : r)));

  // Every member must climb to the leader without looping.
  const validate = () => {
    if (!name.trim()) return 'Give the team a name.';
    if (!leaderId) return 'Choose a team leader.';
    const to = Object.fromEntries(rows.map(r => [r.id, r.reportsTo]));
    for (const r of rows) {
      let cur = r.id, steps = 0;
      while (cur !== leaderId) {
        cur = to[cur];
        if (!cur || ++steps > rows.length) {
          return `${byId[r.id]?.full_name || 'A member'} has a "reports to" loop — every chain must lead up to the leader.`;
        }
      }
    }
    return null;
  };

  const save = async () => {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setError(null);
    setSaving(true);

    const teamName = name.trim();
    const changes = []; // [{ id, before, patch }]
    const add = (id, patch) => {
      const u = byId[id];
      if (!u) return;
      const diff = Object.fromEntries(Object.entries(patch).filter(([k, v]) => (u[k] || '') !== (v || '')));
      if (Object.keys(diff).length) {
        changes.push({ id, before: Object.fromEntries(Object.keys(diff).map(k => [k, u[k] ?? ''])), patch: diff });
      }
    };

    // Leader: holds the team name, and must be the top of the chain.
    const leader = byId[leaderId];
    const leaderPatch = { team_name: teamName, team_location: location };
    const parent = byId[leader?.up_head_id];
    if (parent && isMentorRole(parent.app_role) && leader.app_role !== 'chief_mentor') {
      leaderPatch.up_head_id = '';
      leaderPatch.up_head_name = '';
    }
    add(leaderId, leaderPatch);

    // Previous leader (edit + leader changed) gives up the team name.
    if (mode === 'edit' && team && team.root.id !== leaderId) add(team.root.id, { team_name: '', team_location: '' });

    for (const r of rows) add(r.id, { up_head_id: r.reportsTo, up_head_name: byId[r.reportsTo]?.full_name || '' });

    // Members dropped from the team go back to Unassigned.
    if (mode === 'edit') {
      for (const id of originalIds) {
        if (id !== leaderId && !rows.some(r => r.id === id)) add(id, { up_head_id: '', up_head_name: '' });
      }
    }

    try {
      for (const c of changes) {
        await base44.entities.User.update(c.id, c.patch);
        await logAction(
          mode === 'create' ? 'create_team' : 'update_team', 'User', c.id,
          `Team "${teamName}": updated ${byId[c.id]?.full_name}`, c.before, c.patch,
        );
      }
      onSaved?.();
      onOpenChange(false);
    } catch (e) {
      setError(`Saving stopped partway: ${e?.message || 'request failed'}. Some changes may already be applied — reopen the team to check.`);
    } finally {
      setSaving(false);
    }
  };

  const leader = byId[leaderId];
  const reportsToOptions = (selfId) => [
    ...(leader ? [{ value: leader.id, label: `${leader.full_name} (leader)` }] : []),
    ...rows.filter(r => r.id !== selfId).map(r => ({ value: r.id, label: byId[r.id]?.full_name || r.id })),
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl text-brand-navy">{mode === 'create' ? 'Create team' : 'Edit team'}</DialogTitle>
          <DialogDescription>
            Members are linked by <strong>Up Head</strong>, the same chain commission pays up and that decides whose data
            each person can see.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="team-name">Team name</Label>
              <Input id="team-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Falcon Team" className="mt-1.5" />
            </div>
            <div>
              <Label>Location</Label>
              <div className="mt-1.5 flex gap-2">
                {LOCATIONS.map(l => (
                  <Button key={l.value} type="button" size="sm" variant={location === l.value ? 'default' : 'outline'} className="flex-1" onClick={() => setLocation(l.value)}>{l.label}</Button>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">New students of this location are shared among its teams only.</p>
            </div>
            <div>
              <Label>Team leader</Label>
              <div className="mt-1.5">
                <SearchableSelect
                  value={leaderId}
                  onValueChange={chooseLeader}
                  options={leaderOptions}
                  placeholder={leaderOptions.length ? 'Choose a Chief Mentor…' : 'No unassigned Chief Mentors'}
                  searchPlaceholder="Search by name…"
                />
              </div>
            </div>
          </div>

          {leaderId && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Members <span className="font-normal text-slate-400">· {rows.length}</span></Label>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="flex items-center gap-3 bg-brand-navy/[0.03] px-4 py-2.5">
                  <Crown className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-semibold text-brand-navy">{leader?.full_name}</span>
                  <span className="text-xs text-slate-400">{roleLabel(leader?.app_role)} · leader</span>
                </div>
                <AnimatePresence initial={false}>
                  {rows.map(r => {
                    const u = byId[r.id];
                    return (
                      <motion.div
                        key={r.id}
                        layout
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: EASE }}
                        className="border-t border-slate-100"
                      >
                        <div className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center">
                          <div className="min-w-0 sm:w-44">
                            <p className="truncate text-sm font-medium text-slate-900">{u?.full_name}</p>
                            <p className="text-[11px] text-slate-400">{roleLabel(u?.app_role)}</p>
                          </div>
                          <div className="flex flex-1 items-center gap-2">
                            <span className="whitespace-nowrap text-xs text-slate-400">reports to</span>
                            <div className="min-w-0 flex-1">
                              <SearchableSelect
                                value={r.reportsTo}
                                onValueChange={v => setReportsTo(r.id, v)}
                                options={reportsToOptions(r.id)}
                                searchPlaceholder="Search…"
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeMember(r.id)}
                              className="h-8 w-8 flex-shrink-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              aria-label={`Remove ${u?.full_name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2.5">
                  <UserPlus className="h-4 w-4 flex-shrink-0 text-slate-400" />
                  <div className="flex-1">
                    <SearchableSelect
                      value=""
                      onValueChange={addMember}
                      options={addOptions}
                      placeholder={addOptions.length ? 'Add a member…' : 'No unassigned people left'}
                      searchPlaceholder="Search by name…"
                      disabled={!addOptions.length}
                    />
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Only unassigned people can be added. To move someone from another team, remove them there first.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {error}
            </div>
          )}
        </div>

        {/* Kept in view however long the member list is, so a change is never left unsaved for want of the button. */}
        <div className="sticky bottom-0 -mx-6 -mb-6 space-y-2 border-t border-slate-100 bg-background/95 px-6 py-4 backdrop-blur">
          {removed.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Removed: <strong>{removed.map(id => byId[id]?.full_name || 'someone').join(', ')}</strong>. Press Save changes to take
              them off the team — they go to Unassigned.
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === 'create' ? 'Create team' : 'Save changes'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
