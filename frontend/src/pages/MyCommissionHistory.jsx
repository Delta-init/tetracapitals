import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign, TrendingUp, Calendar } from "lucide-react";
import { filterLedgersByRole } from "../components/utils/LedgerUtils";
import { getEffectiveUser } from "../components/utils/ImpersonationContext";
import { format } from "date-fns";

export default function MyCommissionHistory() {
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    const fetchUser = async () => {
      const realUser = await base44.auth.me();
      setCurrentUser(getEffectiveUser(realUser));
    };
    fetchUser();
  }, []);

  const { data: ledgers = [] } = useQuery({
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

  const myLedgers = filterLedgersByRole(currentUser, ledgers);

  // Calculate totals
  const totalReleased = myLedgers
    .filter(l => l.overall_status === 'released')
    .reduce((sum, l) => sum + (l.commission_release_usd || 0), 0);

  const totalPending = myLedgers
    .filter(l => l.overall_status !== 'released' && l.overall_status !== 'rejected')
    .reduce((sum, l) => sum + (l.commission_release_usd || 0), 0);

  // Get buffer from last released commission statement
  const releasedLedgers = myLedgers.filter(l => l.overall_status === 'released');
  const lastReleasedLedger = releasedLedgers.length > 0 ? releasedLedgers[0] : null;
  const totalBuffer = lastReleasedLedger ? (lastReleasedLedger.buffer_carried_out_usd || 0) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">My Commission History</h1>
          <p className="text-gray-600 mt-2 text-base">View your quarterly commission statements</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-none bg-gradient-to-br from-emerald-100 to-teal-100 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-white/80 rounded-lg shadow-sm">
                  <DollarSign className="h-6 w-6 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">Total Released</p>
                  <p className="text-3xl font-bold text-emerald-700">${totalReleased.toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none bg-gradient-to-br from-blue-100 to-indigo-100 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-white/80 rounded-lg shadow-sm">
                  <TrendingUp className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">Pending Release</p>
                  <p className="text-3xl font-bold text-blue-700">${totalPending.toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none bg-gradient-to-br from-amber-100 to-orange-100 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-white/80 rounded-lg shadow-sm">
                  <Calendar className="h-6 w-6 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wider text-gray-700">Total Buffer</p>
                  <p className="text-3xl font-bold text-amber-700">${totalBuffer.toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Commission History Table */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
            <CardTitle className="text-lg font-semibold tracking-tight">Commission Statements</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold">Quarter</TableHead>
                    <TableHead className="font-semibold">Net Deposit</TableHead>
                    <TableHead className="font-semibold">Gross Commission</TableHead>
                    <TableHead className="font-semibold">Release (75%)</TableHead>
                    <TableHead className="font-semibold">Buffer (25%)</TableHead>
                    <TableHead className="font-semibold">Buffer In</TableHead>
                    <TableHead className="font-semibold">Buffer Out</TableHead>
                    <TableHead className="font-semibold">Release Date</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myLedgers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                        No commission records yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    myLedgers.map((ledger) => (
                      <TableRow key={ledger.id} className="hover:bg-gray-50 transition-colors">
                        <TableCell className="font-semibold text-blue-600">{ledger.quarter}</TableCell>
                        <TableCell className="font-semibold">${ledger.net_deposit_usd?.toFixed(2)}</TableCell>
                        <TableCell className="font-semibold">${ledger.gross_commission_usd?.toFixed(2)}</TableCell>
                        <TableCell className="font-semibold text-emerald-600">
                          ${ledger.commission_release_usd?.toFixed(2)}
                        </TableCell>
                        <TableCell className="font-semibold text-amber-600">
                          ${ledger.commission_buffer_usd?.toFixed(2)}
                        </TableCell>
                        <TableCell>${ledger.buffer_carried_in_usd?.toFixed(2)}</TableCell>
                        <TableCell>${ledger.buffer_carried_out_usd?.toFixed(2)}</TableCell>
                        <TableCell className="text-sm">
                          {ledger.actual_release_date ? (
                            <div>
                              <div className="font-semibold text-emerald-600">
                                {format(new Date(ledger.actual_release_date), 'MMM d, yyyy')}
                              </div>
                              <div className="text-xs text-gray-500">
                                (Expected: {format(new Date(ledger.release_date), 'MMM d, yyyy')})
                              </div>
                            </div>
                          ) : (
                            format(new Date(ledger.release_date), 'MMM d, yyyy')
                          )}
                        </TableCell>
                        <TableCell>
                          {ledger.overall_status === 'released' ? (
                            <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">
                              RELEASED
                            </Badge>
                          ) : ledger.overall_status === 'rejected' ? (
                            <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
                              REJECTED
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200">
                              PENDING
                            </Badge>
                          )}
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