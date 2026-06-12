import React, { useState } from 'react';
import ReferralRequestPopup from './ReferralRequestPopup';
import CoManageSearchModal from './CoManageSearchModal';
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import SearchableStudentSelect from '../common/SearchableStudentSelect';
import TagsPicker from './TagsPicker';

const PAYMENT_METHODS = [
  'AED TRANSFER',
  'UPI',
  'CARD PAYMENT',
  'USDT',
  'INR TRANSFER',
  'Cash deposit',
  'Other'
];

export default function FundingRequestForm({ students, allStudents = [], currentUser, onSubmit, onCancel, isSubmitting }) {
  const [formData, setFormData] = useState({
    type: 'DEPOSIT',
    student_id: '',
    amount_usd: '',
    payment_method: '',
    mt5_login: '',
    screenshot_url: '',
    tags: [],          // only meaningful when type === 'BONUS'
  });
  const [uploading, setUploading] = useState(false);
  const [referralStudent, setReferralStudent] = useState(null);
  const [showCoManageModal, setShowCoManageModal] = useState(false);

  const isMentor = ['junior_mentor', 'senior_mentor', 'subjunior_mentor'].includes(currentUser?.app_role);

  const handleStudentSelect = (studentId) => {
    const student = students.find(s => s.id === studentId);
    if (isMentor && student && student.primary_mentor_id !== currentUser.id) {
      let alreadyCoManaged = false;
      if (student.co_mentors_details) {
        try {
          const co = JSON.parse(student.co_mentors_details);
          alreadyCoManaged = Array.isArray(co) && co.some(m => m.mentor_id === currentUser.id);
        } catch (_) {}
      }
      if (!alreadyCoManaged) {
        setReferralStudent(student);
        return;
      }
    }
    setFormData(prev => ({ ...prev, student_id: studentId }));
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploading(true);
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        setFormData({ ...formData, screenshot_url: file_url });
        toast.success('Screenshot uploaded');
      } catch (error) {
        toast.error('Failed to upload screenshot');
      } finally {
        setUploading(false);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const selectedStudent = students.find(s => s.id === formData.student_id);
    if (!selectedStudent) {
      toast.error('Please select a student');
      return;
    }

    if (formData.type === 'BONUS' && (!formData.tags || formData.tags.length === 0)) {
      toast.error('Please pick a tag for the bonus');
      return;
    }

    let primaryMentorId, primaryMentorName, seniorMentorId, seniorMentorName;
    if (currentUser.app_role === 'assistance' && currentUser.assigned_mentor_id) {
      primaryMentorId = currentUser.assigned_mentor_id;
      primaryMentorName = currentUser.assigned_mentor_name;
      seniorMentorId = selectedStudent.senior_mentor_id;
      seniorMentorName = selectedStudent.senior_mentor_name;
    } else {
      primaryMentorId = selectedStudent.primary_mentor_id;
      primaryMentorName = selectedStudent.primary_mentor_name;
      seniorMentorId = selectedStudent.senior_mentor_id;
      seniorMentorName = selectedStudent.senior_mentor_name;
    }

    const dataToSubmit = {
      ...formData,
      amount_usd: parseFloat(formData.amount_usd),
      status: 'PENDING',
      student_name: selectedStudent.full_name,
      student_code: selectedStudent.student_code,
      primary_mentor_id: primaryMentorId,
      primary_mentor_name: primaryMentorName,
      senior_mentor_id: seniorMentorId,
      senior_mentor_name: seniorMentorName,
      requested_by_id: currentUser.id,
      requested_by_name: currentUser.full_name,
      requested_at: new Date().toISOString(),
      initiating_mentor_id: currentUser.app_role === 'assistance' && currentUser.assigned_mentor_id
        ? currentUser.assigned_mentor_id
        : currentUser.id,
      initiating_mentor_name: currentUser.app_role === 'assistance' && currentUser.assigned_mentor_name
        ? currentUser.assigned_mentor_name
        : currentUser.full_name
    };

    onSubmit(dataToSubmit);
  };

  return (
    <>
      {showCoManageModal && (
        <CoManageSearchModal
          allStudents={allStudents}
          currentUser={currentUser}
          onSelectStudent={(student) => {
            setShowCoManageModal(false);
            setReferralStudent(student);
          }}
          onClose={() => setShowCoManageModal(false)}
        />
      )}
      {referralStudent && (
        <ReferralRequestPopup
          student={referralStudent}
          currentUser={currentUser}
          // Carry the type + tags chosen in the parent form into the referral so
          // BONUS (and its required tag) flows through the co-management path
          // the same way DEPOSIT does.
          transactionType={formData.type}
          initialTags={formData.tags}
          onClose={() => setReferralStudent(null)}
        />
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="type">Transaction Type *</Label>
            <Select
              value={formData.type}
              onValueChange={(value) => setFormData({ ...formData, type: value })}
              required
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DEPOSIT">Deposit</SelectItem>
                <SelectItem value="WITHDRAWAL">Withdrawal</SelectItem>
                <SelectItem value="BONUS">Bonus</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <SearchableStudentSelect
              students={students}
              value={formData.student_id}
              onValueChange={handleStudentSelect}
              label="Student"
              required
            />
            {isMentor && (
              <button
                type="button"
                onClick={() => setShowCoManageModal(true)}
                className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
              >
                Looking for a client managed by another mentor? → Request Co-Management
              </button>
            )}
          </div>

          {formData.type === 'BONUS' && (
            <div className="space-y-2 md:col-span-2">
              <Label>Tag *</Label>
              <TagsPicker
                value={formData.tags}
                onChange={(tags) => setFormData({ ...formData, tags })}
              />
              <p className="text-xs text-muted-foreground">
                Pick the tag that categorizes this bonus. Tag names are managed by admins.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="amount">Amount (USD) *</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0.01"
              value={formData.amount_usd}
              onChange={(e) => setFormData({ ...formData, amount_usd: e.target.value })}
              placeholder="0.00"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment_method">Payment Method *</Label>
            <Select
              value={formData.payment_method}
              onValueChange={(value) => setFormData({ ...formData, payment_method: value })}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Select payment method" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((method) => (
                  <SelectItem key={method} value={method}>
                    {method}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mt5_login">MT5 Login (Optional)</Label>
            <Input
              id="mt5_login"
              value={formData.mt5_login}
              onChange={(e) => setFormData({ ...formData, mt5_login: e.target.value })}
              placeholder="Enter MT5 login"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="screenshot">Screenshot (Optional)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="screenshot"
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                disabled={uploading}
              />
              {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
            {formData.screenshot_url && (
              <p className="text-xs text-green-600">✓ Screenshot uploaded</p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || uploading}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              'Submit Request'
            )}
          </Button>
        </div>
      </form>
    </>
  );
}