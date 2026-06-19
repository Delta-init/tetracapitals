import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import StudentForm from "../components/students/StudentForm";
import StudentRequestForm from "../components/students/StudentRequestForm";
import BulkImportStudentsDialog from "../components/students/BulkImportStudentsDialog";

import { Plus, Search, Eye, Users, UserCheck, Upload, Download, Filter, ArrowUp, Share2, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { 
  canSubmitStudentRequest, 
  canEditStudent,
  canDeleteStudent,
  filterStudentsByRole, 
  applyStudentMasking,
  generateStudentCode
} from "../components/utils/StudentAccessControl";
import { getEffectiveUser } from "../components/utils/ImpersonationContext";
import { createPageUrl } from "../utils";
import { toast } from "sonner";
import { format } from "date-fns";
import { logAction } from "../components/utils/AuditLogger";

export default function Students() {
  const [currentUser, setCurrentUser] = useState(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showBulkImportDialog, setShowBulkImportDialog] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('my');
  const [filterMentor, setFilterMentor] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterDateRange, setFilterDateRange] = useState('all');
  const [customDateFrom, setCustomDateFrom] = useState(null);
  const [customDateTo, setCustomDateTo] = useState(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [showBulkUpgradeDialog, setShowBulkUpgradeDialog] = useState(false);

  const queryClient = useQueryClient();

  useEffect(() => {
    const fetchUser = async () => {
      const realUser = await base44.auth.me();
      const user = getEffectiveUser(realUser);
      setCurrentUser(user);
      // Set default tab based on user role
      if (['super_admin', 'broker_admin', 'academic_head'].includes(user.app_role)) {
        setActiveTab('all');
      }
    };
    fetchUser();
  }, []);

  const { data: students = [] } = useQuery({
    queryKey: ['students'],
    queryFn: () => base44.entities.Student.list('-created_date'),
    enabled: !!currentUser
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const result = await base44.functions.invoke('getAllUsers', {});
      return result.data?.users || [];
    },
    enabled: !!currentUser,
    retry: false
  });

  const { data: studentRequests = [] } = useQuery({
    queryKey: ['student-requests'],
    queryFn: () => base44.entities.StudentRequest.list('-created_date'),
    enabled: !!currentUser && currentUser.app_role === 'academic_admin'
  });

  const { data: allStudentsForCoManaged = [] } = useQuery({
    queryKey: ['all-students-co-managed'],
    queryFn: () => base44.entities.Student.list('-created_date'),
    enabled: !!currentUser && isMentorRole(currentUser?.app_role)
  });



  const createMutation = useMutation({
    mutationFn: async (data) => {
      // Check for duplicate email
      const existingStudent = students.find(s => s.email?.toLowerCase() === data.email?.toLowerCase());
      if (existingStudent) {
        throw new Error(`A student with email ${data.email} already exists (${existingStudent.student_code} - ${existingStudent.full_name})`);
      }
      
      const studentCode = await generateStudentCode(base44);
      const newStudent = await base44.entities.Student.create({
        ...data,
        student_code: studentCode
      });
      await logAction('create_student', 'Student', newStudent.id, `Created student: ${data.full_name}`, null, data);
      return newStudent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setShowAddDialog(false);
      toast.success('Student created successfully');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to create student');
    }
  });

  const createRequestMutation = useMutation({
    mutationFn: async (data) => {
      // Check for duplicate email — block for all roles
      const existingStudent = students.find(s => s.email?.toLowerCase() === data.email?.toLowerCase());
      if (existingStudent) {
        if (existingStudent.primary_mentor_id === currentUser.id) {
          throw new Error('DUPLICATE_OWN_STUDENT');
        }
        throw new Error(`A student with email ${data.email} already exists (${existingStudent.student_code} - ${existingStudent.full_name})`);
      }
      
      // No duplicate - create student directly
      const studentCode = await generateStudentCode(base44);
      const newStudent = await base44.entities.Student.create({
        student_code: studentCode,
        full_name: data.full_name,
        email: data.email,
        phone: data.phone,
        country: data.country,
        notes: data.notes,
        primary_mentor_id: data.requested_primary_mentor_id,
        primary_mentor_name: data.requested_primary_mentor_name,
        senior_mentor_id: data.requested_senior_mentor_id,
        senior_mentor_name: data.requested_senior_mentor_name,
        assignment_status: 'assigned',
        status: 'ACTIVE',
        student_level: 'LEVEL_1'
      });
      
      // Also create a request record for tracking
      await base44.entities.StudentRequest.create({
        ...data,
        request_type: 'NEW_ENROLLMENT',
        requested_by_id: currentUser.id,
        requested_by_name: currentUser.full_name,
        requested_at: new Date().toISOString(),
        status: 'APPROVED',
        created_student_id: newStudent.id
      });
      
      await logAction('create_student', 'Student', newStudent.id, `Created student: ${data.full_name}`, null, newStudent);
      return newStudent;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['student-requests'] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setShowAddDialog(false);
      
      if (result?.isTransferRequest) {
        toast.success('Transfer request submitted. Awaiting academic head approval.');
      } else {
        toast.success('Student created successfully');
      }
    },
    onError: (error) => {
      if (error.message === 'DUPLICATE_OWN_STUDENT') {
        toast.error('Student already exists in your student list');
      } else {
        toast.error(error.message || 'Failed to create student');
      }
    }
  });

  const deleteStudentMutation = useMutation({
    mutationFn: async (student) => {
      await base44.entities.Student.delete(student.id);
      await logAction('delete_student', 'Student', student.id, `Deleted student: ${student.full_name} (${student.student_code})`, student, null);
      return student;
    },
    onSuccess: (student) => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
      toast.success(`Deleted ${student.full_name}`);
    },
    onError: (err) => {
      toast.error(err?.message || 'Failed to delete student');
    },
  });

  const handleDeleteStudent = (student) => {
    const code = student.student_code || student.id;
    if (!confirm(`Delete ${student.full_name} (${code})?\n\nThis cannot be undone. Existing transactions and logs that reference this student will keep their copy of the student name/code but will no longer link to a live record.`)) return;
    deleteStudentMutation.mutate(student);
  };

  const bulkUpgradeMutation = useMutation({
    mutationFn: async (studentIds) => {
      const results = await Promise.all(
        studentIds.map(id => 
          base44.entities.Student.update(id, { student_level: 'LEVEL_2' })
        )
      );
      await logAction('bulk_upgrade_student_level', 'Student', null, 
        `Bulk upgraded ${studentIds.length} students to Level 2`, 
        null, 
        { studentIds, newLevel: 'LEVEL_2' }
      );
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] });
      setSelectedStudentIds([]);
      setShowBulkUpgradeDialog(false);
      toast.success('Students upgraded to Level 2 successfully');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to upgrade students');
    }
  });

  const requestOpenPoolStudentMutation = useMutation({
    mutationFn: async (student) => {
      const user = await base44.auth.me();
      // Update student directly (auto-approved)
      await base44.entities.Student.update(student.id, {
        primary_mentor_id: user.id,
        primary_mentor_name: user.full_name,
        senior_mentor_id: user.app_role === 'junior_mentor' ? user.senior_mentor_id : '',
        senior_mentor_name: user.app_role === 'junior_mentor' ? user.senior_mentor_name : '',
        assignment_status: 'assigned'
      });
      
      // Create request record for tracking
      await base44.entities.StudentRequest.create({
        request_type: 'OPEN_POOL_ASSIGNMENT',
        existing_student_id: student.id,
        full_name: student.full_name,
        email: student.email,
        phone: student.phone,
        country: student.country,
        requested_primary_mentor_id: user.id,
        requested_primary_mentor_name: user.full_name,
        requested_senior_mentor_id: user.app_role === 'junior_mentor' ? user.senior_mentor_id : '',
        requested_senior_mentor_name: user.app_role === 'junior_mentor' ? user.senior_mentor_name : '',
        requested_by_id: user.id,
        requested_by_name: user.full_name,
        requested_at: new Date().toISOString(),
        status: 'APPROVED',
        notes: `Assigned open pool student to mentor`
      });
      
      await logAction('assign_open_pool_student', 'Student', student.id, `Assigned open pool student: ${student.full_name}`, null, student);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-requests'] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
      toast.success('Student assigned successfully');
    }
  });

  const handleSubmit = (formData) => {
    // For assistance users, auto-assign their mentor
    if (currentUser.app_role === 'assistance' && currentUser.assigned_mentor_id) {
      const mentorUser = users.find(u => u.id === currentUser.assigned_mentor_id);
      formData.primary_mentor_id = currentUser.assigned_mentor_id;
      formData.primary_mentor_name = currentUser.assigned_mentor_name;
      if (mentorUser?.senior_mentor_id) {
        formData.senior_mentor_id = mentorUser.senior_mentor_id;
        formData.senior_mentor_name = mentorUser.senior_mentor_name;
      }
    }
    
    // Mentors create students directly (auto-approved)
    if (isMentor) {
      createRequestMutation.mutate(formData);
    } else {
      createMutation.mutate(formData);
    }
  };

  if (!currentUser) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  // Must be defined before query usage above — hoisted via function declaration
  function isMentorRole(role) {
    return ['junior_mentor', 'senior_mentor', 'subjunior_mentor'].includes(role);
  }

  const canCreate = canSubmitStudentRequest(currentUser.app_role);
  const isMentor = ['junior_mentor', 'senior_mentor', 'subjunior_mentor'].includes(currentUser.app_role);
  const isSeniorMentor = currentUser.app_role === 'senior_mentor';
  const isAssistance = currentUser.app_role === 'assistance';
  const isAdmin = ['super_admin', 'broker_admin', 'academic_head'].includes(currentUser.app_role);
  const isSuperAdmin = currentUser.app_role === 'super_admin';

  // Co-managed students: where current user appears in co_mentors_details (mentors)
  const coManagedStudents = isMentor ? (allStudentsForCoManaged.length ? allStudentsForCoManaged : students).filter(s => {
    if (!s.co_mentors_details) return false;
    try {
      const co = JSON.parse(s.co_mentors_details);
      return Array.isArray(co) && co.some(m => m.mentor_id === currentUser.id);
    } catch (_) { return false; }
  }) : [];

  // All co-managed students for admin view
  const allCoManagedStudents = isAdmin ? students.filter(s => {
    if (!s.co_mentors_details) return false;
    try {
      const co = JSON.parse(s.co_mentors_details);
      return Array.isArray(co) && co.length > 0;
    } catch (_) { return false; }
  }) : [];

  const handleSelectAll = (checked, currentFilteredStudents) => {
    if (checked) {
      const level1StudentIds = currentFilteredStudents
        .filter(s => (s.student_level || 'LEVEL_1') === 'LEVEL_1')
        .map(s => s.id);
      setSelectedStudentIds(level1StudentIds);
    } else {
      setSelectedStudentIds([]);
    }
  };

  const handleSelectStudent = (studentId, checked) => {
    if (checked) {
      setSelectedStudentIds(prev => [...prev, studentId]);
    } else {
      setSelectedStudentIds(prev => prev.filter(id => id !== studentId));
    }
  };

  // Get mentor users for bulk import
  const mentorUsers = users.filter(u => 
    ['junior_mentor', 'senior_mentor', 'subjunior_mentor'].includes(u.app_role)
  );

  // For mentors: filter students into My, Team, and Open Pool
  // For assistance: show only students of their assigned mentor
  // For academic_admin: show only students they created
  // For admins: show all students + open pool tab
  let myStudents = [];
  let teamStudents = [];
  let openPoolStudents = [];
  let allStudents = students;

  if (isAssistance && currentUser.assigned_mentor_id) {
    // Assistance sees only students assigned to their mentor
    allStudents = students.filter(s => s.primary_mentor_id === currentUser.assigned_mentor_id);
  } else if (isMentor) {
    // Filter MY students - students where I am the primary mentor
    myStudents = students.filter(s => s.primary_mentor_id === currentUser.id);
    
    // Filter TEAM students - students where I am the senior mentor but NOT the primary mentor
    teamStudents = students.filter(s => 
      currentUser.app_role === 'senior_mentor' && 
      s.senior_mentor_id === currentUser.id &&
      s.primary_mentor_id !== currentUser.id
    );
    
    // Filter OPEN POOL students - students without assigned mentors
    openPoolStudents = students.filter(s => s.assignment_status === 'open_pool');
  } else if (isAdmin) {
    // Admins see open pool students in separate tab
    openPoolStudents = students.filter(s => s.assignment_status === 'open_pool');
  }

  // Get unique mentors for filter
  const uniqueMentors = [...new Set(students.map(s => s.primary_mentor_name))].filter(Boolean).sort();

  // Get date range based on filter
  const getDateRange = () => {
    const now = new Date();
    if (filterDateRange === 'weekly') {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return { from: weekAgo, to: now };
    } else if (filterDateRange === 'monthly') {
      const monthAgo = new Date(now);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      return { from: monthAgo, to: now };
    } else if (filterDateRange === 'custom' && customDateFrom && customDateTo) {
      return { from: customDateFrom, to: customDateTo };
    }
    return null;
  };

  // Get base student list based on role and active tab
  let baseStudents;
  if (isMentor) {
    baseStudents = activeTab === 'my' ? myStudents : activeTab === 'team' ? teamStudents : openPoolStudents;
  } else if (isAssistance) {
    baseStudents = allStudents;
  } else if (isAdmin) {
    baseStudents = activeTab === 'open_pool' ? openPoolStudents : allStudents;
  } else {
    baseStudents = allStudents;
  }

  // Apply all filters to base list
  let filteredStudents = baseStudents;

  // Apply search filter
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    const has = (v) => v != null && String(v).toLowerCase().includes(q);
    filteredStudents = filteredStudents.filter(s =>
      has(s.full_name) ||
      has(s.student_code) ||
      has(s.email) ||
      has(s.phone)
    );
  }

  // Apply mentor filter (only for "all" tab)
  if (filterMentor !== 'all' && activeTab === 'all') {
    filteredStudents = filteredStudents.filter(s => s.primary_mentor_name === filterMentor);
  }

  // Apply status filter
  if (filterStatus !== 'all') {
    filteredStudents = filteredStudents.filter(s => s.status === filterStatus);
  }

  // Apply level filter
  if (filterLevel !== 'all') {
    filteredStudents = filteredStudents.filter(s => (s.student_level || 'LEVEL_1') === filterLevel);
  }

  // Apply date filter (only for "all" tab)
  if (activeTab === 'all') {
    const dateRange = getDateRange();
    if (dateRange) {
      filteredStudents = filteredStudents.filter(s => {
        if (!s.created_date) return false;
        const createdDate = new Date(s.created_date);
        return createdDate >= dateRange.from && createdDate <= dateRange.to;
      });
    }
  }
  
  // Apply masking to displayed students
  const displayStudents = filteredStudents.map(s => applyStudentMasking(s, currentUser.app_role));
  
  // Filter selected students to only Level 1 (after filteredStudents is defined)
  const selectedLevel1Students = filteredStudents.filter(s => 
    selectedStudentIds.includes(s.id) && (s.student_level || 'LEVEL_1') === 'LEVEL_1'
  );

  const handleBulkUpgrade = () => {
    if (selectedLevel1Students.length === 0) {
      toast.error('No Level 1 students selected');
      return;
    }
    setShowBulkUpgradeDialog(true);
  };
  
  const canEdit = canEditStudent(currentUser.app_role);
  const canDelete = canDeleteStudent(currentUser.app_role);
  
  const getStatusColor = (status) => {
    return status === 'ACTIVE' 
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const handleExportStudents = () => {
    if (filteredStudents.length === 0) {
      toast.error('No students to export');
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

    const csvContent = [
      ['Student Code', 'Full Name', 'Email', 'Phone', 'Country', 'User ID', 'Primary Mentor', 'Senior Mentor', 'Status', 'Created Date', 'Notes'].join(','),
      ...filteredStudents.map(s => [
        escapeCSV(s.student_code || ''),
        escapeCSV(s.full_name || ''),
        escapeCSV(s.email || ''),
        escapeCSV(s.phone || ''),
        escapeCSV(s.country || ''),
        escapeCSV(s.user_id || ''),
        escapeCSV(s.primary_mentor_name || ''),
        escapeCSV(s.senior_mentor_name || ''),
        escapeCSV(s.status || ''),
        escapeCSV(s.created_date ? format(new Date(s.created_date), 'yyyy-MM-dd') : ''),
        escapeCSV(s.notes || '')
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `students_export_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filteredStudents.length} students successfully`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Students</h1>
          <div className="flex gap-3">
            {isSuperAdmin && selectedLevel1Students.length > 0 && (
              <Button 
                onClick={handleBulkUpgrade}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <ArrowUp className="h-4 w-4 mr-2" />
                Upgrade {selectedLevel1Students.length} to Level 2
              </Button>
            )}
            {['super_admin', 'broker_admin'].includes(currentUser.app_role) && (
              <Button onClick={handleExportStudents} variant="outline" className="border-green-600 text-green-600 hover:bg-green-50">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            )}
            {['super_admin', 'broker_admin'].includes(currentUser.app_role) && (
              <Button onClick={() => setShowBulkImportDialog(true)} variant="outline" className="border-blue-600 text-blue-600 hover:bg-blue-50">
                <Upload className="h-4 w-4 mr-2" />
                Bulk Import
              </Button>
            )}
            {canCreate && (isMentor ? activeTab === 'my' : true) && (
              <Button onClick={() => setShowAddDialog(true)} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" />
                {isMentor ? 'Request Student' : isAssistance ? 'Add Student' : 'Add Student'}
              </Button>
            )}
          </div>
        </div>

        {/* Search and Filters */}
        <Card className="border-gray-200">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4">
              {/* Search */}
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by name, code, email or phone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Admin Filters */}
              {['super_admin', 'broker_admin'].includes(currentUser.app_role) && (activeTab === 'all' || activeTab === 'open_pool') && (
                <>
                  {/* Mentor Filter */}
                  {activeTab === 'all' && (
                    <Select value={filterMentor} onValueChange={setFilterMentor}>
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder="Filter by Mentor" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Mentors</SelectItem>
                        {uniqueMentors.map((mentor) => (
                          <SelectItem key={mentor} value={mentor}>
                            {mentor}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* Status Filter */}
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-36">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="ACTIVE">Active</SelectItem>
                      <SelectItem value="INACTIVE">Inactive</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Level Filter */}
                  <Select value={filterLevel} onValueChange={setFilterLevel}>
                    <SelectTrigger className="w-36">
                      <SelectValue placeholder="Level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Levels</SelectItem>
                      <SelectItem value="LEVEL_1">Level 1</SelectItem>
                      <SelectItem value="LEVEL_2">Level 2</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Date Filter */}
                  {activeTab === 'all' && (
                    <Select value={filterDateRange} onValueChange={setFilterDateRange}>
                      <SelectTrigger className="w-36">
                        <SelectValue placeholder="Date Range" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Time</SelectItem>
                        <SelectItem value="weekly">Last 7 Days</SelectItem>
                        <SelectItem value="monthly">Last 30 Days</SelectItem>
                        <SelectItem value="custom">Custom Range</SelectItem>
                      </SelectContent>
                    </Select>
                  )}

                  {/* Custom Date Pickers */}
                  {filterDateRange === 'custom' && activeTab === 'all' && (
                    <>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-36">
                            {customDateFrom ? format(customDateFrom, 'MMM d, yyyy') : 'From Date'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={customDateFrom}
                            onSelect={setCustomDateFrom}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-36">
                            {customDateTo ? format(customDateTo, 'MMM d, yyyy') : 'To Date'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={customDateTo}
                            onSelect={setCustomDateTo}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tabs for mentors and admins, single table for assistance/others */}
        {isMentor || isAdmin ? (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full max-w-5xl" style={{ gridTemplateColumns: isMentor ? (isSeniorMentor ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr') : (['broker_admin', 'super_admin'].includes(currentUser.app_role) ? '1fr 1fr 1fr 1fr' : (currentUser.app_role === 'academic_head' ? '1fr 1fr' : '1fr')) }}>
              {isMentor && <TabsTrigger value="my">My Students</TabsTrigger>}
              {isSeniorMentor && <TabsTrigger value="team">Team Students</TabsTrigger>}
              {isMentor && (
                <TabsTrigger value="co_managed" className="flex items-center gap-1">
                  <Share2 className="h-3.5 w-3.5" />
                  Co-Managed ({coManagedStudents.length})
                </TabsTrigger>
              )}

              {isAdmin && <TabsTrigger value="all">All Students</TabsTrigger>}
              {['academic_head', 'broker_admin', 'super_admin'].includes(currentUser.app_role) && (
                <TabsTrigger value="open_pool">Delta Open Students</TabsTrigger>
              )}
              {['broker_admin', 'super_admin'].includes(currentUser.app_role) && (
                <TabsTrigger value="admin_co_managed" className="flex items-center gap-1">
                  <Share2 className="h-3.5 w-3.5" />
                  Co-Managed ({allCoManagedStudents.length})
                </TabsTrigger>
              )}
            </TabsList>

            {/* My Students Tab (Mentors Only) */}
            {isMentor && (
              <TabsContent value="my">
                <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                  <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200">
                    <h3 className="text-lg font-semibold flex items-center gap-2 tracking-tight">
                      <UserCheck className="h-5 w-5 text-blue-600" />
                      My Students ({displayStudents.length})
                    </h3>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead className="font-semibold">Student Code</TableHead>
                        <TableHead className="font-semibold">Full Name</TableHead>
                        <TableHead className="font-semibold">Email</TableHead>
                        <TableHead className="font-semibold">Phone</TableHead>
                        <TableHead className="font-semibold">Country</TableHead>
                        <TableHead className="font-semibold">User ID</TableHead>
                        <TableHead className="font-semibold">Primary Mentor</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="font-semibold">Created</TableHead>
                        <TableHead className="font-semibold text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayStudents.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={10} className="text-center py-8 text-gray-500">
                            No students found
                          </TableCell>
                        </TableRow>
                      ) : (
                        displayStudents.map((student) => (
                          <TableRow key={student.id} className="hover:bg-gray-50 transition-colors">
                            <TableCell className="font-mono text-sm font-medium text-blue-600">
                              {student.student_code}
                            </TableCell>
                            <TableCell className="font-medium">{student.full_name}</TableCell>
                            <TableCell className="text-sm">{student.email}</TableCell>
                            <TableCell className="text-sm font-mono">{student.phone}</TableCell>
                            <TableCell className="text-sm">{student.country || '-'}</TableCell>
                            <TableCell className="text-sm font-mono">{student.user_id || '-'}</TableCell>
                            <TableCell className="text-sm">{student.primary_mentor_name}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={getStatusColor(student.status)}>
                                {student.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">
                              {student.created_date ? format(new Date(student.created_date), 'MMM d, yyyy') : '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Link to={createPageUrl('StudentDetail') + '?id=' + student.id}>
                                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="View">
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </Link>
                                {canDelete && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                    title="Delete"
                                    onClick={() => handleDeleteStudent(student)}
                                    disabled={deleteStudentMutation.isPending}
                                  >
                                    <Trash2 className="h-4 w-4" />
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
              </TabsContent>
            )}

            {/* Team Students Tab (Senior Mentors Only) */}
            {isSeniorMentor && (
            <TabsContent value="team">
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 border-b border-purple-200">
                  <h3 className="text-lg font-semibold flex items-center gap-2 tracking-tight">
                    <Users className="h-5 w-5 text-purple-600" />
                    Team Students ({displayStudents.length})
                  </h3>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="font-semibold">Student Code</TableHead>
                      <TableHead className="font-semibold">Full Name</TableHead>
                      <TableHead className="font-semibold">Email</TableHead>
                      <TableHead className="font-semibold">Phone</TableHead>
                      <TableHead className="font-semibold">Country</TableHead>
                      <TableHead className="font-semibold">User ID</TableHead>
                      <TableHead className="font-semibold">Primary Mentor</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold">Created</TableHead>
                      <TableHead className="font-semibold text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayStudents.length === 0 ? (
                     <TableRow>
                       <TableCell colSpan={10} className="text-center py-8 text-gray-500">
                         No team students found
                       </TableCell>
                     </TableRow>
                    ) : (
                     displayStudents.map((student) => (
                       <TableRow key={student.id} className="hover:bg-gray-50 transition-colors">
                         <TableCell className="font-mono text-sm font-medium text-blue-600">
                           {student.student_code}
                         </TableCell>
                         <TableCell className="font-medium">{student.full_name}</TableCell>
                         <TableCell className="text-sm">{student.email}</TableCell>
                         <TableCell className="text-sm font-mono">{student.phone}</TableCell>
                         <TableCell className="text-sm">{student.country || '-'}</TableCell>
                         <TableCell className="text-sm font-mono">{student.user_id || '-'}</TableCell>
                         <TableCell className="text-sm text-purple-600 font-medium">{student.primary_mentor_name}</TableCell>
                         <TableCell>
                           <Badge variant="outline" className={getStatusColor(student.status)}>
                             {student.status}
                           </Badge>
                         </TableCell>
                         <TableCell className="text-sm">
                           {student.created_date ? format(new Date(student.created_date), 'MMM d, yyyy') : '-'}
                         </TableCell>
                         <TableCell className="text-right">
                           <div className="flex justify-end gap-1">
                             <Link to={createPageUrl('StudentDetail') + '?id=' + student.id}>
                               <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="View">
                                 <Eye className="h-4 w-4" />
                               </Button>
                             </Link>
                             {canDelete && (
                               <Button
                                 size="sm"
                                 variant="ghost"
                                 className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                 title="Delete"
                                 onClick={() => handleDeleteStudent(student)}
                                 disabled={deleteStudentMutation.isPending}
                               >
                                 <Trash2 className="h-4 w-4" />
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
            </TabsContent>
          )}

          {/* All Students Tab (Admins Only) */}
          {isAdmin && (
            <TabsContent value="all">
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="p-4 bg-gradient-to-r from-gray-50 to-blue-50 border-b border-gray-200">
                  <h3 className="text-lg font-semibold flex items-center gap-2 tracking-tight">
                    <Users className="h-5 w-5 text-blue-600" />
                    All Students ({displayStudents.length})
                  </h3>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      {isSuperAdmin && (
                        <TableHead className="w-12">
                          <Checkbox
                            checked={selectedStudentIds.length > 0 && 
                              filteredStudents.filter(s => (s.student_level || 'LEVEL_1') === 'LEVEL_1').length > 0 &&
                              filteredStudents.filter(s => (s.student_level || 'LEVEL_1') === 'LEVEL_1').every(s => selectedStudentIds.includes(s.id))}
                            onCheckedChange={(checked) => handleSelectAll(checked, filteredStudents)}
                          />
                        </TableHead>
                      )}
                      <TableHead className="font-semibold">Student Code</TableHead>
                      <TableHead className="font-semibold">Full Name</TableHead>
                      <TableHead className="font-semibold">Email</TableHead>
                      <TableHead className="font-semibold">Phone</TableHead>
                      <TableHead className="font-semibold">Country</TableHead>
                      <TableHead className="font-semibold">User ID</TableHead>
                      <TableHead className="font-semibold">Primary Mentor</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold">Created</TableHead>
                      <TableHead className="font-semibold text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayStudents.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isSuperAdmin ? 11 : 10} className="text-center py-8 text-gray-500">
                          No students found
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayStudents.map((student) => (
                        <TableRow key={student.id} className="hover:bg-gray-50 transition-colors">
                          {isSuperAdmin && (
                            <TableCell>
                              <Checkbox
                                checked={selectedStudentIds.includes(student.id)}
                                onCheckedChange={(checked) => handleSelectStudent(student.id, checked)}
                                disabled={(student.student_level || 'LEVEL_1') !== 'LEVEL_1'}
                              />
                            </TableCell>
                          )}
                          <TableCell className="font-mono text-sm font-medium text-blue-600">
                            {student.student_code}
                          </TableCell>
                          <TableCell className="font-medium">{student.full_name}</TableCell>
                          <TableCell className="text-sm">{student.email}</TableCell>
                          <TableCell className="text-sm font-mono">{student.phone}</TableCell>
                          <TableCell className="text-sm">{student.country || '-'}</TableCell>
                          <TableCell className="text-sm font-mono">{student.user_id || '-'}</TableCell>
                          <TableCell className="text-sm">{student.primary_mentor_name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={getStatusColor(student.status)}>
                              {student.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {student.created_date ? format(new Date(student.created_date), 'MMM d, yyyy') : '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Link to={createPageUrl('StudentDetail') + '?id=' + student.id}>
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="View">
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </Link>
                              {canDelete && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                  title="Delete"
                                  onClick={() => handleDeleteStudent(student)}
                                  disabled={deleteStudentMutation.isPending}
                                >
                                  <Trash2 className="h-4 w-4" />
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
            </TabsContent>
          )}

          {/* Co-Managed Clients Tab */}
          {isMentor && (
            <TabsContent value="co_managed">
              <div className="rounded-xl border border-purple-200 bg-white overflow-hidden">
                <div className="p-4 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-200">
                  <h3 className="text-lg font-semibold flex items-center gap-2 tracking-tight">
                    <Share2 className="h-5 w-5 text-purple-600" />
                    Co-Managed Clients ({coManagedStudents.length})
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Clients where you are a co-mentor. Commission is attributed to your deposits only.</p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="font-semibold">Client Name</TableHead>
                      <TableHead className="font-semibold">Code</TableHead>
                      <TableHead className="font-semibold">Primary Mentor</TableHead>
                      <TableHead className="font-semibold">My Net Deposits</TableHead>
                      <TableHead className="font-semibold">Primary Net Deposits</TableHead>
                      <TableHead className="font-semibold">Combined Total</TableHead>
                      <TableHead className="font-semibold">Co-Mentor Since</TableHead>
                      <TableHead className="font-semibold text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {coManagedStudents.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                          No co-managed clients yet. Send a referral request from a Fund Request to get started.
                        </TableCell>
                      </TableRow>
                    ) : (
                      coManagedStudents.map((student) => {
        const _coMentors = Array.isArray(student.co_mentors_details)
          ? student.co_mentors_details
          : (() => { try { return JSON.parse(student.co_mentors_details || '[]'); } catch(_) { return []; } })();
        const myNet = _coMentors.find(cm => cm.mentor_id === currentUser?.id)?.net_deposit_contribution_usd || 0;
        const combinedNet = _coMentors.reduce((sum, cm) => sum + (cm.net_deposit_contribution_usd || 0), 0);
        const primaryNet = combinedNet - myNet;
        const myEntry = _coMentors.find(cm => cm.mentor_id === currentUser?.id);
                        return (
                          <TableRow key={student.id} className="hover:bg-gray-50 transition-colors">
                            <TableCell className="font-medium">{student.full_name}</TableCell>
                            <TableCell className="font-mono text-sm text-blue-600">{student.student_code || '-'}</TableCell>
                            <TableCell className="text-sm">{student.primary_mentor_name}</TableCell>
                            <TableCell className="text-sm font-semibold text-green-700">${myNet.toLocaleString()}</TableCell>
                            <TableCell className="text-sm text-gray-600">${primaryNet.toLocaleString()}</TableCell>
                            <TableCell className="text-sm font-semibold">${combinedNet.toLocaleString()}</TableCell>
                            <TableCell className="text-sm text-gray-500">
                              {myEntry?.since ? format(new Date(myEntry.since), 'MMM d, yyyy') : '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Link to={createPageUrl('StudentDetail') + '?id=' + student.id}>
                                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="View">
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </Link>
                                {canDelete && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                    title="Delete"
                                    onClick={() => handleDeleteStudent(student)}
                                    disabled={deleteStudentMutation.isPending}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          )}


          {/* Open Pool Students Tab */}
          <TabsContent value="open_pool">
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-200">
                <h3 className="text-lg font-semibold flex items-center gap-2 tracking-tight">
                  <Users className="h-5 w-5 text-green-600" />
                  Delta Open Students ({displayStudents.length})
                </h3>
                <p className="text-sm text-gray-600 mt-1">Students available for mentor assignment</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold">Student Code</TableHead>
                    <TableHead className="font-semibold">Full Name</TableHead>
                    <TableHead className="font-semibold">Email</TableHead>
                    <TableHead className="font-semibold">Phone</TableHead>
                    <TableHead className="font-semibold">Country</TableHead>
                    <TableHead className="font-semibold">User ID</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">Created</TableHead>
                    <TableHead className="font-semibold text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayStudents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                        No open pool students available
                      </TableCell>
                    </TableRow>
                  ) : (
                    displayStudents.map((student) => (
                      <TableRow key={student.id} className="hover:bg-gray-50 transition-colors">
                        <TableCell className="font-mono text-sm font-medium text-blue-600">
                          {student.student_code}
                        </TableCell>
                        <TableCell className="font-medium">{student.full_name}</TableCell>
                        <TableCell className="text-sm">{student.email}</TableCell>
                        <TableCell className="text-sm font-mono">{student.phone}</TableCell>
                        <TableCell className="text-sm">{student.country || '-'}</TableCell>
                        <TableCell className="text-sm font-mono">{student.user_id || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getStatusColor(student.status)}>
                            {student.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {student.created_date ? format(new Date(student.created_date), 'MMM d, yyyy') : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Link to={createPageUrl('StudentDetail') + '?id=' + student.id}>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="View">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                            {canDelete && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                title="Delete"
                                onClick={() => handleDeleteStudent(student)}
                                disabled={deleteStudentMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                            {isMentor && (
                              <Button
                                size="sm"
                                onClick={() => requestOpenPoolStudentMutation.mutate(student)}
                                disabled={requestOpenPoolStudentMutation.isPending}
                                className="bg-green-600 hover:bg-green-700"
                              >
                                {requestOpenPoolStudentMutation.isPending ? 'Requesting...' : 'Request Student'}
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
          </TabsContent>

          {/* Admin Co-Managed Tab */}
          {['broker_admin', 'super_admin'].includes(currentUser.app_role) && (
            <TabsContent value="admin_co_managed">
              <div className="rounded-xl border border-purple-200 bg-white overflow-hidden">
                <div className="p-4 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-200">
                  <h3 className="text-lg font-semibold flex items-center gap-2 tracking-tight">
                    <Share2 className="h-5 w-5 text-purple-600" />
                    Co-Managed Clients ({allCoManagedStudents.length})
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">All co-managed client relationships across all mentors</p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="font-semibold">Client Name</TableHead>
                      <TableHead className="font-semibold">Code</TableHead>
                      <TableHead className="font-semibold">Primary Mentor</TableHead>
                      <TableHead className="font-semibold">Co-Mentor</TableHead>
                      <TableHead className="font-semibold">Primary Net Deposits</TableHead>
                      <TableHead className="font-semibold">Co-Mentor Net Deposits</TableHead>
                      <TableHead className="font-semibold">Combined Total</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold">Co-Mentor Since</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allCoManagedStudents.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                          No co-managed clients found
                        </TableCell>
                      </TableRow>
                    ) : (
                      allCoManagedStudents.flatMap((student) => {
                        let coMentors = [];
                        try { coMentors = JSON.parse(student.co_mentors_details || '[]'); } catch (_) {}
                        return coMentors.map((co, idx) => {
                          const combined = student.net_deposit_usd || 0;
                          const coNet = co.net_deposit_contribution_usd || 0;
                          const primaryNet = Math.max(0, combined - coNet);
                          return (
                            <TableRow key={`${student.id}-${idx}`} className="hover:bg-gray-50 transition-colors">
                              <TableCell className="font-medium">{student.full_name}</TableCell>
                              <TableCell className="font-mono text-sm text-blue-600">{student.student_code || '-'}</TableCell>
                              <TableCell className="text-sm">{student.primary_mentor_name}</TableCell>
                              <TableCell className="text-sm font-medium text-purple-700">{co.mentor_name}</TableCell>
                              <TableCell className="text-sm text-gray-700">${primaryNet.toLocaleString()}</TableCell>
                              <TableCell className="text-sm font-semibold text-green-700">${coNet.toLocaleString()}</TableCell>
                              <TableCell className="text-sm font-semibold">${combined.toLocaleString()}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={getStatusColor(student.status)}>
                                  {student.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm text-gray-500">
                                {co.since ? format(new Date(co.since), 'MMM d, yyyy') : '-'}
                              </TableCell>
                            </TableRow>
                          );
                        });
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          )}
          </Tabs>
        ) : (
          /* Admin view - all students in one table */
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="p-4 bg-gradient-to-r from-gray-50 to-blue-50 border-b border-gray-200">
              <h3 className="text-lg font-semibold flex items-center gap-2 tracking-tight">
                <Users className="h-5 w-5 text-blue-600" />
                All Students ({displayStudents.length})
              </h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="font-semibold">Student Code</TableHead>
                  <TableHead className="font-semibold">Full Name</TableHead>
                  <TableHead className="font-semibold">Email</TableHead>
                  <TableHead className="font-semibold">Phone</TableHead>
                  <TableHead className="font-semibold">Country</TableHead>
                  <TableHead className="font-semibold">User ID</TableHead>
                  <TableHead className="font-semibold">Primary Mentor</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">Created</TableHead>
                  <TableHead className="font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayStudents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-gray-500">
                      No students found
                    </TableCell>
                  </TableRow>
                ) : (
                  displayStudents.map((student) => (
                    <TableRow key={student.id} className="hover:bg-gray-50 transition-colors">
                      <TableCell className="font-mono text-sm font-medium text-blue-600">
                        {student.student_code}
                      </TableCell>
                      <TableCell className="font-medium">{student.full_name}</TableCell>
                      <TableCell className="text-sm">{student.email}</TableCell>
                      <TableCell className="text-sm font-mono">{student.phone}</TableCell>
                      <TableCell className="text-sm">{student.country || '-'}</TableCell>
                      <TableCell className="text-sm font-mono">{student.user_id || '-'}</TableCell>
                      <TableCell className="text-sm">{student.primary_mentor_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getStatusColor(student.status)}>
                          {student.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {student.created_date ? format(new Date(student.created_date), 'MMM d, yyyy') : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Link to={createPageUrl('StudentDetail') + '?id=' + student.id}>
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="View">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          {canDelete && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="Delete"
                              onClick={() => handleDeleteStudent(student)}
                              disabled={deleteStudentMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
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
        )}

        {/* Add Dialog */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{isMentor ? 'Request New Student' : 'Add New Student'}</DialogTitle>
            </DialogHeader>
            {isMentor ? (
              <StudentRequestForm
                onSubmit={handleSubmit}
                onCancel={() => setShowAddDialog(false)}
                isSubmitting={createRequestMutation.isPending}
                users={users}
                currentUser={currentUser}
              />
            ) : (
              <StudentForm
                onSubmit={handleSubmit}
                onCancel={() => setShowAddDialog(false)}
                isSubmitting={createMutation.isPending}
                users={users}
                currentUser={currentUser}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Bulk Import Dialog */}
        <BulkImportStudentsDialog
          open={showBulkImportDialog}
          onOpenChange={setShowBulkImportDialog}
          onImportComplete={() => {
            queryClient.invalidateQueries({ queryKey: ['students'] });
            setShowBulkImportDialog(false);
          }}
          mentors={mentorUsers}
        />

        {/* Bulk Upgrade Confirmation Dialog */}
        <Dialog open={showBulkUpgradeDialog} onOpenChange={setShowBulkUpgradeDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Bulk Upgrade</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p className="text-gray-700">
                Are you sure you want to upgrade <span className="font-bold">{selectedLevel1Students.length}</span> students from Level 1 to Level 2?
              </p>
              <div className="mt-4 max-h-48 overflow-y-auto bg-gray-50 rounded-lg p-3">
                <p className="text-sm font-semibold mb-2">Students to be upgraded:</p>
                <ul className="text-sm space-y-1">
                  {selectedLevel1Students.map(s => (
                    <li key={s.id} className="text-gray-600">
                      • {s.student_code} - {s.full_name}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowBulkUpgradeDialog(false)}>
                Cancel
              </Button>
              <Button 
                onClick={() => bulkUpgradeMutation.mutate(selectedLevel1Students.map(s => s.id))}
                disabled={bulkUpgradeMutation.isPending}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {bulkUpgradeMutation.isPending ? 'Upgrading...' : 'Confirm Upgrade'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}