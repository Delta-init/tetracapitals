import React, { useState, useEffect } from 'react';
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Save, RotateCcw } from "lucide-react";
import { getDefaultSettings } from "../components/utils/GamificationUtils";
import { toast } from "sonner";
import { logAction } from "../components/utils/AuditLogger";

export default function GamificationSettings() {
  const [currentUser, setCurrentUser] = useState(null);
  const [formData, setFormData] = useState({});

  const queryClient = useQueryClient();

  useEffect(() => {
    const fetchUser = async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  const { data: settings = [] } = useQuery({
    queryKey: ['gamification-settings'],
    queryFn: () => base44.entities.GamificationSettings.list(),
    enabled: !!currentUser,
    onSuccess: (data) => {
      const mapped = {};
      data.forEach(s => {
        mapped[s.setting_key] = s.setting_value;
      });
      setFormData(mapped);
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (settingData) => {
      const existing = settings.find(s => s.setting_key === settingData.setting_key);
      if (existing) {
        return base44.entities.GamificationSettings.update(existing.id, settingData);
      } else {
        return base44.entities.GamificationSettings.create(settingData);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gamification-settings'] });
    }
  });

  const createDefaultMutation = useMutation({
    mutationFn: (data) => base44.entities.GamificationSettings.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gamification-settings'] });
      toast.success('Default settings created');
    }
  });

  useEffect(() => {
    if (settings.length > 0) {
      const mapped = {};
      settings.forEach(s => {
        mapped[s.setting_key] = s.setting_value;
      });
      setFormData(mapped);
    }
  }, [settings]);

  const handleSave = async () => {
    try {
      const defaults = getDefaultSettings();
      
      for (const defaultSetting of defaults) {
        const value = formData[defaultSetting.setting_key];
        if (value !== undefined) {
          await updateMutation.mutateAsync({
            setting_key: defaultSetting.setting_key,
            setting_value: parseFloat(value),
            description: defaultSetting.description,
            updated_by_id: currentUser.id,
            updated_by_name: currentUser.full_name
          });
        }
      }
      
      await logAction('update_gamification_settings', 'GamificationSettings', null, 'Updated gamification settings', null, formData);
      toast.success('Settings saved successfully!');
    } catch (error) {
      toast.error('Failed to save settings');
      console.error(error);
    }
  };

  const handleCreateDefaults = async () => {
    try {
      const defaults = getDefaultSettings();
      
      for (const setting of defaults) {
        const exists = settings.find(s => s.setting_key === setting.setting_key);
        if (!exists) {
          await createDefaultMutation.mutateAsync({
            ...setting,
            updated_by_id: currentUser.id,
            updated_by_name: currentUser.full_name
          });
        }
      }
    } catch (error) {
      toast.error('Failed to create default settings');
      console.error(error);
    }
  };

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!['super_admin', 'academic_head'].includes(currentUser.app_role)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-xl text-gray-600">Access Denied</p>
          <p className="text-sm text-gray-500 mt-2">You don't have permission to access this page</p>
        </div>
      </div>
    );
  }

  const defaultSettings = getDefaultSettings();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
              <Settings className="h-8 w-8 text-blue-600" />
              Gamification Settings
            </h1>
            <p className="text-gray-600 mt-2 text-base">Configure point values and rules</p>
          </div>
          {settings.length === 0 && (
            <Button onClick={handleCreateDefaults} variant="outline">
              <RotateCcw className="h-4 w-4 mr-2" />
              Create Defaults
            </Button>
          )}
        </div>

        {/* Settings Form */}
        <Card className="border-gray-200">
          <CardHeader className="border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
            <CardTitle className="text-lg font-semibold tracking-tight">Point Configuration</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {defaultSettings.map((setting) => (
              <div key={setting.setting_key} className="space-y-2">
                <Label className="text-base font-semibold">{setting.description}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData[setting.setting_key] || setting.setting_value}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    [setting.setting_key]: parseFloat(e.target.value) 
                  })}
                  className="max-w-xs"
                />
                <p className="text-sm text-gray-500">
                  Current value: {formData[setting.setting_key] || setting.setting_value}
                </p>
              </div>
            ))}

            <div className="pt-4 border-t border-gray-200">
              <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700">
                <Save className="h-4 w-4 mr-2" />
                Save Settings
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-6">
            <h3 className="font-semibold text-blue-900 mb-2">How Points Work</h3>
            <ul className="space-y-2 text-sm text-blue-800">
              <li>• <strong>Deposit Points:</strong> Calculated based on net deposits (deposits - withdrawals)</li>
              <li>• <strong>Student Points:</strong> Awarded for each unique student with minimum qualifying deposit</li>
              <li>• <strong>Streak Bonus:</strong> Extra points awarded for consecutive weeks of activity (4+ weeks)</li>
              <li>• <strong>Badges:</strong> Automatically awarded based on achievements and milestones</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}