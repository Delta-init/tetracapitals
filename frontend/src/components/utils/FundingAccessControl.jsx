// Utility functions for funding transaction access control
import { isMentorRole } from './roles';

export const canCreateFundingTransaction = (role) => {
  // Built-in admins that can raise requests, plus any mentor/staff-tier role
  // (built-in mentors AND custom Role-Management roles).
  return ['broker_admin', 'super_admin', 'admin'].includes(role) || isMentorRole(role);
};

export const canProcessFundingTransaction = (role) => {
  return ['broker_admin', 'super_admin', 'admin'].includes(role);
};

export const canViewAllFundingTransactions = (role) => {
  return ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'finance_admin'].includes(role);
};

export const filterFundingTransactionsByRole = (currentUser, allTransactions, allStudents, allUsers = []) => {
  if (!currentUser || !allTransactions) return [];
  
  const { app_role: role, id } = currentUser;

  // A transaction belongs to whoever INITIATED it. For co-managed clients the
  // co-mentor is the initiator (and gets the commission), so the transaction
  // shows for them, NOT for the client's primary mentor — matching how the
  // commission is attributed. Legacy rows without an initiator fall back to the
  // primary mentor, so existing data is unaffected.
  const initiatorId = (t) => t.initiating_mentor_id || t.primary_mentor_id;

  // Super Admin, Admin and Broker Admin see all
  if (['super_admin', 'admin', 'broker_admin'].includes(role)) {
    return allTransactions;
  }

  // Academic Head, Academic Admin, and Finance Admin see all
  if (['academic_head', 'academic_admin', 'finance_admin'].includes(role)) {
    return allTransactions;
  }

  // Junior Mentor sees only transactions they initiated (incl. co-managed ones
  // they raised on another mentor's client).
  if (role === 'junior_mentor') {
    return allTransactions.filter(t => initiatorId(t) === id);
  }

  // Senior Mentor sees what they initiated + their junior mentors' transactions
  if (role === 'senior_mentor') {
    // Get all junior mentors assigned to this senior mentor
    const myJuniorMentors = allUsers.filter(u =>
      u.app_role === 'junior_mentor' && u.senior_mentor_id === id
    );
    const juniorMentorIds = myJuniorMentors.map(jm => jm.id);

    return allTransactions.filter(t =>
      initiatorId(t) === id || // Transactions they initiated
      t.senior_mentor_id === id || // Students assigned to them as senior mentor
      juniorMentorIds.includes(initiatorId(t)) // Their junior mentors' transactions
    );
  }

  // Any other staff / custom Role-Management role: transactions they initiated
  // (or where they're the senior / requester). Row-level scope is also enforced
  // on the backend by the role's data_scope.
  return allTransactions.filter(t =>
    initiatorId(t) === id ||
    t.senior_mentor_id === id ||
    t.requested_by_id === id
  );
};

export const canEditFundingCoreFields = (record, currentUser) => {
  if (!currentUser) return false;
  return ['super_admin', 'admin'].includes(currentUser.app_role);
};

export const canUpdateProcessingFields = (record, currentUser) => {
  if (!currentUser || !record) return false;
  
  const { app_role: role } = currentUser;
  
  // Super Admin and Admin can always update
  if (['super_admin', 'admin'].includes(role)) return true;
  
  // Broker Admin can update while PENDING
  if (role === 'broker_admin' && record.status === 'PENDING') return true;
  
  return false;
};

export const canChangeFundingStatus = (record, currentUser) => {
  if (!currentUser || !record) return false;
  
  const { app_role: role } = currentUser;
  
  // Super Admin and Admin can always change status
  if (['super_admin', 'admin'].includes(role)) return true;
  
  // Broker Admin can change status from PENDING to APPROVED/REJECTED
  if (role === 'broker_admin' && record.status === 'PENDING') return true;
  
  return false;
};