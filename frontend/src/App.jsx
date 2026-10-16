import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TenantProvider } from './context/TenantContext';
import { ThemeProvider } from './context/ThemeContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';

// Pages
import Dashboard from './pages/Dashboard';
import { Customers } from './pages/Customers';
import { MeetingSchedule } from './pages/MeetingSchedule';
import { Integrations } from './pages/Integrations';
import { Logs } from './pages/Logs';
import { Login } from './pages/Login';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { ChangePassword } from './pages/ChangePassword';
import { AccountPassword } from './pages/AccountPassword';
import Unauthorized from './pages/Unauthorized';

// Tracker pages
import { TrackerTaskDetail } from './pages/tracker/TrackerTaskDetail';

// Reports Pages
import { ReportsDashboard } from './pages/reports/ReportsDashboard';
import { ReportList } from './pages/reports/ReportList';
import { ReportDetails } from './pages/reports/ReportDetails';
import { ReportPreview } from './pages/reports/ReportPreview';


// ─── Guards ───────────────────────────────────────────────────────────────────

// Redirects unauthenticated users to /login and enforces role restrictions.
const RoleProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();
  const location          = useLocation();
  if (loading) return null;
  if (!user)   return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (!allowedRoles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  // If the user must change their password, intercept every protected page.
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return children;
};

const AM = ['super_admin', 'account_manager'];

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <TenantProvider>
              <BrowserRouter>
                <Routes>
                  {/* ── Public auth routes ─────────────────────────────── */}
                  <Route path="/login"           element={<Login />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/reset-password"  element={<ResetPassword />} />
                  <Route path="/change-password" element={<ChangePassword />} />
                  <Route path="/unauthorized"    element={<Unauthorized />} />

                  {/* ── Protected app routes ───────────────────────────── */}
                  <Route path="/" element={<Layout />}>
                    <Route index element={<Dashboard />} />

                    {/* Super Admin Only */}
                    <Route path="customers" element={
                      <RoleProtectedRoute allowedRoles={['super_admin']}>
                        <Customers />
                      </RoleProtectedRoute>
                    } />

                    {/* Meetings & Tracker */}
                    <Route path="meetings" element={
                      <RoleProtectedRoute allowedRoles={AM}>
                        <MeetingSchedule />
                      </RoleProtectedRoute>
                    } />

                    <Route path="tracker/tasks/:taskId" element={
                      <RoleProtectedRoute allowedRoles={AM}>
                        <TrackerTaskDetail />
                      </RoleProtectedRoute>
                    } />

                    <Route path="tracker" element={<Navigate to="/meetings" replace />} />
                    <Route path="tracker/tasks" element={<Navigate to="/meetings" replace />} />

                    {/* Account / profile routes */}
                    <Route path="account/password" element={
                      <RoleProtectedRoute allowedRoles={AM}>
                        <AccountPassword />
                      </RoleProtectedRoute>
                    } />

                    {/* Common routes */}
                    <Route path="integrations" element={
                      <RoleProtectedRoute allowedRoles={AM}>
                        <Integrations />
                      </RoleProtectedRoute>
                    } />
                    <Route path="logs" element={
                      <RoleProtectedRoute allowedRoles={AM}>
                        <Logs />
                      </RoleProtectedRoute>
                    } />

                    {/* Reports */}
                    <Route path="reports" element={
                      <RoleProtectedRoute allowedRoles={AM}>
                        <ReportsDashboard />
                      </RoleProtectedRoute>
                    } />
                    <Route path="reports/list" element={
                      <RoleProtectedRoute allowedRoles={AM}>
                        <ReportList />
                      </RoleProtectedRoute>
                    } />
                    <Route path="reports/:reportId" element={
                      <RoleProtectedRoute allowedRoles={AM}>
                        <ReportDetails />
                      </RoleProtectedRoute>
                    } />
                    <Route path="reports/:reportId/preview" element={
                      <RoleProtectedRoute allowedRoles={AM}>
                        <ReportPreview />
                      </RoleProtectedRoute>
                    } />

                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
              </BrowserRouter>
            </TenantProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
