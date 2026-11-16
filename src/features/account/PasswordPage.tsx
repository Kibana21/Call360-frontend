// Account → Change password (`/account/password`, CP0.1B-3; API-009). Any signed-in user can change their own local
// password; a user holding a one-time password is sent here first and cannot use anything else until it is
// replaced. The policy is checked by the server; other sessions are signed out when the password changes.
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, expectOk } from '../../api/client';
import { ME_KEY, useAuth } from '../../auth/AuthContext';
import { Button, Card, PageHead } from '../../components/ui';
import { errorText } from '../admin/shared';

export function PasswordPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const required = !!me?.password_change_required;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== next;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setError(null);
    setBusy(true);
    try {
      expectOk(await api.POST('/api/v1/me/password', { body: { current_password: current, new_password: next } }));
      setCurrent(''); setNext(''); setConfirm('');
      await qc.invalidateQueries({ queryKey: ME_KEY });
      setDone(true);
      if (required) navigate('/', { replace: true });
    } catch (err) {
      setError(errorText(err, 'The password could not be changed.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead eyebrow="Your account" title="Change password"
        description="Your local Call360 password. Other signed-in browsers are signed out when it changes." />
      {required ? (
        <div className="topnotice" role="alert" data-testid="password-required"><span><strong>Set your own password to continue.</strong> Your administrator gave you a one-time password; nothing else in Call360 is available until you replace it.</span></div>
      ) : null}
      <Card title="Your password" subtitle="12–128 characters. Common passwords and ones containing your username or name are refused.">
        <form onSubmit={submit} style={{ maxWidth: 420 }} aria-label="Change password">
          <label className="form-label" htmlFor="pw-current">{required ? 'One-time password' : 'Current password'}</label>
          <input id="pw-current" type="password" className="field labelled" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          <label className="form-label" htmlFor="pw-new" style={{ marginTop: 12 }}>New password</label>
          <input id="pw-new" type="password" className="field labelled" autoComplete="new-password" minLength={12} maxLength={128} value={next} onChange={(e) => setNext(e.target.value)} required />
          <label className="form-label" htmlFor="pw-confirm" style={{ marginTop: 12 }}>Confirm new password</label>
          <input id="pw-confirm" type="password" className="field labelled" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required
            aria-invalid={mismatch || undefined} aria-describedby={mismatch ? 'pw-mismatch' : undefined} />
          {mismatch ? <div id="pw-mismatch" className="field-error">The two new passwords differ</div> : null}
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          {done && !required ? <div className="topnotice" role="status" style={{ marginTop: 14 }}><span>Password changed. Other sessions were signed out.</span></div> : null}
          <div className="row" style={{ marginTop: 18 }}>
            <Button type="submit" variant="primary" disabled={busy || !current || !next || mismatch}>{busy ? 'Saving…' : 'Change password'}</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
