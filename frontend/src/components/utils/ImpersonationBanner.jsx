import React from 'react';
import { Button } from '@/components/ui/button';
import { UserX, Eye } from 'lucide-react';
import { stopImpersonation, getImpersonationState } from './ImpersonationContext';

export default function ImpersonationBanner() {
  const state = getImpersonationState();
  if (!state) return null;

  const { targetUser, adminUser } = state;

  return (
    <div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-between text-sm font-medium shadow-lg z-50 sticky top-0">
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4 flex-shrink-0" />
        <span>
          Viewing as <strong>{targetUser.full_name}</strong> ({targetUser.app_role?.replace(/_/g, ' ')})
          {' — '}actions are logged under impersonation
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={stopImpersonation}
        className="text-white hover:bg-amber-600 border border-white/40 flex items-center gap-1.5 ml-4 flex-shrink-0"
      >
        <UserX className="h-4 w-4" />
        Return to My Account
      </Button>
    </div>
  );
}