// CP0.1B-3 shared Administration pieces: a reason-required confirmation dialog and the one-time password panel.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiFailure } from '../../api/client';
import { Button } from '../../components/ui';

export const adminWhen = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }).format(new Date(iso)) : '—';

export function errorText(e: unknown, fallback = 'The change could not be saved.'): string {
  if (!(e instanceof ApiFailure)) return fallback;
  if (e.code === 'CONFLICT_ROW_VERSION') return 'This changed since you loaded it. Close, reload and try again.';
  return `${e.message}${e.code ? ` (${e.code})` : ''}`;
}

/** Modal with a required reason; `onConfirm` performs the server change and resolves when it is saved. */
export function ReasonDialog({ eyebrow, title, description, confirm, danger, onConfirm, onClose, children, canConfirm = true }: {
  eyebrow: string; title: string; description: string; confirm: string; danger?: boolean; canConfirm?: boolean;
  onConfirm: (reason: string) => Promise<unknown>; onClose: () => void; children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try { await onConfirm(reason.trim()); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="reason-title">
        <form className="modal-content" onSubmit={submit}>
          <div className="modal-head"><div>
            <div className="eyebrow">{eyebrow}</div>
            <h2 id="reason-title">{title}</h2>
            <p className="small muted" style={{ margin: 0 }}>{description}</p>
          </div></div>
          {children}
          <label className="form-label" htmlFor="reason-text">Reason (required)</label>
          <textarea id="reason-text" ref={first} className="field labelled textarea" rows={3} minLength={3} maxLength={500}
            value={reason} onChange={(e) => setReason(e.target.value)} required />
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="row right" style={{ marginTop: 20 }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={reason.trim().length < 3 || busy || !canConfirm}>
              {busy ? 'Saving…' : confirm}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** The one-time password, shown once; it is never stored by the page or sent anywhere else. */
export function OneTimePasswordPanel({ username, password, onDone }: { username: string; password: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="otp-title">
        <div className="modal-content">
          <div className="eyebrow">One-time password</div>
          <h2 id="otp-title">Password for {username}</h2>
          <p className="small muted">Shown once. Give it to the user through a separate channel. They must set their own password at first sign-in;
            until then they cannot use any other part of Call360.</p>
          <div className="softbox mono strong" data-testid="one-time-password" style={{ fontSize: 15, letterSpacing: '.5px', overflowWrap: 'anywhere' }}>{password}</div>
          <div className="row right" style={{ marginTop: 18 }}>
            <Button onClick={() => { void navigator.clipboard?.writeText(password).then(() => setCopied(true), () => setCopied(false)); }}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button variant="primary" onClick={onDone} autoFocus>Done — hide password</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
