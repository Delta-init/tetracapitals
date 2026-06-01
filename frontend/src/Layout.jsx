import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from './utils';
import { base44 } from '@/api/base44Client';
import { 
        LayoutDashboard, 
        Users, 
        TrendingUp, 
        Award, 
        Target, 
        Ticket,
        DollarSign,
        Menu,
        X,
        LogOut,
        Shield,
        UserPlus
      } from 'lucide-react';
import ImpersonationBanner from './components/utils/ImpersonationBanner';
import NotificationBell from './components/utils/NotificationBell';
import { getEffectiveUser, isImpersonating } from './components/utils/ImpersonationContext';
import { Button } from '@/components/ui/button';

export default function Layout({ children, currentPageName }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingCounts, setPendingCounts] = useState({
    fundingRequests: 0,
    studentRequests: 0,
    tickets: 0,
    retention: 0
  });

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
        if (['super_admin', 'academic_admin', 'broker_admin', 'senior_mentor', 'junior_mentor'].includes(role)) {
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

  const handleLogout = () => {
    base44.auth.logout();
  };

  const navigation = [
    { name: 'Dashboard', href: createPageUrl('Dashboard'), icon: LayoutDashboard, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'admin_supervisor', 'junior_mentor', 'senior_mentor', 'finance_admin'] },
    { name: 'AIInsights', href: createPageUrl('AIInsights'), icon: TrendingUp, roles: ['super_admin', 'broker_admin', 'academic_head'] },
    { name: 'MentorTraining', href: createPageUrl('MentorTraining'), icon: TrendingUp, roles: ['junior_mentor', 'senior_mentor'] },
    { name: 'Leaderboard', href: createPageUrl('Leaderboard'), icon: Award, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'junior_mentor', 'senior_mentor', 'finance_admin'] },
    { name: 'MentorPerformance', href: createPageUrl('MentorPerformance'), icon: Award, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'junior_mentor', 'senior_mentor', 'finance_admin'] },
    { name: 'Personnel', href: createPageUrl('Personnel'), icon: Users, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'admin_supervisor'] },
    { name: 'AcademicCounselors', href: createPageUrl('AcademicCounselors'), icon: Users, roles: ['academic_head', 'super_admin'] },
    { name: 'Students', href: createPageUrl('Students'), icon: Users, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'junior_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'] },
    { name: 'StudentLogs', href: createPageUrl('StudentLogs'), icon: Users, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'junior_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'] },
    { name: 'StudentLogHistoryPage', href: createPageUrl('StudentLogHistoryPage'), icon: Shield, roles: ['super_admin', 'academic_head', 'academic_admin', 'admin_supervisor', 'junior_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'] },
    { name: 'MyStudentRequests', href: createPageUrl('MyStudentRequests'), icon: UserPlus, roles: ['junior_mentor', 'senior_mentor', 'academic_head'] },
    { name: 'StudentRequestApprovals', href: createPageUrl('StudentRequestApprovals'), icon: UserPlus, roles: ['super_admin', 'academic_head', 'broker_admin'] },
    { name: 'RetentionManagement', href: createPageUrl('RetentionManagement'), icon: Users, roles: ['academic_head'] },
    { name: 'DrawAdminStudents', href: createPageUrl('DrawAdminStudents'), icon: Users, roles: ['draw_admin'] },
    { name: 'MT5Accounts', href: createPageUrl('MT5Accounts'), icon: TrendingUp, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'junior_mentor', 'senior_mentor'] },
    { name: 'FundingActivities', href: createPageUrl('MyFundingRequests'), icon: DollarSign, roles: ['senior_mentor', 'junior_mentor', 'assistance'] },
    { name: 'FundingRequests', href: createPageUrl('FundingRequests'), icon: DollarSign, roles: ['super_admin', 'broker_admin', 'academic_head', 'finance_admin'] },
    { name: 'MyTargets', href: createPageUrl('MyTargets'), icon: Target, roles: ['senior_mentor', 'junior_mentor'] },
    { name: 'TargetsManagement', href: createPageUrl('TargetsManagement'), icon: Target, roles: ['super_admin', 'broker_admin', 'academic_head'] },
    { name: 'MyCommissionHistory', href: createPageUrl('MyCommissionHistory'), icon: Award, roles: ['senior_mentor', 'junior_mentor'] },
    { name: 'QuarterClosing', href: createPageUrl('QuarterClosing'), icon: Award, roles: ['super_admin', 'broker_admin', 'finance_admin'] },
    { name: 'CommissionTools', href: createPageUrl('CommissionTools'), icon: DollarSign, roles: ['super_admin', 'broker_admin', 'finance_admin'] },
    { name: 'CommissionReports', href: createPageUrl('CommissionReports'), icon: Award, roles: ['super_admin', 'broker_admin', 'academic_head', 'finance_admin'] },
    { name: 'GamificationSettings', href: createPageUrl('GamificationSettings'), icon: Target, roles: ['super_admin', 'academic_head'] },
    { name: 'Transactions', href: createPageUrl('Transactions'), icon: TrendingUp, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head'] },
    { name: 'TransactionTags', href: createPageUrl('TransactionTags'), icon: Award, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'finance_admin'] },
    { name: 'Commissions', href: createPageUrl('Commissions'), icon: Award, roles: ['super_admin', 'broker_admin', 'academic_head'] },
    { name: 'Tickets', href: createPageUrl('Tickets'), icon: Ticket, roles: ['super_admin', 'broker_admin', 'academic_head', 'senior_mentor', 'junior_mentor'] },
    { name: 'Reports', href: createPageUrl('Reports'), icon: TrendingUp, roles: ['super_admin', 'broker_admin', 'academic_head', 'junior_mentor', 'senior_mentor'] },
    { name: 'AuditLogs', href: createPageUrl('AuditLogs'), icon: Shield, roles: ['super_admin', 'admin_supervisor', 'academic_head'] }
  ];

  const filteredNavigation = navigation.filter(item => 
    item.roles.includes('all') || item.roles.includes(currentUser?.app_role)
  );

  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <ImpersonationBanner />
      <style>{`
        :root {
          --color-primary: 30 58 138;
          --color-secondary: 16 185 129;
          --color-accent: 245 158 11;
        }
      `}</style>

      {/* Sidebar - Desktop */}
      <aside className="hidden md:fixed md:inset-y-0 md:flex md:w-64 md:flex-col bg-gradient-to-b from-white via-blue-50/30 to-indigo-50/30 border-r border-gray-200 shadow-lg">
        <div className="flex flex-col flex-grow pt-6 pb-4 overflow-y-auto">
          <div className="flex items-center justify-between flex-shrink-0 px-6 mb-10">
            <Link to={createPageUrl('Dashboard')} className="flex items-center space-x-3 hover:opacity-80 transition-opacity">
              <div className="w-11 h-11 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl flex items-center justify-center shadow-lg">
                <Award className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 tracking-tight">Commission Portal</h1>
              </div>
            </Link>
            <NotificationBell currentUser={currentUser} />
          </div>

          <div className="px-4 mb-6">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl p-5 border-none shadow-xl">
              <p className="text-sm font-bold text-white tracking-wide">{currentUser.full_name}</p>
              <p className="text-xs text-blue-100 mt-1.5">{currentUser.email}</p>
              <div className="mt-3">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-white/25 text-white backdrop-blur-sm">
                  {currentUser.app_role?.replace(/_/g, ' ')}
                </span>
              </div>
            </div>
          </div>

          <nav className="flex-1 px-3 space-y-1.5">
            {filteredNavigation.map((item) => {
              const isActive = currentPageName === item.name;
              const showBadge = 
                (item.name === 'FundingRequests' && pendingCounts.fundingRequests > 0) ||
                (item.name === 'StudentRequestApprovals' && pendingCounts.studentRequests > 0) ||
                (item.name === 'Tickets' && pendingCounts.tickets > 0) ||
                (item.name === 'RetentionManagement' && pendingCounts.retention > 0);

               return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`
                    group flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 ease-in-out
                    ${isActive 
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/40 scale-[1.02] transform' 
                      : 'text-gray-700 hover:bg-white/80 hover:shadow-md hover:scale-[1.01] hover:-translate-x-1'
                    }
                  `}
                >
                  <div className="flex items-center">
                    <item.icon
                      className={`mr-3 h-5 w-5 flex-shrink-0 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-600'}`}
                    />
                    {item.name}
                  </div>
                  {showBadge && (
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="flex-shrink-0 px-3 pb-4">
            <Button
              onClick={handleLogout}
              variant="ghost"
              className="w-full justify-start text-gray-700 hover:bg-gray-100"
            >
              <LogOut className="mr-3 h-5 w-5" />
              Logout
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden bg-white/95 backdrop-blur-md border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="flex items-center justify-between p-4">
          <Link to={createPageUrl('Dashboard')} className="flex items-center space-x-3 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-blue-800 rounded-lg flex items-center justify-center">
              <Award className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-gray-900">Commission Portal</h1>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </Button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="px-2 pt-2 pb-3 space-y-1">
            {filteredNavigation.map((item) => {
              const isActive = currentPageName === item.name;
              const showBadge = 
                (item.name === 'FundingRequests' && pendingCounts.fundingRequests > 0) ||
                (item.name === 'StudentRequestApprovals' && pendingCounts.studentRequests > 0) ||
                (item.name === 'Tickets' && pendingCounts.tickets > 0) ||
                (item.name === 'RetentionManagement' && pendingCounts.retention > 0);

              return (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`
                    group flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg
                    ${isActive 
                      ? 'bg-blue-600 text-white' 
                      : 'text-gray-700 hover:bg-gray-100'
                    }
                  `}
                >
                  <div className="flex items-center">
                    <item.icon className={`mr-3 h-5 w-5 ${isActive ? 'text-white' : 'text-gray-400'}`} />
                    {item.name}
                  </div>
                  {showBadge && (
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                  )}
                </Link>
              );
            })}
            <Button
              onClick={handleLogout}
              variant="ghost"
              className="w-full justify-start text-gray-700 hover:bg-gray-100"
            >
              <LogOut className="mr-3 h-5 w-5" />
              Logout
            </Button>
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="md:pl-64">
        <main>{children}</main>
      </div>
    </div>
  );
}