import './App.css'
import { Toaster } from "@/components/ui/toaster"
// Most screens call toast() from sonner; its Toaster must be mounted for them to show.
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import CommissionTools from './pages/CommissionTools';
import ReportTransactionDetails from './pages/ReportTransactionDetails';
import { BrowserRouter as Router, Route, Routes, Outlet, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Login from './pages/Login';
import Sso from './pages/Sso';
import RootPortalHistoryBridge from '@/components/RootPortalHistoryBridge';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const PAGE_KEYS = [...Object.keys(Pages), 'CommissionTools', 'ReportTransactionDetails'];

// One persistent layout for every authenticated page, so the sidebar/top bar
// stay mounted between navigations and only the page content transitions.
const LayoutRoute = () => {
  const { pathname } = useLocation();
  const segment = decodeURIComponent(pathname.replace(/^\/+/, '').split('/')[0] || '');
  const currentPageName = segment
    ? (PAGE_KEYS.find(k => k.toLowerCase() === segment.toLowerCase()) || segment)
    : mainPageKey;
  return <LayoutWrapper currentPageName={currentPageName}><Outlet /></LayoutWrapper>;
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, authError, isAuthenticated, navigateToLogin } = useAuth();
  const location = useLocation();
  const onLoginPage = location.pathname === '/Login' || location.pathname === '/login';

  // Login route is always reachable without auth.
  if (onLoginPage) return <Routes><Route path="*" element={<Login />} /></Routes>;
  // So is the landing page for signing in from the Root portal.
  if (location.pathname === '/sso') return <Routes><Route path="*" element={<Sso />} /></Routes>;

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background bg-dot-grid">
        <img src="/brand/delta-logo.png" alt="Delta" className="h-10 w-auto animate-pulse" />
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') return <UserNotRegisteredError />;
    if (authError.type === 'auth_required') { navigateToLogin(); return null; }
  }
  if (!isAuthenticated) { navigateToLogin(); return null; }

  return (
    <Routes>
      <Route element={<LayoutRoute />}>
        <Route path="/" element={<MainPage />} />
        {Object.entries(Pages).filter(([path]) => path !== 'Login').map(([path, Page]) => (
          <Route key={path} path={`/${path}`} element={<Page />} />
        ))}
        <Route path="/CommissionTools" element={<CommissionTools />} />
        <Route path="/ReportTransactionDetails" element={<ReportTransactionDetails />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <NavigationTracker />
          <RootPortalHistoryBridge />
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <SonnerToaster theme="light" position="top-right" richColors closeButton />
        <VisualEditAgent />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App