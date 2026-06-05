import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CheckCircle, XCircle, AlertTriangle, Search, UserPlus, Clock, History } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { logAction } from "../components/utils/AuditLogger";
import { generateStudentCode } from "../components/utils/StudentAccessControl";

export default function StudentRequestApprovals() {
  const [currentUser, setCurrentUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [showAcademicApproveDialog, setShowAcademicApproveDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [duplicateStudent, setDuplicateStudent] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [userId, setUserId] = useState('');

  const queryClient = useQueryClient();

  useEffect(() => {
    const fetchUser = async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const { data: requests = [], isLoading: requestsLoading } = useQuery({
    queryKey: ['student-requests'],
    queryFn: async () => {
      const data = await base44.entities.StudentRequest.list('-requested_at');
      console.log('Fetched student requests:', data);
      return data;
    },
    enabled: !!currentUser
  });

  const { data: students = [] } = useQuery({
    queryKey: ['students'],
    queryFn: () => base44.entities.Student.list(),
    enabled: !!currentUser
  });

  if (!currentUser) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  const isAcademicHead = currentUser.app_role === 'academic_head';
  const isBrokerAdmin = currentUser.app_role === 'broker_admin';
  const isSuperAdmin = currentUser.app_role === 'super_admin';
  const canApprove = isAcademicHead || isBrokerAdmin || isSuperAdmin;

  if (!canApprove) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="max-w-7xl mx-auto">
          <Alert variant="destructive">
            <AlertDescription>
              You don't have permission to access this page.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // Academic head sees: PENDING_ACADEMIC_APPROVAL transfers + PENDING_LEVEL_UPGRADE
  // Broker admin sees: PENDING_BROKER_APPROVAL transfers (after academic head approved) + PENDING_LEVEL_UPGRADE
  // Super admin sees: both stages
  const searchFilter = (r) => {
    if (!searchTerm) return true;
    const lowerSearch = searchTerm.toLowerCase();
    return r.full_name?.toLowerCase().includes(lowerSearch) ||
      r.email?.toLowerCase().includes(lowerSearch) ||
      r.requested_by_name?.toLowerCase().includes(lowerSearch);
  };

  const pendingRequests = requests
    .filter(r => {
      if (r.status === 'PENDING_LEVEL_UPGRADE') return true;
      if (r.status === 'PENDING_ACADEMIC_APPROVAL' && r.request_type === 'TRANSFER' && (isAcademicHead || isSuperAdmin)) return true;
      if (r.status === 'PENDING_BROKER_APPROVAL' && r.request_type === 'TRANSFER' && (isBrokerAdmin || isSuperAdmin)) return true;
      return false;
    })
    .filter(searchFilter);

  const approvedRequests = requests
    .filter(r => ['APPROVED', 'TRANSFERRED'].includes(r.status))
    .filter(searchFilter);

  const rejectedRequests = requests
    .filter(r => r.status === 'REJECTED')
    .filter(searchFilter);

  const filteredRequests = pendingRequests;

  const checkDuplicate = (email) => {
    return students.find(s => s.email?.toLowerCase() === email?.toLowerCase());
  };

  const handleApprove = async (request) => {
    setSelectedRequest(request);
    
    if (request.request_type === 'TRANSFER' && request.existing_student_id) {
      const existing = students.find(s => s.id === request.existing_student_id);
      setDuplicateStudent(existing);

      if (request.status === 'PENDING_ACADEMIC_APPROVAL') {
        // Academic head forwards to broker admin
        setShowAcademicApproveDialog(true);
      } else {
        // Broker admin does the actual transfer
        setShowTransferDialog(true);
      }
    } else {
      // For level upgrade requests
      setShowApproveDialog(true);
    }
  };

  const handleReject = (request) => {
    setSelectedRequest(request);
    setShowRejectDialog(true);
  };

  const confirmApprove = async () => {
    setProcessing(true);
    try {
      if (selectedRequest.request_type === 'LEVEL_UPGRADE') {
        // Upgrade student to Level 2
        await base44.entities.Student.update(selectedRequest.existing_student_id, {
          student_level: 'LEVEL_2'
        });

        // Mark request as approved
        await base44.entities.StudentRequest.update(selectedRequest.id, {
          status: 'APPROVED',
          level_upgrade_approved_by_id: currentUser.id,
          level_upgrade_approved_by_name: currentUser.full_name,
          level_upgrade_approved_at: new Date().toISOString()
        });

        await logAction('approve_level_upgrade', 'Student', selectedRequest.existing_student_id, 
          `Approved level upgrade for ${selectedRequest.full_name} to Level 2`, null, selectedRequest);
        toast.success('Student upgraded to Level 2 successfully');
      }

      queryClient.invalidateQueries({ queryKey: ['student-requests'] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setShowApproveDialog(false);
      setSelectedRequest(null);
    } catch (error) {
      toast.error('Failed to approve request');
      console.error(error);
    } finally {
      setProcessing(false);
    }
  };

  const confirmReject = async () => {
    if (!rejectionReason.trim()) {
      toast.error('Please provide a rejection reason');
      return;
    }

    setProcessing(true);
    try {
      await base44.entities.StudentRequest.update(selectedRequest.id, {
        status: 'REJECTED',
        level_upgrade_approved_by_id: currentUser.id,
        level_upgrade_approved_by_name: currentUser.full_name,
        level_upgrade_approved_at: new Date().toISOString(),
        level_upgrade_rejection_reason: rejectionReason
      });

      await logAction('reject_level_upgrade', 'StudentRequest', selectedRequest.id, 
        `Rejected level upgrade for ${selectedRequest.full_name}: ${rejectionReason}`, null, { reason: rejectionReason });

      queryClient.invalidateQueries({ queryKey: ['student-requests'] });
      toast.success('Upgrade request rejected');
      setShowRejectDialog(false);
      setSelectedRequest(null);
      setRejectionReason('');
    } catch (error) {
      toast.error('Failed to reject request');
      console.error(error);
    } finally {
      setProcessing(false);
    }
  };

  const confirmAcademicApprove = async () => {
    setProcessing(true);
    try {
      // Forward to broker admin
      await base44.entities.StudentRequest.update(selectedRequest.id, {
        status: 'PENDING_BROKER_APPROVAL',
        level_upgrade_approved_by_id: currentUser.id,
        level_upgrade_approved_by_name: currentUser.full_name,
        level_upgrade_approved_at: new Date().toISOString()
      });

      await logAction('approve_transfer_request', 'StudentRequest', selectedRequest.id,
        `Academic head approved transfer request for ${selectedRequest.full_name}, forwarded to Broker Admin`, null, selectedRequest);

      queryClient.invalidateQueries({ queryKey: ['student-requests'] });
      toast.success('Transfer request approved and forwarded to Broker Admin');
      setShowAcademicApproveDialog(false);
      setSelectedRequest(null);
      setDuplicateStudent(null);
    } catch (error) {
      toast.error('Failed to approve request');
      console.error(error);
    } finally {
      setProcessing(false);
    }
  };

  const confirmTransfer = async () => {
    setProcessing(true);
    try {
      // Update existing student with new mentor info
      await base44.entities.Student.update(duplicateStudent.id, {
        primary_mentor_id: selectedRequest.requested_primary_mentor_id,
        primary_mentor_name: selectedRequest.requested_primary_mentor_name,
        senior_mentor_id: selectedRequest.requested_senior_mentor_id,
        senior_mentor_name: selectedRequest.requested_senior_mentor_name,
        assignment_status: 'assigned'
      });

      // Mark request as transferred
      await base44.entities.StudentRequest.update(selectedRequest.id, {
        status: 'TRANSFERRED',
        level_upgrade_approved_by_id: currentUser.id,
        level_upgrade_approved_by_name: currentUser.full_name,
        level_upgrade_approved_at: new Date().toISOString(),
        is_transfer: true,
        existing_student_id: duplicateStudent.id,
        previous_mentor_id: duplicateStudent.primary_mentor_id,
        previous_mentor_name: duplicateStudent.primary_mentor_name
      });

      await logAction('transfer_student', 'Student', duplicateStudent.id, 
        `Transferred student ${duplicateStudent.full_name} from ${duplicateStudent.primary_mentor_name} to ${selectedRequest.requested_primary_mentor_name}`, 
        { old_mentor: duplicateStudent.primary_mentor_name }, 
        { new_mentor: selectedRequest.requested_primary_mentor_name });

      queryClient.invalidateQueries({ queryKey: ['student-requests'] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      toast.success('Student transferred successfully');
      setShowTransferDialog(false);
      setSelectedRequest(null);
      setDuplicateStudent(null);
    } catch (error) {
      toast.error('Failed to transfer student');
      console.error(error);
    } finally {
      setProcessing(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'PENDING_ACADEMIC_APPROVAL': return 'bg-yellow-100 text-yellow-800';
      case 'PENDING_BROKER_APPROVAL': return 'bg-blue-100 text-blue-800';
      case 'APPROVED': return 'bg-green-100 text-green-800';
      case 'REJECTED': return 'bg-red-100 text-red-800';
      case 'TRANSFERRED': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">
            Student Request Approvals
          </h1>
          <p className="text-gray-600 mt-2">
            Review and approve student level upgrades and transfer requests
          </p>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by name, email, or requester..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Requests Tabs */}
        <Tabs defaultValue="pending">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="pending" className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Pending ({pendingRequests.length})
            </TabsTrigger>
            <TabsTrigger value="approved" className="flex items-center gap-1">
              <CheckCircle className="h-3.5 w-3.5" />
              Approved ({approvedRequests.length})
            </TabsTrigger>
            <TabsTrigger value="rejected" className="flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" />
              Rejected ({rejectedRequests.length})
            </TabsTrigger>
          </TabsList>

          {/* Pending Tab */}
          <TabsContent value="pending">
            <Card className="border-gray-200">
              <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-yellow-50">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <UserPlus className="h-5 w-5 text-yellow-600" />
                  Pending Requests ({pendingRequests.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead className="font-semibold">Requested</TableHead>
                        <TableHead className="font-semibold">Request Type</TableHead>
                        <TableHead className="font-semibold">Student Name</TableHead>
                        <TableHead className="font-semibold">Email</TableHead>
                        <TableHead className="font-semibold">Current Mentor</TableHead>
                        <TableHead className="font-semibold">Requested By</TableHead>
                        <TableHead className="font-semibold">New Mentor</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="font-semibold text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingRequests.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                            No pending requests
                          </TableCell>
                        </TableRow>
                      ) : (
                        pendingRequests.map((request) => {
                          const existingStudent = request.existing_student_id ? students.find(s => s.id === request.existing_student_id) : null;
                          return (
                            <TableRow key={request.id} className="hover:bg-gray-50 transition-colors">
                              <TableCell className="text-sm">
                                {request.requested_at ? format(new Date(request.requested_at), 'MMM d, yyyy HH:mm') : '-'}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={request.request_type === 'TRANSFER' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}>
                                  {request.request_type === 'TRANSFER' ? 'Transfer' : 'Level Upgrade'}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-medium">{request.full_name}</TableCell>
                              <TableCell className="text-sm">{request.email}</TableCell>
                              <TableCell className="text-sm">
                                {request.request_type === 'TRANSFER' ? request.previous_mentor_name : existingStudent?.primary_mentor_name || '-'}
                              </TableCell>
                              <TableCell className="text-sm">{request.requested_by_name}</TableCell>
                              <TableCell className="text-sm">{request.requested_primary_mentor_name}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={getStatusColor(request.status)}>
                                  {request.status.replace(/_/g, ' ')}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  <Button size="sm" variant="ghost" onClick={() => handleApprove(request)} className="text-green-600 hover:text-green-700 hover:bg-green-50">
                                    <CheckCircle className="h-4 w-4" />
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => handleReject(request)} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                                    <XCircle className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Approved Tab */}
          <TabsContent value="approved">
            <Card className="border-gray-200">
              <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-green-50">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  Approved Requests ({approvedRequests.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead className="font-semibold">Requested At</TableHead>
                        <TableHead className="font-semibold">Request Type</TableHead>
                        <TableHead className="font-semibold">Student Name</TableHead>
                        <TableHead className="font-semibold">Email</TableHead>
                        <TableHead className="font-semibold">Requested By</TableHead>
                        <TableHead className="font-semibold">New Mentor</TableHead>
                        <TableHead className="font-semibold">Approved By</TableHead>
                        <TableHead className="font-semibold">Approved At</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {approvedRequests.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                            No approved requests
                          </TableCell>
                        </TableRow>
                      ) : (
                        approvedRequests.map((request) => (
                          <TableRow key={request.id} className="hover:bg-gray-50 transition-colors">
                            <TableCell className="text-sm">
                              {request.requested_at ? format(new Date(request.requested_at), 'MMM d, yyyy HH:mm') : '-'}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={request.request_type === 'TRANSFER' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}>
                                {request.request_type === 'TRANSFER' ? 'Transfer' : 'Level Upgrade'}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium">{request.full_name}</TableCell>
                            <TableCell className="text-sm">{request.email}</TableCell>
                            <TableCell className="text-sm font-medium text-blue-700">{request.requested_by_name || '-'}</TableCell>
                            <TableCell className="text-sm">{request.requested_primary_mentor_name || '-'}</TableCell>
                            <TableCell className="text-sm font-medium text-green-700">{request.level_upgrade_approved_by_name || '-'}</TableCell>
                            <TableCell className="text-sm">
                              {request.level_upgrade_approved_at ? format(new Date(request.level_upgrade_approved_at), 'MMM d, yyyy HH:mm') : '-'}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={getStatusColor(request.status)}>
                                {request.status.replace(/_/g, ' ')}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Rejected Tab */}
          <TabsContent value="rejected">
            <Card className="border-gray-200">
              <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-red-50">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-red-600" />
                  Rejected Requests ({rejectedRequests.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead className="font-semibold">Requested At</TableHead>
                        <TableHead className="font-semibold">Request Type</TableHead>
                        <TableHead className="font-semibold">Student Name</TableHead>
                        <TableHead className="font-semibold">Email</TableHead>
                        <TableHead className="font-semibold">Requested By</TableHead>
                        <TableHead className="font-semibold">Rejected By</TableHead>
                        <TableHead className="font-semibold">Rejected At</TableHead>
                        <TableHead className="font-semibold">Rejection Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rejectedRequests.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                            No rejected requests
                          </TableCell>
                        </TableRow>
                      ) : (
                        rejectedRequests.map((request) => (
                          <TableRow key={request.id} className="hover:bg-gray-50 transition-colors">
                            <TableCell className="text-sm">
                              {request.requested_at ? format(new Date(request.requested_at), 'MMM d, yyyy HH:mm') : '-'}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className={request.request_type === 'TRANSFER' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}>
                                {request.request_type === 'TRANSFER' ? 'Transfer' : 'Level Upgrade'}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium">{request.full_name}</TableCell>
                            <TableCell className="text-sm">{request.email}</TableCell>
                            <TableCell className="text-sm font-medium text-blue-700">{request.requested_by_name || '-'}</TableCell>
                            <TableCell className="text-sm font-medium text-red-700">{request.level_upgrade_approved_by_name || '-'}</TableCell>
                            <TableCell className="text-sm">
                              {request.level_upgrade_approved_at ? format(new Date(request.level_upgrade_approved_at), 'MMM d, yyyy HH:mm') : '-'}
                            </TableCell>
                            <TableCell className="text-sm text-red-600 max-w-xs">
                              {request.level_upgrade_rejection_reason || '-'}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Approve Dialog */}
        <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Approve Student Request</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p>Are you sure you want to upgrade this student to Level 2?</p>
              {selectedRequest && (
                <div className="bg-blue-50 p-4 rounded-lg space-y-2 text-sm border border-blue-200">
                  <p className="font-semibold text-blue-900">Level Upgrade Request:</p>
                  <p><strong>Student:</strong> {selectedRequest.full_name}</p>
                  <p><strong>Email:</strong> {selectedRequest.email}</p>
                  <p><strong>Current Level:</strong> Level 1 (Logs Only)</p>
                  <p><strong>Requested Level:</strong> Level 2 (Full Access - Deposits & Withdrawals)</p>
                  <p><strong>Primary Mentor:</strong> {selectedRequest.requested_primary_mentor_name}</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowApproveDialog(false); setUserId(''); }} disabled={processing}>
                Cancel
              </Button>
              <Button onClick={confirmApprove} disabled={processing} className="bg-green-600 hover:bg-green-700">
                {processing ? 'Processing...' : 'Approve'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reject Dialog */}
        <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Student Request</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p>Please provide a reason for rejecting this request:</p>
              <div className="space-y-2">
                <Label>Rejection Reason *</Label>
                <Textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Enter rejection reason..."
                  rows={4}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowRejectDialog(false)} disabled={processing}>
                Cancel
              </Button>
              <Button onClick={confirmReject} disabled={processing} variant="destructive">
                {processing ? 'Processing...' : 'Reject'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Academic Head Approve Transfer Dialog */}
        <Dialog open={showAcademicApproveDialog} onOpenChange={setShowAcademicApproveDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Approve Transfer Request</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p>Approving this will forward the transfer request to <strong>Broker Admin</strong> for final approval.</p>
              {duplicateStudent && selectedRequest && (
                <div className="space-y-3">
                  <div className="bg-gray-50 p-4 rounded-lg space-y-2 text-sm">
                    <p className="font-semibold text-gray-900">Student:</p>
                    <p><strong>Name:</strong> {duplicateStudent.full_name}</p>
                    <p><strong>Current Mentor:</strong> {duplicateStudent.primary_mentor_name}</p>
                  </div>
                  <div className="bg-blue-50 p-4 rounded-lg space-y-2 text-sm">
                    <p className="font-semibold text-gray-900">Requested By:</p>
                    <p><strong>Mentor:</strong> {selectedRequest.requested_by_name}</p>
                    <p><strong>New Primary Mentor:</strong> {selectedRequest.requested_primary_mentor_name}</p>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAcademicApproveDialog(false)} disabled={processing}>
                Cancel
              </Button>
              <Button onClick={confirmAcademicApprove} disabled={processing} className="bg-blue-600 hover:bg-blue-700">
                {processing ? 'Processing...' : 'Approve & Forward to Broker Admin'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Transfer Dialog */}
        <Dialog open={showTransferDialog} onOpenChange={setShowTransferDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                Duplicate Student Detected
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Alert className="bg-amber-50 border-amber-200">
                <AlertDescription>
                  A student with this email already exists. Do you want to transfer this student to the new mentor?
                </AlertDescription>
              </Alert>
              
              {duplicateStudent && selectedRequest && (
                <div className="space-y-4">
                  <div className="bg-gray-50 p-4 rounded-lg space-y-2 text-sm">
                    <p className="font-semibold text-gray-900">Existing Student:</p>
                    <p><strong>Name:</strong> {duplicateStudent.full_name}</p>
                    <p><strong>Email:</strong> {duplicateStudent.email}</p>
                    <p><strong>Current Primary Mentor:</strong> {duplicateStudent.primary_mentor_name}</p>
                    {duplicateStudent.senior_mentor_name && (
                      <p><strong>Current Senior Mentor:</strong> {duplicateStudent.senior_mentor_name}</p>
                    )}
                  </div>
                  
                  <div className="bg-blue-50 p-4 rounded-lg space-y-2 text-sm">
                    <p className="font-semibold text-gray-900">Transfer To:</p>
                    <p><strong>New Primary Mentor:</strong> {selectedRequest.requested_primary_mentor_name}</p>
                    {selectedRequest.requested_senior_mentor_name && (
                      <p><strong>New Senior Mentor:</strong> {selectedRequest.requested_senior_mentor_name}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowTransferDialog(false);
                setShowApproveDialog(true);
              }} disabled={processing}>
                Cancel Transfer
              </Button>
              <Button onClick={confirmTransfer} disabled={processing} className="bg-blue-600 hover:bg-blue-700">
                {processing ? 'Processing...' : 'Transfer Student'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}