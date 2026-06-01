import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, Calendar, Clock, User, BookOpen, ChevronDown, ChevronUp, LayoutList, GitBranch } from "lucide-react";
import { format, isWithinInterval, parseISO } from "date-fns";
import { getEffectiveUser } from "../components/utils/ImpersonationContext";
import { TAB_COLORS } from "../components/studentlogs/StudentLogHistoryUtils";
import SearchableStudentSelect from "../components/common/SearchableStudentSelect";

const ADMIN_ROLES = ['super_admin', 'academic_head', 'academic_admin', 'admin_supervisor'];
const ALL_TABS = ['Contact', 'Basic Info', 'Payment', 'Induction', 'Academic', 'Upgrade', 'Convocation', 'Traders Day', 'Live Trade', 'SSF', 'Rejoining', 'Seminar', 'Practice Tracking', 'Feedback & Review', 'Pips Craft', 'Trading'];
const ALL_ROLES = ['super_admin', 'academic_head', 'academic_admin', 'admin_supervisor', 'junior_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance', 'broker_admin'];

function FieldChangesDetail({ fieldsChanged }) {
  const [expanded, setExpanded] = useState(false);
  let changes = [];
  try { changes = JSON.parse(fieldsChanged || '[]'); } catch {}
  if (!changes.length) return <span className="text-gray-400 text-xs">No field details</span>;

  const displayed = expanded ? changes : changes.slice(0, 3);

  return (
    <div>
      <div className="space-y-1">
        {displayed.map((c, i) => (
          <div key={i} className="text-xs bg-gray-50 rounded p-1.5 border border-gray-100">
            <span className="font-medium text-gray-700">{c.field.replace(/_/g, ' ')}</span>
            {c.oldValue !== '' && c.oldValue !== undefined && (
              <span className="text-red-500 ml-1 line-through">{String(c.oldValue).substring(0, 40)}</span>
            )}
            <span className="text-green-600 ml-1">→ {String(c.newValue).substring(0, 40)}</span>
          </div>
        ))}
      </div>
      {changes.length > 3 && (
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-blue-600 hover:underline mt-1 flex items-center gap-1">
          {expanded ? <><ChevronUp className="h-3 w-3" /> Show less</> : <><ChevronDown className="h-3 w-3" /> +{changes.length - 3} more fields</>}
        </button>
      )}
    </div>
  );
}

function TimelineView({ entries, students }) {
  const [selectedStudentId, setSelectedStudentId] = useState('');
  
  const studentEntries = useMemo(() => {
    if (!selectedStudentId) return [];
    return entries
      .filter(e => e.student_id === selectedStudentId)
      .sort((a, b) => new Date(b.entry_timestamp) - new Date(a.entry_timestamp));
  }, [entries, selectedStudentId]);

  const groupedByDate = useMemo(() => {
    const groups = {};
    studentEntries.forEach(e => {
      const dateKey = e.entry_timestamp ? format(new Date(e.entry_timestamp), 'yyyy-MM-dd') : 'Unknown';
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(e);
    });
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [studentEntries]);

  return (
    <div className="space-y-4">
      <div className="max-w-sm">
        <SearchableStudentSelect
          students={students}
          value={selectedStudentId}
          onValueChange={setSelectedStudentId}
          label="Select Student for Timeline"
          placeholder="Choose a student..."
        />
      </div>

      {!selectedStudentId && (
        <div className="text-center py-12 text-gray-500">
          <GitBranch className="h-12 w-12 mx-auto mb-3 text-gray-300" />
          <p>Select a student to view their full log timeline</p>
        </div>
      )}

      {selectedStudentId && studentEntries.length === 0 && (
        <div className="text-center py-12 text-gray-500">No history entries found for this student.</div>
      )}

      {groupedByDate.map(([date, dayEntries]) => (
        <div key={date} className="relative">
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
              {format(new Date(date), 'MMM d, yyyy')}
            </div>
            <div className="text-xs text-gray-500">{dayEntries.length} update{dayEntries.length > 1 ? 's' : ''}</div>
          </div>
          <div className="ml-4 border-l-2 border-blue-100 pl-6 space-y-3">
            {dayEntries.map((entry, i) => (
              <div key={entry.id || i} className="relative">
                <div className="absolute -left-8 top-3 w-3 h-3 rounded-full bg-blue-400 border-2 border-white" />
                <Card className="border border-gray-100 shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-gray-800">{entry.updated_by_name}</span>
                        <Badge variant="outline" className="text-xs">{entry.updated_by_role?.replace(/_/g, ' ')}</Badge>
                        <Badge className={`text-xs ${entry.action_type === 'created' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                          {entry.action_type}
                        </Badge>
                      </div>
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {entry.entry_timestamp ? format(new Date(entry.entry_timestamp), 'HH:mm') : '-'}
                      </span>
                    </div>
                    {entry.tab_section && entry.tab_section !== 'All' && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {entry.tab_section.split(', ').map(tab => (
                          <span key={tab} className={`px-2 py-0.5 rounded-full text-xs font-medium ${TAB_COLORS[tab] || 'bg-gray-100 text-gray-800'}`}>{tab}</span>
                        ))}
                      </div>
                    )}
                    <FieldChangesDetail fieldsChanged={entry.fields_changed} />
                    {entry.contact_history_snapshot && (
                      <div className="mt-2 bg-blue-50 rounded p-2 border border-blue-100">
                        <p className="text-xs font-semibold text-blue-700 mb-0.5">Contact Notes:</p>
                        <p className="text-xs text-gray-700 line-clamp-3">{entry.contact_history_snapshot}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StudentLogHistoryPage() {
  const [currentUser, setCurrentUser] = useState(null);
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'timeline'
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStudent, setFilterStudent] = useState('');
  const [filterStaff, setFilterStaff] = useState('all');
  const [filterTab, setFilterTab] = useState('all');
  const [filterRole, setFilterRole] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);

  useEffect(() => {
    const fetchUser = async () => {
      const realUser = await base44.auth.me();
      setCurrentUser(getEffectiveUser(realUser));
    };
    fetchUser();
  }, []);

  const isAdmin = currentUser && ADMIN_ROLES.includes(currentUser.app_role);

  const { data: allEntries = [] } = useQuery({
    queryKey: ['student-log-history'],
    queryFn: () => base44.entities.StudentLogHistory.list('-created_date'),
    enabled: !!currentUser
  });

  const { data: students = [] } = useQuery({
    queryKey: ['students'],
    queryFn: () => base44.entities.Student.list(),
    enabled: !!currentUser
  });

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  // Role-based visibility
  let visibleEntries = allEntries;
  if (!isAdmin) {
    visibleEntries = allEntries.filter(e => e.updated_by_id === currentUser.id);
  }

  // Apply filters
  let filtered = visibleEntries;

  if (searchTerm) {
    const t = searchTerm.toLowerCase();
    filtered = filtered.filter(e =>
      e.student_name?.toLowerCase().includes(t) ||
      e.student_code?.toLowerCase().includes(t) ||
      e.updated_by_name?.toLowerCase().includes(t)
    );
  }
  if (filterStudent) {
    filtered = filtered.filter(e => e.student_id === filterStudent);
  }
  if (filterStaff !== 'all') {
    filtered = filtered.filter(e => e.updated_by_id === filterStaff);
  }
  if (filterTab !== 'all') {
    filtered = filtered.filter(e => e.tab_section?.includes(filterTab));
  }
  if (filterRole !== 'all') {
    filtered = filtered.filter(e => e.updated_by_role === filterRole);
  }
  if (filterDateFrom) {
    filtered = filtered.filter(e => e.entry_timestamp && new Date(e.entry_timestamp) >= new Date(filterDateFrom));
  }
  if (filterDateTo) {
    filtered = filtered.filter(e => e.entry_timestamp && new Date(e.entry_timestamp) <= new Date(filterDateTo + 'T23:59:59'));
  }

  // Get unique staff for filter
  const uniqueStaff = [...new Map(allEntries.map(e => [e.updated_by_id, { id: e.updated_by_id, name: e.updated_by_name }])).values()];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Student Log History</h1>
            <p className="text-gray-600 mt-1">Complete audit trail of all student log activities</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={viewMode === 'table' ? 'default' : 'outline'}
              onClick={() => setViewMode('table')}
              className={viewMode === 'table' ? 'bg-blue-600 hover:bg-blue-700' : ''}
            >
              <LayoutList className="h-4 w-4 mr-2" />
              Table View
            </Button>
            <Button
              variant={viewMode === 'timeline' ? 'default' : 'outline'}
              onClick={() => setViewMode('timeline')}
              className={viewMode === 'timeline' ? 'bg-blue-600 hover:bg-blue-700' : ''}
            >
              <GitBranch className="h-4 w-4 mr-2" />
              Timeline View
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className="border-gray-200">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              <div className="relative xl:col-span-2">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search student name, code, or staff..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              <SearchableStudentSelect
                students={students}
                value={filterStudent}
                onValueChange={setFilterStudent}
                placeholder="All Students"
                label=""
                allowNone
              />

              {isAdmin && (
                <Select value={filterStaff} onValueChange={setFilterStaff}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Staff" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Staff</SelectItem>
                    {uniqueStaff.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select value={filterTab} onValueChange={setFilterTab}>
                <SelectTrigger>
                  <SelectValue placeholder="All Sections" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sections</SelectItem>
                  {ALL_TABS.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {isAdmin && (
                <Select value={filterRole} onValueChange={setFilterRole}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Roles" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    {ALL_ROLES.map(r => (
                      <SelectItem key={r} value={r}>{r.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <div className="flex gap-2 items-center">
                <Input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  placeholder="From"
                  className="text-sm"
                />
                <span className="text-gray-400 text-sm">–</span>
                <Input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  placeholder="To"
                  className="text-sm"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Content */}
        {viewMode === 'timeline' ? (
          <TimelineView entries={filtered} students={students} />
        ) : (
          <Card className="border-gray-200">
            <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
              <CardTitle className="text-lg font-semibold">
                Log Entries ({filtered.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="font-semibold">Date & Time</TableHead>
                      <TableHead className="font-semibold">Student</TableHead>
                      <TableHead className="font-semibold">Updated By</TableHead>
                      <TableHead className="font-semibold">Section(s)</TableHead>
                      <TableHead className="font-semibold">Fields Changed</TableHead>
                      <TableHead className="font-semibold">Contact Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-10 text-gray-500">No history entries found</td>
                      </tr>
                    ) : (
                      filtered.map((entry) => {
                        let changesCount = 0;
                        try { changesCount = JSON.parse(entry.fields_changed || '[]').length; } catch {}
                        const isExpanded = expandedRow === entry.id;

                        return (
                          <TableRow key={entry.id} className="hover:bg-gray-50 transition-colors align-top">
                            <TableCell className="text-sm whitespace-nowrap">
                              <div className="flex items-center gap-1 text-gray-600">
                                <Calendar className="h-3 w-3" />
                                {entry.entry_timestamp ? format(new Date(entry.entry_timestamp), 'MMM d, yyyy') : '-'}
                              </div>
                              <div className="flex items-center gap-1 text-gray-400 text-xs mt-0.5">
                                <Clock className="h-3 w-3" />
                                {entry.entry_timestamp ? format(new Date(entry.entry_timestamp), 'HH:mm') : ''}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium text-sm">{entry.student_name}</div>
                              <div className="text-xs text-blue-600 font-mono">{entry.student_code}</div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <User className="h-3 w-3 text-gray-400" />
                                <span className="text-sm font-medium">{entry.updated_by_name}</span>
                              </div>
                              <Badge variant="outline" className="text-xs mt-1">
                                {entry.updated_by_role?.replace(/_/g, ' ')}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {entry.action_type === 'created' ? (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">New Entry</span>
                              ) : (
                                <div className="flex flex-wrap gap-1 max-w-[180px]">
                                  {(entry.tab_section || '').split(', ').filter(Boolean).map(tab => (
                                    <span key={tab} className={`px-2 py-0.5 rounded-full text-xs font-medium ${TAB_COLORS[tab] || 'bg-gray-100 text-gray-800'}`}>{tab}</span>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="max-w-xs">
                              {changesCount === 0 ? (
                                <span className="text-xs text-gray-400">—</span>
                              ) : (
                                <>
                                  <button
                                    onClick={() => setExpandedRow(isExpanded ? null : entry.id)}
                                    className="text-xs text-blue-600 hover:underline flex items-center gap-1 mb-1"
                                  >
                                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                    {changesCount} field{changesCount !== 1 ? 's' : ''} changed
                                  </button>
                                  {isExpanded && <FieldChangesDetail fieldsChanged={entry.fields_changed} />}
                                </>
                              )}
                            </TableCell>
                            <TableCell className="max-w-xs">
                              {entry.contact_history_snapshot ? (
                                <p className="text-xs text-gray-600 line-clamp-3">{entry.contact_history_snapshot}</p>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
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
        )}
      </div>
    </div>
  );
}