import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Download, Upload, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { logAction } from "../utils/AuditLogger";

export default function BulkImportStudentsDialog({ open, onOpenChange, onImportComplete, mentors }) {
  const [file, setFile] = useState(null);
  const [assignmentMethod, setAssignmentMethod] = useState('round_robin');
  const [selectedMentorId, setSelectedMentorId] = useState('');
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);

  const downloadTemplate = () => {
    const csvContent = "full_name,email,phone,country,user_id,notes\n" +
                       "John Doe,john@example.com,+1234567890,USA,USR123,Sample student\n" +
                       "Jane Smith,jane@example.com,+0987654321,UK,USR456,";
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'student_import_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
    toast.success('Template downloaded');
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setResults(null);
    }
  };

  const parseCSV = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim());
    
    const students = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const student = {};
      headers.forEach((header, index) => {
        if (values[index]) {
          student[header] = values[index];
        }
      });
      if (student.full_name && student.email) {
        students.push(student);
      }
    }
    return students;
  };

  const assignMentorsRoundRobin = (students) => {
    if (mentors.length === 0) return students;
    
    return students.map((student, index) => {
      const mentor = mentors[index % mentors.length];
      const seniorMentor = mentor.senior_mentor_id ? mentors.find(m => m.id === mentor.senior_mentor_id) : null;
      
      return {
        ...student,
        primary_mentor_id: mentor.id,
        primary_mentor_name: mentor.full_name,
        senior_mentor_id: seniorMentor?.id || mentor.senior_mentor_id || null,
        senior_mentor_name: seniorMentor?.full_name || mentor.senior_mentor_name || null,
        status: 'ACTIVE'
      };
    });
  };

  const assignToSpecificMentor = (students, mentorId) => {
    const mentor = mentors.find(m => m.id === mentorId);
    if (!mentor) return students;
    
    const seniorMentor = mentor.senior_mentor_id ? mentors.find(m => m.id === mentor.senior_mentor_id) : null;
    
    return students.map(student => ({
      ...student,
      primary_mentor_id: mentor.id,
      primary_mentor_name: mentor.full_name,
      senior_mentor_id: seniorMentor?.id || mentor.senior_mentor_id || null,
      senior_mentor_name: seniorMentor?.full_name || mentor.senior_mentor_name || null,
      status: 'ACTIVE'
    }));
  };

  const handleImport = async () => {
    if (!file) {
      toast.error('Please select a file');
      return;
    }

    setImporting(true);
    setResults(null);

    try {
      const text = await file.text();
      let students = parseCSV(text);

      if (students.length === 0) {
        toast.error('No valid students found in CSV');
        setImporting(false);
        return;
      }

      // Assign mentors based on method
      if (assignmentMethod === 'round_robin') {
        students = assignMentorsRoundRobin(students);
      } else if (assignmentMethod === 'specific_mentor') {
        if (!selectedMentorId) {
          toast.error('Please select a mentor');
          setImporting(false);
          return;
        }
        students = assignToSpecificMentor(students, selectedMentorId);
      }

      // Fetch existing students for duplication check and code generation
      const existingStudents = await base44.entities.Student.list();
      const existingEmails = new Set(existingStudents.map(s => s.email?.toLowerCase()).filter(Boolean));
      const existingCodes = existingStudents.map(s => s.student_code).filter(Boolean);
      
      // Check for duplicates
      const duplicates = students.filter(s => existingEmails.has(s.email?.toLowerCase()));
      console.log('Checking duplicates:', { duplicates, existingEmails: Array.from(existingEmails), studentEmails: students.map(s => s.email) });
      
      if (duplicates.length > 0) {
        const duplicateEmails = duplicates.map(d => d.email).join(', ');
        console.log('Duplicates found:', duplicateEmails);
        
        setResults({
          success: false,
          error: `Duplicate entry detected: ${duplicateEmails}`
        });
        setImporting(false);
        
        toast.error(`Duplicate entry detected: ${duplicateEmails}`, {
          duration: 5000,
          position: 'top-center'
        });
        
        return;
      }
      
      let maxNumber = 0;
      existingCodes.forEach(code => {
        const match = code.match(/STU-(\d+)/);
        if (match) {
          maxNumber = Math.max(maxNumber, parseInt(match[1]));
        }
      });

      students = students.map((student, index) => ({
        ...student,
        student_code: `STU-${String(maxNumber + index + 1).padStart(4, '0')}`
      }));

      // Bulk create students
      const created = await base44.entities.Student.bulkCreate(students);

      // Log bulk import
      await logAction('bulk_import_students', 'Student', null, `Imported ${created.length} students`, null, { count: created.length, method: assignmentMethod });

      setResults({
        success: true,
        total: students.length,
        created: created.length
      });

      toast.success(`Successfully imported ${created.length} students`);
      onImportComplete();
    } catch (error) {
      console.error('Import error:', error);
      setResults({
        success: false,
        error: error.message || 'Failed to import students'
      });
      toast.error('Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setResults(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk Import Students</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Template Download */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Download className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-semibold text-gray-900">Step 1: Download Template</h4>
                <p className="text-sm text-gray-600 mt-1">
                  Download the CSV template and fill in your student data
                </p>
                <Button
                  onClick={downloadTemplate}
                  variant="outline"
                  size="sm"
                  className="mt-3"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download Template
                </Button>
              </div>
            </div>
          </div>

          {/* Assignment Method */}
          <div className="space-y-2">
            <Label>Mentor Assignment Method</Label>
            <Select value={assignmentMethod} onValueChange={setAssignmentMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="round_robin">Round Robin (Auto-assign to mentors)</SelectItem>
                <SelectItem value="specific_mentor">Assign to Specific Mentor</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">
              {assignmentMethod === 'round_robin' 
                ? 'Round Robin will automatically distribute students evenly among all mentors'
                : 'All students will be assigned to the selected mentor'}
            </p>
          </div>

          {/* Specific Mentor Selection */}
          {assignmentMethod === 'specific_mentor' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Primary Mentor *</Label>
                <Select value={selectedMentorId} onValueChange={setSelectedMentorId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a primary mentor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {mentors.map((mentor) => (
                      <SelectItem key={mentor.id} value={mentor.id}>
                        {mentor.full_name} ({mentor.app_role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedMentorId && (
                <div className="space-y-2">
                  <Label>Senior Mentor (Auto-assigned)</Label>
                  <Input
                    value={(() => {
                      const selectedMentor = mentors.find(m => m.id === selectedMentorId);
                      if (selectedMentor?.senior_mentor_name) {
                        return selectedMentor.senior_mentor_name;
                      }
                      return 'None';
                    })()}
                    disabled
                    className="bg-gray-50"
                  />
                  <p className="text-xs text-gray-500">
                    Senior mentor is automatically assigned based on the primary mentor's hierarchy
                  </p>
                </div>
              )}
            </div>
          )}

          {/* File Upload */}
          <div className="space-y-2">
            <Label>Upload CSV File</Label>
            <Input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              disabled={importing}
            />
            {file && (
              <p className="text-sm text-green-600 flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                {file.name} selected
              </p>
            )}
          </div>

          {/* Results */}
          {results && (
            <Alert variant={results.success ? "default" : "destructive"}>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {results.success ? (
                  <div>
                    Successfully imported {results.created} of {results.total} students
                  </div>
                ) : (
                  <div>Import failed: {results.error}</div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={handleClose} disabled={importing}>
              {results ? 'Close' : 'Cancel'}
            </Button>
            {!results && (
              <Button onClick={handleImport} disabled={!file || importing}>
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Import Students
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}