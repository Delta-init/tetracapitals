// Utility functions for data masking based on user role

export const maskEmail = (email) => {
  if (!email) return '';
  const [localPart, domain] = email.split('@');
  if (localPart.length <= 5) {
    return `${localPart[0]}*****@${domain}`;
  }
  const first3 = localPart.substring(0, 3);
  const last2 = localPart.substring(localPart.length - 2);
  return `${first3}*****${last2}@${domain}`;
};

export const maskPhone = (phone) => {
  if (!phone) return '';
  if (phone.length <= 4) {
    return '**' + phone.slice(-2);
  }
  const first2 = phone.substring(0, 2);
  const last2 = phone.substring(phone.length - 2);
  return `${first2}******${last2}`;
};

export const shouldMaskData = (userRole) => {
  // Only Super Admin, Admin and Broker Admin see unmasked data
  return !['super_admin', 'admin', 'broker_admin'].includes(userRole);
};

export const canEditData = (userRole) => {
  // Only Super Admin and Admin can edit existing data
  return ['super_admin', 'admin'].includes(userRole);
};

export const canApproveTransactions = (userRole) => {
  return ['super_admin', 'admin', 'broker_admin'].includes(userRole);
};

export const canManageTargets = (userRole) => {
  return ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin'].includes(userRole);
};

export const canManageTickets = (userRole) => {
  return ['super_admin', 'admin', 'academic_admin'].includes(userRole);
};

export const canViewAllStudents = (userRole) => {
  return ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin'].includes(userRole);
};

export const isMentorRole = (userRole) => {
  return ['senior_mentor', 'junior_mentor', 'subjunior_mentor'].includes(userRole);
};