import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { base44 } from '@/api/base44Client';
import SearchableSelect from '@/components/common/SearchableSelect';

export default function PersonnelForm({ user, onSubmit, onClose, allUsers }) {
  const isCreate = !user;
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    app_role: 'junior_mentor',
    senior_mentor_id: '',
    senior_mentor_name: '',
    assigned_mentor_id: '',
    assigned_mentor_name: '',
    up_head_id: '',      // the person directly above this user (A is under this head)
    up_head_name: '',
    commission_plan_id: '',  // commission plan applied when this staff submits
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);

  // Load via React Query with the SAME keys the Personnel page uses, so the
  // lists are already cached when the edit dialog opens — otherwise the Radix
  // Select mounts with a value whose matching option doesn't exist yet, and it
  // sticks on the placeholder ("(none)") even after the options arrive.
  const { data: commissionRoles = [] } = useQuery({
    queryKey: ['commission-roles'],
    queryFn: () => base44.entities.CommissionRole.list('name'),
  });
  const { data: commissionPlans = [] } = useQuery({
    queryKey: ['commission-plans'],
    queryFn: () => base44.entities.CommissionPlan.list('name'),
  });

  useEffect(() => {
    if (user) {
      setFormData({
        full_name: user.full_name || '',
        email: user.email || '',
        app_role: user.app_role || 'junior_mentor',
        senior_mentor_id: user.senior_mentor_id || '',
        senior_mentor_name: user.senior_mentor_name || '',
        assigned_mentor_id: user.assigned_mentor_id || '',
        assigned_mentor_name: user.assigned_mentor_name || '',
        up_head_id: user.up_head_id || '',
        up_head_name: user.up_head_name || '',
        commission_plan_id: user.commission_plan_id || '',
      });
    }
  }, [user]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isCreate) {
      if (!formData.password || formData.password.length < 8) {
        alert('Initial password is required and must be at least 8 characters.');
        return;
      }
      onSubmit(formData);
    } else {
      // Editing — don't send the password field at all.
      const { password, ...rest } = formData;
      onSubmit(rest);
    }
  };

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
    setFormData((d) => ({ ...d, password: out }));
    setShowPassword(true);
  };

  const slugify = (s) => (s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const BUILTIN_ROLES = [
    ['super_admin', 'Super Admin'], ['admin', 'Admin'], ['broker_admin', 'Broker Admin'],
    ['academic_head', 'Academic Head'], ['academic_admin', 'Academic Admin'], ['admin_supervisor', 'Admin Supervisor'],
    ['senior_mentor', 'Senior Mentor'], ['junior_mentor', 'Junior Mentor'], ['subjunior_mentor', 'Sub Junior Mentor'],
    ['finance_admin', 'Finance Admin'], ['assistance', 'Assistance'], ['draw_admin', 'Draw Admin'],
  ];
  // Role options come live from Role Management (so custom roles appear); fall
  // back to the built-in list if none have been seeded yet.
  const roleOptions = commissionRoles.length
    ? commissionRoles.map(r => [r.role_key || slugify(r.name), r.name])
    : BUILTIN_ROLES;

  const seniorMentors = allUsers?.filter(u => u.app_role === 'senior_mentor') || [];
  const allMentors = allUsers?.filter(u => ['senior_mentor', 'junior_mentor'].includes(u.app_role)) || [];

  const handleSeniorMentorChange = (mentorId) => {
    const mentor = seniorMentors.find(m => m.id === mentorId);
    setFormData({
      ...formData,
      senior_mentor_id: mentorId,
      senior_mentor_name: mentor?.full_name || ''
    });
  };

  const handleAssignedMentorChange = (mentorId) => {
    const mentor = allMentors.find(m => m.id === mentorId);
    setFormData({
      ...formData,
      assigned_mentor_id: mentorId,
      assigned_mentor_name: mentor?.full_name || ''
    });
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{user ? 'Edit User' : 'Add New User'}</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="full_name">Full Name *</Label>
            <Input
              id="full_name"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              required
            />
          </div>

          <div>
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
              disabled={!!user}
            />
            {user && <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>}
          </div>

          {isCreate && (
            <div>
              <Label htmlFor="password">Initial Password *</Label>
              <div className="flex gap-2">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Min 8 characters"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                <Button type="button" variant="outline" onClick={() => setShowPassword((s) => !s)}>
                  {showPassword ? 'Hide' : 'Show'}
                </Button>
                <Button type="button" variant="outline" onClick={generatePassword}>
                  Generate
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Share this password securely with the user. They can change it after first login.
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="app_role">Role *</Label>
            <Select
              value={formData.app_role}
              onValueChange={(value) => setFormData({ ...formData, app_role: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {formData.app_role === 'assistance' && (
            <div>
              <Label htmlFor="assigned_mentor">Assigned Mentor *</Label>
              <Select
                value={formData.assigned_mentor_id}
                onValueChange={handleAssignedMentorChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select mentor" />
                </SelectTrigger>
                <SelectContent>
                  {allMentors.map((mentor) => (
                    <SelectItem key={mentor.id} value={mentor.id}>
                      {mentor.full_name} ({mentor.app_role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">Students and funding requests will be associated with this mentor</p>
            </div>
          )}

          {/* Hierarchy: the person directly above this user */}
          <div>
            <Label htmlFor="up_head">Up Head</Label>
            <SearchableSelect
              value={formData.up_head_id || '__none__'}
              onValueChange={(v) => {
                if (v === '__none__') { setFormData({ ...formData, up_head_id: '', up_head_name: '' }); return; }
                const head = allUsers?.find(u => u.id === v);
                setFormData({ ...formData, up_head_id: v, up_head_name: head?.full_name || '' });
              }}
              placeholder="(no head — top of chain)"
              searchPlaceholder="Search by name or email…"
              noneLabel="(no head — top of chain)"
              options={(allUsers || [])
                .filter(u => u.id !== user?.id)
                .map(u => ({ value: u.id, label: `${u.full_name} — ${u.email}` }))}
            />
            <p className="text-xs text-gray-500 mt-1">The person directly above this user. Set B here in A's profile → A is under B.</p>
          </div>

          <div>
            <Label htmlFor="commission_plan">Commission Plan</Label>
            <SearchableSelect
              key={`plan-select-${commissionPlans.length}`}
              value={formData.commission_plan_id || '__none__'}
              onValueChange={(v) => setFormData({ ...formData, commission_plan_id: v === '__none__' ? '' : v })}
              placeholder="(none)"
              searchPlaceholder="Search plans…"
              noneLabel="(none)"
              options={commissionPlans.map(p => ({ value: p.id, label: p.name }))}
            />
            <p className="text-xs text-gray-500 mt-1">Applied when this staff submits a transaction — pays each level up the chain per the plan.</p>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
              {user ? 'Update' : 'Add User'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}