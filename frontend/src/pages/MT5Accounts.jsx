import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, CheckCircle } from "lucide-react";
import { filterStudentsByRole } from "../components/utils/StudentAccessControl";
import { Link } from "react-router-dom";
import { createPageUrl } from "../utils";
import { format } from "date-fns";

export default function MT5Accounts() {
  const [currentUser, setCurrentUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchUser = async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const { data: mt5Accounts = [] } = useQuery({
    queryKey: ['mt5accounts'],
    queryFn: () => base44.entities.MT5Account.list('-created_date'),
    enabled: !!currentUser
  });

  const { data: students = [] } = useQuery({
    queryKey: ['students'],
    queryFn: () => base44.entities.Student.list(),
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

  // Filter students based on role
  const accessibleStudents = filterStudentsByRole(students, currentUser, users);
  const accessibleStudentIds = accessibleStudents.map(s => s.id);

  // Filter MT5 accounts based on accessible students
  let filteredAccounts = mt5Accounts.filter(acc => 
    accessibleStudentIds.includes(acc.student_id)
  );

  // Apply search filter
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    const has = (v) => v != null && String(v).toLowerCase().includes(q);
    filteredAccounts = filteredAccounts.filter(acc =>
      has(acc.mt5_login) ||
      has(acc.student_name) ||
      has(acc.student_code)
    );
  }

  const getPlatformColor = (platform) => {
    return platform === 'MT5' 
      ? 'bg-blue-100 text-blue-800 border-blue-200'
      : 'bg-purple-100 text-purple-800 border-purple-200';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">MT5 Accounts</h1>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search by MT5 login, student name, or student code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white/80 backdrop-blur-sm rounded-xl border-none shadow-lg p-5">
            <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">Total Accounts</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{filteredAccounts.length}</p>
          </div>
          <div className="border-none bg-gradient-to-br from-blue-100 to-indigo-100 rounded-xl shadow-lg p-5">
            <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">MT5 Accounts</p>
            <p className="text-3xl font-bold text-blue-700 mt-1">
              {filteredAccounts.filter(a => a.platform === 'MT5').length}
            </p>
          </div>
          <div className="border-none bg-gradient-to-br from-purple-100 to-pink-100 rounded-xl shadow-lg p-5">
            <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">MT4 Accounts</p>
            <p className="text-3xl font-bold text-purple-700 mt-1">
              {filteredAccounts.filter(a => a.platform === 'MT4').length}
            </p>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="font-semibold">MT5 Login</TableHead>
                <TableHead className="font-semibold">Student Name</TableHead>
                <TableHead className="font-semibold">Student Code</TableHead>
                <TableHead className="font-semibold">Platform</TableHead>
                <TableHead className="font-semibold">Account Type</TableHead>
                <TableHead className="font-semibold">Currency</TableHead>
                <TableHead className="font-semibold">Primary</TableHead>
                <TableHead className="font-semibold">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAccounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                    No MT5 accounts found
                  </TableCell>
                </TableRow>
              ) : (
                filteredAccounts.map((account) => (
                  <TableRow key={account.id} className="hover:bg-gray-50 transition-colors">
                    <TableCell className="font-mono font-semibold text-gray-900">
                      {account.mt5_login}
                    </TableCell>
                    <TableCell>
                      <Link 
                        to={createPageUrl('StudentDetail') + '?id=' + account.student_id}
                        className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {account.student_name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-blue-600">
                      {account.student_code}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={getPlatformColor(account.platform)}>
                        {account.platform}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {account.account_type || '-'}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {account.base_currency}
                    </TableCell>
                    <TableCell>
                      {account.is_primary && (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Primary
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {account.created_date 
                        ? format(new Date(account.created_date), 'MMM d, yyyy')
                        : '-'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}