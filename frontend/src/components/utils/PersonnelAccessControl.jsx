// Utility functions for personnel/user management access control

export const canViewPersonnel = (userRole) => {
  return ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'admin_supervisor'].includes(userRole);
};

export const canEditPersonnel = (userRole) => {
  return ['super_admin', 'admin', 'broker_admin', 'academic_head'].includes(userRole);
};

export const canAssignRoles = (userRole) => {
  return ['super_admin', 'admin', 'broker_admin'].includes(userRole);
};

export const filterPersonnelByRole = (currentUser, allUsers) => {
  if (!currentUser || !allUsers || allUsers.length === 0) return [];
  
  const role = currentUser?.app_role || currentUser?.data?.app_role;
  
  // Super Admin, Admin, and Broker Admin see all users
  if (['super_admin', 'admin', 'broker_admin'].includes(role)) {
    return allUsers;
  }
  
  // Academic Head and Academic Admin see academic staff and mentors
  if (['academic_head', 'academic_admin'].includes(role)) {
    return allUsers.filter(u => {
      const userRole = String(u.app_role || u.data?.app_role || '').toLowerCase();
      return ['academic_head', 'academic_admin', 'senior_mentor', 'junior_mentor', 'subjunior_mentor', 'assistance', 'draw_admin'].includes(userRole);
    });
  }
  
  // Admin Supervisor can only see academic_admin users
  if (role === 'admin_supervisor') {
    return allUsers.filter(u => {
      const userRole = String(u.app_role || u.data?.app_role || '').toLowerCase();
      return userRole === 'academic_admin';
    });
  }
  
  return [];
};