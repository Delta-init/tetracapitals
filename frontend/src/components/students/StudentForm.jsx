import React, { useState, useEffect, useRef, useMemo } from 'react';
import { isSeniorTier, isMentorRole, BUILTIN_ROLE_NAMES } from '@/components/utils/roles';
import { listTeams, teamOfUser } from '@/components/utils/teams';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export default function StudentForm({ student, onSubmit, onCancel, isSubmitting, users: propUsers, currentUser }) {
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    phone: '',
    country: '',
    user_id: '',
    primary_mentor_id: '',
    senior_mentor_id: '',
    assignment_status: 'assigned',
    status: 'ACTIVE',
    student_level: 'LEVEL_1',
    notes: ''
  });

  const { data: fetchedUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      try {
        const r = await base44.functions.invoke('getAllUsers', {}); return r.data?.users || [];
      } catch (error) {
        console.warn('Unable to fetch users:', error);
        return [];
      }
    },
    enabled: !propUsers,
    retry: false
  });

  const users = propUsers || fetchedUsers;

  useEffect(() => {
    if (student) {
      setFormData(student);
    }
  }, [student]);

  // Team first, then the person in it (anyone on the team; CS listed first).
  // The server works the student's team out from the mentor, so only the
  // mentor is saved. "No team" lists staff not on any team yet.
  const NO_TEAM = '__none__';
  const teams = useMemo(() => listTeams(users), [users]);
  const noTeamStaff = useMemo(() =>
    users.filter(u => isMentorRole(u.app_role) && u.status !== 'inactive' && !teamOfUser(u.id, teams))
      .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''))),
  [users, teams]);
  const [teamChoice, setTeamChoice] = useState(null);
  const derivedTeam = teamOfUser(formData.primary_mentor_id, teams)?.id || NO_TEAM;
  const selectedTeam = teamChoice ?? derivedTeam;
  const people = selectedTeam === NO_TEAM ? noTeamStaff : (teams.find(t => t.id === selectedTeam)?.members || []);
  const roleName = (r) => BUILTIN_ROLE_NAMES[r] || ({ cs: 'CS', cs_manager: 'CS Manager' }[r]) || String(r || '').replace(/_/g, ' ');

  // Synchronous double-submit guard — `isSubmitting` only flips after React
  // re-renders, so a fast second click could fire onSubmit twice.
  const inFlight = useRef(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inFlight.current || isSubmitting) return;
    inFlight.current = true;
    setTimeout(() => { inFlight.current = false; }, 0);

    // Regular mentor assignment flow
    const primaryMentor = users.find(u => u.id === formData.primary_mentor_id);
    
    // Auto-populate senior_mentor_id if primary mentor is junior
    let finalSeniorMentorId = formData.senior_mentor_id;
    let finalSeniorMentorName = '';
    
    if (primaryMentor?.app_role === 'junior_mentor' && primaryMentor.senior_mentor_id) {
      finalSeniorMentorId = primaryMentor.senior_mentor_id;
      finalSeniorMentorName = primaryMentor.senior_mentor_name || '';
    } else if (isSeniorTier(primaryMentor?.app_role)) {
      // If primary is senior, clear senior mentor field
      finalSeniorMentorId = '';
      finalSeniorMentorName = '';
    } else if (formData.senior_mentor_id) {
      const seniorMentor = users.find(u => u.id === formData.senior_mentor_id);
      finalSeniorMentorName = seniorMentor?.full_name || '';
    }
    
    const dataToSubmit = {
      ...formData,
      assignment_status: 'assigned',
      primary_mentor_name: primaryMentor?.full_name || '',
      senior_mentor_id: finalSeniorMentorId,
      senior_mentor_name: finalSeniorMentorName
    };
    
    onSubmit(dataToSubmit);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="full_name">Full Name *</Label>
          <Input
            id="full_name"
            value={formData.full_name}
            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
            required
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="email">Email *</Label>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="country">Country</Label>
          <Input
            id="country"
            value={formData.country}
            onChange={(e) => setFormData({ ...formData, country: e.target.value })}
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="user_id">User ID</Label>
          <Input
            id="user_id"
            value={formData.user_id}
            onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
            placeholder="Enter user ID from CRM"
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="team">Team</Label>
          <Select
            value={selectedTeam}
            onValueChange={(value) => {
              // Radix reports "" when its option list changes under it (e.g. the
              // user list is still loading) — never treat that as a choice.
              if (!value) return;
              setTeamChoice(value);
              // Keep the person only if they're on the newly picked team.
              const inTeam = value === NO_TEAM
                ? noTeamStaff.some(u => u.id === formData.primary_mentor_id)
                : teams.find(t => t.id === value)?.members.some(m => m.id === formData.primary_mentor_id);
              if (!inTeam) setFormData({ ...formData, primary_mentor_id: '' });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select team" />
            </SelectTrigger>
            <SelectContent>
              {teams.map(t => (
                <SelectItem key={t.id} value={t.id}>{t.name} · {t.members.length}</SelectItem>
              ))}
              <SelectItem value={NO_TEAM}>No team</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="primary_mentor">CS</Label>
          <Select
            value={formData.primary_mentor_id || undefined}
            onValueChange={(value) => { if (value) setFormData(f => ({ ...f, primary_mentor_id: value })); }}
          >
            <SelectTrigger>
              <SelectValue placeholder={people.length ? 'Select person' : 'Nobody here yet'} />
            </SelectTrigger>
            <SelectContent>
              {people.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.full_name} ({roleName(p.app_role)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="senior_mentor">Senior Mentor (Auto-assigned)</Label>
          <Input
            value={
              (() => {
                const primaryMentor = users.find(u => u.id === formData.primary_mentor_id);
                if (isSeniorTier(primaryMentor?.app_role) && primaryMentor.senior_mentor_name) {
                  return primaryMentor.senior_mentor_name;
                } else if (['junior_mentor', 'subjunior_mentor'].includes(primaryMentor?.app_role)) {
                  return 'None';
                } else if (isSeniorTier(primaryMentor?.app_role)) {
                  return 'None (Primary is Senior)';
                }
                return 'None';
              })()
            }
            disabled
            className="bg-gray-50"
          />
        </div>
        

        
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <Select
            value={formData.status}
            onValueChange={(value) => setFormData({ ...formData, status: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        

      </div>
      
      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          rows={3}
          placeholder="Additional notes about the student..."
        />
      </div>
      
      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700">
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            student ? 'Update Student' : 'Create Student'
          )}
        </Button>
      </div>
    </form>
  );
}