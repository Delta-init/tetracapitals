import React, { useState } from 'react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export default function TargetForm({ mentors, onSubmit, onCancel, isSubmitting }) {
  const [formData, setFormData] = useState({
    mentor_id: '',
    period_type: 'WEEKLY',
    period_start_date: '',
    period_end_date: '',
    target_net_deposit_usd: '',
    notes: ''
  });

  const handlePeriodTypeChange = (type) => {
    setFormData({ ...formData, period_type: type, period_start_date: '', period_end_date: '' });
  };

  const handleStartDateChange = (date) => {
    const start = new Date(date);
    let end = new Date(date);
    
    if (formData.period_type === 'WEEKLY') {
      end.setDate(start.getDate() + 6);
    } else if (formData.period_type === 'MONTHLY') {
      end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    } else if (formData.period_type === 'QUARTERLY') {
      const quarter = Math.floor(start.getMonth() / 3);
      end = new Date(start.getFullYear(), (quarter + 1) * 3, 0);
    }
    
    setFormData({
      ...formData,
      period_start_date: date,
      period_end_date: end.toISOString().split('T')[0]
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const mentor = mentors.find(m => m.id === formData.mentor_id);
    if (!mentor) return;
    
    const dataToSubmit = {
      ...formData,
      mentor_name: mentor.full_name,
      target_net_deposit_usd: parseFloat(formData.target_net_deposit_usd),
      target_status: new Date() < new Date(formData.period_start_date) ? 'NOT_STARTED' : 'IN_PROGRESS',
      achievement_net_deposit_usd: 0,
      achievement_percent: 0
    };
    
    onSubmit(dataToSubmit);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="mentor">Mentor *</Label>
          <Select
            value={formData.mentor_id}
            onValueChange={(value) => setFormData({ ...formData, mentor_id: value })}
            required
          >
            <SelectTrigger>
              <SelectValue placeholder="Select mentor" />
            </SelectTrigger>
            <SelectContent>
              {mentors.map((mentor) => (
                <SelectItem key={mentor.id} value={mentor.id}>
                  {mentor.full_name} ({mentor.app_role === 'junior_mentor' ? 'Junior' : 'Senior'})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="period_type">Period Type *</Label>
          <Select
            value={formData.period_type}
            onValueChange={handlePeriodTypeChange}
            required
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="WEEKLY">Weekly</SelectItem>
              <SelectItem value="MONTHLY">Monthly</SelectItem>
              <SelectItem value="QUARTERLY">Quarterly</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="start_date">Period Start Date *</Label>
          <Input
            id="start_date"
            type="date"
            value={formData.period_start_date}
            onChange={(e) => handleStartDateChange(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="end_date">Period End Date *</Label>
          <Input
            id="end_date"
            type="date"
            value={formData.period_end_date}
            onChange={(e) => setFormData({ ...formData, period_end_date: e.target.value })}
            required
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="target">Target Net Deposit (USD) *</Label>
          <Input
            id="target"
            type="number"
            step="0.01"
            min="0"
            value={formData.target_net_deposit_usd}
            onChange={(e) => setFormData({ ...formData, target_net_deposit_usd: e.target.value })}
            placeholder="0.00"
            required
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="Additional notes..."
            rows={3}
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700">
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            'Create Target'
          )}
        </Button>
      </div>
    </form>
  );
}