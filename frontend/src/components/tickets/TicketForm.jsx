import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import { Info } from 'lucide-react';

const CATEGORY_ROLE_LABEL = {
  academic: 'Academic Head',
  financial: 'Finance Admin',
  technical: 'Broker Admin',
  general: 'Academic Head',
};

export default function TicketForm({ onSubmit, onCancel, isSubmitting, students = [], currentUser }) {
  const [form, setForm] = useState({
    category: '',
    title: '',
    priority: 'medium',
    student_id: '',
    description: '',
    screenshot_url: '',
  });
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setForm(f => ({ ...f, screenshot_url: file_url }));
    setUploading(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const student = students.find(s => s.id === form.student_id);
    onSubmit({
      ...form,
      student_name: student?.full_name || '',
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Category */}
      <div className="space-y-1">
        <Label>Category *</Label>
        <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
          <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="academic">Academic Issue</SelectItem>
            <SelectItem value="financial">Financial Issue</SelectItem>
            <SelectItem value="technical">Technical Issue</SelectItem>
            <SelectItem value="general">General Query</SelectItem>
          </SelectContent>
        </Select>
        {form.category && (
          <p className="flex items-center gap-1 text-xs text-blue-600 mt-1">
            <Info className="h-3 w-3" />
            This ticket will be assigned to <strong>{CATEGORY_ROLE_LABEL[form.category]}</strong>
          </p>
        )}
      </div>

      {/* Title */}
      <div className="space-y-1">
        <Label>Title *</Label>
        <Input
          required
          value={form.title}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="Short summary of the issue"
        />
      </div>

      {/* Priority */}
      <div className="space-y-1">
        <Label>Priority *</Label>
        <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Student (optional) */}
      {students.length > 0 && (
        <div className="space-y-1">
          <Label>Student (Optional)</Label>
          <Select value={form.student_id} onValueChange={v => setForm(f => ({ ...f, student_id: v }))}>
            <SelectTrigger><SelectValue placeholder="Select student" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>None</SelectItem>
              {students.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.student_code} — {s.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Description */}
      <div className="space-y-1">
        <Label>Description *</Label>
        <Textarea
          required
          rows={5}
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder="Detailed description of your issue..."
        />
      </div>

      {/* Screenshot */}
      <div className="space-y-1">
        <Label>Screenshot (Optional)</Label>
        <Input type="file" accept="image/*" onChange={handleFileUpload} disabled={uploading} />
        {uploading && <p className="text-xs text-gray-500">Uploading...</p>}
        {form.screenshot_url && <p className="text-xs text-green-600">Screenshot uploaded ✓</p>}
      </div>

      <div className="flex justify-end gap-3 pt-2 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button
          type="submit"
          disabled={isSubmitting || uploading || !form.category || !form.title || !form.description}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {isSubmitting ? 'Submitting...' : 'Submit Ticket'}
        </Button>
      </div>
    </form>
  );
}