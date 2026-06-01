import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Edit } from "lucide-react";
import { format } from "date-fns";

export default function StudentLogDetails({ log, open, onClose, onEdit }) {
  const InfoSection = ({ title, items }) => (
    <Card className="mb-4">
      <CardHeader className="bg-gray-50">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {items.map(({ label, value }) => (
            <div key={label}>
              <dt className="text-gray-600 font-medium">{label}</dt>
              <dd className="text-gray-900 mt-1">{value || '-'}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Student Log Details - {log.student_name}</DialogTitle>
            <Button size="sm" onClick={onEdit}>
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <InfoSection
            title="Contact Status"
            items={[
              { label: 'Student Code', value: log.student_code },
              { label: 'Followup Priority', value: <Badge className={log.followup_priority === 'High' ? 'bg-red-100 text-red-800' : log.followup_priority === 'Medium' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}>{log.followup_priority}</Badge> },
              { label: 'Active in Classes', value: log.active_in_classes ? 'Yes' : 'No' },
              { label: 'Not Attending Reason', value: log.not_attending_reason },
              { label: 'Last Contact Date', value: log.last_contact_date ? format(new Date(log.last_contact_date), 'MMM d, yyyy') : '-' },
              { label: 'Last Contact Person', value: log.last_contact_person },
              { label: 'Preferred Contact Mode', value: log.preferred_contact_mode }
            ]}
          />

          <InfoSection
            title="Basic Information"
            items={[
              { label: 'Email', value: log.email },
              { label: 'Phone', value: log.phone_number },
              { label: 'Nationality', value: log.nationality },
              { label: 'Gender', value: log.gender },
              { label: 'Date of Birth', value: log.dob ? format(new Date(log.dob), 'MMM d, yyyy') : '-' },
              { label: 'Occupation', value: log.occupation },
              { label: 'Course Enrolled', value: log.course_enrolled },
              { label: 'Mode of Study', value: log.mode_of_study }
            ]}
          />

          <InfoSection
            title="Payment Status"
            items={[
              { label: 'Course Amount', value: log.course_amount ? `$${log.course_amount}` : '-' },
              { label: 'Payment Status', value: <Badge>{log.payment_status}</Badge> },
              { label: 'Payment Mode', value: log.payment_mode },
              { label: 'Payment Date', value: log.payment_date ? format(new Date(log.payment_date), 'MMM d, yyyy') : '-' },
              { label: 'Payment Due', value: log.payment_due ? `$${log.payment_due}` : '-' },
              { label: 'Discount', value: log.discount ? `$${log.discount}` : '-' }
            ]}
          />

          <InfoSection
            title="Academic Status"
            items={[
              { label: 'Exam Date', value: log.exam_date ? format(new Date(log.exam_date), 'MMM d, yyyy') : '-' },
              { label: 'Exam Status', value: <Badge>{log.exam_status}</Badge> },
              { label: 'Exam Marks', value: log.exam_marks },
              { label: 'Exam Result', value: <Badge className={log.exam_result === 'Pass' ? 'bg-green-100 text-green-800' : log.exam_result === 'Fail' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}>{log.exam_result}</Badge> },
              { label: 'Induction Status', value: log.induction_status },
              { label: 'Current Class Status', value: log.current_class_status }
            ]}
          />

          <InfoSection
            title="Trading Status"
            items={[
              { label: 'Trading Status', value: log.trading_status },
              { label: 'Current Broker', value: log.current_broker },
              { label: 'Assets Traded', value: log.assets_traded },
              { label: 'Current P/L', value: log.current_profit_loss ? `$${log.current_profit_loss}` : '-' },
              { label: 'Potential to Deposit', value: log.potential_to_deposit ? 'Yes' : 'No' },
              { label: 'Live Trades Attended', value: log.live_trades_attended_count }
            ]}
          />

          <InfoSection
            title="Engagement"
            items={[
              { label: 'Practice Sessions', value: log.practice_sessions_attended },
              { label: 'Seminars Attended', value: log.seminars_attended_count },
              { label: 'Testimonial Done', value: log.testimonial_done ? 'Yes' : 'No' },
              { label: 'Google Review', value: log.google_review ? 'Yes' : 'No' },
              { label: 'Senior Mentor Class', value: log.attended_senior_mentor_class ? 'Yes' : 'No' },
              { label: 'Discussion with Senior', value: log.discussion_with_senior_mentor ? 'Yes' : 'No' }
            ]}
          />

          {log.contact_history && (
            <Card>
              <CardHeader className="bg-gray-50">
                <CardTitle className="text-base">Contact History</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{log.contact_history}</p>
              </CardContent>
            </Card>
          )}

          {log.feedback && (
            <Card>
              <CardHeader className="bg-gray-50">
                <CardTitle className="text-base">Feedback</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{log.feedback}</p>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}