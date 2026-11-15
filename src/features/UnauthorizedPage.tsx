import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { PageHead } from '../components/ui';

export function UnauthorizedPage() {
  return (
    <>
      <PageHead eyebrow="Restricted workspace" title="Access restricted"
        description="Permissions are enforced by the Call360 backend for every request." />
      <div className="card card-pad" style={{ maxWidth: 600 }}>
        <div className="row" style={{ color: 'var(--red)' }}>
          <Icon name="lock" size="lg" />
          <h2 style={{ margin: 0, fontSize: 16 }}>Administrator access required</h2>
        </div>
        <p className="muted" style={{ lineHeight: 1.7 }}>
          Your account does not include the permission needed for this page. Ask a Call360 administrator if you
          believe you should have access.
        </p>
        <Link className="btn primary" to="/"><Icon name="dashboard" size="sm" /> Return to Overview</Link>
      </div>
    </>
  );
}
