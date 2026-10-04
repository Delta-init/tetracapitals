// Utility functions for funding transaction access control
import { isMentorRole, getScope, downlineIds } from './roles';

export const canCreateFundingTransaction = (role) => {
  // Built-in admins that can raise requests, plus any mentor/staff-tier role
  // (built-in mentors AND custom Role-Management roles).
  return ['broker_admin', 'super_admin', 'admin'].includes(role) || isMentorRole(role);
};

export const canProcessFundingTransaction = (role) => {
  return ['broker_admin', 'super_admin', 'admin'].includes(role);
};

/**
 * A deposit request Delta Finance's accountants are deciding. New deposits go
 * there for approval (backend/src/finance/funding.ts); until the decision
 * comes back, nobody here approves, rejects or deletes them — the server
 * refuses, and the pages show "With accounts" instead of the actions. One
 * still waiting to be sent counts only while the link is on (`linkOn`, from
 * useFinanceLink): switched off, it never reached finance and is approved here.
 */
export const isWithAccounts = (t, linkOn = true) =>
  t?.status === 'PENDING' &&
  (t?.finance_approval?.state === 'sent' || (t?.finance_approval?.state === 'queued' && linkOn));

/** A deposit finance would not take — handed back, and approved here as before. */
export const isHandedBack = (t) => t?.status === 'PENDING' && t?.finance_approval?.state === 'refused';

/**
 * A bonus Delta Finance approved, waiting for a broker admin or a Super Admin to credit it in MT5 and approve —
 * the second of a bonus's two approvals (backend/src/finance/funding.ts, awaitingBroker).
 */
export const isAwaitingBroker = (t) =>
  t?.type === 'BONUS' && t?.status === 'PENDING' && t?.finance_approval?.state === 'decided' && t?.finance_approval?.decision === 'approved';

/** Who approves or rejects a bonus here: a broker admin or a Super Admin (the server refuses anyone else). */
export const canDecideBonus = (role) => ['broker_admin', 'super_admin'].includes(role);

/** Whether this person may approve or reject this request. */
export const canDecideFunding = (t, role) => (t?.type === 'BONUS' ? canDecideBonus(role) : canProcessFundingTransaction(role));

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

  // Roles with a visibility setting (Chief / Senior / Junior Mentor by default,
  // or any role configured in Role Management) follow it:
  //   own      → requests they initiated or raised
  //   downline → the same for everyone on their team (Up Head chain), in full
  //   all      → every request
  const scope = getScope(currentUser);
  if (scope === 'all') return allTransactions;
  if (scope === 'own') {
    return allTransactions.filter(t => initiatorId(t) === id || t.requested_by_id === id);
  }
  if (scope === 'downline') {
    const team = downlineIds(id, allUsers);
    return allTransactions.filter(t =>
      team.has(initiatorId(t)) || team.has(t.requested_by_id) || t.senior_mentor_id === id
    );
  }

  // Junior Mentor sees only transactions they initiated (incl. co-managed ones
  // they raised on another mentor's client).
  if (role === 'junior_mentor') {
    return allTransactions.filter(t => initiatorId(t) === id);
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