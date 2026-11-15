import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './app/AppShell';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RequirePermission } from './auth/guards';
import { AdminLayout } from './features/admin/AdminLayout';
import { AuditPage } from './features/admin/AuditPage';
import { UsersPage } from './features/admin/UsersPage';
import { HomePage } from './features/HomePage';
import { LoginPage } from './features/LoginPage';
import { NotFoundPage } from './features/NotFoundPage';
import { SessionExpiredPage } from './features/SessionExpiredPage';
import { UnauthorizedPage } from './features/UnauthorizedPage';

// CP0.1A routes only (S0_SCREEN_SPEC §2; S0_IMPLEMENTATION_PLAN CP0.1A).
export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/session-expired" element={<SessionExpiredPage />} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<HomePage />} />
          <Route path="unauthorized" element={<UnauthorizedPage />} />
          <Route path="admin" element={<RequirePermission permission="admin.users.read"><AdminLayout /></RequirePermission>}>
            <Route index element={<Navigate to="/admin/users" replace />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="audit" element={<RequirePermission permission="audit.read"><AuditPage /></RequirePermission>} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
