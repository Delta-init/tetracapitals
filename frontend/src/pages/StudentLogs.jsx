import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Plus, Edit, Eye, Download } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import StudentLogForm from "../components/studentlogs/StudentLogForm";
import StudentLogDetails from "../components/studentlogs/StudentLogDetails";
import { getEffectiveUser } from "../components/utils/ImpersonationContext";
import { detectChanges, getTabsFromChanges } from "../components/studentlogs/StudentLogHistoryUtils";

export default function StudentLogs() {
  const [currentUser, setCurrentUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);

  const queryClient = useQueryClient();

  useEffect(() => {
    const fetchUser = async () => {
      const realUser = await base44.auth.me();
      const user = getEffectiveUser(realUser);
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const { data: logs = [] } = useQuery({
    queryKey: ['student-logs'],
    queryFn: () => base44.entities.StudentLog.list('-created_date'),
    enabled: !!currentUser
  });

  // Define mentor roles
  const mentorAppRoles = ['junior_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'];
  const isMentorRole = currentUser && mentorAppRoles.includes(currentUser.app_role);

  const { data: students = [] } = useQuery({
    queryKey: ['students'],
    queryFn: () => base44.entities.Student.list(),
    enabled: !!currentUser
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const newLog = await base44.entities.StudentLog.create(data);
      // Record history entry for creation
      await base44.entities.StudentLogHistory.create({
        student_log_id: newLog.id,
        student_id: data.student_id,
        student_code: data.student_code,
        student_name: data.student_name,
        updated_by_id: currentUser.id,
        updated_by_name: currentUser.full_name,
        updated_by_role: currentUser.app_role,
        action_type: 'created',
        tab_section: 'All',
        fields_changed: JSON.stringify([]),
        contact_history_snapshot: data.contact_history || '',
        entry_timestamp: new Date().toISOString()
      });
      return newLog;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-logs'] });
      setShowAddDialog(false);
      toast.success('Student log created successfully');
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const oldLog = logs.find(l => l.id === id);
      const updatedLog = await base44.entities.StudentLog.update(id, data);
      // Detect changes and record history
      const changes = detectChanges(oldLog, data);
      const tabSection = getTabsFromChanges(changes);
      if (changes.length > 0 || data.contact_history !== oldLog?.contact_history) {
        await base44.entities.StudentLogHistory.create({
          student_log_id: id,
          student_id: data.student_id,
          student_code: data.student_code,
          student_name: data.student_name,
          updated_by_id: currentUser.id,
          updated_by_name: currentUser.full_name,
          updated_by_role: currentUser.app_role,
          action_type: 'updated',
          tab_section: tabSection || 'General',
          fields_changed: JSON.stringify(changes),
          contact_history_snapshot: data.contact_history || '',
          entry_timestamp: new Date().toISOString()
        });
      }
      return updatedLog;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-logs'] });
      setShowEditDialog(false);
      setSelectedLog(null);
      toast.success('Student log updated successfully');
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

  // Filter students available in the form based on role
  const isAdminRole = currentUser && ['super_admin', 'broker_admin', 'academic_head', 'academic_admin'].includes(currentUser.app_role);
  
  let availableStudentsForForm = students;
  if (!isAdminRole && currentUser) {
    if (currentUser.app_role === 'assistance' && currentUser.assigned_mentor_id) {
      availableStudentsForForm = students.filter(s => s.primary_mentor_id === currentUser.assigned_mentor_id);
    } else if (isMentorRole) {
      availableStudentsForForm = students.filter(s => 
        s.primary_mentor_id === currentUser.id || s.senior_mentor_id === currentUser.id
      );
    }
  }

  // Filter logs based on user role
  let visibleLogs = logs;
  
  // If current user is a mentor, filter logs to only show their students' logs
  if (isMentorRole) {
    const mentoredStudentIds = new Set();
    students.forEach(student => {
      if (student.primary_mentor_id === currentUser.id || student.senior_mentor_id === currentUser.id) {
        mentoredStudentIds.add(student.id);
      }
    });
    // For 'assistance' role, also consider assigned_mentor_id if it exists
    if (currentUser.app_role === 'assistance' && currentUser.assigned_mentor_id) {
      students.forEach(student => {
        if (student.primary_mentor_id === currentUser.assigned_mentor_id || student.senior_mentor_id === currentUser.assigned_mentor_id) {
          mentoredStudentIds.add(student.id);
        }
      });
    }

    visibleLogs = logs.filter(log => mentoredStudentIds.has(log.student_id));
  }
  
  // Filter logs by search term
  let filteredLogs = visibleLogs;
  if (searchTerm) {
    const lowerSearch = searchTerm.toLowerCase();
    filteredLogs = visibleLogs.filter(log => 
      log.student_name?.toLowerCase().includes(lowerSearch) ||
      log.student_code?.toLowerCase().includes(lowerSearch) ||
      log.email?.toLowerCase().includes(lowerSearch) ||
      log.phone_number?.toLowerCase().includes(lowerSearch)
    );
  }

  const handleAdd = () => {
    setSelectedLog(null);
    setShowAddDialog(true);
  };

  const handleEdit = (log) => {
    setSelectedLog(log);
    setShowEditDialog(true);
  };

  const handleView = (log) => {
    setSelectedLog(log);
    setShowDetailsDialog(true);
  };

  const handleSubmit = (formData) => {
    if (selectedLog) {
      updateMutation.mutate({ id: selectedLog.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleExport = () => {
    if (filteredLogs.length === 0) {
      toast.error('No logs to export');
      return;
    }

    const escapeCSV = (value) => {
      if (value === null || value === undefined) return '';
      const stringValue = String(value);
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    };

    const headers = [
      'Student Code', 'Student Name', 'Email', 'Phone', 'Followup Priority',
      'Active in Classes', 'Last Contact Date', 'Last Contact Person',
      'Payment Status', 'Course Amount', 'Exam Status', 'Trading Status'
    ];

    const csvContent = [
      headers.join(','),
      ...filteredLogs.map(log => [
        escapeCSV(log.student_code),
        escapeCSV(log.student_name),
        escapeCSV(log.email),
        escapeCSV(log.phone_number),
        escapeCSV(log.followup_priority),
        escapeCSV(log.active_in_classes ? 'Yes' : 'No'),
        escapeCSV(log.last_contact_date ? format(new Date(log.last_contact_date), 'yyyy-MM-dd') : ''),
        escapeCSV(log.last_contact_person),
        escapeCSV(log.payment_status),
        escapeCSV(log.course_amount),
        escapeCSV(log.exam_status),
        escapeCSV(log.trading_status)
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `student_logs_export_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredLogs.length} student logs successfully`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Student Logs</h1>
            <p className="text-gray-600 mt-2 text-base">Comprehensive student information and tracking</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleExport} variant="outline" className="border-green-600 text-green-600 hover:bg-green-50">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button onClick={handleAdd} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-2" />
              Add Student Log
            </Button>
          </div>
        </div>

        {/* Search */}
        <Card className="border-gray-200">
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by student name, code, email, or phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
            <CardTitle className="text-lg font-semibold tracking-tight">Student Logs ({filteredLogs.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold">Student Code</TableHead>
                    <TableHead className="font-semibold">Student Name</TableHead>
                    <TableHead className="font-semibold">Email</TableHead>
                    <TableHead className="font-semibold">Phone</TableHead>
                    <TableHead className="font-semibold">Priority</TableHead>
                    <TableHead className="font-semibold">Active</TableHead>
                    <TableHead className="font-semibold">Last Contact</TableHead>
                    <TableHead className="font-semibold">Payment Status</TableHead>
                    <TableHead className="font-semibold text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                        No student logs found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredLogs.map((log) => (
                      <TableRow key={log.id} className="hover:bg-gray-50 transition-colors">
                        <TableCell className="font-mono text-sm text-blue-600">{log.student_code || '-'}</TableCell>
                        <TableCell className="font-medium">{log.student_name}</TableCell>
                        <TableCell className="text-sm">{log.email || '-'}</TableCell>
                        <TableCell className="text-sm">{log.phone_number || '-'}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            log.followup_priority === 'High' ? 'bg-red-100 text-red-800' :
                            log.followup_priority === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                            {log.followup_priority || 'N/A'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            log.active_in_classes ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {log.active_in_classes ? 'Yes' : 'No'}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">
                          {log.last_contact_date ? format(new Date(log.last_contact_date), 'MMM d, yyyy') : '-'}
                        </TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                            log.payment_status === 'Paid' ? 'bg-green-100 text-green-800' :
                            log.payment_status === 'Pending' ? 'bg-yellow-100 text-yellow-800' :
                            log.payment_status === 'Overdue' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {log.payment_status || 'N/A'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleView(log)}
                              className="h-8 w-8 p-0"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEdit(log)}
                              className="h-8 w-8 p-0"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Add/Edit Dialog */}
        {(showAddDialog || showEditDialog) && (
          <StudentLogForm
            log={selectedLog}
            students={availableStudentsForForm}
            open={showAddDialog || showEditDialog}
            onClose={() => {
              setShowAddDialog(false);
              setShowEditDialog(false);
              setSelectedLog(null);
            }}
            onSubmit={handleSubmit}
            isSubmitting={createMutation.isPending || updateMutation.isPending}
          />
        )}

        {/* Details Dialog */}
        {showDetailsDialog && selectedLog && (
          <StudentLogDetails
            log={selectedLog}
            open={showDetailsDialog}
            onClose={() => {
              setShowDetailsDialog(false);
              setSelectedLog(null);
            }}
            onEdit={() => {
              setShowDetailsDialog(false);
              setShowEditDialog(true);
            }}
          />
        )}
      </div>
    </div>
  );
}