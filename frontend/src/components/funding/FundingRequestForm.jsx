import React, { useState } from 'react';
import { useQuery } from "@tanstack/react-query";
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
import SearchableSelect from '../common/SearchableSelect';
import TagsPicker from './TagsPicker';
import { isMentorRole } from '../utils/roles';
import { teamMembersOf } from '../utils/teams';

const NONE = '__none__';
// "junior_mentor" -> "Junior Mentor"
const roleLabel = (r) => String(r || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

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
    meeting_mentor_id: '', // mentor who conducted the meeting with the client
  });
  const [uploading, setUploading] = useState(false);
  const [referralStudent, setReferralStudent] = useState(null);
  const [showCoManageModal, setShowCoManageModal] = useState(false);

  // Tag catalog with per-tag amounts — for BONUS, the product's price fills in the amount (which can still be changed).
  const { data: bonusTags = [] } = useQuery({
    queryKey: ['transaction-tags-catalog'],
    queryFn: async () => (await base44.entities.TransactionTag.list('name')).filter(t => t.active !== false),
    staleTime: 5 * 60_000,
  });
  const tagAmount = (tagName) => bonusTags.find(t => t.name === tagName)?.amount_usd;

  // Mentors (junior / senior / sub-junior / chief) for the "meeting conducted by"
  // picker — only from the submitter's own team (their Up Head chain). Admins
  // aren't on a team, so they see every mentor. Everyone can read the user list,
  // so staff roles like CS can load it.
  const { data: allUsers = [] } = useQuery({
    queryKey: ['users-mentor-options'],
    queryFn: () => base44.entities.User.list(),
    staleTime: 5 * 60_000,
  });
  const mentorOptions = React.useMemo(() => {
    const pool = isMentorRole(currentUser?.app_role) ? teamMembersOf(currentUser, allUsers) : allUsers;
    return pool
      .filter(u => /mentor/.test(String(u.app_role || '')) && u.full_name)
      .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)))
      .map(u => ({ value: u.id, label: `${u.full_name} · ${roleLabel(u.app_role)}` }));
  }, [allUsers, currentUser]);

  const isMentor = isMentorRole(currentUser?.app_role);

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
      toast.error('Please pick a product for the bonus');
      return;
    }

    if (!(parseFloat(formData.amount_usd) > 0)) {
      toast.error('Enter the amount');
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

    const meetingMentor = formData.meeting_mentor_id && formData.meeting_mentor_id !== NONE
      ? allUsers.find(u => u.id === formData.meeting_mentor_id)
      : null;

    const dataToSubmit = {
      ...formData,
      meeting_mentor_id: meetingMentor?.id || null,
      meeting_mentor_name: meetingMentor?.full_name || null,
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
              onValueChange={(value) => setFormData({ ...formData, type: value, tags: [], amount_usd: value === 'BONUS' ? '' : formData.amount_usd })}
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
              <Label>Product *</Label>
              <TagsPicker
                value={formData.tags}
                onChange={(picked) => {
                  // The picked product may BUNDLE lower products (e.g. buying the
                  // higher course includes the lower one). Auto-add those to the
                  // tags, but the amount stays the primary product's price — the
                  // bundled items are included, not added on top.
                  const primary = picked[0];
                  const product = bonusTags.find(t => t.name === primary);
                  const included = Array.isArray(product?.includes)
                    ? product.includes.filter(n => n && n !== primary)
                    : [];
                  const allTags = primary ? [primary, ...included] : [];
                  const amt = product?.amount_usd;
                  setFormData({ ...formData, tags: allTags, amount_usd: amt != null ? String(amt) : '' });
                }}
              />
              {formData.tags.length > 1 && (
                <p className="text-xs text-green-700 font-medium">
                  ✓ Automatically included (no extra charge): {formData.tags.slice(1).join(', ')}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Pick the product — its price fills in the amount, which you can change. Bundled products come along at no extra charge.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="amount">
              Amount (USD) *
            </Label>
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
            {formData.type === 'BONUS' && (
              <p className="text-xs text-muted-foreground">Filled in from the product's price — change it if needed.</p>
            )}
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
            <Label>Meeting Conducted By (Mentor)</Label>
            <SearchableSelect
              value={formData.meeting_mentor_id || undefined}
              onValueChange={(v) => setFormData({ ...formData, meeting_mentor_id: v })}
              options={mentorOptions}
              placeholder="Select the mentor who took the meeting"
              searchPlaceholder="Search mentor by name or role…"
              noneLabel="— None —"
              noneValue={NONE}
            />
            {isMentorRole(currentUser?.app_role) && mentorOptions.length === 0 && (
              <p className="text-xs text-amber-600">No mentors on your team yet — ask an admin to set your Up Head in Personnel.</p>
            )}
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