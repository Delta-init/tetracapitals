import { userLocationIn } from './teams';
// Ticket Access Control Utility
import { isMentorRole } from './roles';

export function canCreateTicket(role) {
  return ['co_mentor', 'academic_head', 'finance_admin', 'broker_admin', 'super_admin', 'admin'].includes(role)
    || isMentorRole(role);
}

// CS Managers answer and resolve the Academic Head's tickets with them (the user, 2026-10-13).
export function canRespondToTicket(role) {
  return ['academic_head', 'cs_manager', 'finance_admin', 'broker_admin', 'super_admin', 'admin'].includes(role);
}

export function canResolveTicket(role) {
  return ['academic_head', 'cs_manager', 'finance_admin', 'broker_admin', 'super_admin', 'admin'].includes(role);
}

export function canCloseTicket(userRole, userId, ticket) {
  if (['super_admin', 'admin'].includes(userRole)) return true;
  return userId === ticket.created_by_id;
}

/** `users` (optional): everyone — a CS Manager sees only their own location's Academic Head tickets (2026-10-14). */
export function canViewTicket(user, ticket, users = []) {
  const role = user.app_role;
  if (['super_admin', 'admin'].includes(role)) return true;
  if (role === 'academic_head') return ticket.assigned_to_role === 'academic_head';
  if (role === 'cs_manager') {
    if (ticket.created_by_id === user.id) return true;
    if (ticket.assigned_to_role !== 'academic_head') return false;
    return !users.length || userLocationIn(users, ticket.created_by_id) === userLocationIn(users, user.id);
  }
  if (role === 'finance_admin') return ticket.assigned_to_role === 'finance_admin';
  if (role === 'broker_admin') return ticket.assigned_to_role === 'broker_admin';
  // Mentors and others see only their own
  return ticket.created_by_id === user.id;
}

export function filterTicketsByRole(user, tickets, users = []) {
  return tickets.filter(t => canViewTicket(user, t, users));
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