import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './app/AppShell';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RequirePermission } from './auth/guards';
import { AdminLayout } from './features/admin/AdminLayout';
import { AuditPage } from './features/admin/AuditPage';
import { ConfigPage } from './features/admin/ConfigPage';
import { UsersPage } from './features/admin/UsersPage';
import { CallDetailPage } from './features/case/CallDetailPage';
import { CallExplorerPage } from './features/cases/CallExplorerPage';
import { WorkQueuesPage } from './features/cases/WorkQueuesPage';
import { PolicyDetailPage } from './features/policies/PolicyDetailPage';
import { PolicyExplorerPage } from './features/policies/PolicyExplorerPage';
import { OverviewPage } from './features/OverviewPage';
import { SearchPage } from './features/search/SearchPage';
import { LoginPage } from './features/LoginPage';
import { NotFoundPage } from './features/NotFoundPage';
import { SessionExpiredPage } from './features/SessionExpiredPage';
import { UnauthorizedPage } from './features/UnauthorizedPage';

// Routes implemented so far: CP0.1A, /admin/config (CP0.1B-1), the Overview (F1), and Call Explorer, Work Queues
// and Search (F2), Call Detail (F3), and Policy Explorer and Policy Detail (F4). S0_SCREEN_SPEC §2.
export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/session-expired" element={<SessionExpiredPage />} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<OverviewPage />} />
          <Route path="calls" element={<RequirePermission permission="case.read"><CallExplorerPage /></RequirePermission>} />
          <Route path="cases/:caseId" element={<RequirePermission permission="case.read"><CallDetailPage /></RequirePermission>} />
          <Route path="policies" element={<RequirePermission permission="policy.read"><PolicyExplorerPage /></RequirePermission>} />
          <Route path="policies/:policyId" element={<RequirePermission permission="policy.read"><PolicyDetailPage /></RequirePermission>} />
          <Route path="queues" element={<RequirePermission permission="queue.read"><WorkQueuesPage /></RequirePermission>} />
          <Route path="search" element={<RequirePermission permission="search.use"><SearchPage /></RequirePermission>} />
          <Route path="unauthorized" element={<UnauthorizedPage />} />
          <Route path="admin" element={<RequirePermission permission="admin.users.read"><AdminLayout /></RequirePermission>}>
            <Route index element={<Navigate to="/admin/users" replace />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="audit" element={<RequirePermission permission="audit.read"><AuditPage /></RequirePermission>} />
            <Route path="config" element={<RequirePermission permission="config.read"><ConfigPage /></RequirePermission>} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
