import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Shield, Search, Filter, Calendar } from "lucide-react";
import { format } from "date-fns";

export default function AuditLogs() {
  const [currentUser, setCurrentUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');

  useEffect(() => {
    const fetchUser = async () => {
      const user = await base44.auth.me();
      if (!['super_admin', 'admin_supervisor'].includes(user.app_role)) {
        window.location.href = '/';
        return;
      }
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const { data: logs = [] } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => base44.entities.Log.list('-timestamp', 500),
    enabled: !!currentUser
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    enabled: !!currentUser
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

  // Filter logs
  let filteredLogs = logs;

  // Search filter
  if (searchTerm) {
    filteredLogs = filteredLogs.filter(log =>
      log.user_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.action_type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.entity_type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.details?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }

  // Action type filter
  if (actionFilter !== 'all') {
    filteredLogs = filteredLogs.filter(log => log.action_type === actionFilter);
  }

  // User filter
  if (userFilter !== 'all') {
    filteredLogs = filteredLogs.filter(log => log.user_id === userFilter);
  }
  
  // Admin Supervisor can only see logs from academic_admin users
  if (currentUser.app_role === 'admin_supervisor') {
    filteredLogs = filteredLogs.filter(log => log.user_role === 'academic_admin');
  }

  // Date filter
  if (dateFilter !== 'all') {
    const now = new Date();
    const filterDate = new Date();
    
    if (dateFilter === 'today') {
      filterDate.setHours(0, 0, 0, 0);
    } else if (dateFilter === 'week') {
      filterDate.setDate(now.getDate() - 7);
    } else if (dateFilter === 'month') {
      filterDate.setMonth(now.getMonth() - 1);
    }

    filteredLogs = filteredLogs.filter(log => 
      new Date(log.timestamp) >= filterDate
    );
  }

  // Get unique action types from logs
  const actionTypes = [...new Set(logs.map(log => log.action_type))].filter(Boolean).sort();

  const getActionColor = (actionType) => {
    if (actionType?.includes('login')) return 'bg-blue-100 text-blue-800 border-blue-200';
    if (actionType?.includes('logout')) return 'bg-gray-100 text-gray-800 border-gray-200';
    if (actionType?.includes('create')) return 'bg-green-100 text-green-800 border-green-200';
    if (actionType?.includes('update')) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    if (actionType?.includes('delete')) return 'bg-red-100 text-red-800 border-red-200';
    if (actionType?.includes('approve')) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (actionType?.includes('reject')) return 'bg-orange-100 text-orange-800 border-orange-200';
    return 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getSuccessColor = (success) => {
    return success 
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : 'bg-red-100 text-red-800 border-red-200';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
              <Shield className="h-8 w-8 text-red-600" />
              Audit Logs
            </h1>
            <p className="text-gray-600 mt-2 text-base">Complete system activity and security audit trail</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="border-none bg-gradient-to-br from-blue-100 to-indigo-100 shadow-lg">
            <CardContent className="p-5">
              <div className="text-sm font-semibold uppercase tracking-wider text-gray-700">Total Events</div>
              <div className="text-3xl font-bold text-blue-700 mt-1">{logs.length}</div>
            </CardContent>
          </Card>

          <Card className="border-none bg-gradient-to-br from-green-100 to-emerald-100 shadow-lg">
            <CardContent className="p-5">
              <div className="text-sm font-semibold uppercase tracking-wider text-gray-700">Successful Actions</div>
              <div className="text-3xl font-bold text-green-700 mt-1">
                {logs.filter(l => l.success !== false).length}
              </div>
            </CardContent>
          </Card>

          <Card className="border-none bg-gradient-to-br from-red-100 to-pink-100 shadow-lg">
            <CardContent className="p-5">
              <div className="text-sm font-semibold uppercase tracking-wider text-gray-700">Failed Actions</div>
              <div className="text-3xl font-bold text-red-700 mt-1">
                {logs.filter(l => l.success === false).length}
              </div>
            </CardContent>
          </Card>

          <Card className="border-none bg-gradient-to-br from-purple-100 to-pink-100 shadow-lg">
            <CardContent className="p-5">
              <div className="text-sm font-semibold uppercase tracking-wider text-gray-700">Unique Users</div>
              <div className="text-3xl font-bold text-purple-700 mt-1">
                {new Set(logs.map(l => l.user_id)).size}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
            <CardTitle className="text-lg font-semibold tracking-tight flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search logs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Action Type Filter */}
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  {actionTypes.map(action => (
                    <SelectItem key={action} value={action}>
                      {action.replace(/_/g, ' ').toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* User Filter */}
              <Select value={userFilter} onValueChange={setUserFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  {users.map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.full_name} ({user.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Date Filter */}
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Time" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">Last 7 Days</SelectItem>
                  <SelectItem value="month">Last 30 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
            <CardTitle className="text-lg font-semibold tracking-tight">
              Activity Log ({filteredLogs.length} events)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold">Timestamp</TableHead>
                    <TableHead className="font-semibold">User</TableHead>
                    <TableHead className="font-semibold">Role</TableHead>
                    <TableHead className="font-semibold">Action</TableHead>
                    <TableHead className="font-semibold">Entity</TableHead>
                    <TableHead className="font-semibold">Details</TableHead>
                    <TableHead className="font-semibold">IP Address</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                        No audit logs found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredLogs.map((log) => (
                      <TableRow key={log.id} className="hover:bg-gray-50 transition-colors">
                        <TableCell className="text-sm font-mono">
                          {log.timestamp ? format(new Date(log.timestamp), 'MMM d, yyyy HH:mm:ss') : '-'}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div className="font-medium">{log.user_name}</div>
                            <div className="text-gray-500 text-xs">{log.user_email}</div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <Badge variant="outline" className="bg-gray-100 text-gray-800 border-gray-200">
                            {log.user_role?.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getActionColor(log.action_type)}>
                            {log.action_type?.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {log.entity_type || '-'}
                          {log.entity_id && (
                            <div className="text-xs text-gray-500 font-mono">
                              {log.entity_id.substring(0, 8)}...
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm max-w-xs">
                          <div className="truncate" title={log.details}>
                            {log.details || '-'}
                          </div>
                          {log.error_message && (
                            <div className="text-xs text-red-600 mt-1">
                              Error: {log.error_message}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-mono">
                          {log.ip_address || '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getSuccessColor(log.success !== false)}>
                            {log.success !== false ? 'Success' : 'Failed'}
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
      </div>
    </div>
  );
}