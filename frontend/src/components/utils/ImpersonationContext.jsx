// Impersonation utility - stores impersonated user in sessionStorage
// so it resets when the browser tab is closed

const IMPERSONATION_KEY = 'impersonated_user';

export function startImpersonation(targetUser, adminUser) {
  sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify({
    targetUser,
    adminUser,
    startedAt: new Date().toISOString()
  }));
  // Reload to apply new role context
  window.location.reload();
}

export function stopImpersonation() {
  sessionStorage.removeItem(IMPERSONATION_KEY);
  window.location.reload();
}

export function getImpersonationState() {
  try {
    const stored = sessionStorage.getItem(IMPERSONATION_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function isImpersonating() {
  return !!getImpersonationState();
}

// Returns the effective user - either the impersonated user or the real user
export function getEffectiveUser(realUser) {
  const state = getImpersonationState();
  if (!state) return realUser;
  // Merge real user's base properties with impersonated user's role/data
  return {
    ...state.targetUser,
    _impersonatedBy: state.adminUser,
    _impersonationStartedAt: state.startedAt
  };
}