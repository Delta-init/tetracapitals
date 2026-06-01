// Utility functions for commission approval workflow

export const canApproveBrokerLevel = (role) => {
  return ['broker_admin', 'super_admin'].includes(role);
};

export const canApproveAcademicLevel = (role) => {
  return ['academic_head', 'super_admin'].includes(role);
};

export const canApproveFinanceLevel = (role) => {
  return ['finance_admin', 'super_admin'].includes(role);
};

export const getApprovalStatusBadge = (ledger) => {
  const status = ledger.overall_status;
  
  const badges = {
    'pending_broker_approval': {
      label: 'Pending Broker Approval',
      color: 'bg-yellow-100 text-yellow-800'
    },
    'pending_academic_approval': {
      label: 'Pending Academic Approval',
      color: 'bg-blue-100 text-blue-800'
    },
    'pending_finance_approval': {
      label: 'Pending Finance Approval',
      color: 'bg-purple-100 text-purple-800'
    },
    'released': {
      label: 'Released',
      color: 'bg-green-100 text-green-800'
    },
    'rejected': {
      label: 'Rejected',
      color: 'bg-red-100 text-red-800'
    }
  };
  
  return badges[status] || { label: status, color: 'bg-gray-100 text-gray-800' };
};

export const canTakeAction = (ledger, currentUser) => {
  if (!currentUser || !ledger) return false;
  
  const role = currentUser.app_role;
  const status = ledger.overall_status;
  
  // Super admin can act at any level
  if (role === 'super_admin') {
    return status !== 'released' && status !== 'rejected';
  }
  
  // Broker admin can approve at broker level
  if (role === 'broker_admin' && status === 'pending_broker_approval') {
    return true;
  }
  
  // Academic head can approve at academic level
  if (role === 'academic_head' && status === 'pending_academic_approval') {
    return true;
  }
  
  // Finance admin can approve at finance level
  if (role === 'finance_admin' && status === 'pending_finance_approval') {
    return true;
  }
  
  return false;
};

export const getNextApprovalStatus = (currentStatus, action) => {
  if (action === 'reject') {
    return 'rejected';
  }
  
  const statusFlow = {
    'pending_broker_approval': 'pending_academic_approval',
    'pending_academic_approval': 'pending_finance_approval',
    'pending_finance_approval': 'released'
  };
  
  return statusFlow[currentStatus] || currentStatus;
};

export const filterLedgersByRole = (ledgers, currentUser) => {
  if (!currentUser || !ledgers) return [];
  
  const role = currentUser.app_role;
  
  // Super admin and finance admin see all
  if (['super_admin', 'finance_admin'].includes(role)) {
    return ledgers;
  }
  
  // Broker admin sees all ledgers (they need to approve first)
  if (role === 'broker_admin') {
    return ledgers;
  }
  
  // Academic head sees ledgers that passed broker approval
  if (role === 'academic_head') {
    return ledgers.filter(l => 
      l.overall_status === 'pending_academic_approval' ||
      l.overall_status === 'pending_finance_approval' ||
      l.overall_status === 'released' ||
      l.overall_status === 'rejected'
    );
  }
  
  // Mentors see only their own ledgers
  if (['senior_mentor', 'junior_mentor'].includes(role)) {
    return ledgers.filter(l => l.mentor_id === currentUser.id);
  }
  
  return [];
};