import { base44 } from "@/api/base44Client";
import { getImpersonationState } from './ImpersonationContext';

export const logAction = async (actionType, entityType, entityId, details, oldValue, newValue) => {
  try {
    const user = await base44.auth.me();
    const impersonation = getImpersonationState();
    
    const detailsObj = details ? (typeof details === 'string' ? { message: details } : details) : {};
    if (impersonation) {
      detailsObj._impersonated_by = impersonation.adminUser.full_name;
      detailsObj._impersonated_by_id = impersonation.adminUser.id;
      detailsObj._acting_as = impersonation.targetUser.full_name;
    }

    await base44.entities.Log.create({
      timestamp: new Date().toISOString(),
      user_id: impersonation ? impersonation.targetUser.id : user.id,
      user_email: impersonation ? impersonation.targetUser.email : user.email,
      user_name: impersonation ? `${impersonation.targetUser.full_name} [via ${impersonation.adminUser.full_name}]` : user.full_name,
      user_role: impersonation ? impersonation.targetUser.app_role : user.app_role,
      action_type: actionType,
      entity_type: entityType,
      entity_id: entityId,
      details: JSON.stringify(detailsObj),
      old_value: oldValue ? JSON.stringify(oldValue) : null,
      new_value: newValue ? JSON.stringify(newValue) : null,
      ip_address: null,
      success: true
    });
  } catch (error) {
    console.error('Failed to log action:', error);
  }
};

export const logError = async (actionType, entityType, errorMessage) => {
  try {
    const user = await base44.auth.me();
    
    await base44.entities.Log.create({
      timestamp: new Date().toISOString(),
      user_id: user.id,
      user_email: user.email,
      user_name: user.full_name,
      user_role: user.app_role,
      action_type: actionType,
      entity_type: entityType,
      details: errorMessage,
      success: false,
      error_message: errorMessage
    });
  } catch (error) {
    console.error('Failed to log error:', error);
  }
};