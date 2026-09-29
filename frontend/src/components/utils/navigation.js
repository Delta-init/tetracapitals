// The sidebar's pages and which built-in roles see each one by default.
// Shared by the sidebar (Layout.jsx) and Role Management, which shows every
// role's pages and lets admins override them (stored as page_permissions on
// the role's commission_roles doc).
import {
  LayoutDashboard,
  LayoutGrid,
  UsersRound,
  Activity,
  Sparkles,
  GraduationCap,
  Trophy,
  Gauge,
  ShieldCheck,
  Contact,
  KeyRound,
  Network,
  BookUser,
  Users,
  ClipboardList,
  History,
  UserPlus,
  UserCheck,
  RefreshCcw,
  CandlestickChart,
  Wallet,
  HandCoins,
  Target,
  Crosshair,
  ReceiptText,
  CalendarCheck,
  CalendarRange,
  Banknote,
  Layers,
  Gift,
  PiggyBank,
  Wrench,
  FileBarChart,
  Gamepad2,
  ArrowLeftRight,
  Package,
  Percent,
  Ticket,
  BarChart3,
  ScrollText,
  Hourglass,
} from 'lucide-react';

// "StudentLogHistoryPage" -> "Student Log History", "AIInsights" -> "AI Insights"
export const humanize = (name = '') =>
  name
    .replace(/Page$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();

export const navLabel = (item) => item.label || humanize(item.name);

// `page` is the route the item opens; `roles` are the built-in roles that see it
// by default ('all' = everyone). `hidden` pages are left out of the sidebar and
// Role Management for everyone (the page itself still opens by address) —
// remove the flag to bring one back.
export const NAV_ITEMS = [
  { name: 'Dashboard', page: 'Dashboard', icon: LayoutDashboard, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'admin_supervisor', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'finance_admin'] },
  { name: 'TeamDashboard', page: 'TeamDashboard', icon: LayoutGrid, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'chief_mentor'] },
  { name: 'Teams', page: 'Teams', icon: UsersRound, roles: ['all'] },
  { name: 'ActivityTracker', page: 'ActivityTracker', icon: Activity, roles: ['all'] },
  { name: 'AIInsights', hidden: true, page: 'AIInsights', icon: Sparkles, roles: ['super_admin', 'broker_admin', 'academic_head'] },
  { name: 'MentorTraining', page: 'MentorTraining', icon: GraduationCap, roles: ['junior_mentor', 'chief_mentor', 'senior_mentor'] },
  { name: 'Leaderboard', page: 'Leaderboard', icon: Trophy, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'finance_admin'] },
  { name: 'MentorPerformance', hidden: true, page: 'MentorPerformance', icon: Gauge, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'finance_admin'] },
  { name: 'MasterAdmin', page: 'MasterAdmin', icon: ShieldCheck, roles: ['super_admin'] },
  { name: 'Personnel', page: 'Personnel', icon: Contact, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'admin_supervisor'] },
  { name: 'RolesManagement', page: 'RolesManagement', icon: KeyRound, roles: ['super_admin', 'admin'] },
  { name: 'Hierarchy', hidden: true, page: 'Hierarchy', icon: Network, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head'] },
  { name: 'AcademicCounselors', hidden: true, page: 'AcademicCounselors', icon: BookUser, roles: ['academic_head', 'super_admin'] },
  { name: 'Students', page: 'Students', icon: Users, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'] },
  { name: 'StudentLogs', page: 'StudentLogs', icon: ClipboardList, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'] },
  { name: 'StudentLogHistoryPage', page: 'StudentLogHistoryPage', icon: History, roles: ['super_admin', 'academic_head', 'academic_admin', 'admin_supervisor', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'] },
  { name: 'MyStudentRequests', page: 'MyStudentRequests', icon: UserPlus, roles: ['junior_mentor', 'chief_mentor', 'senior_mentor', 'academic_head'] },
  { name: 'StudentRequestApprovals', page: 'StudentRequestApprovals', icon: UserCheck, roles: ['super_admin', 'academic_head', 'broker_admin'] },
  { name: 'RetentionManagement', page: 'RetentionManagement', icon: RefreshCcw, roles: ['academic_head'] },
  { name: 'DrawAdminStudents', page: 'DrawAdminStudents', icon: Users, roles: ['draw_admin'] },
  { name: 'InactivityTransfers', page: 'InactivityTransfers', icon: Hourglass, roles: ['super_admin', 'admin'] },
  { name: 'MT5Accounts', hidden: true, page: 'MT5Accounts', icon: CandlestickChart, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'junior_mentor', 'chief_mentor', 'senior_mentor'] },
  { name: 'FundingActivities', page: 'MyFundingRequests', icon: Wallet, roles: ['chief_mentor', 'senior_mentor', 'junior_mentor', 'assistance'] },
  { name: 'FundingRequests', page: 'FundingRequests', icon: HandCoins, roles: ['super_admin', 'broker_admin', 'academic_head', 'finance_admin'] },
  { name: 'MyTargets', page: 'MyTargets', icon: Target, roles: ['chief_mentor', 'senior_mentor', 'junior_mentor'] },
  { name: 'TargetsManagement', page: 'TargetsManagement', icon: Crosshair, roles: ['super_admin', 'broker_admin', 'academic_head'] },
  { name: 'MyCommissionHistory', page: 'MyCommissionHistory', icon: ReceiptText, roles: ['chief_mentor', 'senior_mentor', 'junior_mentor'] },
  { name: 'QuarterClosing', label: 'Quarterly Deposit Closing', page: 'QuarterClosing', icon: CalendarCheck, roles: ['super_admin', 'broker_admin', 'finance_admin'] },
  { name: 'MonthlyClosing', label: 'Bonus Closing', page: 'MonthlyClosing', icon: CalendarRange, roles: ['super_admin', 'admin', 'broker_admin', 'finance_admin'] },
  { name: 'DailyPayouts', page: 'DailyPayouts', icon: Banknote, roles: ['super_admin', 'admin', 'broker_admin', 'finance_admin', 'chief_mentor', 'senior_mentor', 'junior_mentor', 'subjunior_mentor'] },
  { name: 'CommissionPlans', page: 'CommissionPlans', icon: Layers, roles: ['super_admin', 'admin', 'broker_admin', 'finance_admin'] },
  { name: 'BonusCommissionReports', hidden: true, page: 'BonusCommissionReports', icon: Gift, roles: ['super_admin', 'admin', 'broker_admin', 'finance_admin'] },
  { name: 'DepositCommissionReports', hidden: true, page: 'DepositCommissionReports', icon: PiggyBank, roles: ['super_admin', 'admin', 'broker_admin', 'finance_admin'] },
  { name: 'CommissionTools', page: 'CommissionTools', icon: Wrench, roles: ['super_admin', 'broker_admin', 'finance_admin'] },
  { name: 'CommissionReports', page: 'CommissionReports', icon: FileBarChart, roles: ['super_admin', 'broker_admin', 'academic_head', 'finance_admin'] },
  { name: 'GamificationSettings', hidden: true, page: 'GamificationSettings', icon: Gamepad2, roles: ['super_admin', 'academic_head'] },
  { name: 'Transactions', page: 'Transactions', icon: ArrowLeftRight, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head'] },
  { name: 'TransactionTags', label: 'Products', page: 'TransactionTags', icon: Package, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'finance_admin'] },
  { name: 'Commissions', hidden: true, page: 'Commissions', icon: Percent, roles: ['super_admin', 'broker_admin', 'academic_head'] },
  { name: 'Tickets', page: 'Tickets', icon: Ticket, roles: ['super_admin', 'broker_admin', 'academic_head', 'chief_mentor', 'senior_mentor', 'junior_mentor'] },
  { name: 'Reports', page: 'Reports', icon: BarChart3, roles: ['super_admin', 'broker_admin', 'academic_head', 'junior_mentor', 'chief_mentor', 'senior_mentor'] },
  { name: 'AuditLogs', page: 'AuditLogs', icon: ScrollText, roles: ['super_admin', 'admin_supervisor', 'academic_head'] }
];

// Sidebar section grouping (page name -> group). Rendered as labelled groups.
export const NAV_GROUPS = ['Overview', 'People & Access', 'Students', 'Funding', 'Commission', 'More'];
export const GROUP_OF = {
  Dashboard: 'Overview', TeamDashboard: 'Overview', Teams: 'Overview', ActivityTracker: 'Overview', AIInsights: 'Overview', Leaderboard: 'Overview', MentorPerformance: 'Overview', MentorTraining: 'Overview',
  Personnel: 'People & Access', RolesManagement: 'People & Access', Hierarchy: 'People & Access', AcademicCounselors: 'People & Access', MasterAdmin: 'People & Access',
  Students: 'Students', StudentLogs: 'Students', StudentLogHistoryPage: 'Students', MyStudentRequests: 'Students', StudentRequestApprovals: 'Students', RetentionManagement: 'Students', DrawAdminStudents: 'Students', MT5Accounts: 'Students', InactivityTransfers: 'Students',
  FundingActivities: 'Funding', FundingRequests: 'Funding', Transactions: 'Funding', TransactionTags: 'Funding',
  CommissionPlans: 'Commission', BonusCommissionReports: 'Commission', DepositCommissionReports: 'Commission', CommissionReports: 'Commission', CommissionTools: 'Commission', Commissions: 'Commission', QuarterClosing: 'Commission', MonthlyClosing: 'Commission', DailyPayouts: 'Commission', MyCommissionHistory: 'Commission', MyTargets: 'Commission', TargetsManagement: 'Commission',
  Tickets: 'More', Reports: 'More', AuditLogs: 'More', GamificationSettings: 'More',
};

/** Page names a built-in role sees when it has no override. */
export const defaultPagesFor = (role) =>
  NAV_ITEMS.filter(i => !i.hidden && (i.roles.includes('all') || i.roles.includes(role))).map(i => i.name);
