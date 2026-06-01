import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Target, TrendingUp, Calendar } from "lucide-react";
import { filterTargetsByRole } from "../components/utils/TargetAccessControl";
import { getEffectiveUser } from "../components/utils/ImpersonationContext";
import { 
  computeTargetAchievement, 
  getCurrentActiveTargets,
  formatPeriodLabel
} from "../components/utils/TargetMetricsUtils";
import { format } from "date-fns";

export default function MyTargets() {
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    const fetchUser = async () => {
      const realUser = await base44.auth.me();
      setCurrentUser(getEffectiveUser(realUser));
    };
    fetchUser();
  }, []);

  const { data: targets = [] } = useQuery({
    queryKey: ['mentor-targets'],
    queryFn: () => base44.entities.MentorTarget.list('-created_date'),
    enabled: !!currentUser
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['funding-transactions'],
    queryFn: () => base44.entities.FundingTransaction.list(),
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

  // Filter targets for this mentor
  const myTargets = filterTargetsByRole(currentUser, targets);
  
  // Get current active targets
  const activeTargets = getCurrentActiveTargets(myTargets, transactions);

  // Compute achievements for all targets
  const enrichedTargets = myTargets.map(target => {
    const achievement = computeTargetAchievement(target, transactions);
    return { ...target, ...achievement };
  });

  const getStatusColor = (status) => {
    switch (status) {
      case 'NOT_STARTED': return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'IN_PROGRESS': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'ACHIEVED': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'MISSED': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const renderActiveTargetCard = (target, type, icon, color) => {
    if (!target) {
      return (
        <Card className="border-gray-200">
          <CardContent className="p-6 text-center">
            <p className="text-gray-500">No active {type.toLowerCase()} target</p>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className={`border-${color}-200 bg-${color}-50`}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              {icon}
              {formatPeriodLabel(target)}
            </CardTitle>
            <Badge variant="outline" className={getStatusColor(target.target_status)}>
              {target.target_status.replace('_', ' ')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="text-sm text-gray-600">Target Net Deposit</p>
            <p className="text-2xl font-bold text-gray-900">
              ${target.target_net_deposit_usd?.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Achieved</p>
            <p className="text-xl font-semibold text-emerald-600">
              ${target.achievement_net_deposit_usd?.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Progress</p>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex-1 bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${
                    target.achievement_percent >= 100 ? 'bg-emerald-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.min(target.achievement_percent, 100)}%` }}
                />
              </div>
              <span className="text-lg font-semibold">
                {target.achievement_percent?.toFixed(1)}%
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">My Targets</h1>
          <p className="text-gray-600 mt-2 text-base">Track your performance against weekly, monthly, and quarterly targets</p>
        </div>

        {/* Active Targets Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {renderActiveTargetCard(
            activeTargets.weekly,
            'Weekly',
            <Calendar className="h-5 w-5 text-blue-600" />,
            'blue'
          )}
          {renderActiveTargetCard(
            activeTargets.monthly,
            'Monthly',
            <TrendingUp className="h-5 w-5 text-emerald-600" />,
            'emerald'
          )}
          {renderActiveTargetCard(
            activeTargets.quarterly,
            'Quarterly',
            <Target className="h-5 w-5 text-purple-600" />,
            'purple'
          )}
        </div>

        {/* All Targets Table */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
            <CardTitle className="text-lg font-semibold tracking-tight">All Targets</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold">Period Type</TableHead>
                    <TableHead className="font-semibold">Start Date</TableHead>
                    <TableHead className="font-semibold">End Date</TableHead>
                    <TableHead className="font-semibold">Target (USD)</TableHead>
                    <TableHead className="font-semibold">Achieved (USD)</TableHead>
                    <TableHead className="font-semibold">Progress %</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">Assigned By</TableHead>
                    <TableHead className="font-semibold">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrichedTargets.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                        No targets assigned yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    enrichedTargets.map((target) => (
                      <TableRow key={target.id} className="hover:bg-gray-50 transition-colors">
                        <TableCell>
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                            {target.period_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {format(new Date(target.period_start_date), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell className="text-sm">
                          {format(new Date(target.period_end_date), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell className="font-semibold">
                          ${target.target_net_deposit_usd?.toFixed(2)}
                        </TableCell>
                        <TableCell className="font-semibold text-emerald-600">
                          ${target.achievement_net_deposit_usd?.toFixed(2)}
                        </TableCell>
                        <TableCell className="font-semibold">
                          {target.achievement_percent?.toFixed(1)}%
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getStatusColor(target.target_status)}>
                            {target.target_status.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{target.assigned_by_name}</TableCell>
                        <TableCell className="text-sm">
                          {target.created_date ? format(new Date(target.created_date), 'MMM d, yyyy') : '-'}
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