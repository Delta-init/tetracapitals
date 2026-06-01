import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';

export default function RetentionManagement() {
  const [currentUser, setCurrentUser] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const fetchUser = async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ['retentionAssignments'],
    queryFn: () => base44.entities.RetentionAssignment.list(),
    enabled: !!currentUser
  });

  const { data: drawAdmins = [] } = useQuery({
    queryKey: ['drawAdmins'],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.app_role === 'draw_admin');
    },
    enabled: !!currentUser
  });

  const { data: students = [] } = useQuery({
    queryKey: ['students'],
    queryFn: () => base44.entities.Student.list(),
    enabled: !!currentUser
  });

  const { data: fundingTransactions = [] } = useQuery({
    queryKey: ['fundingTransactions'],
    queryFn: () => base44.entities.FundingTransaction.list(),
    enabled: !!currentUser
  });

  const assignMutation = useMutation({
    mutationFn: ({ assignmentId, drawAdminId, drawAdminName }) =>
      Promise.all([
        base44.entities.RetentionAssignment.update(assignmentId, {
          status: 'assigned',
          assigned_draw_admin_id: drawAdminId,
          assigned_draw_admin_name: drawAdminName,
          assigned_by_id: currentUser.id,
          assigned_by_name: currentUser.full_name,
          assigned_date: new Date().toISOString()
        }),
        base44.entities.Student.update(assignments.find(a => a.id === assignmentId).student_id, {
          retention_status: 'assigned_to_draw_admin',
          assigned_draw_admin_id: drawAdminId,
          assigned_draw_admin_name: drawAdminName,
          assigned_to_draw_admin_date: new Date().toISOString()
        })
      ]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['retentionAssignments'] });
      base44.analytics.track({
        eventName: 'retention_assignment_created',
        properties: { success: true }
      });
    }
  });

  const createRetentionMutation = useMutation({
    mutationFn: (student) =>
      base44.entities.RetentionAssignment.create({
        student_id: student.id,
        student_code: student.student_code,
        student_name: student.full_name,
        primary_mentor_id: student.primary_mentor_id,
        primary_mentor_name: student.primary_mentor_name,
        net_deposit_usd: student.net_deposit_usd,
        status: 'pending_assignment',
        threshold_crossed_date: new Date().toISOString()
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['retentionAssignments'] });
    }
  });

  const pendingAssignments = assignments.filter(a => a.status === 'pending_assignment');
  
  // Calculate net deposits for each student from funding transactions
  const studentNetDeposits = {};
  fundingTransactions.forEach(tx => {
    if (tx.status === 'APPROVED') {
      const amount = tx.type === 'DEPOSIT' ? tx.amount_usd : -tx.amount_usd;
      studentNetDeposits[tx.student_id] = (studentNetDeposits[tx.student_id] || 0) + amount;
    }
  });

  // Find students with 25K+ deposit who don't have retention assignments yet
  const eligibleStudents = students.filter(student => {
    const netDeposit = student.net_deposit_usd || studentNetDeposits[student.id] || 0;
    const hasDeposit = netDeposit >= 25000;
    const alreadyAssigned = assignments.some(a => a.student_id === student.id);
    return hasDeposit && !alreadyAssigned;
  });

  if (!currentUser) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  if (currentUser.app_role !== 'academic_head') {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <p className="text-xl font-semibold text-gray-700">Access Denied</p>
          <p className="text-gray-500">Only Academic Head can access this page</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900">Retention Management</h1>
          <p className="text-gray-600 mt-2">Assign students who reached 25K deposit threshold to Draw Admin team</p>
        </div>

        {pendingAssignments.length === 0 && eligibleStudents.length === 0 ? (
          <Card className="bg-white border-l-4 border-green-500">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
                <div>
                  <p className="font-semibold text-gray-900">All caught up!</p>
                  <p className="text-gray-600 text-sm">No students pending retention assignment</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {pendingAssignments.length > 0 && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
                  <Clock className="h-5 w-5 text-blue-600" />
                  <p className="text-blue-700">{pendingAssignments.length} student{pendingAssignments.length !== 1 ? 's' : ''} awaiting assignment</p>
                </div>

                {pendingAssignments.map((assignment) => (
                  <AssignmentCard
                    key={assignment.id}
                    assignment={assignment}
                    drawAdmins={drawAdmins}
                    onAssign={(drawAdminId, drawAdminName) =>
                      assignMutation.mutate({ assignmentId: assignment.id, drawAdminId, drawAdminName })
                    }
                    isLoading={assignMutation.isPending}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {eligibleStudents.length > 0 && (
          <div className="mt-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Students Eligible for Retention (25K+ Deposit)</h2>
            <p className="text-gray-600 mb-4">These students have reached the 25K threshold but don't have assignments yet. Click "Create Assignment" to add them.</p>
            <div className="space-y-4">
              {eligibleStudents.map((student) => (
                <Card key={student.id} className="bg-white border-l-4 border-yellow-500">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{student.full_name}</p>
                        <p className="text-sm text-gray-600">Code: {student.student_code}</p>
                        <p className="text-sm text-green-600 font-medium mt-2">Net Deposit: ${student.net_deposit_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                        {student.primary_mentor_name && (
                          <p className="text-sm text-gray-600 mt-1">Primary Mentor: {student.primary_mentor_name}</p>
                        )}
                      </div>
                      <Button
                        onClick={() => createRetentionMutation.mutate(student)}
                        disabled={createRetentionMutation.isPending}
                        className="bg-yellow-600 hover:bg-yellow-700"
                      >
                        {createRetentionMutation.isPending ? 'Creating...' : 'Create Assignment'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {assignments.length > pendingAssignments.length && (
           <div className="mt-12">
             <h2 className="text-2xl font-bold text-gray-900 mb-4">Assigned Cases</h2>
            <div className="space-y-4">
              {assignments.filter(a => a.status === 'assigned').map((assignment) => (
                <Card key={assignment.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-gray-900">{assignment.student_name}</p>
                        <p className="text-sm text-gray-600">Code: {assignment.student_code}</p>
                        <p className="text-sm text-gray-600 mt-2">Deposit: ${assignment.net_deposit_usd.toLocaleString()}</p>
                        <p className="text-sm text-blue-600 font-medium mt-2">
                          Assigned to: {assignment.assigned_draw_admin_name}
                        </p>
                      </div>
                      <div className="text-right text-xs text-gray-500">
                        Assigned: {new Date(assignment.assigned_date).toLocaleDateString()}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AssignmentCard({ assignment, drawAdmins, onAssign, isLoading }) {
  const [selectedDrawAdmin, setSelectedDrawAdmin] = useState('');

  return (
    <Card className="bg-white border-l-4 border-orange-500">
      <CardContent className="pt-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Student Name</p>
            <p className="text-lg font-semibold text-gray-900">{assignment.student_name}</p>
            <p className="text-sm text-gray-600">{assignment.student_code}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Deposit Amount</p>
            <p className="text-lg font-semibold text-green-600">${assignment.net_deposit_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
            <p className="text-sm text-gray-600">Primary Mentor: {assignment.primary_mentor_name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Assign to Draw Admin</p>
            <Select value={selectedDrawAdmin} onValueChange={setSelectedDrawAdmin}>
              <SelectTrigger className="mb-2">
                <SelectValue placeholder="Select Draw Admin" />
              </SelectTrigger>
              <SelectContent>
                {drawAdmins.map((admin) => (
                  <SelectItem key={admin.id} value={admin.id}>
                    {admin.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => {
                if (selectedDrawAdmin) {
                  const admin = drawAdmins.find(a => a.id === selectedDrawAdmin);
                  onAssign(selectedDrawAdmin, admin.full_name);
                  setSelectedDrawAdmin('');
                }
              }}
              disabled={!selectedDrawAdmin || isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              Assign
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}