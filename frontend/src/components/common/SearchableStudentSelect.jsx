import React, { useState, useMemo } from 'react';
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export default function SearchableStudentSelect({ 
  students = [], 
  value, 
  onValueChange, 
  placeholder = "Select student",
  label = "Student",
  required = false,
  allowNone = false
}) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredStudents = useMemo(() => {
    if (!searchTerm) return students;
    
    const term = searchTerm.toLowerCase();
    return students.filter(student => 
      student.full_name?.toLowerCase().includes(term) ||
      student.student_code?.toLowerCase().includes(term) ||
      student.email?.toLowerCase().includes(term)
    );
  }, [students, searchTerm]);

  return (
    <div className="space-y-2">
      {label && <Label>{label} {required && '*'}</Label>}
      <Select value={value} onValueChange={onValueChange} required={required}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="max-h-[300px]">
          <div className="sticky top-0 bg-white p-2 border-b">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search students..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-9"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
          {allowNone && <SelectItem value="none">None</SelectItem>}
          {filteredStudents.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-500">
              No students found
            </div>
          ) : (
            filteredStudents.map((student) => (
              <SelectItem key={student.id} value={student.id}>
                {student.student_code ? `${student.student_code} - ` : ''}{student.full_name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}