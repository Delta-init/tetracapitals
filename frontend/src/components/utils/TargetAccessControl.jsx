// Utility functions for target access control

export const canCreateTarget = (role) => {
  return ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin'].includes(role);
};

export const canEditTarget = (record, currentUser) => {
  if (!currentUser) return false;
  return ['super_admin', 'admin'].includes(currentUser.app_role);
};

export const canDeleteTarget = (currentUser) => {
  if (!currentUser) return false;
  return ['super_admin', 'admin'].includes(currentUser.app_role);
};

export const filterTargetsByRole = (currentUser, allTargets) => {
  if (!currentUser || !allTargets) return [];
  
  const { app_role: role, id } = currentUser;
  
  // Super Admin, Admin, Broker Admin, Academic Head/Admin see all
  if (['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin'].includes(role)) {
    return allTargets;
  }
  
  // Mentors see only their own targets
  if (['senior_mentor', 'junior_mentor'].includes(role)) {
    return allTargets.filter(t => t.mentor_id === id);
  }
  
  return [];
};