import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Trash2 } from "lucide-react";
import TargetForm from "../components/targets/TargetForm";
import { 
  canCreateTarget, 
  canDeleteTarget,
  filterTargetsByRole 
} from "../components/utils/TargetAccessControl";
import { computeTargetAchievement } from "../components/utils/TargetMetricsUtils";
import { toast } from "sonner";
import { format } from "date-fns";
import { logAction } from "../components/utils/AuditLogger";

export default function TargetsManagement() {
  const [currentUser, setCurrentUser] = useState(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [filterMentor, setFilterMentor] = useState('all');
  const [filterPeriodType, setFilterPeriodType] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  const queryClient = useQueryClient();

  useEffect(() => {
    const fetchUser = async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const { data: targets = [] } = useQuery({
    queryKey: ['mentor-targets'],
    queryFn: () => base44.entities.MentorTarget.list('-created_date'),
    enabled: !!currentUser
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['funding-transactions'],
    queryFn: () => base44.entities.FundingTransaction.list(),
    enabled: !!currentUser
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
            const r = await base44.functions.invoke('getAllUsers', {});
                  return r.data?.users || [];
                      },
    enabled: !!currentUser
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const result = await base44.entities.MentorTarget.create(data);
      await logAction('create_target', 'MentorTarget', result.id, `Created target for ${data.mentor_name}`, null, data);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mentor-targets'] });
      setShowAddDialog(false);
      toast.success('Target created successfully');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await logAction('delete_target', 'MentorTarget', id, `Deleted target`, null, null);
      return base44.entities.MentorTarget.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mentor-targets'] });
      toast.success('Target deleted successfully');
    }
  });

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Filter targets
  let filteredTargets = filterTargetsByRole(currentUser, targets);

  if (filterMentor !== 'all') {
    filteredTargets = filteredTargets.filter(t => t.mentor_id === filterMentor);
  }
  if (filterPeriodType !== 'all') {
    filteredTargets = filteredTargets.filter(t => t.period_type === filterPeriodType);
  }
  if (searchTerm) {
    filteredTargets = filteredTargets.filter(t =>
      t.mentor_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }

  // Compute achievements
  const enrichedTargets = filteredTargets.map(target => {
    const achievement = computeTargetAchievement(target, transactions);
    return { ...target, ...achievement };
  });

  // Get mentors for filters and form
  const mentors = users.filter(u => ['junior_mentor', 'senior_mentor'].includes(u.app_role));
  const uniqueMentorIds = [...new Set(targets.map(t => t.mentor_id))];
  const mentorsWithTargets = users.filter(u => uniqueMentorIds.includes(u.id));

  const canCreate = canCreateTarget(currentUser.app_role);
  const canDelete = canDeleteTarget(currentUser);

  const handleSubmit = (formData) => {
    const dataToCreate = {
      ...formData,
      assigned_by_id: currentUser.id,
      assigned_by_name: currentUser.full_name
    };
    createMutation.mutate(dataToCreate);
  };

  const handleDelete = (target) => {
    if (window.confirm(`Delete target for ${target.mentor_name}?`)) {
      deleteMutation.mutate(target.id);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'NOT_STARTED': return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'IN_PROGRESS': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'ACHIEVED': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'MISSED': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // Calculate summary stats
  const totalTargets = enrichedTargets.length;
  const achievedCount = enrichedTargets.filter(t => t.target_status === 'ACHIEVED').length;
  const inProgressCount = enrichedTargets.filter(t => t.target_status === 'IN_PROGRESS').length;
  const missedCount = enrichedTargets.filter(t => t.target_status === 'MISSED').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Targets Management</h1>
            <p className="text-gray-600 mt-2 text-base">Create and manage mentor targets</p>
          </div>
          {canCreate && (
            <Button onClick={() => setShowAddDialog(true)} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-2" />
              New Target
            </Button>
          )}
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="border-none bg-gradient-to-br from-gray-100 to-slate-100 shadow-lg">
            <CardContent className="p-5">
              <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">Total Targets</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{totalTargets}</p>
            </CardContent>
          </Card>
          <Card className="border-none bg-gradient-to-br from-blue-100 to-indigo-100 shadow-lg">
            <CardContent className="p-5">
              <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">In Progress</p>
              <p className="text-3xl font-bold text-blue-700 mt-1">{inProgressCount}</p>
            </CardContent>
          </Card>
          <Card className="border-none bg-gradient-to-br from-emerald-100 to-teal-100 shadow-lg">
            <CardContent className="p-5">
              <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">Achieved</p>
              <p className="text-3xl font-bold text-emerald-700 mt-1">{achievedCount}</p>
            </CardContent>
          </Card>
          <Card className="border-none bg-gradient-to-br from-red-100 to-pink-100 shadow-lg">
            <CardContent className="p-5">
              <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">Missed</p>
              <p className="text-3xl font-bold text-red-700 mt-1">{missedCount}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="border-gray-200">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search by mentor name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              <Select value={filterMentor} onValueChange={setFilterMentor}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All Mentors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Mentors</SelectItem>
                  {mentorsWithTargets.map((mentor) => (
                    <SelectItem key={mentor.id} value={mentor.id}>
                      {mentor.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterPeriodType} onValueChange={setFilterPeriodType}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Period Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="WEEKLY">Weekly</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                  <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Targets Table */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
            <CardTitle className="text-lg font-semibold tracking-tight">Targets</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold">Mentor</TableHead>
                    <TableHead className="font-semibold">Period Type</TableHead>
                    <TableHead className="font-semibold">Start Date</TableHead>
                    <TableHead className="font-semibold">End Date</TableHead>
                    <TableHead className="font-semibold">Target (USD)</TableHead>
                    <TableHead className="font-semibold">Achieved (USD)</TableHead>
                    <TableHead className="font-semibold">Progress %</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">Assigned By</TableHead>
                    <TableHead className="font-semibold">Created</TableHead>
                    {canDelete && <TableHead className="font-semibold text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrichedTargets.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={canDelete ? 11 : 10} className="text-center py-8 text-gray-500">
                        No targets found
                      </TableCell>
                    </TableRow>
                  ) : (
                    enrichedTargets.map((target) => (
                      <TableRow key={target.id} className="hover:bg-gray-50 transition-colors">
                        <TableCell className="font-medium">{target.mentor_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                            {target.period_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {format(new Date(target.period_start_date), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell className="text-sm">
                          {format(new Date(target.period_end_date), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell className="font-semibold">
                          ${target.target_net_deposit_usd?.toFixed(2)}
                        </TableCell>
                        <TableCell className="font-semibold text-emerald-600">
                          ${target.achievement_net_deposit_usd?.toFixed(2)}
                        </TableCell>
                        <TableCell className="font-semibold">
                          {target.achievement_percent?.toFixed(1)}%
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getStatusColor(target.target_status)}>
                            {target.target_status.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{target.assigned_by_name}</TableCell>
                        <TableCell className="text-sm">
                          {target.created_date ? format(new Date(target.created_date), 'MMM d, yyyy') : '-'}
                        </TableCell>
                        {canDelete && (
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(target)}
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Add Target Dialog */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Target</DialogTitle>
            </DialogHeader>
            <TargetForm
              mentors={mentors}
              onSubmit={handleSubmit}
              onCancel={() => setShowAddDialog(false)}
              isSubmitting={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}