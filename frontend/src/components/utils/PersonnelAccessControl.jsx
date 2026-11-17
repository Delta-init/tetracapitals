import { userLocationIn } from './teams';
// Utility functions for personnel/user management access control

export const canViewPersonnel = (userRole) => {
  // CS Managers too (2026-10-13): the CS accounts only, to View as — nothing to edit. Chief Mentors (2026-11-17): their
  // own team's members, to see and View as — nothing to edit.
  return ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'admin_supervisor', 'cs_manager', 'chief_mentor'].includes(userRole);
};

/** Whom a Chief Mentor sees and Views as (2026-11-17): their own team's CSs and mentors — the server's rule too. */
export const CHIEF_VIEW_AS_ROLES = ['cs', 'senior_mentor', 'junior_mentor', 'subjunior_mentor', 'assistance'];

/** Everyone below this person in the Up Head tree. */
export const teamMemberIds = (allUsers, leaderId) => {
  const kids = {};
  for (const u of allUsers) if (u.up_head_id) (kids[String(u.up_head_id)] ||= []).push(String(u.id));
  const out = new Set();
  const walk = [String(leaderId)];
  while (walk.length) for (const k of kids[walk.pop()] || []) if (!out.has(k)) { out.add(k); walk.push(k); }
  return out;
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
      return ['academic_head', 'academic_admin', 'chief_mentor', 'senior_mentor', 'junior_mentor', 'subjunior_mentor', 'assistance', 'draw_admin'].includes(userRole);
    });
  }
  
  // CS Manager: the CS accounts — to View as any of them (the server allows any active CS)
  // …their own location's (2026-10-14: Doney Dubai's, ambili B Bangalore's).
  if (role === 'cs_manager') {
    const mine = userLocationIn(allUsers, currentUser.id);
    return allUsers.filter(u => String(u.app_role || u.data?.app_role || '').toLowerCase() === 'cs' && userLocationIn(allUsers, u.id) === mine);
  }

  // Chief Mentor: their own team's CSs and mentors (2026-11-17) — never a CS Manager, another Chief or an admin.
  if (role === 'chief_mentor') {
    const mine = teamMemberIds(allUsers, currentUser.id);
    return allUsers.filter(u => mine.has(String(u.id)) && CHIEF_VIEW_AS_ROLES.includes(String(u.app_role || u.data?.app_role || '').toLowerCase()));
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