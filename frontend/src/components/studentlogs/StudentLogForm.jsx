import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Upload } from "lucide-react";
import SearchableStudentSelect from '../common/SearchableStudentSelect';
import { detectChanges, getTabsFromChanges } from './StudentLogHistoryUtils';
import { toast } from "sonner";

export default function StudentLogForm({ log, students, open, onClose, onSubmit, isSubmitting }) {
  const [formData, setFormData] = useState({
    student_id: '',
    student_code: '',
    student_name: '',
    followup_priority: 'Medium',
    active_in_classes: true,
    not_attending_reason: '',
    last_contact_date: '',
    last_contact_person: '',
    contact_history: '',
    preferred_contact_mode: 'Phone',
    email: '',
    phone_number: '',
    home_country_contact: '',
    emergency_contact: '',
    nationality: '',
    gender: 'Male',
    dob: '',
    occupation: '',
    permanent_address: '',
    residency_address: '',
    passport_number: '',
    emirates_id: '',
    photo_url: '',
    passport_copy_url: '',
    date_of_joining: '',
    month_of_joining: '',
    course_enrolled: '',
    preferred_language: '',
    academic_counselors: '',
    mode_of_study: 'Online',
    country_of_attendance: '',
    joined_dollar_club: false,
    course_amount: 0,
    payment_status: 'Pending',
    payment_mode: '',
    payment_date: '',
    payment_due: 0,
    discount: 0,
    payment_history: '',
    amount_collected_by: '',
    induction_status: 'Pending',
    induction_done_by: '',
    onboarding_document_status: '',
    community_status: '',
    current_class_status: '',
    last_attended_class: '',
    exam_date: '',
    exam_status: 'Scheduled',
    exam_not_attended_reason: '',
    exam_valuation_date: '',
    exam_evaluator: '',
    exam_marks: 0,
    exam_result: 'Pending',
    failed_assigned_mentor: '',
    failure_reason: '',
    upgrade_response: 'Pending',
    upgrade_not_interested_reason: '',
    course_to_upgrade: '',
    upgrade_date: '',
    upgrade_month: '',
    convocation_status: '',
    certificate_status: '',
    convocation_month: '',
    invited_traders_dayout: false,
    traders_dayout_invite_reason: '',
    traders_dayout_outcome: '',
    trading_journal_management: '',
    trading_journal_link: '',
    live_trades_attended_count: 0,
    last_attended_live_trade: '',
    trading_status: '',
    current_broker: '',
    assets_traded: '',
    current_profit_loss: 0,
    potential_to_deposit: false,
    easy_to_convince: false,
    total_loss_from_trading: 0,
    rejoining_response: 'Pending',
    rejoining_date: '',
    rejoining_measures: '',
    rejoined_class: '',
    rejoining_sales_person: '',
    rejoinees_feedback: '',
    mentor_assigned: '',
    attended_senior_mentor_class: false,
    discussion_with_senior_mentor: false,
    practice_sessions_attended: 0,
    seminars_attended_count: 0,
    online_seminars_list: '',
    offline_seminars_list: '',
    seminars_not_attended_reason: '',
    feedback: '',
    testimonial_done: false,
    google_review: false,
    subscribed_for_pipscraft: false,
    pipscraft_subscription_date: '',
    still_using_pipscraft: false,
    pipscraft_satisfaction: 'Satisfied',
    pipscraft_not_satisfied_reason: '',
    pipscraft_subscribed_agent: ''
    });

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingPassport, setUploadingPassport] = useState(false);

  const { data: academicCounselors = [] } = useQuery({
    queryKey: ['academic-counselors'],
    queryFn: () => base44.entities.AcademicCounselor.list(),
    initialData: []
  });

  const countries = [
    "United Arab Emirates", "India", "Pakistan", "Bangladesh", "Philippines",
    "United States", "United Kingdom", "Canada", "Australia", "Saudi Arabia",
    "Kuwait", "Bahrain", "Qatar", "Oman", "Egypt", "Jordan", "Lebanon",
    "Turkey", "Malaysia", "Singapore", "Indonesia", "Thailand", "China",
    "Japan", "South Korea", "Germany", "France", "Italy", "Spain",
    "Netherlands", "Belgium", "Switzerland", "Sweden", "Norway", "Denmark",
    "Russia", "South Africa", "Nigeria", "Kenya", "Ghana", "Brazil",
    "Argentina", "Mexico", "Other"
  ].sort();

  useEffect(() => {
    if (log) {
      setFormData(log);
    }
  }, [log]);

  const handleStudentChange = (studentId) => {
    const student = students.find(s => s.id === studentId);
    if (student) {
      setFormData(prev => ({
        ...prev,
        student_id: studentId,
        student_code: student.student_code || '',
        student_name: student.full_name || '',
        email: student.email || '',
        phone_number: student.phone || ''
      }));
    }
  };

  const handleFileUpload = async (file, fieldName) => {
    const setUploading = fieldName === 'photo_url' ? setUploadingPhoto : setUploadingPassport;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData(prev => ({ ...prev, [fieldName]: file_url }));
      toast.success('File uploaded successfully');
    } catch (error) {
      toast.error('Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{log ? 'Edit Student Log' : 'Add Student Log'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <Tabs defaultValue="contact" className="w-full">
            <TabsList className="grid grid-cols-7 w-full mb-4">
              <TabsTrigger value="contact">Contact</TabsTrigger>
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="payment">Payment</TabsTrigger>
              <TabsTrigger value="induction">Induction</TabsTrigger>
              <TabsTrigger value="academic">Academic</TabsTrigger>
              <TabsTrigger value="upgrade">Upgrade</TabsTrigger>
              <TabsTrigger value="convocation">Convocation</TabsTrigger>
            </TabsList>
            <TabsList className="grid grid-cols-7 w-full mb-4">
              <TabsTrigger value="traders">Traders Day</TabsTrigger>
              <TabsTrigger value="livetrade">Live Trade</TabsTrigger>
              <TabsTrigger value="ssf">SSF</TabsTrigger>
              <TabsTrigger value="rejoining">Rejoining</TabsTrigger>
              <TabsTrigger value="seminar">Seminar</TabsTrigger>
              <TabsTrigger value="practice">Practice Tracking</TabsTrigger>
              <TabsTrigger value="feedback">Feedback & Review</TabsTrigger>
            </TabsList>
            <TabsList className="grid grid-cols-7 w-full">
              <TabsTrigger value="pipscraft">Pips Craft</TabsTrigger>
            </TabsList>

            {/* Contact Status Tab */}
            <TabsContent value="contact" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <SearchableStudentSelect
                  students={students}
                  value={formData.student_id}
                  onValueChange={handleStudentChange}
                  label="Select Student"
                  required
                />
                <div className="space-y-2">
                  <Label>Followup Priority</Label>
                  <Select value={formData.followup_priority} onValueChange={(v) => setFormData({...formData, followup_priority: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="High">High</SelectItem>
                      <SelectItem value="Medium">Medium</SelectItem>
                      <SelectItem value="Low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Checkbox
                      checked={formData.active_in_classes}
                      onCheckedChange={(checked) => setFormData({...formData, active_in_classes: checked})}
                    />
                    Active in Classes
                  </Label>
                </div>
                <div className="space-y-2">
                  <Label>Not Attending Reason</Label>
                  <Input
                    value={formData.not_attending_reason}
                    onChange={(e) => setFormData({...formData, not_attending_reason: e.target.value})}
                    placeholder="If not attending..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Last Contact Date</Label>
                  <Input
                    type="date"
                    value={formData.last_contact_date}
                    onChange={(e) => setFormData({...formData, last_contact_date: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Last Contact Person</Label>
                  <Input
                    value={formData.last_contact_person}
                    onChange={(e) => setFormData({...formData, last_contact_person: e.target.value})}
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Contact History</Label>
                  <Textarea
                    value={formData.contact_history}
                    onChange={(e) => setFormData({...formData, contact_history: e.target.value})}
                    placeholder="Detailed contact history..."
                    rows={4}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Preferred Contact Mode</Label>
                  <Select value={formData.preferred_contact_mode} onValueChange={(v) => setFormData({...formData, preferred_contact_mode: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Phone">Phone</SelectItem>
                      <SelectItem value="Email">Email</SelectItem>
                      <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                      <SelectItem value="In-Person">In-Person</SelectItem>
                      <SelectItem value="Video Call">Video Call</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>

            {/* Basic Info Tab */}
            <TabsContent value="basic" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone Number</Label>
                  <Input
                    value={formData.phone_number}
                    onChange={(e) => setFormData({...formData, phone_number: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Home Country Contact</Label>
                  <Input
                    value={formData.home_country_contact}
                    onChange={(e) => setFormData({...formData, home_country_contact: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Emergency Contact</Label>
                  <Input
                    value={formData.emergency_contact}
                    onChange={(e) => setFormData({...formData, emergency_contact: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Nationality</Label>
                  <Input
                    value={formData.nationality}
                    onChange={(e) => setFormData({...formData, nationality: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Gender</Label>
                  <Select value={formData.gender} onValueChange={(v) => setFormData({...formData, gender: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Date of Birth</Label>
                  <Input
                    type="date"
                    value={formData.dob}
                    onChange={(e) => setFormData({...formData, dob: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Occupation</Label>
                  <Input
                    value={formData.occupation}
                    onChange={(e) => setFormData({...formData, occupation: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Permanent Address</Label>
                  <Input
                    value={formData.permanent_address}
                    onChange={(e) => setFormData({...formData, permanent_address: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Residency Address</Label>
                  <Input
                    value={formData.residency_address}
                    onChange={(e) => setFormData({...formData, residency_address: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Passport Number</Label>
                  <Input
                    value={formData.passport_number}
                    onChange={(e) => setFormData({...formData, passport_number: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Emirates ID</Label>
                  <Input
                    value={formData.emirates_id}
                    onChange={(e) => setFormData({...formData, emirates_id: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Professional Photo</Label>
                  <div className="flex gap-2">
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'photo_url')}
                      disabled={uploadingPhoto}
                    />
                    {uploadingPhoto && <span className="text-sm text-gray-500">Uploading...</span>}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Passport Copy</Label>
                  <div className="flex gap-2">
                    <Input
                      type="file"
                      onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'passport_copy_url')}
                      disabled={uploadingPassport}
                    />
                    {uploadingPassport && <span className="text-sm text-gray-500">Uploading...</span>}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Date of Joining</Label>
                  <Input
                    type="date"
                    value={formData.date_of_joining}
                    onChange={(e) => setFormData({...formData, date_of_joining: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Course Enrolled</Label>
                  <Input
                    value={formData.course_enrolled}
                    onChange={(e) => setFormData({...formData, course_enrolled: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Preferred Language</Label>
                  <Input
                    value={formData.preferred_language}
                    onChange={(e) => setFormData({...formData, preferred_language: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Academic Counselors</Label>
                  <Select value={formData.academic_counselors} onValueChange={(v) => setFormData({...formData, academic_counselors: v})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select counselor" />
                    </SelectTrigger>
                    <SelectContent>
                      {academicCounselors.filter(c => c.status === 'Active').map(counselor => (
                        <SelectItem key={counselor.id} value={counselor.counselor_name}>
                          {counselor.counselor_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Mode of Study</Label>
                  <Select value={formData.mode_of_study} onValueChange={(v) => setFormData({...formData, mode_of_study: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Online">Online</SelectItem>
                      <SelectItem value="Offline">Offline</SelectItem>
                      <SelectItem value="Hybrid">Hybrid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Country of Attendance</Label>
                  <Select value={formData.country_of_attendance} onValueChange={(v) => setFormData({...formData, country_of_attendance: v})}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent>
                      {countries.map(country => (
                        <SelectItem key={country} value={country}>
                          {country}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Checkbox
                      checked={formData.joined_dollar_club}
                      onCheckedChange={(checked) => setFormData({...formData, joined_dollar_club: checked})}
                    />
                    Joined Dollar Club
                  </Label>
                </div>
              </div>
            </TabsContent>

            {/* Payment & Academic Tabs - Similar structure */}
            <TabsContent value="payment" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Course Amount</Label>
                  <Input
                    type="number"
                    value={formData.course_amount}
                    onChange={(e) => setFormData({...formData, course_amount: parseFloat(e.target.value) || 0})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Payment Status</Label>
                  <Select value={formData.payment_status} onValueChange={(v) => setFormData({...formData, payment_status: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Paid">Paid</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Partial">Partial</SelectItem>
                      <SelectItem value="Overdue">Overdue</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Payment Mode</Label>
                  <Input
                    value={formData.payment_mode}
                    onChange={(e) => setFormData({...formData, payment_mode: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Payment Date</Label>
                  <Input
                    type="date"
                    value={formData.payment_date}
                    onChange={(e) => setFormData({...formData, payment_date: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Payment Due</Label>
                  <Input
                    type="number"
                    value={formData.payment_due}
                    onChange={(e) => setFormData({...formData, payment_due: parseFloat(e.target.value) || 0})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Discount</Label>
                  <Input
                    type="number"
                    value={formData.discount}
                    onChange={(e) => setFormData({...formData, discount: parseFloat(e.target.value) || 0})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Amount Collected By</Label>
                  <Input
                    value={formData.amount_collected_by}
                    onChange={(e) => setFormData({...formData, amount_collected_by: e.target.value})}
                    placeholder="Person name"
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Payment History</Label>
                  <Textarea
                    value={formData.payment_history}
                    onChange={(e) => setFormData({...formData, payment_history: e.target.value})}
                    rows={3}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="induction" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Induction</Label>
                  <Select value={formData.induction_status} onValueChange={(v) => setFormData({...formData, induction_status: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Completed">Completed</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Not Started">Not Started</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Induction Done By</Label>
                  <Input
                    value={formData.induction_done_by}
                    onChange={(e) => setFormData({...formData, induction_done_by: e.target.value})}
                    placeholder="Name of person"
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Student Onboarding Document Status</Label>
                  <Input
                    value={formData.onboarding_document_status}
                    onChange={(e) => setFormData({...formData, onboarding_document_status: e.target.value})}
                    placeholder="Document status details"
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="academic" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Exam Date</Label>
                  <Input
                    type="date"
                    value={formData.exam_date}
                    onChange={(e) => setFormData({...formData, exam_date: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Exam Status</Label>
                  <Select value={formData.exam_status} onValueChange={(v) => setFormData({...formData, exam_status: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Attended">Attended</SelectItem>
                      <SelectItem value="Not Attended">Not Attended</SelectItem>
                      <SelectItem value="Scheduled">Scheduled</SelectItem>
                      <SelectItem value="Passed">Passed</SelectItem>
                      <SelectItem value="Failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>If Not Attended, Reason</Label>
                  <Input
                    value={formData.exam_not_attended_reason}
                    onChange={(e) => setFormData({...formData, exam_not_attended_reason: e.target.value})}
                    placeholder="Reason for not attending"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Exam Valuation Date</Label>
                  <Input
                    type="date"
                    value={formData.exam_valuation_date}
                    onChange={(e) => setFormData({...formData, exam_valuation_date: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Exam Evaluator</Label>
                  <Input
                    value={formData.exam_evaluator}
                    onChange={(e) => setFormData({...formData, exam_evaluator: e.target.value})}
                    placeholder="Evaluator name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Exam Marks</Label>
                  <Input
                    type="number"
                    value={formData.exam_marks}
                    onChange={(e) => setFormData({...formData, exam_marks: parseFloat(e.target.value) || 0})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Exam Result</Label>
                  <Select value={formData.exam_result} onValueChange={(v) => setFormData({...formData, exam_result: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Pass">Pass</SelectItem>
                      <SelectItem value="Fail">Fail</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>If Failed, Assigned Mentor</Label>
                  <Input
                    value={formData.failed_assigned_mentor}
                    onChange={(e) => setFormData({...formData, failed_assigned_mentor: e.target.value})}
                    placeholder="Mentor name"
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Reason for Failure</Label>
                  <Textarea
                    value={formData.failure_reason}
                    onChange={(e) => setFormData({...formData, failure_reason: e.target.value})}
                    placeholder="Detailed reason for failure"
                    rows={3}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="upgrade" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Upgrade Response</Label>
                  <Select value={formData.upgrade_response} onValueChange={(v) => setFormData({...formData, upgrade_response: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Interested">Interested</SelectItem>
                      <SelectItem value="Not Interested">Not Interested</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>If Not Interested Why</Label>
                  <Input
                    value={formData.upgrade_not_interested_reason}
                    onChange={(e) => setFormData({...formData, upgrade_not_interested_reason: e.target.value})}
                    placeholder="Reason"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Course to be Upgrade</Label>
                  <Input
                    value={formData.course_to_upgrade}
                    onChange={(e) => setFormData({...formData, course_to_upgrade: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date of Upgrade</Label>
                  <Input
                    type="date"
                    value={formData.upgrade_date}
                    onChange={(e) => setFormData({...formData, upgrade_date: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Month of Upgrade</Label>
                  <Input
                    value={formData.upgrade_month}
                    onChange={(e) => setFormData({...formData, upgrade_month: e.target.value})}
                    placeholder="e.g., January 2026"
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="convocation" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Convocation</Label>
                  <Input
                    value={formData.convocation_status}
                    onChange={(e) => setFormData({...formData, convocation_status: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Certificate Status (KHDA, Delta)</Label>
                  <Input
                    value={formData.certificate_status}
                    onChange={(e) => setFormData({...formData, certificate_status: e.target.value})}
                    placeholder="e.g., KHDA Approved"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Convocation Month</Label>
                  <Input
                    value={formData.convocation_month}
                    onChange={(e) => setFormData({...formData, convocation_month: e.target.value})}
                    placeholder="e.g., March 2026"
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="traders" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Checkbox
                      checked={formData.invited_traders_dayout}
                      onCheckedChange={(checked) => setFormData({...formData, invited_traders_dayout: checked})}
                    />
                    Invited for Traders Day Out
                  </Label>
                </div>
                <div className="space-y-2">
                  <Label>Reason for Invite</Label>
                  <Input
                    value={formData.traders_dayout_invite_reason}
                    onChange={(e) => setFormData({...formData, traders_dayout_invite_reason: e.target.value})}
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Outcome for Traders Dayout</Label>
                  <Textarea
                    value={formData.traders_dayout_outcome}
                    onChange={(e) => setFormData({...formData, traders_dayout_outcome: e.target.value})}
                    rows={3}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="livetrade" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Trading Journal Management</Label>
                  <Input
                    value={formData.trading_journal_management}
                    onChange={(e) => setFormData({...formData, trading_journal_management: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Journal Link</Label>
                  <Input
                    value={formData.trading_journal_link}
                    onChange={(e) => setFormData({...formData, trading_journal_link: e.target.value})}
                    placeholder="https://"
                  />
                </div>
                <div className="space-y-2">
                  <Label>How Many Live Trades Attended So Far</Label>
                  <Input
                    type="number"
                    value={formData.live_trades_attended_count}
                    onChange={(e) => setFormData({...formData, live_trades_attended_count: parseInt(e.target.value) || 0})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Last Attended Live Trade</Label>
                  <Input
                    type="date"
                    value={formData.last_attended_live_trade}
                    onChange={(e) => setFormData({...formData, last_attended_live_trade: e.target.value})}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="ssf" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Checkbox
                      checked={formData.potential_to_deposit}
                      onCheckedChange={(checked) => setFormData({...formData, potential_to_deposit: checked})}
                    />
                    Is He Potential to Deposit
                  </Label>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Checkbox
                      checked={formData.easy_to_convince}
                      onCheckedChange={(checked) => setFormData({...formData, easy_to_convince: checked})}
                    />
                    Easy to Convince
                  </Label>
                </div>
                <div className="space-y-2">
                  <Label>Total Loss from Trading</Label>
                  <Input
                    type="number"
                    value={formData.total_loss_from_trading}
                    onChange={(e) => setFormData({...formData, total_loss_from_trading: parseFloat(e.target.value) || 0})}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="rejoining" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Rejoining Response</Label>
                  <Select value={formData.rejoining_response} onValueChange={(v) => setFormData({...formData, rejoining_response: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Interested">Interested</SelectItem>
                      <SelectItem value="Not Interested">Not Interested</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Date of Rejoining</Label>
                  <Input
                    type="date"
                    value={formData.rejoining_date}
                    onChange={(e) => setFormData({...formData, rejoining_date: e.target.value})}
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Measures Taken for Rejoining</Label>
                  <Textarea
                    value={formData.rejoining_measures}
                    onChange={(e) => setFormData({...formData, rejoining_measures: e.target.value})}
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Rejoined Class</Label>
                  <Input
                    value={formData.rejoined_class}
                    onChange={(e) => setFormData({...formData, rejoined_class: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Sales Person (Rejoining by Admin Team)</Label>
                  <Input
                    value={formData.rejoining_sales_person}
                    onChange={(e) => setFormData({...formData, rejoining_sales_person: e.target.value})}
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Rejoinees Feedback</Label>
                  <Textarea
                    value={formData.rejoinees_feedback}
                    onChange={(e) => setFormData({...formData, rejoinees_feedback: e.target.value})}
                    rows={3}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="seminar" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Number of Seminars Attended</Label>
                  <Input
                    type="number"
                    value={formData.seminars_attended_count}
                    onChange={(e) => setFormData({...formData, seminars_attended_count: parseInt(e.target.value) || 0})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>If Not Attended, Reason</Label>
                  <Input
                    value={formData.seminars_not_attended_reason}
                    onChange={(e) => setFormData({...formData, seminars_not_attended_reason: e.target.value})}
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>List of Online Seminars Attended</Label>
                  <Textarea
                    value={formData.online_seminars_list}
                    onChange={(e) => setFormData({...formData, online_seminars_list: e.target.value})}
                    placeholder="List online seminars..."
                    rows={3}
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>List of Offline Seminars Attended</Label>
                  <Textarea
                    value={formData.offline_seminars_list}
                    onChange={(e) => setFormData({...formData, offline_seminars_list: e.target.value})}
                    placeholder="List offline seminars..."
                    rows={3}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="practice" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Mentor Assigned (Last)</Label>
                  <Input
                    value={formData.mentor_assigned}
                    onChange={(e) => setFormData({...formData, mentor_assigned: e.target.value})}
                    placeholder="Mentor name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Practice Sessions Attended</Label>
                  <Input
                    type="number"
                    value={formData.practice_sessions_attended}
                    onChange={(e) => setFormData({...formData, practice_sessions_attended: parseInt(e.target.value) || 0})}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Checkbox
                      checked={formData.attended_senior_mentor_class}
                      onCheckedChange={(checked) => setFormData({...formData, attended_senior_mentor_class: checked})}
                    />
                    Did the Student Attend Senior Mentor Class
                  </Label>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Checkbox
                      checked={formData.discussion_with_senior_mentor}
                      onCheckedChange={(checked) => setFormData({...formData, discussion_with_senior_mentor: checked})}
                    />
                    Did the Client Have Discussion Session with Senior Mentors
                  </Label>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="trading" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Trading Status</Label>
                  <Input
                    value={formData.trading_status}
                    onChange={(e) => setFormData({...formData, trading_status: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Current Broker</Label>
                  <Input
                    value={formData.current_broker}
                    onChange={(e) => setFormData({...formData, current_broker: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Assets Traded</Label>
                  <Input
                    value={formData.assets_traded}
                    onChange={(e) => setFormData({...formData, assets_traded: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Current P/L</Label>
                  <Input
                    type="number"
                    value={formData.current_profit_loss}
                    onChange={(e) => setFormData({...formData, current_profit_loss: parseFloat(e.target.value) || 0})}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="feedback" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 col-span-2">
                  <Label>Feedback</Label>
                  <Textarea
                    value={formData.feedback}
                    onChange={(e) => setFormData({...formData, feedback: e.target.value})}
                    rows={4}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Checkbox
                      checked={formData.testimonial_done}
                      onCheckedChange={(checked) => setFormData({...formData, testimonial_done: checked})}
                    />
                    Testimonial Done
                  </Label>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Checkbox
                      checked={formData.google_review}
                      onCheckedChange={(checked) => setFormData({...formData, google_review: checked})}
                    />
                    Google Review
                  </Label>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="pipscraft" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Checkbox
                      checked={formData.subscribed_for_pipscraft}
                      onCheckedChange={(checked) => setFormData({...formData, subscribed_for_pipscraft: checked})}
                    />
                    Subscribed for Pips Craft
                  </Label>
                </div>
                <div className="space-y-2">
                  <Label>When Subscribed for Pipscraft</Label>
                  <Input
                    type="date"
                    value={formData.pipscraft_subscription_date}
                    onChange={(e) => setFormData({...formData, pipscraft_subscription_date: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Checkbox
                      checked={formData.still_using_pipscraft}
                      onCheckedChange={(checked) => setFormData({...formData, still_using_pipscraft: checked})}
                    />
                    Is the Client Still Using the Service
                  </Label>
                </div>
                <div className="space-y-2">
                  <Label>Is the Client Satisfied with Service</Label>
                  <Select value={formData.pipscraft_satisfaction} onValueChange={(v) => setFormData({...formData, pipscraft_satisfaction: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Satisfied">Satisfied</SelectItem>
                      <SelectItem value="Not Satisfied">Not Satisfied</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>If Not Satisfied, Why</Label>
                  <Textarea
                    value={formData.pipscraft_not_satisfied_reason}
                    onChange={(e) => setFormData({...formData, pipscraft_not_satisfied_reason: e.target.value})}
                    placeholder="Reason for not being satisfied..."
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Pipscraft Subscribed Agent</Label>
                  <Input
                    value={formData.pipscraft_subscribed_agent}
                    onChange={(e) => setFormData({...formData, pipscraft_subscribed_agent: e.target.value})}
                    placeholder="Agent name"
                  />
                </div>
              </div>
            </TabsContent>
                </Tabs>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : log ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}