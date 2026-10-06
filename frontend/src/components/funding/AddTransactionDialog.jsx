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
import TagsPicker from './TagsPicker';
import { PaymentRows, newPayment, paymentsTotal, paymentsMissing, paymentsToSave } from './payments';

// A withdrawal's method. Money in — a deposit or a bonus — is taken as payments, each with its own (./payments).
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
    notes: '',
    tags: [],
  });
  const [uploading, setUploading] = useState(false);
  // Money received — a deposit or a bonus — as payments, as on the CS's form: each with its method, amount (USD) and
  // receipt, adding up to the amount. A withdrawal has one amount and method, and no receipt yet.
  const [payments, setPayments] = useState(() => [newPayment()]);
  const takesPayments = formData.type !== 'WITHDRAWAL';

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploading(true);
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        setFormData(f => ({ ...f, screenshot_url: file_url }));
        toast.success('Receipt uploaded');
      } catch (error) {
        toast.error('Failed to upload the receipt');
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

    if (formData.type === 'BONUS' && (!formData.tags || formData.tags.length === 0)) {
      toast.error('Please pick a tag for the bonus');
      return;
    }

    const missing = takesPayments ? paymentsMissing(payments) : uploading ? 'Wait for the receipt to finish uploading' : '';
    if (missing) {
      toast.error(missing);
      return;
    }

    const dataToSubmit = {
      ...formData,
      amount_usd: takesPayments ? paymentsTotal(payments) : parseFloat(formData.amount_usd),
      // Money in: every payment, and the first one's method and receipt where only one is read (./payments).
      ...(takesPayments ? {
        payments: paymentsToSave(payments, 'USD'),
        payment_method: payments[0].method,
        screenshot_url: payments[0].receipt_url,
      } : {}),
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
                  <SelectItem value="BONUS">Bonus</SelectItem>
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

            {formData.type === 'BONUS' && (
              <div className="space-y-2 md:col-span-2">
                <Label>Tag *</Label>
                <TagsPicker
                  value={formData.tags}
                  onChange={(tags) => setFormData({ ...formData, tags })}
                />
              </div>
            )}

            {takesPayments ? (
              <div className="space-y-2 md:col-span-2">
                <Label>Payments (USD) *</Label>
                {/* Part by card, part in cash: each payment with its method, amount and receipt — Finance sees them all */}
                <PaymentRows rows={payments} onChange={setPayments} currency="USD" />
                {paymentsTotal(payments) > 0 && (
                  <p className="text-xs text-muted-foreground">Total ${paymentsTotal(payments).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                )}
              </div>
            ) : (<>
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
                    {WITHDRAWAL_PAYMENT_METHODS.map((method) => (
                      <SelectItem key={method} value={method}>
                        {method}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>)}

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

            {/* A withdrawal's receipt, if there is one yet — money in has a receipt on each payment above */}
            {!takesPayments && (
              <div className="space-y-2">
                <Label>Receipt (optional)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleFileUpload}
                    disabled={uploading}
                  />
                  {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                </div>
                {formData.screenshot_url ? (
                  <p className="text-xs text-green-600">
                    ✓ Receipt uploaded · <a href={formData.screenshot_url} target="_blank" rel="noopener noreferrer" className="underline">View</a>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">A withdrawal has no receipt yet.</p>
                )}
              </div>
            )}
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