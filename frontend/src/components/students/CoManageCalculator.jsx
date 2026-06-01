import React, { useState, useMemo } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, Calculator, Plus } from "lucide-react";
import { toast } from "sonner";

export default function CoManageCalculator({ students = [], coManagedStudents = [] }) {
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [results, setResults] = useState(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [applyingMentorId, setApplyingMentorId] = useState(null);

  const queryClient = useQueryClient();

  const { data: transactions = [] } = useQuery({
    queryKey: ['funding-transactions-calculator'],
    queryFn: () => base44.entities.FundingTransaction.list(),
  });

  const { data: currentUser } = useQuery({
    queryKey: ['current-user'],
    queryFn: async () => {
      const user = await base44.auth.me();
      return user;
    }
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const r = await base44.functions.invoke('getAllUsers', {});
      return r.data?.users || [];
    },
    retry: false
  });

  const createDeductionMutation = useMutation({
    mutationFn: async ({ mentor_id, mentor_name, student_id, student_name, student_code, amount_usd, reason, created_by_id, created_by_name, notes }) => {
      const deduction = await base44.entities.MentorDeduction.create({
        mentor_id,
        mentor_name,
        student_id,
        student_name,
        student_code,
        amount_usd,
        reason,
        created_by_id,
        created_by_name,
        notes
      });

      return deduction;
    },
    onSuccess: (deduction) => {
      queryClient.invalidateQueries(['mentor-deductions']);
      toast.success(`Deduction applied successfully for ${deduction.mentor_name}`);
      setApplyingMentorId(null);
    },
    onError: (error) => {
      toast.error(`Failed to apply deduction: ${error.message}`);
      setApplyingMentorId(null);
    }
  });

  const selectedStudent = useMemo(() => {
    return students.find(s => s.id === selectedStudentId);
  }, [selectedStudentId, students]);

  const handleApplyDeduction = async (result) => {
    if (!currentUser || !selectedStudent) return;

    try {
      setApplyingMentorId(result.mentor_id);
      await createDeductionMutation.mutateAsync({
        mentor_id: result.mentor_id,
        mentor_name: result.mentor_name,
        student_id: selectedStudentId,
        student_name: selectedStudent.full_name,
        student_code: selectedStudent.student_code,
        amount_usd: result.withdrawal_share,
        reason: `Pro-rata withdrawal deduction - Student withdrawal: $${withdrawalAmount} (${result.share_percent.toFixed(1)}% share)`,
        created_by_id: currentUser.id,
        created_by_name: currentUser.full_name,
        notes: `Mentor deposits: $${result.total_deposits.toFixed(2)}`
      });
    } catch (error) {
      console.error('Deduction error:', error);
      toast.error(error.message || 'Failed to apply deduction');
      setApplyingMentorId(null);
    }
  };

  const handleCalculate = () => {
    if (!selectedStudentId || !withdrawalAmount) {
      toast.error('Please select a student and enter a withdrawal amount');
      return;
    }

    if (parseFloat(withdrawalAmount) <= 0) {
      toast.error('Withdrawal amount must be greater than 0');
      return;
    }

    if (!selectedStudent?.co_mentors_details) {
      toast.error('Selected student has no co-mentor details');
      return;
    }

    setIsCalculating(true);

    try {
      let coMentors = [];
      try {
        coMentors = typeof selectedStudent.co_mentors_details === 'string'
          ? JSON.parse(selectedStudent.co_mentors_details)
          : selectedStudent.co_mentors_details;
      } catch (_) {
        throw new Error('Invalid co-mentor data format');
      }

      if (!Array.isArray(coMentors) || coMentors.length === 0) {
        throw new Error('No co-mentors found');
      }

      // Calculate actual deposits per mentor from FundingTransactions
      const amount = parseFloat(withdrawalAmount);
      const primaryMentorId = selectedStudent.primary_mentor_id;
      
      // Get all approved deposits for each mentor
      const mentorDeposits = {};
      
      // Initialize all mentors
      coMentors.forEach(cm => {
        mentorDeposits[cm.mentor_id] = 0;
      });
      mentorDeposits[primaryMentorId] = 0;
      
      // Sum approved deposits by initiating mentor
      transactions
        .filter(t => t.student_id === selectedStudentId && t.type === 'DEPOSIT' && t.status === 'APPROVED')
        .forEach(t => {
          const mentorId = t.initiating_mentor_id || primaryMentorId;
          if (mentorDeposits.hasOwnProperty(mentorId)) {
            mentorDeposits[mentorId] += t.amount_usd || 0;
          }
        });

      const totalDeposits = Object.values(mentorDeposits).reduce((sum, val) => sum + val, 0);
      
      if (totalDeposits === 0) {
        throw new Error('No approved deposits found for any mentor');
      }

      // Build results including both co-mentors and primary mentor
      const allMentors = [...coMentors];
      
      // Add primary mentor if not already in co-mentors
      if (!coMentors.some(cm => cm.mentor_id === primaryMentorId)) {
        allMentors.push({
          mentor_id: primaryMentorId,
          mentor_name: selectedStudent.primary_mentor_name
        });
      }
      
      const calculatedResults = allMentors.map(mentor => {
        const mentorTotal = mentorDeposits[mentor.mentor_id] || 0;
        const sharePercent = totalDeposits > 0 ? (mentorTotal / totalDeposits) * 100 : 0;
        const withdrawalShare = totalDeposits > 0 ? amount * (mentorTotal / totalDeposits) : 0;

        return {
          mentor_id: mentor.mentor_id,
          mentor_name: mentor.mentor_name,
          total_deposits: mentorTotal,
          share_percent: sharePercent,
          withdrawal_share: withdrawalShare
        };
      }).filter(r => r.total_deposits > 0);

      setResults(calculatedResults);
    } catch (error) {
      toast.error(`Calculation failed: ${error.message}`);
    } finally {
      setIsCalculating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calculator className="h-5 w-5 text-blue-600" />
            Pro-Rata Withdrawal Calculator
          </CardTitle>
          <p className="text-sm text-gray-600 mt-2">Calculate and apply proportional withdrawal deductions for co-managed students</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="student-select">Co-Managed Student *</Label>
              <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a co-managed student" />
                </SelectTrigger>
                <SelectContent>
                  {coManagedStudents.map((student) => (
                    <SelectItem key={student.id} value={student.id}>
                      {student.full_name} ({student.student_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="withdrawal-amount">Withdrawal Amount (USD) *</Label>
              <Input
                id="withdrawal-amount"
                type="number"
                step="0.01"
                min="0"
                value={withdrawalAmount}
                onChange={(e) => setWithdrawalAmount(e.target.value)}
                placeholder="Enter amount"
              />
            </div>

            <div className="flex items-end">
              <Button
                onClick={handleCalculate}
                disabled={isCalculating || !selectedStudentId || !withdrawalAmount}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {isCalculating ? 'Calculating...' : 'Calculate'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {results && (
        <Card className="border-gray-200">
          <CardHeader>
            <CardTitle className="text-lg">Withdrawal Distribution Results</CardTitle>
            <p className="text-sm text-gray-600 mt-1">
              Total Withdrawal: ${parseFloat(withdrawalAmount).toFixed(2)} | Student: {selectedStudent?.full_name}
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold">Mentor Name</TableHead>
                    <TableHead className="font-semibold text-right">Total Deposits</TableHead>
                    <TableHead className="font-semibold text-right">Share %</TableHead>
                    <TableHead className="font-semibold text-right">Withdrawal Share</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((result) => (
                    <TableRow key={result.mentor_id} className="hover:bg-gray-50">
                      <TableCell className="font-medium">{result.mentor_name}</TableCell>
                      <TableCell className="text-right font-mono">${result.total_deposits.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-semibold">{result.share_percent.toFixed(1)}%</TableCell>
                      <TableCell className="text-right font-semibold text-red-700">${result.withdrawal_share.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          onClick={() => handleApplyDeduction(result)}
                          disabled={applyingMentorId === result.mentor_id || createDeductionMutation.isPending}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          {applyingMentorId === result.mentor_id ? 'Applying...' : (
                            <>
                              <Plus className="h-3 w-3 mr-1" />
                              Apply
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                <p className="font-semibold">Applied deductions will appear in:</p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li>Mentor's Funding Activities (as deduction records)</li>
                  <li>Quarter Closing calculations (subtracted from commission)</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!results && selectedStudentId && !isCalculating && (
        <Card className="border-gray-200 bg-gray-50">
          <CardContent className="p-6 text-center text-gray-500">
            Enter withdrawal amount and click Calculate to see the distribution
          </CardContent>
        </Card>
      )}
    </div>
  );
}