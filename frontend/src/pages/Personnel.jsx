import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, Edit, Users, Shield, LogIn, Plus, KeyRound } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import PersonnelForm from '../components/personnel/PersonnelForm';
import { canViewPersonnel, canEditPersonnel, filterPersonnelByRole } from '../components/utils/PersonnelAccessControl';
import { logAction } from '../components/utils/AuditLogger';
import { startImpersonation, isImpersonating } from '../components/utils/ImpersonationContext';

export default function Personnel() {
  const [currentUser, setCurrentUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  const queryClient = useQueryClient();

  useEffect(() => {
    const fetchUser = async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
      
      if (!canViewPersonnel(user.app_role)) {
        toast.error('Access denied');
      }
    };
    fetchUser();
  }, []);

  const { data: allUsers = [], isLoading } = useQuery({
    queryKey: ['all-users'],
    queryFn: async () => {
      const response = await base44.functions.invoke('getAllUsers', {});
      return response.data?.users || [];
    },
    enabled: !!currentUser,
    retry: 2
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, userData }) => {
      const response = await base44.functions.invoke('updateUser', { userId, userData });
      await logAction('update_user', 'User', userId, `Updated user: ${userData.full_name}`, null, userData);
      return response.data?.user;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
      setShowForm(false);
      setEditingUser(null);
      toast.success('User updated successfully');
    },
    onError: () => {
      toast.error('Failed to update user');
    }
  });

  const [resetPasswordUser, setResetPasswordUser] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [resetPasswordShow, setResetPasswordShow] = useState(false);

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, newPassword, userName }) => {
      const r = await base44.functions.invoke('resetUserPassword', { userId, newPassword });
      await logAction('reset_user_password', 'User', userId, `Reset password for ${userName}`, null, { user_id: userId });
      return r.data;
    },
    onSuccess: (_, vars) => {
      toast.success(`Password reset for ${vars.userName}. Share the new password with them securely.`);
      setResetPasswordUser(null);
      setResetPasswordValue('');
      setResetPasswordShow(false);
    },
    onError: (e) => {
      toast.error(e?.response?.data?.error || e?.message || 'Failed to reset password');
    },
  });

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
    setResetPasswordValue(out);
    setResetPasswordShow(true);
  };

  const confirmResetPassword = () => {
    if (!resetPasswordUser) return;
    if (!resetPasswordValue || resetPasswordValue.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    resetPasswordMutation.mutate({
      userId: resetPasswordUser.id,
      newPassword: resetPasswordValue,
      userName: resetPasswordUser.full_name,
    });
  };

  const createUserMutation = useMutation({
    mutationFn: async (userData) => {
      const response = await base44.functions.invoke('createUser', userData);
      const created = response.data?.user;
      if (created) {
        await logAction('create_user', 'User', created.id, `Created user: ${userData.full_name} (${userData.app_role})`, null, { ...userData, password: '[redacted]' });
      }
      return created;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
      setShowForm(false);
      setEditingUser(null);
      toast.success(`Created ${created?.full_name || 'user'}. They can sign in now.`);
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error || err?.message || 'Failed to create user');
    }
  });

  const handleEdit = (user) => {
    setEditingUser(user);
    setShowForm(true);
  };

  const handleSubmit = (formData) => {
    if (editingUser) {
      updateUserMutation.mutate({
        userId: editingUser.id,
        userData: formData
      });
    } else {
      createUserMutation.mutate(formData);
    }
  };

  // Super admins use /MasterAdmin for all personnel actions (add, edit,
  // impersonate, reset password). /Personnel becomes a read-only directory
  // for them, so we hide the action buttons here.
  const isSuper = currentUser?.app_role === 'super_admin';
  const canCreate = !isSuper && ['super_admin', 'admin'].includes(currentUser?.app_role);

  const handleClose = () => {
    setShowForm(false);
    setEditingUser(null);
  };

  const handleImpersonate = async (targetUser) => {
    await logAction('other', 'User', targetUser.id, 
      `Super admin started impersonating user: ${targetUser.full_name} (${targetUser.app_role})`, 
      null, { impersonated_user: targetUser.full_name, impersonated_role: targetUser.app_role });
    startImpersonation(targetUser, currentUser);
  };

  if (!currentUser || isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!canViewPersonnel(currentUser.app_role)) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <Shield className="h-12 w-12 text-red-600 mx-auto mb-3" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600">You don't have permission to view this page.</p>
        </div>
      </div>
    );
  }

  const baseAccessibleUsers = filterPersonnelByRole(currentUser, allUsers);

  const filteredUsers = baseAccessibleUsers.filter(user => {
   const userRole = String(user.app_role || user.data?.app_role || '').toLowerCase();
   const matchesSearch = 
     user.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
     user.email?.toLowerCase().includes(searchTerm.toLowerCase());
   const matchesRole = roleFilter === 'all' || userRole === roleFilter;
   return matchesSearch && matchesRole;
  });

  const getRoleBadgeColor = (role) => {
    const colors = {
      super_admin: 'bg-purple-100 text-purple-800',
      admin: 'bg-red-100 text-red-800',
      broker_admin: 'bg-orange-100 text-orange-800',
      academic_head: 'bg-blue-100 text-blue-800',
      academic_admin: 'bg-cyan-100 text-cyan-800',
      senior_mentor: 'bg-green-100 text-green-800',
      junior_mentor: 'bg-yellow-100 text-yellow-800',
      finance_admin: 'bg-indigo-100 text-indigo-800',
      assistance: 'bg-pink-100 text-pink-800'
    };
    return colors[role] || 'bg-gray-100 text-gray-800';
  };

  const totalUsers = filteredUsers.length;
  const mentorCount = filteredUsers.filter(u => ['senior_mentor', 'junior_mentor'].includes(u.app_role)).length;
  const adminCount = filteredUsers.filter(u => ['super_admin', 'admin', 'broker_admin'].includes(u.app_role)).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-100/20 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Personnel Directory</h1>
            <p className="text-gray-600 mt-2 text-base">Manage users and roles</p>
          </div>
          {canCreate && (
            <Button
              onClick={() => { setEditingUser(null); setShowForm(true); }}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border-none p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">Total Users</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{totalUsers}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Users className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border-none p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">Mentors</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{mentorCount}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <Users className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </div>

          <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border-none p-6 hover:shadow-xl transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">Administrators</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{adminCount}</p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <Shield className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border-none p-5">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <Input
                placeholder="Search by name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue placeholder="Filter by role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="super_admin">Super Admin</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="broker_admin">Broker Admin</SelectItem>
                <SelectItem value="academic_head">Academic Head</SelectItem>
                <SelectItem value="academic_admin">Academic Admin</SelectItem>
                <SelectItem value="senior_mentor">Senior Mentor</SelectItem>
                <SelectItem value="junior_mentor">Junior Mentor</SelectItem>
                <SelectItem value="finance_admin">Finance Admin</SelectItem>
                <SelectItem value="assistance">Assistance</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg border-none overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Commission Rate</TableHead>
                <TableHead>Upline %</TableHead>
                <TableHead>Senior Mentor</TableHead>
                <TableHead>Assigned Mentor</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.full_name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge className={getRoleBadgeColor(user.app_role)}>
                        {user.app_role?.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {['junior_mentor', 'senior_mentor'].includes(user.app_role) 
                        ? `${user.commission_rate || 4}%` 
                        : '-'}
                    </TableCell>
                    <TableCell>
                      {user.app_role === 'junior_mentor' 
                        ? `${user.upline_commission_percentage || 0}%` 
                        : '-'}
                    </TableCell>
                    <TableCell>
                      {user.app_role === 'senior_mentor' ? (user.senior_mentor_name || '-') : '-'}
                    </TableCell>
                    <TableCell>
                      {user.assigned_mentor_name || '-'}
                    </TableCell>
                    <TableCell>
                      {new Date(user.created_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {!isSuper && ['academic_head', 'broker_admin', 'admin'].includes(currentUser.app_role) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEdit(user)}
                            title="Edit user"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        )}
                        {!isSuper && ['academic_head', 'broker_admin'].includes(currentUser.app_role) && !isImpersonating() && user.app_role !== 'super_admin' && user.app_role !== 'broker_admin' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleImpersonate(user)}
                            title={`View portal as ${user.full_name}`}
                            className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                          >
                            <LogIn className="h-4 w-4" />
                          </Button>
                        )}
                        {!isSuper && currentUser.app_role === 'admin' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setResetPasswordUser(user); setResetPasswordValue(''); setResetPasswordShow(false); }}
                            title={`Reset ${user.full_name}'s password`}
                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                        )}
                        </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {showForm && (
        <PersonnelForm
          user={editingUser}
          onSubmit={handleSubmit}
          onClose={handleClose}
          allUsers={allUsers}
        />
      )}

      <Dialog open={!!resetPasswordUser} onOpenChange={(o) => !o && setResetPasswordUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-blue-600" />
              Reset Password
            </DialogTitle>
          </DialogHeader>
          {resetPasswordUser && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded p-3 text-sm space-y-1">
                <p><span className="text-gray-500">User:</span> <strong>{resetPasswordUser.full_name}</strong></p>
                <p><span className="text-gray-500">Email:</span> {resetPasswordUser.email}</p>
                <p><span className="text-gray-500">Role:</span> {resetPasswordUser.app_role?.replace(/_/g, ' ')}</p>
              </div>
              <div>
                <Label htmlFor="resetpw">New Password *</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    id="resetpw"
                    type={resetPasswordShow ? 'text' : 'password'}
                    value={resetPasswordValue}
                    onChange={(e) => setResetPasswordValue(e.target.value)}
                    placeholder="Min 8 characters"
                    minLength={8}
                    autoComplete="new-password"
                    autoFocus
                  />
                  <Button type="button" variant="outline" onClick={() => setResetPasswordShow(s => !s)}>
                    {resetPasswordShow ? 'Hide' : 'Show'}
                  </Button>
                  <Button type="button" variant="outline" onClick={generateRandomPassword}>
                    Generate
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  The user can sign in immediately with this password. Share it with them through a secure channel — the system never emails it.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPasswordUser(null)} disabled={resetPasswordMutation.isPending}>
              Cancel
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={confirmResetPassword}
              disabled={resetPasswordMutation.isPending}
            >
              {resetPasswordMutation.isPending ? 'Resetting…' : 'Reset password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}