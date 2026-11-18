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
import { RiskWorkbenchPage } from './features/risk/RiskWorkbenchPage';
import { OverviewPage } from './features/OverviewPage';
import { SearchPage } from './features/search/SearchPage';
import { IntakePage } from './features/intake/IntakePage';
import { PasswordPage } from './features/account/PasswordPage';
import { GroupsPage } from './features/admin/GroupsPage';
import { SessionsPage } from './features/admin/SessionsPage';
import { SystemPage } from './features/admin/SystemPage';
import { ReviewWorkbenchPage } from './features/reviews/ReviewWorkbenchPage';
import { VoiceStudioPage } from './features/voice/VoiceStudioPage';
import { RuleDetailPage } from './features/rules/RuleDetailPage';
import { TextSimulatorPage } from './features/simulator/TextSimulatorPage';
import { AssignmentRulesPage } from './features/scripts/AssignmentRulesPage';
import { ScriptFamilyPage } from './features/scripts/ScriptFamilyPage';
import { ScriptLibraryPage } from './features/scripts/ScriptLibraryPage';
import { LoginPage } from './features/LoginPage';
import { NotFoundPage } from './features/NotFoundPage';
import { SessionExpiredPage } from './features/SessionExpiredPage';
import { UnauthorizedPage } from './features/UnauthorizedPage';

// Routes implemented so far: CP0.1A, /admin/config (CP0.1B-1), the Overview (F1), and Call Explorer, Work Queues
// and Search (F2), Call Detail (F3), Policy Explorer and Policy Detail (F4), and the SBQ Risk Workbench (F5). S0_SCREEN_SPEC §2.
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
          <Route path="risk-assessments" element={<RequirePermission permission="risk.read"><RiskWorkbenchPage /></RequirePermission>} />
          <Route path="queues" element={<RequirePermission permission="queue.read"><WorkQueuesPage /></RequirePermission>} />
          <Route path="search" element={<RequirePermission permission="search.use"><SearchPage /></RequirePermission>} />
          <Route path="scripts" element={<RequirePermission permission="script.read"><ScriptLibraryPage /></RequirePermission>} />
          <Route path="scripts/:scriptFamilyId" element={<RequirePermission permission="script.read"><ScriptFamilyPage /></RequirePermission>} />
          <Route path="assignment-rules" element={<RequirePermission permission="script.read"><AssignmentRulesPage /></RequirePermission>} />
          <Route path="assignment-rules/:ruleCode" element={<RequirePermission permission="script.read"><RuleDetailPage /></RequirePermission>} />
          <Route path="simulator" element={<RequirePermission permission="script.read"><TextSimulatorPage /></RequirePermission>} />
          <Route path="reviews" element={<RequirePermission permission="queue.read"><ReviewWorkbenchPage /></RequirePermission>} />
          <Route path="voice-studio" element={<RequirePermission permission="voice.preflight.read"><VoiceStudioPage /></RequirePermission>} />
          <Route path="intake" element={<RequirePermission permission="intake.read"><IntakePage /></RequirePermission>} />
          <Route path="account/password" element={<PasswordPage />} />
          <Route path="unauthorized" element={<UnauthorizedPage />} />
          <Route path="admin" element={<RequirePermission permission="admin.users.read"><AdminLayout /></RequirePermission>}>
            <Route index element={<Navigate to="/admin/users" replace />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="groups" element={<GroupsPage />} />
            <Route path="sessions" element={<RequirePermission permission="admin.sessions.manage"><SessionsPage /></RequirePermission>} />
            <Route path="system" element={<RequirePermission permission="system.health.read"><SystemPage /></RequirePermission>} />
            <Route path="audit" element={<RequirePermission permission="audit.read"><AuditPage /></RequirePermission>} />
            <Route path="config" element={<RequirePermission permission="config.read"><ConfigPage /></RequirePermission>} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
