import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { createPageUrl } from './utils';
import { base44 } from '@/api/base44Client';
import { Menu, X, LogOut, PanelLeftClose, PanelLeftOpen, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import ImpersonationBanner from './components/utils/ImpersonationBanner';
import NotificationBell from './components/utils/NotificationBell';
import { getEffectiveUser } from './components/utils/ImpersonationContext';
import { EASE } from '@/components/motion';
import { NAV_ITEMS, NAV_GROUPS, GROUP_OF, humanize, pageBlockedFor } from '@/components/utils/navigation';
import { readsClosedOnly } from '@/components/utils/roles';
import { CallFlowProvider } from '@/components/followups/CallFlow';
import { forgetThisDevice } from '@/components/utils/usePushNotifications';

const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || 'D';

const SIDEBAR_KEY = 'delta.sidebar.collapsed';
const SIDEBAR_W = { open: 272, collapsed: 84 };

export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const [currentUser, setCurrentUser] = useState(null);
  const [myRole, setMyRole] = useState(null); // current user's role (drives page visibility)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
  });
  const [waUnread, setWaUnread] = useState(0);   // a CS's unread WhatsApp (NotificationBell keeps it)
  const [pendingCounts, setPendingCounts] = useState({
    fundingRequests: 0,
    studentRequests: 0,
    tickets: 0,
    retention: 0
  });

  // Tablets (md..lg) always get the icon-only sidebar so content has room.
  const [isTablet, setIsTablet] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 768px) and (max-width: 1023px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px) and (max-width: 1023px)');
    const onChange = (e) => setIsTablet(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileMenuOpen(false); }, [location.pathname]);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const realUser = await base44.auth.me();
        const effectiveUser = getEffectiveUser(realUser);
        setCurrentUser(effectiveUser);
      } catch (error) {
        base44.auth.redirectToLogin();
      }
    };
    fetchUser();
  }, []);

  // The Sales role's home is the students they closed, not the Dashboard (nothing there is theirs).
  const navigate = useNavigate();
  useEffect(() => {
    if (readsClosedOnly(currentUser) && currentPageName === 'Dashboard') navigate(createPageUrl('Students'), { replace: true });
  }, [currentUser, currentPageName]);

  // Load the current user's role so the sidebar can respect its page permissions.
  useEffect(() => {
    if (!currentUser?.app_role) return;
    base44.entities.CommissionRole.list()
      .then(rows => setMyRole((rows || []).find(r => r.role_key === currentUser.app_role) || null))
      .catch(() => setMyRole(null));
  }, [currentUser?.app_role]);

  useEffect(() => {
    const fetchPendingCounts = async () => {
      if (!currentUser) return;

      try {
        const [fundingTransactions, studentRequests, tickets, retentionAssignments] = await Promise.all([
          base44.entities.FundingTransaction.list(),
          base44.entities.StudentRequest.list(),
          base44.entities.Ticket.list(),
          base44.entities.RetentionAssignment.list()
        ]);

        const role = currentUser.app_role;

        // Count pending funding requests
        let pendingFunding = 0;
        if (['super_admin', 'broker_admin', 'academic_head', 'academic_admin'].includes(role)) {
          pendingFunding = fundingTransactions.filter(t => t.status === 'PENDING').length;
        }

        // Count pending student requests
        let pendingStudents = 0;
        if (role === 'academic_head') {
          pendingStudents = studentRequests.filter(r => r.status === 'PENDING_ACADEMIC_APPROVAL').length;
        } else if (role === 'broker_admin') {
          pendingStudents = studentRequests.filter(r => r.status === 'PENDING_BROKER_APPROVAL').length;
        }

        // Count open/unresolved tickets
        let pendingTickets = 0;
        if (['super_admin', 'academic_admin', 'broker_admin', 'chief_mentor', 'senior_mentor', 'junior_mentor'].includes(role)) {
          pendingTickets = tickets.filter(t => ['open', 'in_progress'].includes(t.status)).length;
        }

        // Count pending retention assignments
        let pendingRetention = 0;
        if (role === 'academic_head') {
          pendingRetention = retentionAssignments.filter(r => r.status === 'pending_assignment').length;
        }

        setPendingCounts({
          fundingRequests: pendingFunding,
          studentRequests: pendingStudents,
          tickets: pendingTickets,
          retention: pendingRetention
        });
      } catch (error) {
        console.error('Error fetching pending counts:', error);
      }
    };

    fetchPendingCounts();
    const interval = setInterval(fetchPendingCounts, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [currentUser]);

  // The numbers on the sidebar: new students given to you (not opened yet), today's and overdue follow-ups.
  const { data: navCounts, refetch: refetchNavCounts } = useQuery({
    queryKey: ['nav-counts'],
    queryFn: async () => (await base44.functions.invoke('getNavCounts', {})).data,
    enabled: !!currentUser,
    refetchInterval: 60_000,
  });
  useEffect(() => { if (currentUser) refetchNavCounts(); }, [location.pathname]);

  const handleLogout = async () => {
    // This device stops getting the person's notifications once they sign out.
    await forgetThisDevice();
    base44.auth.logout();
  };

  const navigation = NAV_ITEMS.map(item => ({ ...item, href: createPageUrl(item.page) }));


  // Sidebar respects the role's page permissions (from Role Management, for
  // custom and built-in roles alike). Falls back to the built-in per-item role
  // list when the role has no page list. Super admin always gets the full
  // default sidebar, and super_admin/admin always keep RolesManagement, so an
  // admin can't lock themselves out of re-enabling pages.
  const allowedPages = currentUser?.app_role === 'super_admin' ? null : myRole?.page_permissions;
  const filteredNavigation = navigation.filter(item => {
    if (item.hidden) return false;
    if (pageBlockedFor(currentUser?.app_role, item.name)) return false;
    // Not the Sales role's, whatever pages its role has (the server refuses them too).
    if (item.notForSales && readsClosedOnly(currentUser)) return false;
    if (item.everyone) return true;
    if (item.name === 'RolesManagement' && ['super_admin', 'admin'].includes(currentUser?.app_role)) return true;
    if (Array.isArray(allowedPages)) return allowedPages.includes(item.sameAccessAs || item.name);
    return item.roles.includes('all') || item.roles.includes(currentUser?.app_role);
  });

  // Group the visible nav items into labelled sections for the sidebar.
  const groupedNav = NAV_GROUPS
    .map(group => ({ group, items: filteredNavigation.filter(i => (GROUP_OF[i.name] || 'More') === group) }))
    .filter(section => section.items.length > 0);

  // Support tickets waiting for an answer and waiting on the student (the Support Tickets page's Open and
  // "Waiting on student" tabs) — they come from the LMS, so asked less often.
  const seesTickets = filteredNavigation.some(i => i.name === 'SupportTickets');
  const { data: ticketCount } = useQuery({
    queryKey: ['nav-ticket-count'],
    queryFn: async () => (await base44.functions.invoke('getLmsSupportTicketCount', {})).data,
    enabled: !!currentUser && seesTickets,
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
  // LMS enrolment requests waiting for a decision (the LMS Requests page's Waiting tab) — from the LMS too.
  const seesLmsRequests = filteredNavigation.some(i => i.name === 'LmsRequests');
  const { data: lmsRequestCount } = useQuery({
    queryKey: ['nav-lms-request-count'],
    queryFn: async () => (await base44.functions.invoke('getLmsEnrolmentRequestCount', {})).data,
    enabled: !!currentUser && seesLmsRequests,
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  // The numbers a page shows in the sidebar, in order, each in the colour its page uses. Payment Links: a Super
  // Admin gets the requests waiting for them, a CS the links ready and the turn-downs they haven't seen (the
  // server only counts each for them). Collapsed there is room for one: the first that isn't 0.
  const PILLS = {
    Students: [{ n: navCounts?.new_students, cls: 'bg-brand-mint text-brand-navy', title: 'new students given to you — not opened yet' }],
    // Red once any has waited 6 hours or more.
    NotOnboarded: [{
      n: navCounts?.not_onboarded,
      cls: navCounts?.not_onboarded_late ? 'bg-rose-500 text-white' : 'bg-amber-400 text-brand-navy',
      title: `new students from finance not onboarded yet${navCounts?.not_onboarded_late ? ` — ${navCounts.not_onboarded_late} over 6 hours` : ''}`,
    }],
    StudentFollowups: [{ n: navCounts?.followups_today, cls: 'bg-amber-400 text-brand-navy', title: 'follow-ups due today' }],
    OverdueFollowups: [{ n: navCounts?.followups_overdue, cls: 'bg-rose-500 text-white', title: 'overdue follow-ups' }],
    PaymentLinks: [
      { n: navCounts?.payment_links_pending, cls: 'bg-amber-400 text-brand-navy', title: 'payment link requests waiting for you' },
      { n: navCounts?.payment_links_ready, cls: 'bg-emerald-400 text-brand-navy', title: 'payment links ready — not seen yet' },
      { n: navCounts?.payment_links_turned_down, cls: 'bg-rose-500 text-white', title: 'payment link requests turned down — not seen yet' },
    ],
    ClassCompletions: [{ n: navCounts?.class_completions_open, cls: 'bg-violet-500 text-white', title: 'class completions waiting for a call' }],
    BonusApprovals: [{ n: navCounts?.bonus_approvals_pending, cls: 'bg-amber-400 text-brand-navy', title: 'MT5 bonuses waiting for your approval' }],
    SupportTickets: [
      { n: ticketCount?.open, cls: 'bg-amber-400 text-brand-navy', title: 'support tickets waiting for an answer' },
      { n: ticketCount?.waiting, cls: 'bg-sky-400 text-brand-navy', title: 'support tickets waiting on the student' },
    ],
    LmsRequests: [{ n: lmsRequestCount?.pending, cls: 'bg-amber-400 text-brand-navy', title: 'LMS enrolment requests waiting for a decision' }],
  };
  const pillsOf = (name, compact) => {
    const pills = (PILLS[name] || []).filter(p => p.n > 0);
    return compact ? pills.slice(0, 1) : pills;
  };

  const hasBadge = (name) =>
    (name === 'FundingRequests' && pendingCounts.fundingRequests > 0) ||
    (name === 'StudentRequestApprovals' && pendingCounts.studentRequests > 0) ||
    (name === 'Tickets' && pendingCounts.tickets > 0) ||
    (name === 'RetentionManagement' && pendingCounts.retention > 0) ||
    (name === 'WhatsApp' && waUnread > 0);

  // The "FundingActivities" nav item routes to the MyFundingRequests page.
  const isActiveItem = (item) =>
    currentPageName === item.name || (item.name === 'FundingActivities' && currentPageName === 'MyFundingRequests');

  const activeItem = navigation.find(isActiveItem);
  const pageTitle = activeItem ? (activeItem.label || humanize(activeItem.name)) : humanize(currentPageName);
  const pageGroup = activeItem ? (GROUP_OF[activeItem.name] || 'More') : null;
  // A page this role never gets (navigation.js `notFor`) says so instead of opening.
  const pageBlocked = pageBlockedFor(currentUser?.app_role, currentPageName);

  if (!currentUser) {
    return (
      <div className="flex h-screen items-center justify-center bg-background bg-dot-grid">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="flex flex-col items-center"
        >
          <img src="/brand/delta-logo.png" alt="Delta" className="h-10 w-auto" />
          <div className="mt-6 h-1 w-40 overflow-hidden rounded-full bg-slate-200">
            <motion.div
              className="h-full w-1/2 rounded-full bg-brand-gradient"
              animate={{ x: ['-100%', '200%'] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        </motion.div>
      </div>
    );
  }

  const roleLabel = currentUser.app_role?.replace(/_/g, ' ');

  // Render helpers (plain functions, not components, so the nav isn't
  // remounted on every re-render — keeps scroll position and the active pill).
  const renderNav = (compact, layoutKey) => (
    <nav className="flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-3 pb-4 [scrollbar-color:rgba(255,255,255,0.15)_transparent]">
      {groupedNav.map((section) => (
        <div key={section.group}>
          {compact ? (
            <div className="mx-auto mb-2 h-px w-6 bg-white/10" />
          ) : (
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/35">{section.group}</p>
          )}
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const isActive = isActiveItem(item);
              const label = item.label || humanize(item.name);
              const pills = pillsOf(item.name, compact);
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  title={compact ? label : undefined}
                  className={`group relative flex items-center rounded-xl py-2 text-[13.5px] font-medium transition-colors duration-200
                    ${compact ? 'justify-center px-0' : 'px-3'}
                    ${isActive ? 'text-white' : 'text-white/60 hover:bg-white/[0.04] hover:text-white'}`}
                >
                  {isActive && (
                    <motion.span
                      layoutId={`nav-active-${layoutKey}`}
                      className="absolute inset-0 rounded-xl bg-white/[0.09] ring-1 ring-inset ring-white/10"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    >
                      <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-gradient" />
                    </motion.span>
                  )}
                  <span className={`relative flex min-w-0 items-center ${compact ? '' : 'gap-3'}`}>
                    <item.icon
                      className={`h-[18px] w-[18px] flex-shrink-0 transition-colors ${isActive ? 'text-brand-cyan' : 'text-white/45 group-hover:text-white/80'}`}
                    />
                    {!compact && <span className="truncate">{label}</span>}
                  </span>
                  {pills.length > 0 ? (
                    <span className={compact ? '' : 'relative ml-auto flex items-center gap-1'}>
                      {pills.map(p => (
                        <span
                          key={p.title}
                          title={`${p.n} ${p.title}`}
                          className={`${compact ? 'absolute right-1 top-0.5 h-4 min-w-[16px] px-1 text-[10px]' : 'h-5 min-w-[20px] px-1.5 text-[11px]'} flex items-center justify-center rounded-full font-semibold tabular-nums leading-none ${p.cls}`}
                        >
                          {p.n > 99 ? '99+' : p.n}
                        </span>
                      ))}
                    </span>
                  ) : hasBadge(item.name) && (
                    <span className={`${compact ? 'absolute right-2 top-1.5' : 'relative ml-auto'} flex h-2 w-2`}>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-mint opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-mint" />
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const renderUserCard = (compact) => (
    <div className="border-t border-white/10 p-3">
      <div className={`flex items-center ${compact ? 'flex-col gap-2' : 'gap-3 rounded-xl bg-white/[0.04] p-2.5'}`}>
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-brand-navy"
          title={compact ? currentUser.full_name : undefined}
        >
          {initials(currentUser.full_name)}
        </div>
        {!compact && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{currentUser.full_name}</p>
            <p className="truncate text-[11px] capitalize text-white/50">{roleLabel}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          title="Logout"
          aria-label="Logout"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const compact = collapsed || isTablet;
  const sidebarWidth = compact ? SIDEBAR_W.collapsed : SIDEBAR_W.open;

  return (
    <div className="min-h-screen bg-background" style={{ '--sidebar-w': `${sidebarWidth}px` }}>
      {/* Sidebar - Desktop */}
      <motion.aside
        initial={false}
        animate={{ width: sidebarWidth }}
        transition={{ duration: 0.35, ease: EASE }}
        className="fixed inset-y-0 left-0 z-40 hidden flex-col overflow-hidden bg-brand-navy md:flex"
      >
        {/* ambient glow */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-brand-cyan/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-24 h-72 w-72 rounded-full bg-brand-mint/10 blur-3xl" />

        <div className={`relative flex h-16 flex-shrink-0 items-center ${compact ? 'justify-center' : 'px-5'}`}>
          <Link to={createPageUrl('Dashboard')} className="flex items-center gap-2.5">
            {compact ? (
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white">
                <img src="/icon-192.png" alt="Delta" className="h-8 w-8" />
              </span>
            ) : (
              <>
                <img src="/brand/delta-logo-white.png" alt="Delta" className="h-7 w-auto" />
                <span className="rounded-md border border-white/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white/60">
                  Portal
                </span>
              </>
            )}
          </Link>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col pt-2">
          {renderNav(compact, 'desktop')}
          {renderUserCard(compact)}
        </div>
      </motion.aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 z-50 bg-brand-ink/50 backdrop-blur-sm md:hidden"
            />
            <motion.aside
              key="drawer"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.4, ease: EASE }}
              className="fixed inset-y-0 left-0 z-50 flex w-[84vw] max-w-[300px] flex-col overflow-hidden bg-brand-navy md:hidden"
            >
              <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-brand-cyan/20 blur-3xl" />
              <div className="relative flex h-16 flex-shrink-0 items-center justify-between px-5">
                <img src="/brand/delta-logo-white.png" alt="Delta" className="h-7 w-auto" />
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="relative flex min-h-0 flex-1 flex-col pt-2">
                {renderNav(false, 'mobile')}
                {renderUserCard(false)}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main column */}
      <div className="flex min-h-screen min-w-0 flex-col transition-[padding] duration-300 ease-out md:pl-[var(--sidebar-w)]">
        <ImpersonationBanner />

        {/* Top bar */}
        <header className="glass sticky top-0 z-30 border-b border-slate-200/70">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-brand-navy hover:bg-slate-100 md:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <button
              onClick={() => setCollapsed(c => !c)}
              className="-ml-2 hidden h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-navy lg:flex"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
            </button>
            <Link to={createPageUrl('Dashboard')} className="md:hidden">
              <img src="/brand/delta-logo.png" alt="Delta" className="h-6 w-auto" />
            </Link>

            <div className="hidden min-w-0 items-center gap-2 text-sm md:flex">
              {pageGroup && <span className="text-slate-400">{pageGroup}</span>}
              {pageGroup && <span className="text-slate-300">/</span>}
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={pageTitle}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, ease: EASE }}
                  className="truncate font-semibold text-brand-navy"
                >
                  {pageTitle}
                </motion.span>
              </AnimatePresence>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-xs font-medium text-slate-400 lg:inline">
                {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              <NotificationBell currentUser={currentUser} onWhatsAppUnread={setWaUnread} />
              <div className="hidden items-center gap-2.5 border-l border-slate-200 pl-3 sm:flex">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-navy text-[11px] font-bold text-white">
                  {initials(currentUser.full_name)}
                </div>
                <div className="hidden leading-tight lg:block">
                  <p className="max-w-[160px] truncate text-sm font-semibold text-brand-navy">{currentUser.full_name}</p>
                  <p className="text-[11px] capitalize text-slate-400">{roleLabel}</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Page content. Pages ship their own full-height gradient wrapper;
            neutralise it so every page sits on the same canvas and spacing. */}
        <main className="relative min-w-0 flex-1">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="page-stagger [&>.min-h-screen]:!min-h-0 [&>.min-h-screen]:!bg-none [&>.min-h-screen]:!bg-transparent [&>.min-h-screen]:!p-4 sm:[&>.min-h-screen]:!p-6 lg:[&>.min-h-screen]:!p-8"
          >
            {/* Call (3CX) then log — one set of dialogs for every page */}
            <CallFlowProvider>
              {pageBlocked ? (
                <div className="mx-auto max-w-xl p-8">
                  <Card className="border-red-200"><CardContent className="space-y-3 p-6 text-center">
                    <ShieldAlert className="mx-auto h-10 w-10 text-red-600" />
                    <h2 className="text-lg font-semibold">Restricted page</h2>
                    <p className="text-sm text-gray-600">{pageTitle} is not available for your role.</p>
                    <Link to="/" className="inline-block text-sm font-medium text-blue-600 hover:underline">Go to the home page</Link>
                  </CardContent></Card>
                </div>
              ) : children}
            </CallFlowProvider>
          </motion.div>
        </main>
      </div>
    </div>
  );
}
