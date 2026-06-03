import React, { useState, useEffect } from 'react';
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
    commission_rate: 4,
    upline_commission_percentage: 0,
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);

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
        commission_rate: user.commission_rate || 4,
        upline_commission_percentage: user.upline_commission_percentage || 0
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
      <DialogContent className="max-w-md">
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
                <SelectItem value="super_admin">Super Admin</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="broker_admin">Broker Admin</SelectItem>
                <SelectItem value="academic_head">Academic Head</SelectItem>
                <SelectItem value="academic_admin">Academic Admin</SelectItem>
                <SelectItem value="admin_supervisor">Admin Supervisor</SelectItem>
                <SelectItem value="senior_mentor">Senior Mentor</SelectItem>
                <SelectItem value="junior_mentor">Junior Mentor</SelectItem>
                <SelectItem value="subjunior_mentor">Sub Junior Mentor</SelectItem>
                <SelectItem value="finance_admin">Finance Admin</SelectItem>
                <SelectItem value="assistance">Assistance</SelectItem>
                <SelectItem value="draw_admin">Draw Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(formData.app_role === 'junior_mentor' || formData.app_role === 'senior_mentor') && (
            <div>
              <Label htmlFor="commission_rate">Commission Rate (%)</Label>
              <Input
                id="commission_rate"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={formData.commission_rate}
                onChange={(e) => setFormData({ ...formData, commission_rate: parseFloat(e.target.value) || 0 })}
                placeholder="e.g., 4 for 4%"
              />
              <p className="text-xs text-gray-500 mt-1">Percentage of net deposit as commission</p>
            </div>
          )}

          {formData.app_role === 'junior_mentor' && (
            <div>
              <Label htmlFor="upline_commission">Upline Senior Mentor Commission (%)</Label>
              <Input
                id="upline_commission"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={formData.upline_commission_percentage}
                onChange={(e) => setFormData({ ...formData, upline_commission_percentage: parseFloat(e.target.value) || 0 })}
                placeholder="e.g., 1 for 1%"
              />
              <p className="text-xs text-gray-500 mt-1">Percentage given to senior mentor from this junior's net deposits</p>
            </div>
          )}

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