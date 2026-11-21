// Survey Studio (FI-1) — the SERVER's validation of the saved draft. This is the authoritative result: the browser's
// own checks give immediate feedback and can never make a draft valid that the server refuses.
import { useCallback, useEffect, useState } from 'react';
import { ApiFailure } from '../../../api/client';
import { Glyph } from '../ui';
import { validateDraft, type ServerValidation } from './api';
import { usePersistence } from './Persistence';

export function ServerValidationPanel() {
  const p = usePersistence();
  const [result, setResult] = useState<ServerValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const surveyId = p?.surveyId, revision = p?.revision, canEdit = p?.canEdit;
  const run = useCallback(() => {
    if (!surveyId || !canEdit) return;
    setBusy(true);
    setError(null);
    validateDraft(surveyId).then(setResult).catch((e) => setError(e instanceof ApiFailure ? e.message : 'The server could not be reached.')).finally(() => setBusy(false));
  }, [surveyId, canEdit]);
  useEffect(() => { run(); }, [run, revision]); // on arrival, and again after every save
  if (!p) return null;
  const stale = result !== null && result.revision !== p.revision;
  const state = !result ? 'pending' : result.blockers ? 'blocked' : 'clear';
  return (
    <section className={`ss-server-val ${state}`} aria-label="Server validation" data-testid="ss-server-validation" data-state={state}>
      <header>
        <div>
          <p className="ss-vsum-kicker">Server validation · authoritative</p>
          <h2 data-testid="ss-server-verdict">
            {!p.canEdit ? 'Server validation needs the survey.edit permission'
              : error ? 'The server could not validate the draft'
                : !result ? 'Asking the server…'
                  : result.blockers ? `The server blocks this draft — ${result.blockers} blocker${result.blockers === 1 ? '' : 's'}` : 'The server finds no blocker in the saved draft'}
          </h2>
          <p className="ss-muted" data-testid="ss-server-scope">
            {result ? <>Checked the <strong>saved revision {result.revision}</strong>.</> : null}
            {p.dirty ? <> <strong data-testid="ss-server-unsaved">You have {p.changed} unsaved change{p.changed === 1 ? '' : 's'}: the server has not seen them. Save, and it validates again.</strong></> : null}
            {stale && !p.dirty ? ' A newer revision has been saved; checking again.' : null}
            {' '}A draft with a server blocker cannot be submitted for review, whatever the checks below say.
          </p>
        </div>
        <button type="button" className="ss-btn small" onClick={run} disabled={busy || !p.canEdit} data-testid="ss-server-validate">{busy ? 'Checking…' : 'Validate the saved draft again'}</button>
      </header>
      {error ? <p className="ss-warn-text" role="alert">{error}</p> : null}
      {result && result.findings.length ? (
        <ul className="ss-server-findings" data-testid="ss-server-findings">
          {result.findings.map((f, i) => (
            <li key={`${f.code}-${f.at}-${i}`} data-testid="ss-server-finding" data-code={f.code}>
              <span className="ss-finding-sev"><Glyph name="stop" size={14} /> {f.severity === 'BLOCKER' ? 'Blocker' : f.severity === 'WARNING' ? 'Warning' : 'For information'}</span>
              <span><strong>{f.message}</strong><small><span className="ss-code">{f.code}</span> at <span className="ss-code">{f.at}</span></small></span>
            </li>))}
        </ul>
      ) : null}
    </section>
  );
}
