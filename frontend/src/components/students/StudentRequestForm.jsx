import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function StudentRequestForm({ onSubmit, onCancel, isSubmitting, users, currentUser }) {
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    phone: '',
    country: '',
    notes: ''
  });

  // Auto-assign current user as primary mentor
  const [primaryMentorId, setPrimaryMentorId] = useState(currentUser?.id || '');
  const [seniorMentorInfo, setSeniorMentorInfo] = useState(null);
  const [emailError, setEmailError] = useState('');

  useEffect(() => {
    if (currentUser && primaryMentorId === currentUser.id) {
      // Only senior mentors should have senior mentor info (not junior or subjunior)
      if (currentUser.app_role === 'senior_mentor') {
        const seniorMentor = users.find(u => u.id === currentUser.senior_mentor_id);
        setSeniorMentorInfo({
          id: currentUser.senior_mentor_id || null,
          name: currentUser.senior_mentor_name || seniorMentor?.full_name || null
        });
      } else {
        setSeniorMentorInfo(null);
      }
    }
  }, [currentUser, primaryMentorId, users]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const allStudents = await base44.entities.Student.list();
      const duplicate = allStudents.find(s => s.email?.toLowerCase() === formData.email?.toLowerCase());
      if (duplicate) {
        setEmailError("A student with this email already exists");
        return;
      }
    } catch (err) {
      // fall through to submit if check fails
    }
    setEmailError('');
    onSubmit({
      ...formData,
      requested_primary_mentor_id: primaryMentorId,
      requested_primary_mentor_name: currentUser?.full_name || '',
      requested_senior_mentor_id: seniorMentorInfo?.id || null,
      requested_senior_mentor_name: seniorMentorInfo?.name || null
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Full Name *</Label>
        <Input
          value={formData.full_name}
          onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
          required
          placeholder="Enter student full name"
        />
      </div>

      <div className="space-y-2">
        <Label>Email *</Label>
        <Input
          type="email"
          value={formData.email}
          onChange={(e) => { setFormData({ ...formData, email: e.target.value }); setEmailError(''); }}
          required
          placeholder="student@example.com"
        />
        {emailError && <p className="text-red-500 text-sm mt-1">{emailError}</p>}
      </div>

      <div className="space-y-2">
        <Label>Phone</Label>
        <Input
          value={formData.phone}
          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          placeholder="+1234567890"
        />
      </div>

      <div className="space-y-2">
        <Label>Country</Label>
        <Input
          value={formData.country}
          onChange={(e) => setFormData({ ...formData, country: e.target.value })}
          placeholder="USA"
        />
      </div>

      <div className="space-y-2">
        <Label>Primary Mentor (You)</Label>
        <Input
          value={currentUser?.full_name || ''}
          disabled
          className="bg-gray-50"
        />
      </div>

      {seniorMentorInfo?.name && (
        <div className="space-y-2">
          <Label>Senior Mentor (Auto-assigned)</Label>
          <Input
            value={seniorMentorInfo.name}
            disabled
            className="bg-gray-50"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Additional notes about the student"
          rows={3}
        />
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Submitting...
            </>
          ) : (
            'Submit Request'
          )}
        </Button>
      </div>
    </form>
  );
}