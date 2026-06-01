import React, { useState } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, CheckCircle } from "lucide-react";
import { canCreateMT5Account } from "../utils/StudentAccessControl";
import { toast } from "sonner";

export default function MT5AccountSection({ student, currentUser }) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [formData, setFormData] = useState({
    mt5_login: '',
    platform: 'MT5',
    account_type: 'LIVE',
    base_currency: 'USD',
    is_primary: false
  });

  const queryClient = useQueryClient();

  const { data: mt5Accounts = [] } = useQuery({
    queryKey: ['mt5accounts', student.id],
    queryFn: async () => {
      const accounts = await base44.entities.MT5Account.list();
      return accounts.filter(acc => acc.student_id === student.id);
    }
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.MT5Account.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['mt5accounts']);
      setShowAddDialog(false);
      toast.success('MT5 Account added successfully');
      resetForm();
    }
  });

  const resetForm = () => {
    setFormData({
      mt5_login: '',
      platform: 'MT5',
      account_type: 'LIVE',
      base_currency: 'USD',
      is_primary: false
    });
  };

  const handleSubmit = () => {
    const dataToSave = {
      ...formData,
      student_id: student.id,
      student_name: student.full_name,
      student_code: student.student_code
    };
    createMutation.mutate(dataToSave);
  };

  const canCreate = canCreateMT5Account(currentUser?.role);

  return (
    <Card className="border-gray-200">
      <CardHeader className="border-b border-gray-100 flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold">MT5 Accounts</CardTitle>
        {canCreate && (
          <Button
            size="sm"
            onClick={() => setShowAddDialog(true)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add MT5 Account
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-6">
        {mt5Accounts.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No MT5 accounts added yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {mt5Accounts.map((account) => (
              <div
                key={account.id}
                className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-semibold text-lg text-gray-900">
                        {account.mt5_login}
                      </span>
                      {account.is_primary && (
                        <Badge className="bg-blue-100 text-blue-800 border-blue-200">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Primary
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="text-gray-500">Platform:</span>
                        <span className="ml-2 font-medium text-gray-900">
                          {account.platform}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Type:</span>
                        <span className="ml-2 font-medium text-gray-900">
                          {account.account_type || 'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Currency:</span>
                        <span className="ml-2 font-medium text-gray-900">
                          {account.base_currency}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Created:</span>
                        <span className="ml-2 font-medium text-gray-900">
                          {new Date(account.created_date).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Add MT5 Account Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add MT5 Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mt5_login">MT5 Login *</Label>
              <Input
                id="mt5_login"
                value={formData.mt5_login}
                onChange={(e) => setFormData({ ...formData, mt5_login: e.target.value })}
                placeholder="Enter MT5 login ID"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="platform">Platform</Label>
              <Select
                value={formData.platform}
                onValueChange={(value) => setFormData({ ...formData, platform: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MT5">MT5</SelectItem>
                  <SelectItem value="MT4">MT4</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="account_type">Account Type</Label>
              <Input
                id="account_type"
                value={formData.account_type}
                onChange={(e) => setFormData({ ...formData, account_type: e.target.value })}
                placeholder="e.g., LIVE, DEMO"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="base_currency">Base Currency</Label>
              <Input
                id="base_currency"
                value={formData.base_currency}
                onChange={(e) => setFormData({ ...formData, base_currency: e.target.value })}
                disabled
              />
              <p className="text-xs text-gray-500">All calculations are in USD</p>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="is_primary"
                checked={formData.is_primary}
                onChange={(e) => setFormData({ ...formData, is_primary: e.target.checked })}
                className="rounded border-gray-300"
              />
              <Label htmlFor="is_primary" className="font-normal cursor-pointer">
                Set as primary account
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || !formData.mt5_login}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {createMutation.isPending ? 'Adding...' : 'Add Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}