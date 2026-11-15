import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { safeReturnPath } from '../api/session';
import { Icon } from '../components/Icon';

export function SessionExpiredPage() {
  const [params] = useSearchParams();
  const returnTo = safeReturnPath(params.get('returnTo'));
  useEffect(() => { document.title = 'Call360 · Session ended'; }, []);
  return (
    <div className="login-page">
      <main className="login-card" aria-labelledby="expired-title">
        <div className="login-mark"><Icon name="clock" size="lg" /></div>
        <h1 id="expired-title">Your session has ended</h1>
        <p>For your security the session was signed out or expired. Sign in again to continue where you left off.</p>
        <Link className="btn primary" style={{ width: '100%', height: 43 }}
          to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in again</Link>
      </main>
    </div>
  );
}
