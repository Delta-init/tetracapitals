import React, { useState, useEffect, useMemo } from 'react';
import { enrolmentOf, ENROLMENT, EnrolledSwitch } from '@/components/students/enrolment';
import { OnboardedSwitch } from '@/components/students/onboarding';
import { isStudentOf } from '@/components/students/common';
import { StudentTagChips, tagNamesOf, useStudentTagCatalog } from '@/components/students/tags';
import PageHeader from '@/components/common/PageHeader';
import { Link, useNavigate } from 'react-router-dom';
import { courseLabel, studentCourses, studentBalance, balanceText } from '@/components/utils/studentProducts';
import { TablePagination, DEFAULT_PAGE_SIZE } from '@/components/common/TablePagination';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import StudentForm from "../components/students/StudentForm";
import { EditDetailsButton } from '@/components/students/EditDetails';
import StudentRequestForm from "../components/students/StudentRequestForm";
import BulkImportStudentsDialog from "../components/students/BulkImportStudentsDialog";
import { isMentorRole as isMentorTier, getScope, readsClosedOnly } from "@/components/utils/roles";

import { Plus, Search, Eye, Users, UserCheck, Upload, Download, Filter, ArrowUp, Share2, Trash2, ArrowRightLeft, Sparkles, RefreshCw, Loader2 } from "lucide-react";
import TransferStudentsDialog from "../components/students/TransferStudentsDialog";
import { CallButton } from "@/components/followups/CallFlow";
import { listTeams } from "@/components/utils/teams";
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

/** A student's courses — the LMS course, their "Closed - <course>" tags, their Course fees — as badges. */
function CourseCell({ student }) {
  const courses = studentCourses(student);
  return courses.length
    ? <div className="flex flex-wrap gap-1">{courses.map(c => <Badge key={c} variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">{c}</Badge>)}</div>
    : <span className="text-slate-300">—</span>;
}

/** Given to you and not opened yet — what the sidebar counts on Students (opening the student clears it). */
const isNewFor = (s, me) => !!me && s.new_for_id === me && s.primary_mentor_id === me;
const NewForYou = ({ student, me }) => (isNewFor(student, me)
  ? <span title="Given to you — not opened yet" className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-emerald-700">New</span>
  : null);

/**
 * Delta LMS classes in their own courses: attended, booked (passed, not marked yet) and upcoming — from the hourly
 * LMS check; the student page lists them.
 */
function ClassesCell({ student }) {
  const c = student.lms_classes;
  if (!c || !(c.attended || c.booked || c.upcoming)) return <span className="text-slate-300">—</span>;
  const title = [`${c.attended} attended`, `${c.booked} booked`, `${c.upcoming} upcoming`, c.last_attended_at ? `last attended ${format(new Date(c.last_attended_at), 'd MMM yyyy')}` : ''].filter(Boolean).join(' · ');
  return (
    <span className="whitespace-nowrap text-sm" title={title}>
      <span className={c.attended ? 'font-medium text-emerald-700' : 'text-slate-500'}>{c.attended} attended</span>
      {c.booked > 0 && <span className="text-xs text-slate-600"> · {c.booked} booked</span>}
      {c.upcoming > 0 && <span className="text-xs text-sky-700"> · {c.upcoming} upcoming</span>}
    </span>
  );
}

/** What is still to pay, from Course fees: amber while owed, green when paid in full, a dash when nothing is known. */
function BalanceCell({ student }) {
  const { known, owing } = studentBalance(student);
  if (!known) return <span className="text-slate-300">—</span>;
  return <span className={`whitespace-nowrap text-sm font-medium ${owing ? 'text-amber-700' : 'text-emerald-700'}`}>{balanceText(student)}</span>;
}

export default function Students() {
  const [currentUser, setCurrentUser] = useState(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showBulkImportDialog, setShowBulkImportDialog] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('my');
  const [filterMentor, setFilterMentor] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterEnrolment, setFilterEnrolment] = useState('all');
  const [filterOnboarding, setFilterOnboarding] = useState('all');
  const [filterClasses, setFilterClasses] = useState('all');
  const [filterBalance, setFilterBalance] = useState('all');
  const [filterTag, setFilterTag] = useState('all');
  const [onlyNew, setOnlyNew] = useState(false);
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterTeam, setFilterTeam] = useState('all');
  const [filterCourse, setFilterCourse] = useState('all');
  const navigate = useNavigate();
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [filterDateRange, setFilterDateRange] = useState('all');
  const [customDateFrom, setCustomDateFrom] = useState(null);
  const [customDateTo, setCustomDateTo] = useState(null);
  // Ticked rows, kept across pages: id → student.
  const [selected, setSelected] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [debouncedSearch, setDebouncedSearch] = useState('');
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

  const { data: tagCatalog = [] } = useStudentTagCatalog();

  // The list is paged on the server (backend/src/functions/studentsList.ts): the tab, search and every filter go
  // there, one page comes back with how many match.
  // The Sales role: one list, the students they closed — to read (the server sends only those).
  const salesOnly = !!currentUser && readsClosedOnly(currentUser);
  const isMentorUser = !!currentUser && isMentorTier(currentUser.app_role) && !salesOnly;
  const isAdminUser = !!currentUser && ['super_admin', 'broker_admin', 'academic_head'].includes(currentUser.app_role);
  const serverTab = !currentUser ? null : (isMentorUser || isAdminUser) ? activeTab : 'all';
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);
  // "Last 7 / 30 days" counts back from when it was picked, so the request stays the same while it is on.
  const dateRange = useMemo(() => {
    const now = new Date();
    if (filterDateRange === 'weekly') { const from = new Date(now); from.setDate(from.getDate() - 7); return { from, to: now }; }
    if (filterDateRange === 'monthly') { const from = new Date(now); from.setMonth(from.getMonth() - 1); return { from, to: now }; }
    if (filterDateRange === 'custom' && customDateFrom && customDateTo) return { from: customDateFrom, to: customDateTo };
    return null;
  }, [filterDateRange, customDateFrom, customDateTo]);
  const listFilters = useMemo(() => ({
    search: debouncedSearch, onlyNew, tag: filterTag, enrolment: filterEnrolment, onboarding: filterOnboarding, classes: filterClasses, course: filterCourse, balance: filterBalance,
    from: dateRange ? new Date(dateRange.from).toISOString() : '', to: dateRange ? new Date(dateRange.to).toISOString() : '',
    status: filterStatus, team: filterTeam, level: filterLevel, mentor: filterMentor,
  }), [debouncedSearch, onlyNew, filterTag, filterEnrolment, filterOnboarding, filterClasses, filterCourse, filterBalance, dateRange, filterStatus, filterTeam, filterLevel, filterMentor]);
  const filtersKey = JSON.stringify(listFilters);
  // A new tab, search or filter starts at page 1 with nothing ticked.
  useEffect(() => { setPage(1); setSelected({}); }, [serverTab, filtersKey]);
  useEffect(() => { setPage(1); }, [pageSize]);

  const { data: list, isLoading: listLoading, isFetching: listFetching } = useQuery({
    queryKey: ['students', 'page', serverTab, page, pageSize, filtersKey],
    queryFn: async () => (await base44.functions.invoke('listStudents', { tab: serverTab, page, pageSize, filters: listFilters })).data,
    enabled: !!serverTab,
    // Keep this tab's rows on screen while the next page loads (not another tab's).
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[2] === serverTab ? prev : undefined),
  });
  const rows = list?.rows || [];
  const total = list?.total || 0;
  const counts = list?.counts || {};

  // The choices in the Course / Product and CS filters.
  const { data: listOptions } = useQuery({
    queryKey: ['students', 'options'],
    queryFn: async () => (await base44.functions.invoke('getStudentListOptions', {})).data,
    enabled: !!currentUser,
    staleTime: 5 * 60_000,
  });

  // Enrolled comes from the Delta LMS (checked every hour); admins can check now.
  const canCheckLms = !!currentUser && ['super_admin', 'admin'].includes(currentUser.app_role);
  const { data: lmsInfo } = useQuery({
    queryKey: ['lms-enrolment'],
    queryFn: async () => (await base44.functions.invoke('getLmsEnrolment', {})).data,
    enabled: canCheckLms,
  });
  const [lmsChecking, setLmsChecking] = useState(false);
  const checkLms = async () => {
    setLmsChecking(true);
    try {
      const r = (await base44.functions.invoke('syncLmsEnrolmentNow', {})).data;
      toast.success(`${r.with_account.toLocaleString()} of ${r.students.toLocaleString()} have a Delta LMS account — ${r.enrolled} now enrolled, ${r.not_enrolled} not enrolled${r.kept_by_hand ? `, ${r.kept_by_hand} kept as set by hand` : ''}`);
      queryClient.invalidateQueries({ queryKey: ['students'] });
      queryClient.invalidateQueries({ queryKey: ['lms-enrolment'] });
    } catch (e) {
      toast.error(e?.message || 'The LMS check did not run');
    } finally {
      setLmsChecking(false);
    }
  };
  const lmsLast = lmsInfo?.last_run;
  const lmsTitle = lmsLast
    ? `Last LMS check ${new Date(lmsLast.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}${lmsLast.ok ? ` — ${lmsLast.with_account} of ${lmsLast.students} have an account` : ` — not run: ${lmsLast.error}`}`
    : 'Enrolled = has a Delta LMS account, checked every hour';

  // Everyone matching the tab and filters (export, "select all") — up to 10,000.
  const fetchAllMatching = async () => {
    const d = (await base44.functions.invoke('listStudents', { tab: serverTab, all: true, filters: listFilters })).data;
    if (d?.truncated) toast.warning(`Only the first ${d.rows.length.toLocaleString()} of ${d.total.toLocaleString()} — narrow the filters`);
    return d?.rows || [];
  };
  const findByEmail = async (email) => (email ? (await base44.functions.invoke('findStudentByEmail', { email })).data?.student : null);

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




  const createMutation = useMutation({
    mutationFn: async (data) => {
      // Check for duplicate email
      const existingStudent = await findByEmail(data.email);
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
      const existingStudent = await findByEmail(data.email);
      if (existingStudent) {
        if (isStudentOf(existingStudent, currentUser.id)) {
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
      setSelected({});
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

  const canCreate = canSubmitStudentRequest(currentUser.app_role) && !salesOnly;
  const isMentor = isMentorUser;
  // Team tab: roles whose visibility is Team (Chief Mentor by default).
  const hasTeamView = getScope(currentUser) === 'downline';
  const isAssistance = currentUser.app_role === 'assistance';
  const isAdmin = ['super_admin', 'broker_admin', 'academic_head'].includes(currentUser.app_role);
  const isSuperAdmin = currentUser.app_role === 'super_admin';
  const newForMe = counts.new_for_me || 0;

  // Tick boxes: a row, this page, or everyone matching (across pages).
  const pageAllSelected = rows.length > 0 && rows.every(s => selected[s.id]);
  const handleSelectAll = (checked) => {
    setSelected(prev => {
      const next = { ...prev };
      for (const s of rows) { if (checked) next[s.id] = s; else delete next[s.id]; }
      return next;
    });
  };
  const handleSelectStudent = (student, checked) => {
    setSelected(prev => {
      const next = { ...prev };
      if (checked) next[student.id] = student; else delete next[student.id];
      return next;
    });
  };
  const selectAllMatching = async () => {
    try {
      const everyone = await fetchAllMatching();
      setSelected(Object.fromEntries(everyone.map(s => [s.id, s])));
    } catch (e) {
      toast.error(e?.message || 'Could not select them all');
    }
  };

  // Get mentor users for bulk import
  const mentorUsers = users.filter(u => 
    ['junior_mentor', 'chief_mentor', 'senior_mentor', 'subjunior_mentor'].includes(u.app_role)
  );

  // The CS filter's choices (every CS among the students they may see).
  const uniqueMentors = listOptions?.mentors || [];

  // This page of the tab — the server applied the search and every filter.
  const displayStudents = rows.map(s => applyStudentMasking(s, currentUser.app_role));
  // Ticked rows for Transfer (any level); Upgrade uses only Level 1.
  const selectedStudents = Object.values(selected);
  const selectedLevel1Students = selectedStudents.filter(s => (s.student_level || 'LEVEL_1') === 'LEVEL_1');
  const emptyText = (text) => (listLoading ? 'Loading students…' : text);
  const pager = (
    <TablePagination page={list?.page || page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} busy={listFetching} />
  );

  const handleBulkUpgrade = () => {
    if (selectedLevel1Students.length === 0) {
      toast.error('No Level 1 students selected');
      return;
    }
    setShowBulkUpgradeDialog(true);
  };
  
  const canEdit = canEditStudent(currentUser.app_role);
  // Row click opens the student; clicks on buttons, links and checkboxes do their own thing.
  const openStudent = (e, id) => {
    if (e.target.closest('button, a, input, [role="checkbox"], [role="menuitem"]')) return;
    navigate(`${createPageUrl('StudentDetail')}?id=${id}`);
  };
  const courseOptions = { courses: listOptions?.courses || [], products: listOptions?.products || [] };
  const teamOptions = listTeams(users);
  const canDelete = canDeleteStudent(currentUser.app_role);
  
  const getStatusColor = (status) => {
    return status === 'ACTIVE' 
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const handleExportStudents = async () => {
    if (total === 0) {
      toast.error('No students to export');
      return;
    }
    // Everyone the tab and filters match, not just this page.
    let filteredStudents;
    try {
      filteredStudents = await fetchAllMatching();
    } catch (e) {
      toast.error(e?.message || 'Could not load the students to export');
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
      ['Student Code', 'Full Name', 'Email', 'Phone', 'Country', 'User ID', 'CS', 'Senior Mentor', 'Team', 'Course', 'Status', 'Enrolment', 'Classes Attended', 'Classes Booked', 'Classes Upcoming', 'Tags', 'Created Date', 'Notes'].join(','),
      ...filteredStudents.map(s => [
        escapeCSV(s.student_code || ''),
        escapeCSV(s.full_name || ''),
        escapeCSV(s.email || ''),
        escapeCSV(s.phone || ''),
        escapeCSV(s.country || ''),
        escapeCSV(s.user_id || ''),
        escapeCSV(s.primary_mentor_name || ''),
        escapeCSV(s.senior_mentor_name || ''),
        escapeCSV(s.team_name || ''),
        escapeCSV(courseLabel(s.lms_course)),
        escapeCSV(s.status || ''),
        escapeCSV(ENROLMENT[enrolmentOf(s)].label),
        escapeCSV(s.lms_classes?.attended ?? ''),
        escapeCSV(s.lms_classes?.booked ?? ''),
        escapeCSV(s.lms_classes?.upcoming ?? ''),
        escapeCSV(tagNamesOf(s).join(', ')),
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
        <PageHeader
          eyebrow="Students"
          title="Students"
          description="Profiles, mentors, levels and funding activity for every student."
          actions={<>
            {canEdit && selectedStudents.length > 0 && (
              <Button onClick={() => setShowTransferDialog(true)}>
                <ArrowRightLeft className="h-4 w-4 mr-2" />
                Transfer {selectedStudents.length}
              </Button>
            )}
            {isSuperAdmin && selectedLevel1Students.length > 0 && (
              <Button 
                onClick={handleBulkUpgrade}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <ArrowUp className="h-4 w-4 mr-2" />
                Upgrade {selectedLevel1Students.length} to Level 2
              </Button>
            )}
            {canCheckLms && lmsInfo?.configured && (
              <Button onClick={checkLms} variant="outline" disabled={lmsChecking} title={lmsTitle}>
                {lmsChecking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Check LMS
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
          </>}
        />

        {/* Search and Filters */}
        <Card className="border-gray-200">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row md:flex-wrap gap-3">
              {/* Search */}
              <div className="relative flex-1 md:min-w-[260px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by name, code, email or phone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* New for you — given to you, not opened yet (the sidebar's count) */}
              {(newForMe > 0 || onlyNew) && (
                <Button type="button" variant={onlyNew ? 'default' : 'outline'}
                  onClick={() => { setOnlyNew(v => !v); if (isMentor) setActiveTab('my'); }}
                  className={onlyNew ? 'bg-emerald-600 hover:bg-emerald-700' : 'border-emerald-600 text-emerald-700 hover:bg-emerald-50'}>
                  <Sparkles className="h-4 w-4 mr-2" />New for you ({newForMe})
                </Button>
              )}

              {/* Tag Filter — everyone, on every tab */}
              <Select value={filterTag} onValueChange={(v) => v && setFilterTag(v)}>
                <SelectTrigger className="w-full md:w-52">
                  <SelectValue placeholder="Tag" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tags</SelectItem>
                  {tagCatalog.filter(t => t.active !== false).map(t => <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>

              {/* Enrolled Filter — everyone, on every tab */}
              <Select value={filterEnrolment} onValueChange={(v) => v && setFilterEnrolment(v)}>
                <SelectTrigger className="w-full md:w-44">
                  <SelectValue placeholder="Enrolled" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Enrolled or not</SelectItem>
                  <SelectItem value="enrolled">Enrolled</SelectItem>
                  <SelectItem value="not_enrolled">Not enrolled</SelectItem>
                </SelectContent>
              </Select>

              {/* Onboarded Filter — everyone, on every tab */}
              <Select value={filterOnboarding} onValueChange={(v) => v && setFilterOnboarding(v)}>
                <SelectTrigger className="w-full md:w-44">
                  <SelectValue placeholder="Onboarded" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Onboarded or not</SelectItem>
                  <SelectItem value="onboarded">Onboarded</SelectItem>
                  <SelectItem value="not_onboarded">Not onboarded</SelectItem>
                </SelectContent>
              </Select>

              {/* LMS classes — everyone, on every tab */}
              <Select value={filterClasses} onValueChange={(v) => v && setFilterClasses(v)}>
                <SelectTrigger className="w-full md:w-44">
                  <SelectValue placeholder="Classes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any classes</SelectItem>
                  <SelectItem value="attended">Attended a class</SelectItem>
                  <SelectItem value="booked">Booked a class</SelectItem>
                  <SelectItem value="upcoming">Upcoming class</SelectItem>
                </SelectContent>
              </Select>

              {/* Course / Product, Balance and Date — everyone, on every tab */}
              <Select value={filterCourse} onValueChange={(v) => v && setFilterCourse(v)}>
                <SelectTrigger className="w-full md:w-52">
                  <SelectValue placeholder="Course / Product" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All courses &amp; products</SelectItem>
                  <SelectItem value="none">No course or product</SelectItem>
                  {courseOptions.courses.map(c => <SelectItem key={'c' + c} value={'course:' + c}>Course · {c}</SelectItem>)}
                  {courseOptions.products.map(p => <SelectItem key={'p' + p} value={'product:' + p}>Product · {p}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={filterBalance} onValueChange={(v) => v && setFilterBalance(v)}>
                <SelectTrigger className="w-full md:w-40">
                  <SelectValue placeholder="Balance" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any balance</SelectItem>
                  <SelectItem value="owing">Has balance</SelectItem>
                  <SelectItem value="paid">Fully paid</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterDateRange} onValueChange={setFilterDateRange}>
                <SelectTrigger className="w-full md:w-40">
                  <SelectValue placeholder="Date added" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Added any time</SelectItem>
                  <SelectItem value="weekly">Last 7 days</SelectItem>
                  <SelectItem value="monthly">Last 30 days</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>
              {filterDateRange === 'custom' && (
                <>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full md:w-36">
                        {customDateFrom ? format(customDateFrom, 'MMM d, yyyy') : 'From date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={customDateFrom} onSelect={setCustomDateFrom} initialFocus />
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full md:w-36">
                        {customDateTo ? format(customDateTo, 'MMM d, yyyy') : 'To date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar mode="single" selected={customDateTo} onSelect={setCustomDateTo} initialFocus />
                    </PopoverContent>
                  </Popover>
                </>
              )}

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



                  {/* Team Filter */}
                  <Select value={filterTeam} onValueChange={setFilterTeam}>
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="Team" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Teams</SelectItem>
                      {teamOptions.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                      <SelectItem value="none">No team</SelectItem>
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

                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tabs for mentors and admins, single table for assistance/others */}
        {isMentor || isAdmin ? (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="flex h-auto w-full max-w-5xl justify-start overflow-x-auto sm:grid" style={{ gridTemplateColumns: isMentor ? (hasTeamView ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr') : (['broker_admin', 'super_admin'].includes(currentUser.app_role) ? '1fr 1fr 1fr 1fr' : (currentUser.app_role === 'academic_head' ? '1fr 1fr' : '1fr')) }}>
              {isMentor && <TabsTrigger value="my">My Students</TabsTrigger>}
              {hasTeamView && <TabsTrigger value="team">Team Students</TabsTrigger>}
              {isMentor && (
                <TabsTrigger value="co_managed" className="flex items-center gap-1">
                  <Share2 className="h-3.5 w-3.5" />
                  Co-Managed ({(counts.co_managed ?? 0).toLocaleString()})
                </TabsTrigger>
              )}

              {isAdmin && <TabsTrigger value="all">All Students</TabsTrigger>}
              {['academic_head', 'broker_admin', 'super_admin'].includes(currentUser.app_role) && (
                <TabsTrigger value="open_pool">Delta Open Students</TabsTrigger>
              )}
              {['broker_admin', 'super_admin'].includes(currentUser.app_role) && (
                <TabsTrigger value="admin_co_managed" className="flex items-center gap-1">
                  <Share2 className="h-3.5 w-3.5" />
                  Co-Managed ({(counts.admin_co_managed ?? 0).toLocaleString()})
                </TabsTrigger>
              )}
            </TabsList>

            {/* My Students Tab (Mentors Only) */}
            {isMentor && (
              <TabsContent value="my">
                <div className="rounded-2xl border border-slate-200/70 bg-white overflow-hidden shadow-soft">
                  <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200">
                    <h3 className="text-lg font-semibold flex items-center gap-2 tracking-tight">
                      <UserCheck className="h-5 w-5 text-blue-600" />
                      My Students ({total.toLocaleString()})
                    </h3>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50">
                        <TableHead className="font-semibold">Student Code</TableHead>
                        <TableHead className="font-semibold">Student</TableHead>
                        <TableHead className="font-semibold">Phone</TableHead>
                        <TableHead className="font-semibold">CS</TableHead>
                        <TableHead className="font-semibold">Team</TableHead>
                      <TableHead className="font-semibold">Course</TableHead>
                      <TableHead className="font-semibold">Balance</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="font-semibold">Enrolled</TableHead>
                        <TableHead className="font-semibold">Onboarded</TableHead>
                      <TableHead className="font-semibold">Classes</TableHead>
                        <TableHead className="font-semibold">Tags</TableHead>
                        <TableHead className="font-semibold">Created</TableHead>
                        <TableHead className="font-semibold text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayStudents.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={14} className="text-center py-8 text-gray-500">
                            {emptyText('No students found')}
                          </TableCell>
                        </TableRow>
                      ) : (
                        displayStudents.map((student) => (
                          <TableRow key={student.id} className="cursor-pointer hover:bg-gray-50 transition-colors" onClick={(e) => openStudent(e, student.id)}>
                            <TableCell className="font-mono text-sm font-medium text-blue-600">
                              {student.student_code}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium text-slate-900">{student.full_name}<NewForYou student={student} me={currentUser.id} /></div>
                              {student.email && <div className="text-xs text-slate-500">{student.email}</div>}
                            </TableCell>
                            <TableCell className="text-sm font-mono">{student.phone}</TableCell>
                            <TableCell className="text-sm">{student.primary_mentor_name}</TableCell>
                            <TableCell className="text-sm">{student.team_name || '-'}</TableCell>
                            <TableCell className="max-w-[220px] text-sm"><CourseCell student={student} /></TableCell>
                            <TableCell><BalanceCell student={student} /></TableCell>
                            <TableCell>
                              <Badge variant="outline" className={getStatusColor(student.status)}>
                                {student.status}
                              </Badge>
                            </TableCell>
                            <TableCell><EnrolledSwitch student={student} currentUser={currentUser} /></TableCell>
                            <TableCell><OnboardedSwitch student={student} currentUser={currentUser} /></TableCell>
                            <TableCell><ClassesCell student={student} /></TableCell>
                            <TableCell><StudentTagChips student={student} catalog={tagCatalog} /></TableCell>
                            <TableCell className="text-sm">
                              {student.created_date ? format(new Date(student.created_date), 'MMM d, yyyy') : '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <CallButton variant="icon" student={student} />
                                <EditDetailsButton student={student} currentUser={currentUser} />
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
                  {pager}
                </div>
              </TabsContent>
            )}

            {/* Team Students Tab (Team visibility, e.g. Chief Mentors) */}
            {hasTeamView && (
            <TabsContent value="team">
              <div className="rounded-2xl border border-slate-200/70 bg-white overflow-hidden shadow-soft">
                <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 border-b border-purple-200">
                  <h3 className="text-lg font-semibold flex items-center gap-2 tracking-tight">
                    <Users className="h-5 w-5 text-purple-600" />
                    Team Students ({total.toLocaleString()})
                  </h3>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="font-semibold">Student Code</TableHead>
                      <TableHead className="font-semibold">Student</TableHead>
                      <TableHead className="font-semibold">Phone</TableHead>
                      <TableHead className="font-semibold">CS</TableHead>
                      <TableHead className="font-semibold">Team</TableHead>
                      <TableHead className="font-semibold">Course</TableHead>
                      <TableHead className="font-semibold">Balance</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold">Enrolled</TableHead>
                      <TableHead className="font-semibold">Onboarded</TableHead>
                      <TableHead className="font-semibold">Classes</TableHead>
                      <TableHead className="font-semibold">Tags</TableHead>
                      <TableHead className="font-semibold">Created</TableHead>
                      <TableHead className="font-semibold text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayStudents.length === 0 ? (
                     <TableRow>
                       <TableCell colSpan={14} className="text-center py-8 text-gray-500">
                         {emptyText('No team students found')}
                       </TableCell>
                     </TableRow>
                    ) : (
                     displayStudents.map((student) => (
                       <TableRow key={student.id} className="cursor-pointer hover:bg-gray-50 transition-colors" onClick={(e) => openStudent(e, student.id)}>
                         <TableCell className="font-mono text-sm font-medium text-blue-600">
                           {student.student_code}
                         </TableCell>
                         <TableCell>
                           <div className="font-medium text-slate-900">{student.full_name}<NewForYou student={student} me={currentUser.id} /></div>
                           {student.email && <div className="text-xs text-slate-500">{student.email}</div>}
                         </TableCell>
                         <TableCell className="text-sm font-mono">{student.phone}</TableCell>
                         <TableCell className="text-sm text-purple-600 font-medium">{student.primary_mentor_name}</TableCell>
                         <TableCell className="text-sm">{student.team_name || '-'}</TableCell>
                            <TableCell className="max-w-[220px] text-sm"><CourseCell student={student} /></TableCell>
                            <TableCell><BalanceCell student={student} /></TableCell>
                         <TableCell>
                           <Badge variant="outline" className={getStatusColor(student.status)}>
                             {student.status}
                           </Badge>
                         </TableCell>
                         <TableCell><EnrolledSwitch student={student} currentUser={currentUser} /></TableCell>
                         <TableCell><OnboardedSwitch student={student} currentUser={currentUser} /></TableCell>
                            <TableCell><ClassesCell student={student} /></TableCell>
                         <TableCell><StudentTagChips student={student} catalog={tagCatalog} /></TableCell>
                         <TableCell className="text-sm">
                           {student.created_date ? format(new Date(student.created_date), 'MMM d, yyyy') : '-'}
                         </TableCell>
                         <TableCell className="text-right">
                           <div className="flex justify-end gap-1">
                             <CallButton variant="icon" student={student} />
                             <EditDetailsButton student={student} currentUser={currentUser} />
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
                {pager}
              </div>
            </TabsContent>
          )}

          {/* All Students Tab (Admins Only) */}
          {isAdmin && (
            <TabsContent value="all">
              <div className="rounded-2xl border border-slate-200/70 bg-white overflow-hidden shadow-soft">
                <div className="p-4 bg-slate-50/70 border-b border-gray-200">
                  <h3 className="text-lg font-semibold flex items-center gap-2 tracking-tight">
                    <Users className="h-5 w-5 text-blue-600" />
                    All Students ({total.toLocaleString()})
                  </h3>
                </div>
                {canEdit && selectedStudents.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-blue-50/60 px-4 py-2 text-sm text-slate-700">
                    <span className="font-medium">{selectedStudents.length.toLocaleString()} selected</span>
                    {pageAllSelected && selectedStudents.length < total && (
                      <button type="button" className="font-medium text-blue-600 hover:underline" onClick={selectAllMatching}>
                        Select all {total.toLocaleString()} matching
                      </button>
                    )}
                    <button type="button" className="text-slate-500 hover:underline" onClick={() => setSelected({})}>Clear</button>
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      {canEdit && (
                        <TableHead className="w-12">
                          <Checkbox
                            checked={pageAllSelected}
                            onCheckedChange={(checked) => handleSelectAll(!!checked)}
                          />
                        </TableHead>
                      )}
                      <TableHead className="font-semibold">Student Code</TableHead>
                      <TableHead className="font-semibold">Student</TableHead>
                      <TableHead className="font-semibold">Phone</TableHead>
                      <TableHead className="font-semibold">CS</TableHead>
                      <TableHead className="font-semibold">Team</TableHead>
                      <TableHead className="font-semibold">Course</TableHead>
                      <TableHead className="font-semibold">Balance</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold">Enrolled</TableHead>
                      <TableHead className="font-semibold">Onboarded</TableHead>
                      <TableHead className="font-semibold">Classes</TableHead>
                      <TableHead className="font-semibold">Tags</TableHead>
                      <TableHead className="font-semibold">Created</TableHead>
                      <TableHead className="font-semibold text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayStudents.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={canEdit ? 15 : 14} className="text-center py-8 text-gray-500">
                          {emptyText('No students found')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayStudents.map((student) => (
                        <TableRow key={student.id} className="cursor-pointer hover:bg-gray-50 transition-colors" onClick={(e) => openStudent(e, student.id)}>
                          {canEdit && (
                            <TableCell>
                              <Checkbox
                                checked={!!selected[student.id]}
                                onCheckedChange={(checked) => handleSelectStudent(student, !!checked)}
                              />
                            </TableCell>
                          )}
                          <TableCell className="font-mono text-sm font-medium text-blue-600">
                            {student.student_code}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-slate-900">{student.full_name}<NewForYou student={student} me={currentUser.id} /></div>
                            {student.email && <div className="text-xs text-slate-500">{student.email}</div>}
                          </TableCell>
                          <TableCell className="text-sm font-mono">{student.phone}</TableCell>
                          <TableCell className="text-sm">{student.primary_mentor_name}</TableCell>
                          <TableCell className="text-sm">{student.team_name || '-'}</TableCell>
                            <TableCell className="max-w-[220px] text-sm"><CourseCell student={student} /></TableCell>
                            <TableCell><BalanceCell student={student} /></TableCell>
                          <TableCell>
                            <Badge variant="outline" className={getStatusColor(student.status)}>
                              {student.status}
                            </Badge>
                          </TableCell>
                          <TableCell><EnrolledSwitch student={student} currentUser={currentUser} /></TableCell>
                          <TableCell><OnboardedSwitch student={student} currentUser={currentUser} /></TableCell>
                            <TableCell><ClassesCell student={student} /></TableCell>
                          <TableCell><StudentTagChips student={student} catalog={tagCatalog} /></TableCell>
                          <TableCell className="text-sm">
                            {student.created_date ? format(new Date(student.created_date), 'MMM d, yyyy') : '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <CallButton variant="icon" student={student} />
                              <EditDetailsButton student={student} currentUser={currentUser} />
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
                {pager}
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
                    Co-Managed Clients ({total.toLocaleString()})
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Clients where you are a co-mentor. Commission is attributed to your deposits only.</p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="font-semibold">Client Name</TableHead>
                      <TableHead className="font-semibold">Code</TableHead>
                      <TableHead className="font-semibold">CS</TableHead>
                      <TableHead className="font-semibold">Team</TableHead>
                      <TableHead className="font-semibold">Course</TableHead>
                      <TableHead className="font-semibold">Balance</TableHead>
                      <TableHead className="font-semibold">Enrolled</TableHead>
                      <TableHead className="font-semibold">Onboarded</TableHead>
                      <TableHead className="font-semibold">Classes</TableHead>
                      <TableHead className="font-semibold">Tags</TableHead>
                      <TableHead className="font-semibold">My Net Deposits</TableHead>
                      <TableHead className="font-semibold">Primary Net Deposits</TableHead>
                      <TableHead className="font-semibold">Combined Total</TableHead>
                      <TableHead className="font-semibold">Co-Mentor Since</TableHead>
                      <TableHead className="font-semibold text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayStudents.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={15} className="text-center py-8 text-gray-500">
                          {emptyText('No co-managed clients yet. Send a referral request from a Fund Request to get started.')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayStudents.map((student) => {
        const _coMentors = Array.isArray(student.co_mentors_details)
          ? student.co_mentors_details
          : (() => { try { return JSON.parse(student.co_mentors_details || '[]'); } catch(_) { return []; } })();
        const myNet = _coMentors.find(cm => cm.mentor_id === currentUser?.id)?.net_deposit_contribution_usd || 0;
        const combinedNet = _coMentors.reduce((sum, cm) => sum + (cm.net_deposit_contribution_usd || 0), 0);
        const primaryNet = combinedNet - myNet;
        const myEntry = _coMentors.find(cm => cm.mentor_id === currentUser?.id);
                        return (
                          <TableRow key={student.id} className="cursor-pointer hover:bg-gray-50 transition-colors" onClick={(e) => openStudent(e, student.id)}>
                            <TableCell className="font-medium">{student.full_name}<NewForYou student={student} me={currentUser.id} /></TableCell>
                            <TableCell className="font-mono text-sm text-blue-600">{student.student_code || '-'}</TableCell>
                            <TableCell className="text-sm">{student.primary_mentor_name}</TableCell>
                            <TableCell className="text-sm">{student.team_name || '-'}</TableCell>
                            <TableCell className="max-w-[220px] text-sm"><CourseCell student={student} /></TableCell>
                            <TableCell><BalanceCell student={student} /></TableCell>
                            <TableCell><EnrolledSwitch student={student} currentUser={currentUser} /></TableCell>
                            <TableCell><OnboardedSwitch student={student} currentUser={currentUser} /></TableCell>
                            <TableCell><ClassesCell student={student} /></TableCell>
                            <TableCell><StudentTagChips student={student} catalog={tagCatalog} /></TableCell>
                            <TableCell className="text-sm font-semibold text-green-700">${myNet.toLocaleString()}</TableCell>
                            <TableCell className="text-sm text-gray-600">${primaryNet.toLocaleString()}</TableCell>
                            <TableCell className="text-sm font-semibold">${combinedNet.toLocaleString()}</TableCell>
                            <TableCell className="text-sm text-gray-500">
                              {myEntry?.since ? format(new Date(myEntry.since), 'MMM d, yyyy') : '-'}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <CallButton variant="icon" student={student} />
                                <EditDetailsButton student={student} currentUser={currentUser} />
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
                {pager}
              </div>
            </TabsContent>
          )}


          {/* Open Pool Students Tab */}
          <TabsContent value="open_pool">
            <div className="rounded-2xl border border-slate-200/70 bg-white overflow-hidden shadow-soft">
              <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-200">
                <h3 className="text-lg font-semibold flex items-center gap-2 tracking-tight">
                  <Users className="h-5 w-5 text-green-600" />
                  Delta Open Students ({total.toLocaleString()})
                </h3>
                <p className="text-sm text-gray-600 mt-1">Students available for mentor assignment</p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold">Student Code</TableHead>
                    <TableHead className="font-semibold">Student</TableHead>
                    <TableHead className="font-semibold">Phone</TableHead>
                      <TableHead className="font-semibold">Course</TableHead>
                      <TableHead className="font-semibold">Balance</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">Enrolled</TableHead>
                    <TableHead className="font-semibold">Onboarded</TableHead>
                      <TableHead className="font-semibold">Classes</TableHead>
                    <TableHead className="font-semibold">Tags</TableHead>
                    <TableHead className="font-semibold">Created</TableHead>
                    <TableHead className="font-semibold text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayStudents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={12} className="text-center py-8 text-gray-500">
                        {emptyText('No open pool students available')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    displayStudents.map((student) => (
                      <TableRow key={student.id} className="cursor-pointer hover:bg-gray-50 transition-colors" onClick={(e) => openStudent(e, student.id)}>
                        <TableCell className="font-mono text-sm font-medium text-blue-600">
                          {student.student_code}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-slate-900">{student.full_name}<NewForYou student={student} me={currentUser.id} /></div>
                          {student.email && <div className="text-xs text-slate-500">{student.email}</div>}
                        </TableCell>
                        <TableCell className="text-sm font-mono">{student.phone}</TableCell>
                            <TableCell className="max-w-[220px] text-sm"><CourseCell student={student} /></TableCell>
                            <TableCell><BalanceCell student={student} /></TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getStatusColor(student.status)}>
                            {student.status}
                          </Badge>
                        </TableCell>
                        <TableCell><EnrolledSwitch student={student} currentUser={currentUser} /></TableCell>
                        <TableCell><OnboardedSwitch student={student} currentUser={currentUser} /></TableCell>
                            <TableCell><ClassesCell student={student} /></TableCell>
                        <TableCell><StudentTagChips student={student} catalog={tagCatalog} /></TableCell>
                        <TableCell className="text-sm">
                          {student.created_date ? format(new Date(student.created_date), 'MMM d, yyyy') : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <CallButton variant="icon" student={student} />
                            <EditDetailsButton student={student} currentUser={currentUser} />
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
              {pager}
            </div>
          </TabsContent>

          {/* Admin Co-Managed Tab */}
          {['broker_admin', 'super_admin'].includes(currentUser.app_role) && (
            <TabsContent value="admin_co_managed">
              <div className="rounded-xl border border-purple-200 bg-white overflow-hidden">
                <div className="p-4 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-200">
                  <h3 className="text-lg font-semibold flex items-center gap-2 tracking-tight">
                    <Share2 className="h-5 w-5 text-purple-600" />
                    Co-Managed Clients ({total.toLocaleString()})
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">All co-managed client relationships across all mentors</p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="font-semibold">Client Name</TableHead>
                      <TableHead className="font-semibold">Code</TableHead>
                      <TableHead className="font-semibold">CS</TableHead>
                      <TableHead className="font-semibold">Team</TableHead>
                      <TableHead className="font-semibold">Course</TableHead>
                      <TableHead className="font-semibold">Balance</TableHead>
                      <TableHead className="font-semibold">Co-Mentor</TableHead>
                      <TableHead className="font-semibold">Primary Net Deposits</TableHead>
                      <TableHead className="font-semibold">Co-Mentor Net Deposits</TableHead>
                      <TableHead className="font-semibold">Combined Total</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold">Enrolled</TableHead>
                      <TableHead className="font-semibold">Onboarded</TableHead>
                      <TableHead className="font-semibold">Classes</TableHead>
                      <TableHead className="font-semibold">Tags</TableHead>
                      <TableHead className="font-semibold">Co-Mentor Since</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayStudents.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={16} className="text-center py-8 text-gray-500">
                          {emptyText('No co-managed clients found')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayStudents.flatMap((student) => {
                        let coMentors = [];
                        try { coMentors = JSON.parse(student.co_mentors_details || '[]'); } catch (_) {}
                        return coMentors.map((co, idx) => {
                          const combined = student.net_deposit_usd || 0;
                          const coNet = co.net_deposit_contribution_usd || 0;
                          const primaryNet = Math.max(0, combined - coNet);
                          return (
                            <TableRow key={`${student.id}-${idx}`} className="cursor-pointer hover:bg-gray-50 transition-colors" onClick={(e) => openStudent(e, student.id)}>
                              <TableCell className="font-medium">{student.full_name}<NewForYou student={student} me={currentUser.id} /></TableCell>
                              <TableCell className="font-mono text-sm text-blue-600">{student.student_code || '-'}</TableCell>
                              <TableCell className="text-sm">{student.primary_mentor_name}</TableCell>
                              <TableCell className="text-sm">{student.team_name || '-'}</TableCell>
                            <TableCell className="max-w-[220px] text-sm"><CourseCell student={student} /></TableCell>
                            <TableCell><BalanceCell student={student} /></TableCell>
                              <TableCell className="text-sm font-medium text-purple-700">{co.mentor_name}</TableCell>
                              <TableCell className="text-sm text-gray-700">${primaryNet.toLocaleString()}</TableCell>
                              <TableCell className="text-sm font-semibold text-green-700">${coNet.toLocaleString()}</TableCell>
                              <TableCell className="text-sm font-semibold">${combined.toLocaleString()}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={getStatusColor(student.status)}>
                                  {student.status}
                                </Badge>
                              </TableCell>
                              <TableCell><EnrolledSwitch student={student} currentUser={currentUser} /></TableCell>
                              <TableCell><OnboardedSwitch student={student} currentUser={currentUser} /></TableCell>
                            <TableCell><ClassesCell student={student} /></TableCell>
                              <TableCell><StudentTagChips student={student} catalog={tagCatalog} /></TableCell>
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
                {pager}
              </div>
            </TabsContent>
          )}
          </Tabs>
        ) : (
          /* One table — every student they may see; for the Sales role, the ones they closed */
          <div className="rounded-2xl border border-slate-200/70 bg-white overflow-hidden shadow-soft">
            <div className="p-4 bg-slate-50/70 border-b border-gray-200">
              <h3 className="text-lg font-semibold flex items-center gap-2 tracking-tight">
                <Users className="h-5 w-5 text-blue-600" />
                {salesOnly ? 'Students You Closed' : 'All Students'} ({total.toLocaleString()})
              </h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="font-semibold">Student Code</TableHead>
                  <TableHead className="font-semibold">Student</TableHead>
                  <TableHead className="font-semibold">Phone</TableHead>
                  <TableHead className="font-semibold">CS</TableHead>
                  <TableHead className="font-semibold">Team</TableHead>
                      <TableHead className="font-semibold">Course</TableHead>
                      <TableHead className="font-semibold">Balance</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">Enrolled</TableHead>
                  <TableHead className="font-semibold">Onboarded</TableHead>
                      <TableHead className="font-semibold">Classes</TableHead>
                  <TableHead className="font-semibold">Tags</TableHead>
                  <TableHead className="font-semibold">Created</TableHead>
                  <TableHead className="font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayStudents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={14} className="text-center py-8 text-gray-500">
                      {emptyText('No students found')}
                    </TableCell>
                  </TableRow>
                ) : (
                  displayStudents.map((student) => (
                    <TableRow key={student.id} className="cursor-pointer hover:bg-gray-50 transition-colors" onClick={(e) => openStudent(e, student.id)}>
                      <TableCell className="font-mono text-sm font-medium text-blue-600">
                        {student.student_code}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-slate-900">{student.full_name}<NewForYou student={student} me={currentUser.id} /></div>
                        {student.email && <div className="text-xs text-slate-500">{student.email}</div>}
                      </TableCell>
                      <TableCell className="text-sm font-mono">{student.phone}</TableCell>
                      <TableCell className="text-sm">{student.primary_mentor_name}</TableCell>
                      <TableCell className="text-sm">{student.team_name || '-'}</TableCell>
                            <TableCell className="max-w-[220px] text-sm"><CourseCell student={student} /></TableCell>
                            <TableCell><BalanceCell student={student} /></TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getStatusColor(student.status)}>
                          {student.status}
                        </Badge>
                      </TableCell>
                      <TableCell><EnrolledSwitch student={student} currentUser={currentUser} /></TableCell>
                      <TableCell><OnboardedSwitch student={student} currentUser={currentUser} /></TableCell>
                            <TableCell><ClassesCell student={student} /></TableCell>
                      <TableCell><StudentTagChips student={student} catalog={tagCatalog} /></TableCell>
                      <TableCell className="text-sm">
                        {student.created_date ? format(new Date(student.created_date), 'MMM d, yyyy') : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <CallButton variant="icon" student={student} />
                          <EditDetailsButton student={student} currentUser={currentUser} />
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
            {pager}
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

        {/* Transfer to team / CS */}
        <TransferStudentsDialog
          open={showTransferDialog}
          onOpenChange={setShowTransferDialog}
          students={selectedStudents}
          users={users}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ['students'] });
            setSelected({});
          }}
        />

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