// The sidebar's pages and which built-in roles see each one by default.
// Shared by the sidebar (Layout.jsx) and Role Management, which shows every
// role's pages and lets admins override them (stored as page_permissions on
// the role's commission_roles doc).
import {
  LayoutDashboard,
  FileCheck,
  ArrowUpCircle,
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
  FileText,
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
  Tags,
  PhoneCall,
  AlarmClock,
  PhoneIncoming,
  MessageCircle,
  CalendarDays,
  CreditCard,
  LifeBuoy,
  DoorOpen,
  BookCheck,
  ClipboardCheck,
  Repeat,
  Coins, BadgeAlert, UserX, Workflow , Award } from 'lucide-react';

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
// remove the flag to bring one back. `sameAccessAs` pages show exactly when
// that page does, and `everyone` pages show for every signed-in person whatever
// their role's page list — Role Management lists neither on its own. `notFor`
// roles never get the page, whatever their page list says: it is not in their
// sidebar or offered for them in Role Management, and opened by address it
// says it is not available (Layout.jsx). `only` pages are the same for every
// role not listed.
const FOLLOWUP_ROLES = ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'admin_supervisor', 'finance_admin', 'chief_mentor', 'senior_mentor', 'junior_mentor', 'subjunior_mentor', 'assistance'];
export const NAV_ITEMS = [
  { name: 'Dashboard', page: 'Dashboard', icon: LayoutDashboard, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'admin_supervisor', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'finance_admin'] },
  { name: 'TeamDashboard', page: 'TeamDashboard', icon: LayoutGrid, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'chief_mentor'] },
  { name: 'Teams', page: 'Teams', icon: UsersRound, roles: ['all'] },
  // Hidden for everyone (the user, 2026-10-11) — the page still opens by its address.
  { name: 'ActivityTracker', hidden: true, page: 'ActivityTracker', icon: Activity, roles: ['all'], notFor: ['cs'] },
  { name: 'AIInsights', hidden: true, page: 'AIInsights', icon: Sparkles, roles: ['super_admin', 'broker_admin', 'academic_head'] },
  { name: 'MentorTraining', page: 'MentorTraining', icon: GraduationCap, roles: ['junior_mentor', 'chief_mentor', 'senior_mentor'], notFor: ['cs'] },
  // CSs and CS Managers see it too (the user, 2026-10-11) — whatever their role's page list says (Layout.jsx).
  { name: 'Leaderboard', page: 'Leaderboard', icon: Trophy, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'finance_admin', 'cs', 'cs_manager'] },
  // The LMS's instructor reviews (the user, 2026-10-22; functions/instructorReviews.ts): admins, chiefs, CS Managers, mentors.
  { name: 'InstructorReviews', label: 'Instructor Reviews', page: 'InstructorReviews', icon: Award, roles: ['super_admin', 'admin', 'chief_mentor', 'senior_mentor', 'junior_mentor', 'subjunior_mentor', 'cs_manager'], only: ['super_admin', 'admin', 'chief_mentor', 'senior_mentor', 'junior_mentor', 'subjunior_mentor', 'cs_manager'] },
  // Each mentor's day — LMS classes, bookings, cancellations, meetings, reviews — and their commission (the user,
  // 2026-10-23; functions/mentorReport.ts): admins everyone, chiefs (and their mentors, CS Managers) their team.
  // The CS TV's voice — the owner's own recordings, kept in R2 (the user, 2026-10-26; functions/voiceRecordings.ts).
  // Everyone's own reminders (2026-10-28), told 15 minutes before and at the time.
  { name: 'Reminders', label: 'Reminders', page: 'Reminders', icon: AlarmClock, roles: ['all'], everyone: true },
  { name: 'MeetingsReport', label: 'Meetings Report', page: 'MeetingsReport', icon: BarChart3, roles: ['super_admin', 'admin', 'chief_mentor', 'cs_manager'], only: ['super_admin', 'admin', 'chief_mentor', 'cs_manager'] },
  { name: 'MentorReport', label: 'Mentor Report', page: 'MentorReport', icon: ClipboardList, roles: ['super_admin', 'admin', 'chief_mentor', 'senior_mentor', 'junior_mentor', 'subjunior_mentor', 'cs_manager'], only: ['super_admin', 'admin', 'chief_mentor', 'senior_mentor', 'junior_mentor', 'subjunior_mentor', 'cs_manager'] },
  { name: 'MentorPerformance', hidden: true, page: 'MentorPerformance', icon: Gauge, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'finance_admin'] },
  { name: 'MasterAdmin', page: 'MasterAdmin', icon: ShieldCheck, roles: ['super_admin'] },
  // CS Managers: the CS accounts only, to View as (2026-10-13; Layout lets them past their role's page list).
  { name: 'Personnel', page: 'Personnel', icon: Contact, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'admin_supervisor', 'cs_manager'] },
  { name: 'RolesManagement', page: 'RolesManagement', icon: KeyRound, roles: ['super_admin', 'admin'] },
  { name: 'Hierarchy', hidden: true, page: 'Hierarchy', icon: Network, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head'] },
  { name: 'AcademicCounselors', hidden: true, page: 'AcademicCounselors', icon: BookUser, roles: ['academic_head', 'super_admin'] },
  { name: 'Students', page: 'Students', icon: Users, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'] },
  // New students from finance not onboarded yet; 6 hours on, their leaders and the Super Admins are told (backend/src/students/onboardingAlerts.ts).
  // CSE course upgrades: balances, next payments and the MT5 bonus (backend functions/courseUpgrades.ts) — whoever sees Students.
  { name: 'CourseUpgrades', label: 'Course Upgrades', page: 'CourseUpgrades', icon: ArrowUpCircle, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance', 'cs_manager', 'cs'], sameAccessAs: 'Students' },
  { name: 'NotOnboarded', label: 'Not onboarded', page: 'NotOnboarded', icon: DoorOpen, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'], sameAccessAs: 'Students' },
  // What students still owe on Delta finance's courses, the next instalment due 29 days after the latest payment, and the
  // next payment recorded for finance to approve (backend functions/balancePayments.ts) — whoever sees Students.
  { name: 'BalancePayments', label: 'Balance payments', page: 'BalancePayments', icon: Coins, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'], sameAccessAs: 'Students' },
  // Marked not a student (backend functions/notStudent.ts): off every list, here only — whoever sees Students (2026-10-14).
  { name: 'InactiveStudents', label: 'Inactive students', page: 'InactiveStudents', icon: UserX, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'], sameAccessAs: 'Students' },
  { name: 'StudentFollowups', label: 'Follow-ups', page: 'StudentFollowups', icon: PhoneCall, roles: FOLLOWUP_ROLES },
  { name: 'OverdueFollowups', label: 'Overdue follow-ups', page: 'OverdueFollowups', icon: AlarmClock, roles: FOLLOWUP_ROLES, sameAccessAs: 'StudentFollowups' },
  { name: 'StudentCalls', label: 'Calls', page: 'StudentCalls', icon: PhoneIncoming, roles: FOLLOWUP_ROLES, sameAccessAs: 'StudentFollowups' },
  // A student attended an LMS class that is over: their CS calls them (backend/src/students/classCompletions.ts).
  { name: 'ClassCompletions', label: 'Class Completions', page: 'ClassCompletions', icon: BookCheck, roles: FOLLOWUP_ROLES, sameAccessAs: 'StudentFollowups' },
  // Student meetings booked from the Mentor Calendar, and how each went (2026-10-28) — whose as the follow-ups.
  { name: 'MeetingsDone', label: 'Meetings done', page: 'MeetingsDone', icon: CalendarCheck, roles: FOLLOWUP_ROLES, sameAccessAs: 'StudentFollowups' },
  // Each CS's own WhatsApp; their Chief Mentor / CS Manager and Super Admins read it (backend/src/functions/whatsapp.ts).
  { name: 'WhatsApp', label: 'WhatsApp', page: 'WhatsApp', icon: MessageCircle, roles: ['super_admin', 'chief_mentor'], sameAccessAs: 'StudentFollowups' },
  // The Delta LMS's exams, with their links to copy (functions/lmsExams.ts; the user, 2026-10-10) — whoever sees Students.
  { name: 'Exams', label: 'Exams', page: 'Exams', icon: FileCheck, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'], sameAccessAs: 'Students', notForSales: true },
  { name: 'MentorCalendar', label: 'Mentor Calendar', page: 'MentorCalendar', icon: CalendarDays, roles: ['all'], everyone: true },
  // Repeating LMS classes for chosen students — a CS their own (and others' one by one), leaders their team's
  // (backend/src/functions/programs.ts).
  { name: 'Programs', label: 'Programs', page: 'Programs', icon: Repeat, roles: ['super_admin', 'chief_mentor'], sameAccessAs: 'StudentFollowups', notForSales: true },
  // Their students' LMS help-desk tickets, answered or resolved from here (backend/src/functions/lmsSupport.ts).
  { name: 'SupportTickets', label: 'Support Tickets', page: 'SupportTickets', icon: LifeBuoy, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'], sameAccessAs: 'Students' },
  // LMS enrolment requests, approved or rejected from here — a CS their own students', the Super Admin every Forex
  // applicant's; never the Sales role (backend/src/functions/lmsEnrolmentRequests.ts).
  { name: 'LmsRequests', label: 'LMS Requests', page: 'LmsRequests', icon: ClipboardCheck, roles: ['super_admin', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'], sameAccessAs: 'Students', notForSales: true },
  // Zoho Books invoices 2024 – Jun 2026 — a CS their own students', leaders their team's, admins all; never the Sales
  // role (backend/src/functions/zohoInvoices.ts).
  { name: 'ZohoInvoices', label: 'Invoices', page: 'ZohoInvoices', icon: FileText, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'], sameAccessAs: 'Students', notForSales: true },
  { name: 'StudentLogs', page: 'StudentLogs', icon: ClipboardList, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'academic_admin', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'] },
  { name: 'StudentLogHistoryPage', page: 'StudentLogHistoryPage', icon: History, roles: ['super_admin', 'academic_head', 'academic_admin', 'admin_supervisor', 'junior_mentor', 'chief_mentor', 'senior_mentor', 'subjunior_mentor', 'assistance'] },
  { name: 'MyStudentRequests', page: 'MyStudentRequests', icon: UserPlus, roles: ['junior_mentor', 'chief_mentor', 'senior_mentor', 'academic_head'], notFor: ['cs'] },
  { name: 'StudentRequestApprovals', page: 'StudentRequestApprovals', icon: UserCheck, roles: ['super_admin', 'academic_head', 'broker_admin'] },
  { name: 'RetentionManagement', page: 'RetentionManagement', icon: RefreshCcw, roles: ['academic_head'] },
  { name: 'DrawAdminStudents', page: 'DrawAdminStudents', icon: Users, roles: ['draw_admin'] },
  { name: 'InactivityTransfers', page: 'InactivityTransfers', icon: Hourglass, roles: ['super_admin', 'admin'] },
  // Where the students that came in went (2026-10-20): admins everything, a CS Manager their location, a team leader their team.
  { name: 'StudentWorkflow', label: 'Student workflow', page: 'StudentWorkflow', icon: Workflow, roles: ['super_admin', 'admin', 'academic_head', 'chief_mentor', 'cs_manager'] },
  { name: 'StudentTags', label: 'Student Tags', page: 'StudentTags', icon: Tags, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'finance_admin'] },
  { name: 'MT5Accounts', hidden: true, page: 'MT5Accounts', icon: CandlestickChart, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'junior_mentor', 'chief_mentor', 'senior_mentor'] },
  { name: 'FundingActivities', page: 'MyFundingRequests', icon: Wallet, roles: ['chief_mentor', 'senior_mentor', 'junior_mentor', 'assistance'] },
  // CS Managers too, to read — every request, no actions (2026-10-09; Layout lets them past their role's page list).
  { name: 'FundingRequests', page: 'FundingRequests', icon: HandCoins, roles: ['super_admin', 'broker_admin', 'academic_head', 'finance_admin', 'cs_manager'] },
  // MT5 bonuses waiting for a broker admin: sales-close bonuses (onboarding verification) and finance-approved bonus
  // requests. Only the people who decide a bonus (backend BONUS_APPROVERS) — `only`, so no role override opens it.
  { name: 'BonusApprovals', label: 'MT5 Approvals', page: 'BonusApprovals', icon: Gift, roles: ['super_admin', 'broker_admin'], only: ['super_admin', 'broker_admin'] },
  // A bonus still not in the student's MT5 (2026-10-13): raised by a CS, CS Manager or Super Admin, answered by the broker
  // admins (backend functions/creditRequests.ts). Layout lets CS and CS Managers past their role's page list.
  // Its own page is gone (the user, 2026-10-13): the "Not credited" tab of MT5 Approvals and of Funding Activities.
  { name: 'NotCreditedYet', label: 'Not Credited Yet', page: 'NotCreditedYet', icon: BadgeAlert, roles: [], only: [], hidden: true, notForSales: true },
  // CSs ask on the student's page; a Super Admin pastes the link in (backend/src/functions/paymentLinks.ts). A CS
  // sees what they asked for here, along with their Students page; no other role gets it.
  { name: 'PaymentLinks', label: 'Payment Links', page: 'PaymentLinks', icon: CreditCard, roles: ['super_admin', 'cs', 'cs_manager', 'chief_mentor', 'senior_mentor', 'junior_mentor', 'subjunior_mentor'], only: ['super_admin', 'cs', 'cs_manager', 'chief_mentor', 'senior_mentor', 'junior_mentor', 'subjunior_mentor'], sameAccessAs: 'Students' },
  { name: 'MyTargets', page: 'MyTargets', icon: Target, roles: ['chief_mentor', 'senior_mentor', 'junior_mentor'] },
  { name: 'TargetsManagement', page: 'TargetsManagement', icon: Crosshair, roles: ['super_admin', 'broker_admin', 'academic_head'] },
  { name: 'MyCommissionHistory', page: 'MyCommissionHistory', icon: ReceiptText, roles: ['chief_mentor', 'senior_mentor', 'junior_mentor'] },
  { name: 'QuarterClosing', label: 'Quarterly Deposit Closing', page: 'QuarterClosing', icon: CalendarCheck, roles: ['super_admin', 'broker_admin', 'finance_admin'] },
  { name: 'MonthlyClosing', label: 'Bonus Closing', page: 'MonthlyClosing', icon: CalendarRange, roles: ['super_admin', 'admin', 'broker_admin', 'finance_admin'] },
  // Removed for everyone (the user, 2026-10-13).
  { name: 'DailyPayouts', page: 'DailyPayouts', icon: Banknote, roles: [], only: [], hidden: true },
  { name: 'CommissionPlans', page: 'CommissionPlans', icon: Layers, roles: ['super_admin', 'admin', 'broker_admin', 'finance_admin'] },
  { name: 'BonusCommissionReports', hidden: true, page: 'BonusCommissionReports', icon: Gift, roles: ['super_admin', 'admin', 'broker_admin', 'finance_admin'] },
  { name: 'DepositCommissionReports', hidden: true, page: 'DepositCommissionReports', icon: PiggyBank, roles: ['super_admin', 'admin', 'broker_admin', 'finance_admin'] },
  { name: 'CommissionTools', page: 'CommissionTools', icon: Wrench, roles: ['super_admin', 'broker_admin', 'finance_admin'] },
  { name: 'CommissionReports', page: 'CommissionReports', icon: FileBarChart, roles: ['super_admin', 'broker_admin', 'academic_head', 'finance_admin'] },
  { name: 'GamificationSettings', hidden: true, page: 'GamificationSettings', icon: Gamepad2, roles: ['super_admin', 'academic_head'] },
  { name: 'Transactions', page: 'Transactions', icon: ArrowLeftRight, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head'] },
  { name: 'TransactionTags', label: 'Products', page: 'TransactionTags', icon: Package, roles: ['super_admin', 'admin', 'broker_admin', 'academic_head', 'finance_admin'] },
  { name: 'Commissions', hidden: true, page: 'Commissions', icon: Percent, roles: ['super_admin', 'broker_admin', 'academic_head'] },
  { name: 'Tickets', page: 'Tickets', icon: Ticket, roles: ['super_admin', 'broker_admin', 'academic_head', 'cs_manager', 'chief_mentor', 'senior_mentor', 'junior_mentor'] },
  { name: 'Reports', label: 'Student & commission reports', page: 'Reports', icon: BarChart3, roles: ['super_admin', 'broker_admin', 'academic_head', 'junior_mentor', 'chief_mentor', 'senior_mentor'] },
  // The Reports section (the user, 2026-10-11): each report its own page, under one "Reports" entry in the sidebar.
  // For everyone but the Sales role; the server decides whose figures each person sees (functions/reports.ts).
  { name: 'DepositReport', label: 'Deposit report', page: 'DepositReport', icon: PiggyBank, roles: ['all'], everyone: true, notForSales: true },
  { name: 'WithdrawalReport', label: 'Withdrawal report', page: 'WithdrawalReport', icon: Wallet, roles: ['all'], everyone: true, notForSales: true },
  { name: 'FundingRequestReport', label: 'Funding request report', page: 'FundingRequestReport', icon: HandCoins, roles: ['all'], everyone: true, notForSales: true },
  { name: 'BonusReport', label: 'Bonus report', page: 'BonusReport', icon: Gift, roles: ['all'], everyone: true, notForSales: true },
  { name: 'AuditLogs', page: 'AuditLogs', icon: ScrollText, roles: ['super_admin', 'admin_supervisor', 'academic_head'] }
];

// Sidebar section grouping (page name -> group). Rendered as labelled groups.
export const NAV_GROUPS = ['Overview', 'People & Access', 'Students', 'Funding', 'Commission', 'Reports', 'More'];
/** Groups drawn as one entry with its pages under it, opened and closed (the user, 2026-10-11). */
export const NESTED_GROUPS = {
  Reports: { icon: BarChart3, order: ['DepositReport', 'WithdrawalReport', 'FundingRequestReport', 'BonusReport', 'CommissionReports', 'Reports'] },
};
export const GROUP_OF = {
  Dashboard: 'Overview', TeamDashboard: 'Overview', Teams: 'Overview', ActivityTracker: 'Overview', AIInsights: 'Overview', Leaderboard: 'Overview', InstructorReviews: 'Overview', Reminders: 'Overview', MentorReport: 'Overview', MeetingsReport: 'Overview', MentorPerformance: 'Overview', MentorTraining: 'Overview',
  Personnel: 'People & Access', RolesManagement: 'People & Access', Hierarchy: 'People & Access', AcademicCounselors: 'People & Access', MasterAdmin: 'People & Access',
  Students: 'Students', CourseUpgrades: 'Students', NotOnboarded: 'Students', InactiveStudents: 'Students', BalancePayments: 'Students', StudentFollowups: 'Students', OverdueFollowups: 'Students', StudentCalls: 'Students', ClassCompletions: 'Students', MeetingsDone: 'Students', WhatsApp: 'Students', MentorCalendar: 'Students', Programs: 'Students', SupportTickets: 'Students', LmsRequests: 'Students', Exams: 'Students', ZohoInvoices: 'Students', StudentLogs: 'Students', StudentLogHistoryPage: 'Students', MyStudentRequests: 'Students', StudentRequestApprovals: 'Students', RetentionManagement: 'Students', DrawAdminStudents: 'Students', MT5Accounts: 'Students', InactivityTransfers: 'Students', StudentWorkflow: 'Students', StudentTags: 'Students',
  FundingActivities: 'Funding', FundingRequests: 'Funding', BonusApprovals: 'Funding', NotCreditedYet: 'Funding', PaymentLinks: 'Funding', Transactions: 'Funding', TransactionTags: 'Funding',
  CommissionPlans: 'Commission', BonusCommissionReports: 'Commission', DepositCommissionReports: 'Commission', CommissionTools: 'Commission', Commissions: 'Commission', QuarterClosing: 'Commission', MonthlyClosing: 'Commission', DailyPayouts: 'Commission', MyCommissionHistory: 'Commission', MyTargets: 'Commission', TargetsManagement: 'Commission',
  DepositReport: 'Reports', WithdrawalReport: 'Reports', FundingRequestReport: 'Reports', BonusReport: 'Reports', Reports: 'Reports', CommissionReports: 'Reports',
  Tickets: 'More', AuditLogs: 'More', GamificationSettings: 'More',
};

/** A page (by item name or page) this role never gets — see `notFor` and `only`. */
/**
 * Roles that see only these pages (the user, 2026-10-12): a broker admin — MT5 Approvals, Tickets and the Reports
 * section — whatever their role's page list says; anything else, opened by its address, says it isn't available. A
 * student's page stays open to them (MT5 Approvals links to it), and the report details the Reports open.
 */
export const ROLE_ONLY_PAGES = {
  broker_admin: ['BonusApprovals', 'Tickets', 'DepositReport', 'WithdrawalReport', 'FundingRequestReport', 'BonusReport', 'Reports', 'CommissionReports', 'StudentDetail', 'ReportTransactionDetails', 'Reminders'],
};
/** Where such a role starts instead of the Dashboard. */
export const ROLE_HOME = { broker_admin: 'BonusApprovals' };
const roleOnlyBlocks = (role, name) => {
  const only = ROLE_ONLY_PAGES[role];
  if (!only || !name) return false;
  const item = NAV_ITEMS.find(i => i.name === name || i.page === name);
  return !only.includes(item ? item.name : name) && !only.includes(name);
};

export const pageBlockedFor = (role, name) =>
  !!role && (roleOnlyBlocks(role, name) || NAV_ITEMS.some(i => (i.name === name || i.page === name) && (i.notFor?.includes(role) || (i.only && !i.only.includes(role)))));

/** Page names a built-in role sees when it has no override. */
export const defaultPagesFor = (role) =>
  NAV_ITEMS.filter(i => !i.hidden && !i.sameAccessAs && !i.everyone && !i.notFor?.includes(role) && (i.roles.includes('all') || i.roles.includes(role))).map(i => i.name);
