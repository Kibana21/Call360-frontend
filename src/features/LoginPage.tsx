import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { safeReturnPath } from '../api/session';
import { ME_KEY, useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { Badge, Button } from '../components/ui';

const MESSAGES: Record<number, string> = {
  401: 'Sign-in failed. Check your username and password.',
  429: 'Too many sign-in attempts. Wait a few minutes and try again.',
};

export function LoginPage() {
  const { me } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const returnTo = safeReturnPath(params.get('returnTo'));

  useEffect(() => { document.title = 'Call360 · Sign in'; }, []);
  if (me) return <Navigate to={returnTo} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await api.GET('/api/v1/auth/csrf'); // pre-session CSRF token bound to a nonce cookie
        const res = await api.POST('/api/v1/auth/login', { body: { username, password } });
        if (res.response.ok) {
          setPassword('');
          await qc.invalidateQueries({ queryKey: ME_KEY });
          navigate(returnTo, { replace: true });
          return;
        }
        if (res.response.status === 403 && attempt === 0) continue; // stale CSRF: fetch a new token once
        setError(MESSAGES[res.response.status] ?? 'Sign-in is unavailable right now. Try again shortly.');
        return;
      }
    } catch {
      setError('Sign-in is unavailable right now. Check that the Call360 API is running.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <main className="login-card" aria-labelledby="login-title">
        <div className="row">
          <div className="login-mark"><Icon name="shield" size="lg" /></div>
          <div>
            <div className="brandname">Call<b>360</b></div>
            <div className="brandsub">CLIENT ASSURANCE</div>
          </div>
        </div>
        <h1 id="login-title">Secure access</h1>
        <p>Sign in to the client callback and compliance assurance workspace.</p>
        <form onSubmit={submit} noValidate>
          <label className="form-label" htmlFor="username">Username</label>
          <input id="username" className="field labelled" autoComplete="username" value={username} required
            maxLength={64} onChange={(e) => setUsername(e.target.value)} />
          <label className="form-label" htmlFor="password" style={{ marginTop: 15 }}>Password</label>
          <input id="password" className="field labelled" type="password" autoComplete="current-password"
            value={password} required maxLength={128} onChange={(e) => setPassword(e.target.value)} />
          <label className="form-label" style={{ marginTop: 15 }} id="provider-label">Authentication provider</label>
          <div className="softbox row between" aria-labelledby="provider-label">
            <span className="small">Local demo identity</span>
            <Badge tone="amber">Not SSO</Badge>
          </div>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="divider" style={{ margin: '23px 0' }} />
          <Button type="submit" variant="primary" disabled={busy || !username || !password}
            style={{ width: '100%', justifyContent: 'space-between', height: 43 }}>
            <Icon name="lock" />
            <span>{busy ? 'Signing in…' : 'Sign in'}</span>
            <Icon name="chev" />
          </Button>
        </form>
        <p style={{ margin: '20px 0 0', textAlign: 'center', fontSize: 10 }}>
          Synthetic data only. Local accounts are for development; enterprise SSO arrives in a later stage.
        </p>
      </main>
    </div>
  );
}
