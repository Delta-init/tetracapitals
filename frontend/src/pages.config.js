/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AIInsights from './pages/AIInsights';
import AcademicCounselors from './pages/AcademicCounselors';
import AuditLogs from './pages/AuditLogs';
import BonusCommissionReports from './pages/BonusCommissionReports';
import CommissionPlans from './pages/CommissionPlans';
import DepositCommissionReports from './pages/DepositCommissionReports';
import CommissionReports from './pages/CommissionReports';
import Commissions from './pages/Commissions';
import DailyPayouts from './pages/DailyPayouts';
import Dashboard from './pages/Dashboard';
import DrawAdminStudents from './pages/DrawAdminStudents';
import FundingRequests from './pages/FundingRequests';
import GamificationSettings from './pages/GamificationSettings';
import Hierarchy from './pages/Hierarchy';
import Home from './pages/Home';
import Leaderboard from './pages/Leaderboard';
import Login from './pages/Login';
import MasterAdmin from './pages/MasterAdmin';
import MT5Accounts from './pages/MT5Accounts';
import MentorPerformance from './pages/MentorPerformance';
import MentorTraining from './pages/MentorTraining';
import MonthlyClosing from './pages/MonthlyClosing';
import ActivityTracker from './pages/ActivityTracker';
import TeamDashboard from './pages/TeamDashboard';
import MyCommissionHistory from './pages/MyCommissionHistory';
import MyFundingRequests from './pages/MyFundingRequests';
import MyStudentRequests from './pages/MyStudentRequests';
import MyTargets from './pages/MyTargets';
import Personnel from './pages/Personnel';
import QuarterClosing from './pages/QuarterClosing';
import Reports from './pages/Reports';
import RetentionManagement from './pages/RetentionManagement';
import RolesManagement from './pages/RolesManagement';
import StudentDetail from './pages/StudentDetail';
import StudentLogHistoryPage from './pages/StudentLogHistoryPage';
import StudentLogs from './pages/StudentLogs';
import StudentTags from './pages/StudentTags';
import StudentRequestApprovals from './pages/StudentRequestApprovals';
import Students from './pages/Students';
import TargetsManagement from './pages/TargetsManagement';
import Teams from './pages/Teams';
import TeamDetail from './pages/TeamDetail';
import InactivityTransfers from './pages/InactivityTransfers';
import StudentFollowups from './pages/StudentFollowups';
import StudentCalls from './pages/StudentCalls';
import MentorCalendar from './pages/MentorCalendar';
import Tickets from './pages/Tickets';
import Transactions from './pages/Transactions';
import TransactionTags from './pages/TransactionTags';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AIInsights": AIInsights,
    "AcademicCounselors": AcademicCounselors,
    "AuditLogs": AuditLogs,
    "BonusCommissionReports": BonusCommissionReports,
    "CommissionPlans": CommissionPlans,
    "DepositCommissionReports": DepositCommissionReports,
    "CommissionReports": CommissionReports,
    "Commissions": Commissions,
    "DailyPayouts": DailyPayouts,
    "Dashboard": Dashboard,
    "DrawAdminStudents": DrawAdminStudents,
    "FundingRequests": FundingRequests,
    "GamificationSettings": GamificationSettings,
    "Hierarchy": Hierarchy,
    "Home": Home,
    "Leaderboard": Leaderboard,
    "Login": Login,
    "MasterAdmin": MasterAdmin,
    "MT5Accounts": MT5Accounts,
    "MentorPerformance": MentorPerformance,
    "MentorTraining": MentorTraining,
    "MonthlyClosing": MonthlyClosing,
    "ActivityTracker": ActivityTracker,
    "TeamDashboard": TeamDashboard,
    "MyCommissionHistory": MyCommissionHistory,
    "MyFundingRequests": MyFundingRequests,
    "MyStudentRequests": MyStudentRequests,
    "MyTargets": MyTargets,
    "Personnel": Personnel,
    "QuarterClosing": QuarterClosing,
    "Reports": Reports,
    "RetentionManagement": RetentionManagement,
    "RolesManagement": RolesManagement,
    "StudentDetail": StudentDetail,
    "StudentLogHistoryPage": StudentLogHistoryPage,
    "StudentTags": StudentTags,
    "StudentLogs": StudentLogs,
    "StudentRequestApprovals": StudentRequestApprovals,
    "Students": Students,
    "TargetsManagement": TargetsManagement,
    "Teams": Teams,
    "TeamDetail": TeamDetail,
    "InactivityTransfers": InactivityTransfers,
    "StudentFollowups": StudentFollowups,
    "StudentCalls": StudentCalls,
    "MentorCalendar": MentorCalendar,
    "Tickets": Tickets,
    "Transactions": Transactions,
    "TransactionTags": TransactionTags,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};