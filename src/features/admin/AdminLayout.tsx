import { NavLink, Outlet } from 'react-router-dom';
import { PageHead, StageChip } from '../../components/ui';

const LATER = ['Groups', 'Sessions', 'System'];

export function AdminLayout() {
  return (
    <>
      <PageHead eyebrow="Access & platform governance" title="Administration"
        description="Local identities, account status, configuration and the append-only audit trail. Every change is enforced and recorded by the server." />
      <nav className="subtabs" aria-label="Administration sections" style={{ marginBottom: 19 }}>
        <NavLink to="/admin/users" className={({ isActive }) => (isActive ? 'active' : '')}>Users</NavLink>
        <NavLink to="/admin/audit" className={({ isActive }) => (isActive ? 'active' : '')}>Audit</NavLink>
        <NavLink to="/admin/config" className={({ isActive }) => (isActive ? 'active' : '')}>Configuration</NavLink>
        {LATER.map((label) => (
          <span key={label} className="disabled-tab" aria-disabled="true">{label} <StageChip label="Later in Stage 0" /></span>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
