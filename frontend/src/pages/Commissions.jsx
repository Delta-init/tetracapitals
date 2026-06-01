import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp, Award } from "lucide-react";
import { format } from "date-fns";

export default function Commissions() {
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    const fetchUser = async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const { data: commissions = [] } = useQuery({
    queryKey: ['commission-ledgers'],
    queryFn: () => base44.entities.CommissionLedger.list('-created_date'),
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

  // Filter based on role
  const filteredCommissions = ['junior_mentor', 'senior_mentor'].includes(currentUser.app_role)
    ? commissions.filter(c => c.mentor_id === currentUser.id)
    : commissions;

  const totalCommission = filteredCommissions.reduce((sum, c) => sum + (c.gross_commission_usd || 0), 0);
  const totalPayable = filteredCommissions.reduce((sum, c) => sum + (c.commission_release_usd || 0), 0);

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending_broker_approval':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'pending_academic_approval':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'pending_finance_approval':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'released':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'rejected':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Commission History</h1>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-gray-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Records</CardTitle>
              <Award className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">{filteredCommissions.length}</div>
            </CardContent>
          </Card>

          <Card className="border-gray-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Commission</CardTitle>
              <DollarSign className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">${totalCommission.toFixed(2)}</div>
            </CardContent>
          </Card>

          <Card className="border-gray-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">Total Payable</CardTitle>
              <TrendingUp className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">${totalPayable.toFixed(2)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Commission Table */}
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="font-semibold">Mentor</TableHead>
                <TableHead className="font-semibold">Quarter</TableHead>
                <TableHead className="font-semibold">Net Deposit</TableHead>
                <TableHead className="font-semibold">Gross (4%)</TableHead>
                <TableHead className="font-semibold">Buffer In</TableHead>
                <TableHead className="font-semibold">Release (75%)</TableHead>
                <TableHead className="font-semibold">Buffer (25%)</TableHead>
                <TableHead className="font-semibold">Status</TableHead>
                <TableHead className="font-semibold">Release Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCommissions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                    No commission records found
                  </TableCell>
                </TableRow>
              ) : (
                filteredCommissions.map((commission) => (
                  <TableRow key={commission.id} className="hover:bg-gray-50 transition-colors">
                    <TableCell className="font-medium">{commission.mentor_name}</TableCell>
                    <TableCell className="font-mono text-sm font-semibold text-blue-600">{commission.quarter}</TableCell>
                    <TableCell className="font-mono">${(commission.net_deposit_usd || 0).toFixed(2)}</TableCell>
                    <TableCell className="font-mono font-medium">
                      ${(commission.gross_commission_usd || 0).toFixed(2)}
                    </TableCell>
                    <TableCell className="font-mono text-sm">${(commission.buffer_carried_in_usd || 0).toFixed(2)}</TableCell>
                    <TableCell className="font-mono font-medium text-emerald-600">
                      ${(commission.commission_release_usd || 0).toFixed(2)}
                    </TableCell>
                    <TableCell className="font-mono text-amber-600">${(commission.commission_buffer_usd || 0).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={getStatusColor(commission.overall_status)}>
                        {commission.overall_status?.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {commission.actual_release_date 
                        ? format(new Date(commission.actual_release_date), 'MMM d, yyyy')
                        : commission.release_date
                        ? format(new Date(commission.release_date), 'MMM d, yyyy')
                        : '-'
                      }
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