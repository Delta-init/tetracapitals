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
import CommissionReports from './pages/CommissionReports';
import Commissions from './pages/Commissions';
import Dashboard from './pages/Dashboard';
import DrawAdminStudents from './pages/DrawAdminStudents';
import FundingRequests from './pages/FundingRequests';
import GamificationSettings from './pages/GamificationSettings';
import Home from './pages/Home';
import Leaderboard from './pages/Leaderboard';
import Login from './pages/Login';
import MT5Accounts from './pages/MT5Accounts';
import MentorPerformance from './pages/MentorPerformance';
import MentorTraining from './pages/MentorTraining';
import MyCommissionHistory from './pages/MyCommissionHistory';
import MyFundingRequests from './pages/MyFundingRequests';
import MyStudentRequests from './pages/MyStudentRequests';
import MyTargets from './pages/MyTargets';
import Personnel from './pages/Personnel';
import QuarterClosing from './pages/QuarterClosing';
import Reports from './pages/Reports';
import RetentionManagement from './pages/RetentionManagement';
import StudentDetail from './pages/StudentDetail';
import StudentLogHistoryPage from './pages/StudentLogHistoryPage';
import StudentLogs from './pages/StudentLogs';
import StudentRequestApprovals from './pages/StudentRequestApprovals';
import Students from './pages/Students';
import TargetsManagement from './pages/TargetsManagement';
import Tickets from './pages/Tickets';
import Transactions from './pages/Transactions';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AIInsights": AIInsights,
    "AcademicCounselors": AcademicCounselors,
    "AuditLogs": AuditLogs,
    "CommissionReports": CommissionReports,
    "Commissions": Commissions,
    "Dashboard": Dashboard,
    "DrawAdminStudents": DrawAdminStudents,
    "FundingRequests": FundingRequests,
    "GamificationSettings": GamificationSettings,
    "Home": Home,
    "Leaderboard": Leaderboard,
    "Login": Login,
    "MT5Accounts": MT5Accounts,
    "MentorPerformance": MentorPerformance,
    "MentorTraining": MentorTraining,
    "MyCommissionHistory": MyCommissionHistory,
    "MyFundingRequests": MyFundingRequests,
    "MyStudentRequests": MyStudentRequests,
    "MyTargets": MyTargets,
    "Personnel": Personnel,
    "QuarterClosing": QuarterClosing,
    "Reports": Reports,
    "RetentionManagement": RetentionManagement,
    "StudentDetail": StudentDetail,
    "StudentLogHistoryPage": StudentLogHistoryPage,
    "StudentLogs": StudentLogs,
    "StudentRequestApprovals": StudentRequestApprovals,
    "Students": Students,
    "TargetsManagement": TargetsManagement,
    "Tickets": Tickets,
    "Transactions": Transactions,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};