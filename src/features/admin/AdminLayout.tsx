import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { PageHead, StageChip } from '../../components/ui';

// Administration sections (CP0.1A, CP0.1B-1, CP0.1B-3). Integrations (API-027) arrives with the deferred remainder
// of CP0.4b, so its tab stays visible and disabled.
const TABS: [string, string, string][] = [
  ['/admin/users', 'Users', 'admin.users.read'],
  ['/admin/groups', 'Groups', 'admin.users.read'],
  ['/admin/sessions', 'Sessions', 'admin.sessions.manage'],
  ['/admin/audit', 'Audit', 'audit.read'],
  ['/admin/config', 'Configuration', 'config.read'],
  ['/admin/system', 'System', 'system.health.read'],
];

export function AdminLayout() {
  const { can } = useAuth();
  return (
    <>
      <PageHead eyebrow="Access & platform governance" title="Administration"
        description="Local identities, groups and sessions, configuration, platform health and the append-only audit trail. Every change is enforced and recorded by the server." />
      <nav className="subtabs" aria-label="Administration sections" style={{ marginBottom: 19 }}>
        {TABS.filter(([, , p]) => can(p)).map(([to, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
        ))}
        <span className="disabled-tab" aria-disabled="true">Integrations <StageChip label="Deferred — CP0.4b" /></span>
      </nav>
      <Outlet />
    </>
  );
}
