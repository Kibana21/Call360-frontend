// Interim landing (CP0.1A → CP0.5): shows ONLY real authenticated-session data from GET /api/v1/me.
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, PageHead } from '../components/ui';

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Singapore' })
    .format(new Date(iso)) + ' SGT';

export function HomePage() {
  const { me } = useAuth();
  if (!me) return null;
  const { principal, session, roles, permissions, environment } = me;
  return (
    <>
      <PageHead eyebrow="S&C operations" title={`Welcome, ${principal.display_name}`}
        description="You are signed in to Call360. The operational Command Centre, with live callback KPIs, is introduced later in Stage 0; this page shows your authenticated session." />
      <div className="layout cols-even">
        <Card title="Your account" subtitle="Resolved by the server from your group memberships"
          aside={<Badge tone={roles.includes('ADMIN') ? 'purple' : 'gray'}>{roles.join(', ') || 'No role'}</Badge>}>
          <dl className="kv">
            <dt>Display name</dt><dd>{principal.display_name}</dd>
            <dt>Username</dt><dd className="mono">{principal.username}</dd>
            <dt>Identity provider</dt><dd>Local demo identity (not SSO)</dd>
            <dt>Market scope</dt><dd>{me.markets.length ? me.markets.join(', ') : 'None assigned yet'}</dd>
          </dl>
        </Card>
        <Card title="Current session" subtitle="Server-side session; tokens are held only in HttpOnly cookies"
          aside={<Badge tone="green">Active</Badge>}>
          <dl className="kv">
            <dt>Signed in</dt><dd>{fmt(session.created_at)}</dd>
            <dt>Access token renews by</dt><dd>{fmt(session.access_expires_at)}</dd>
            <dt>Idle timeout</dt><dd>{fmt(session.idle_expires_at)}</dd>
            <dt>Session ends at the latest</dt><dd>{fmt(session.absolute_expires_at)}</dd>
            <dt>Environment</dt><dd>{environment.app_env} · {environment.data_policy.replace('_', ' ').toLowerCase()}</dd>
          </dl>
        </Card>
      </div>
      <div style={{ marginTop: 19 }}>
        <Card title="Permissions" subtitle={`${permissions.length} permissions granted to your role${roles.length > 1 ? 's' : ''}`}>
          <div className="row wrap">
            {permissions.map((p) => <span key={p} className="tag mono">{p}</span>)}
          </div>
        </Card>
      </div>
    </>
  );
}
