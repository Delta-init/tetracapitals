import React, { useState } from 'react';
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import SearchableStudentSelect from '../common/SearchableStudentSelect';

const DEPOSIT_PAYMENT_METHODS = [
  'AED TRANSFER',
  'UPI',
  'CARD PAYMENT',
  'USDT',
  'INR TRANSFER',
  'Cash deposit',
  'Other'
];

const WITHDRAWAL_PAYMENT_METHODS = [
  'AED TRANSFER',
  'UPI',
  'CARD PAYMENT',
  'USDT',
  'INR TRANSFER',
  'Cash Withdrawal',
  'Bank Withdrawal',
  'Other'
];

export default function AddTransactionDialog({ open, onClose, onSubmit, students, isSubmitting }) {
  const [formData, setFormData] = useState({
    type: 'DEPOSIT',
    student_id: '',
    amount_usd: '',
    payment_method: '',
    mt5_login: '',
    user_id: '',
    transaction_id: '',
    screenshot_url: '',
    notes: ''
  });
  const [uploading, setUploading] = useState(false);

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

  const handleSubmit = (e) => {
    e.preventDefault();

    const selectedStudent = students.find(s => s.id === formData.student_id);
    if (!selectedStudent) {
      toast.error('Please select a student');
      return;
    }

    const dataToSubmit = {
      ...formData,
      amount_usd: parseFloat(formData.amount_usd),
      status: 'PENDING',
      student_name: selectedStudent.full_name,
      student_code: selectedStudent.student_code,
      primary_mentor_id: selectedStudent.primary_mentor_id,
      primary_mentor_name: selectedStudent.primary_mentor_name,
      senior_mentor_id: selectedStudent.senior_mentor_id,
      senior_mentor_name: selectedStudent.senior_mentor_name
    };

    onSubmit(dataToSubmit);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Funding Transaction</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Transaction Type *</Label>
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
                </SelectContent>
              </Select>
            </div>

            <SearchableStudentSelect
              students={students}
              value={formData.student_id}
              onValueChange={(value) => {
                const selectedStudent = students.find(s => s.id === value);
                setFormData({ 
                  ...formData, 
                  student_id: value,
                  user_id: selectedStudent?.user_id || ''
                });
              }}
              label="Student"
              required
            />

            <div className="space-y-2">
              <Label>Amount (USD) *</Label>
              <Input
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
              <Label>Payment Method *</Label>
              <Select
                value={formData.payment_method}
                onValueChange={(value) => setFormData({ ...formData, payment_method: value })}
                required
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  {(formData.type === 'WITHDRAWAL' ? WITHDRAWAL_PAYMENT_METHODS : DEPOSIT_PAYMENT_METHODS).map((method) => (
                    <SelectItem key={method} value={method}>
                      {method}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>MT5 Login</Label>
              <Input
                value={formData.mt5_login}
                onChange={(e) => setFormData({ ...formData, mt5_login: e.target.value })}
                placeholder="Enter MT5 login"
              />
            </div>

            <div className="space-y-2">
              <Label>User ID</Label>
              <Input
                value={formData.user_id}
                onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                placeholder="Auto-populated from student"
                disabled
                className="bg-gray-50"
              />
            </div>

            <div className="space-y-2">
              <Label>Transaction ID</Label>
              <Input
                value={formData.transaction_id}
                onChange={(e) => setFormData({ ...formData, transaction_id: e.target.value })}
                placeholder="External transaction ID"
              />
            </div>

            <div className="space-y-2">
              <Label>Screenshot</Label>
              <div className="flex items-center gap-2">
                <Input
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

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              placeholder="Additional notes..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
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
                  Creating...
                </>
              ) : (
                'Create Transaction'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}