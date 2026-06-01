// Ticket Access Control Utility

export function canCreateTicket(role) {
  return ['junior_mentor', 'senior_mentor', 'co_mentor', 'academic_head', 'finance_admin', 'broker_admin', 'super_admin', 'admin', 'subjunior_mentor', 'assistance'].includes(role);
}

export function canRespondToTicket(role) {
  return ['academic_head', 'finance_admin', 'broker_admin', 'super_admin', 'admin'].includes(role);
}

export function canResolveTicket(role) {
  return ['academic_head', 'finance_admin', 'broker_admin', 'super_admin', 'admin'].includes(role);
}

export function canCloseTicket(userRole, userId, ticket) {
  if (['super_admin', 'admin'].includes(userRole)) return true;
  return userId === ticket.created_by_id;
}

export function canViewTicket(user, ticket) {
  const role = user.app_role;
  if (['super_admin', 'admin'].includes(role)) return true;
  if (role === 'academic_head') return ticket.assigned_to_role === 'academic_head';
  if (role === 'finance_admin') return ticket.assigned_to_role === 'finance_admin';
  if (role === 'broker_admin') return ticket.assigned_to_role === 'broker_admin';
  // Mentors and others see only their own
  return ticket.created_by_id === user.id;
}

export function filterTicketsByRole(user, tickets) {
  return tickets.filter(t => canViewTicket(user, t));
}

export function getAutoAssignRole(category) {
  const map = {
    academic: 'academic_head',
    financial: 'finance_admin',
    technical: 'broker_admin',
    general: 'academic_head',
  };
  return map[category] || 'academic_head';
}

export function canReviewTicket(role) {
  return canRespondToTicket(role);
}