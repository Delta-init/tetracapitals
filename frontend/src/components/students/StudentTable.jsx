import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, Edit } from "lucide-react";
import { maskEmail, maskPhone, shouldMaskData, canEditData } from "../utils/DataMasking";
import { format } from "date-fns";

export default function StudentTable({ students, currentUser, onView, onEdit }) {
  const shouldMask = shouldMaskData(currentUser?.role);
  const canEdit = canEditData(currentUser?.role);

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'inactive': return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'suspended': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead className="font-semibold">Name</TableHead>
            <TableHead className="font-semibold">Email</TableHead>
            <TableHead className="font-semibold">Phone</TableHead>
            <TableHead className="font-semibold">Mentor</TableHead>
            <TableHead className="font-semibold">MT5 ID</TableHead>
            <TableHead className="font-semibold">Net Deposit</TableHead>
            <TableHead className="font-semibold">Status</TableHead>
            <TableHead className="font-semibold text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                No students found
              </TableCell>
            </TableRow>
          ) : (
            students.map((student) => (
              <TableRow key={student.id} className="hover:bg-gray-50 transition-colors">
                <TableCell className="font-medium">{student.name}</TableCell>
                <TableCell className="text-sm">
                  {shouldMask ? maskEmail(student.email) : student.email}
                </TableCell>
                <TableCell className="text-sm">
                  {shouldMask ? maskPhone(student.phone) : student.phone}
                </TableCell>
                <TableCell className="text-sm">{student.mentor_name}</TableCell>
                <TableCell className="text-sm font-mono">{student.mt5_id || '-'}</TableCell>
                <TableCell className="font-semibold text-emerald-600">
                  ${student.net_deposit?.toFixed(2) || '0.00'}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={getStatusColor(student.status)}>
                    {student.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onView(student)}
                      className="h-8 w-8 p-0"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onEdit(student)}
                        className="h-8 w-8 p-0"
                      >
                        <Edit className="h-4 w-4" />
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
  );
}