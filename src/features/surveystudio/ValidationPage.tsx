// Survey Studio prototype (SS-02C) — Screen I, part 1: the validation workspace.
// One grouped readiness view instead of an error log. Every finding says how serious it is, where it is, why it matters
// and what to do, and "Go to it" opens the exact place. A blocker must be fixed; a warning may be acknowledged with a
// reason the reviewer will read. Coverage by synthetic customers is shown as evidence and can never offset a blocker.
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { JourneyNav, useGovernance, who } from './JourneyNav';
import { AREAS, acknowledge, canAuthor, unacknowledge, type Area, type Finding } from './model/governance';
import { findSurvey } from './model/ops';
import { ServerValidationPanel } from './persist/ServerValidationPanel';
import { STANDING_NOTE } from './persist/standing';
import { StudioBar } from './StudioRoot';
import { useStudio } from './store';
import { Glyph, Tag } from './ui';

const SEVERITY = { BLOCKER: { label: 'Blocker', hint: 'Must be fixed', glyph: 'stop' }, WARNING: { label: 'Warning', hint: 'Fix or acknowledge', glyph: 'alert' }, INFO: { label: 'For information', hint: 'Nothing to do', glyph: 'info' } } as const;

export function ValidationPage() {
  const { surveyId = '' } = useParams();
  const { ws, gov, govern, requestFocus, persisted } = useStudio();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const survey = findSurvey(ws, surveyId);
  const { readiness: r, standing: st } = useGovernance(survey);
  if (!survey || !r || !st) {
    return (<><StudioBar crumbs={[{ label: 'Survey Studio', to: '/survey-studio' }, { label: 'Survey not found' }]} />
      <div className="ss-empty page"><p><strong>This survey is not in the prototype workspace.</strong> It may have been cleared by a reset.</p>
        <Link className="ss-btn" to="/survey-studio">Back to Survey Studio</Link></div></>);
  }
  const base = `/survey-studio/surveys/${survey.id}`;
  const only = params.get('area') as Area | null;
  const author = canAuthor(gov.actor);
  const goTo = (f: Finding) => {
    const w = f.where;
    if (!w) return;
    if (w.instanceId && (w.nodeId || w.moduleKey)) nav(`${base}/modules/${w.instanceId}${w.nodeId ? `?node=${w.nodeId}` : ''}`);
    else if (w.instanceId && w.part === 'entry') nav(`${base}?rule=${w.instanceId}`);
    else { nav(base); if (w.instanceId) window.setTimeout(() => requestFocus(`inst:${w.instanceId}`), 80); }
  };
  const shown = r.findings.filter((f) => !only || f.area === only);
  const state = r.blockers ? 'blocked' : r.open ? 'attention' : 'ready';

  return (
    <>
      <StudioBar crumbs={[{ label: 'Survey Studio', to: '/survey-studio' }, { label: survey.name, to: base }, { label: 'Validation' }]} badge={<Tag tone="draft">Draft v{survey.versionLabel}</Tag>} />
      <JourneyNav survey={survey} at="validate" />
      <div className="ss-val" data-testid="ss-validation">
        {persisted ? <ServerValidationPanel /> : null}
        {persisted ? <h2 className="ss-val-own" data-testid="ss-editor-checks-title">Editor checks <small>immediate, in your browser — not authoritative. Warnings and information items come only from here; the server reports blockers.</small></h2> : null}
        <header className={`ss-vsum ${state}`} data-testid="ss-val-verdict" data-state={state}>
          <div>
            <p className="ss-vsum-kicker">Validation of this draft · fingerprint <span className="ss-code" data-testid="ss-val-fingerprint">{r.fingerprint}</span></p>
            <h1 className="ss-title" data-testid="ss-val-verdict-title">
              {r.blockers ? `Not ready for review — ${r.blockers} blocker${r.blockers === 1 ? '' : 's'} to fix`
                : r.open ? `Not ready for review — ${r.open} warning${r.open === 1 ? '' : 's'} to acknowledge` : 'Ready to submit for review'}
            </h1>
            <p className="ss-vsum-text">
              {r.blockers ? 'A blocker makes the survey structurally invalid. It cannot be submitted, whatever the simulator shows: a synthetic customer completing the call does not make an invalid survey valid.'
                : r.open ? 'Nothing blocks this draft. Each warning needs either a fix or a short reason why it is acceptable, which the reviewer will read.'
                  : `No blockers, and ${r.warnings ? `all ${r.warnings} warnings are acknowledged` : 'no warnings'}. This says the draft is complete enough to review. It is not an approval.`}
            </p>
          </div>
          <div className="ss-vsum-side">
            <dl>
              <div><dt>Blockers</dt><dd data-testid="ss-val-blockers">{r.blockers}</dd></div>
              <div><dt>Warnings open</dt><dd data-testid="ss-val-open">{r.open}<small> of {r.warnings}</small></dd></div>
            </dl>
            {persisted ? <span className="ss-btn primary" aria-disabled="true" data-testid="ss-val-to-review" title="Submitting a saved survey for review is not available yet.">Submit is not available yet</span>
              : r.ready ? <Link className="ss-btn primary" to={`${base}/review`} data-testid="ss-val-to-review">Go to review and publish <Glyph name="right" size={14} /></Link>
              : <span className="ss-btn primary" aria-disabled="true" data-testid="ss-val-to-review" title={r.reasons.join('; ')}>Submit is not available yet</span>}
          </div>
        </header>
        <p className="ss-note" data-testid="ss-val-notice"><Glyph name="info" size={14} />
          <span>{persisted ? `These checks run in your browser on what is on screen, saved or not. They cannot override the server: a draft the server blocks stays blocked. ${STANDING_NOTE}` : 'Checked in your browser by the prototype’s own rules. In Call360 the server validates the exact saved revision; this screen shows how that result would be presented. Nothing here is submitted or approved.'}</span></p>

        <div className="ss-val-body">
          <aside className="ss-val-areas" aria-label="Areas checked">
            <button type="button" className={`ss-val-area ${only ? '' : 'on'}`} onClick={() => setParams({}, { replace: true })} aria-pressed={!only} data-testid="ss-area-ALL">
              <span><strong>Everything</strong><small>{r.findings.length} finding{r.findings.length === 1 ? '' : 's'}</small></span></button>
            {AREAS.map((a) => {
              const c = r.areas[a.id];
              return (
                <button key={a.id} type="button" className={`ss-val-area ${only === a.id ? 'on' : ''} ${c.state.toLowerCase()}`} onClick={() => setParams({ area: a.id }, { replace: true })} aria-pressed={only === a.id} data-testid={`ss-area-${a.id}`} data-state={c.state}>
                  <Glyph name={c.state === 'BLOCKED' ? 'stop' : c.state === 'ATTENTION' ? 'alert' : 'check'} size={15} />
                  <span><strong>{a.label}</strong>
                    <small>{c.blockers ? `${c.blockers} blocker${c.blockers === 1 ? '' : 's'}` : c.open ? `${c.open} to acknowledge` : c.warnings ? `${c.warnings} acknowledged` : c.info ? `${c.info} note${c.info === 1 ? '' : 's'}` : 'Nothing found'}</small></span>
                </button>
              );
            })}
          </aside>

          <main className="ss-val-main" aria-label="Findings">
            {only ? <p className="ss-val-about">{AREAS.find((a) => a.id === only)!.about}</p> : null}
            {shown.length === 0 ? <p className="ss-empty" data-testid="ss-val-empty"><span><strong>Nothing found here.</strong> {only ? 'This area passes.' : 'This draft passes every check.'}</span></p> : null}
            <ul className="ss-findings" data-testid="ss-findings">
              {shown.map((f) => <FindingRow key={f.id} f={f} canAck={author} onGo={() => goTo(f)}
                onAck={(note) => govern((g) => acknowledge(g, survey.id, f, note, Date.now()))} onUnack={() => govern((g) => unacknowledge(g, survey.id, f, Date.now()))} />)}
            </ul>

            {(!only || only === 'DEPENDENCIES') ? (
              <details className="ss-val-panel" data-testid="ss-val-lock" open={only === 'DEPENDENCIES'}>
                <summary><strong>Pinned versions</strong><span>{r.lock.modules.length} modules · {r.lock.questions.length} questions · {r.lock.conditions.length} conditions</span></summary>
                <p className="ss-muted">A survey pins exact versions. A pinned version never changes under it, and a newer version is never applied silently.</p>
                <table className="ss-table"><thead><tr><th scope="col">Kind</th><th scope="col">Name</th><th scope="col">Pinned</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {r.lock.modules.map((m) => <tr key={`m${m.code}${m.revision}`}><td>Module</td><td>{m.name}</td><td><span className="ss-code">v{m.revision}</span></td><td>{m.shared ? 'Shared library version' : 'Draft for this survey'}{m.newer ? ` · v${m.newer} available` : ''}</td></tr>)}
                    {r.lock.conditions.map((c) => <tr key={`c${c.code}${c.version}`}><td>Condition</td><td>{c.name}<small> — {c.usedIn.join(', ')}</small></td><td><span className="ss-code">v{c.version}</span></td><td>{c.shared ? 'Shared library version' : 'Belongs to one placement'}{c.newer ? ` · v${c.newer} available` : ''}</td></tr>)}
                    {r.lock.questions.map((q) => <tr key={`q${q.code}${q.version}`}><td>Question</td><td>{q.text}<small> — {q.usedIn.join(', ')}</small></td><td><span className="ss-code">v{q.version}</span></td><td>{q.usedIn.length > 1 ? `Shared by ${q.usedIn.length} modules` : 'Used once'}{q.newer ? ` · v${q.newer} available` : ''}</td></tr>)}
                  </tbody></table>
              </details>
            ) : null}
            {(!only || only === 'WORDING') ? (
              <details className="ss-val-panel" data-testid="ss-val-wording" open={only === 'WORDING'}>
                <summary><strong>Wording to approve in review</strong><span>{r.wording.toApprove.length} of {r.wording.total}</span></summary>
                <p className="ss-muted">All wording in this prototype is synthetic sample text. None of it is approved AIA or MAS language; “approval” here is a simulated step.</p>
                {r.wording.toApprove.length ? <ul className="ss-wording">{r.wording.toApprove.map((q) => <li key={`${q.code}@${q.version}`}><span>“{q.text}”</span><small>{q.usedIn.join(', ')} · v{q.version} · {q.why}</small></li>)}</ul>
                  : <p>No wording is new or changed since version {st.published?.label}.</p>}
              </details>
            ) : null}
            {(!only || only === 'COVERAGE') ? (
              <details className="ss-val-panel" data-testid="ss-val-coverage" open={only === 'COVERAGE'}>
                <summary><strong>Journey coverage</strong><span>{r.coverage.length} synthetic customers</span></summary>
                <p className="ss-muted">What each invented customer reaches when played through this draft. It is evidence of what was exercised, not proof that the survey is valid.</p>
                <table className="ss-table"><thead><tr><th scope="col">Customer</th><th scope="col">Ending</th><th scope="col">Modules run</th><th scope="col"><span className="ss-sr">Open</span></th></tr></thead>
                  <tbody>{r.coverage.map((c) => <tr key={c.profile}><td>{c.name}</td><td>{c.ending}</td><td>{c.ran.length ? c.ran.join(' · ') : '—'}</td><td><Link to={`${base}/simulate?profile=${c.profile}`}>Simulate</Link></td></tr>)}</tbody></table>
              </details>
            ) : null}
          </main>
        </div>
      </div>
    </>
  );
}

function FindingRow({ f, canAck, onGo, onAck, onUnack }: { f: Finding; canAck: boolean; onGo: () => void; onAck: (note: string) => string | null; onUnack: () => string | null }) {
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = SEVERITY[f.severity];
  return (
    <li className={`ss-finding ${f.severity.toLowerCase()} ${f.acknowledged ? 'acked' : ''}`} data-testid="ss-finding" data-severity={f.severity} data-area={f.area}>
      <span className="ss-finding-sev" title={s.hint}><Glyph name={s.glyph} size={14} /> {s.label}</span>
      <div className="ss-finding-body">
        <h3>{f.title}</h3>
        <p className="ss-finding-where">{AREAS.find((a) => a.id === f.area)!.label}{f.module ? <> · <strong>{f.module}</strong></> : null}{f.item ? <> · {f.item}</> : null}</p>
        {f.why ? <p>{f.why}</p> : null}
        {f.fix ? <p className="ss-finding-fix"><strong>What to do:</strong> {f.fix}</p> : null}
        {f.acknowledged ? <p className="ss-finding-ack" data-testid="ss-finding-acked"><Glyph name="check" size={14} /> Acknowledged by {who(f.acknowledged.by)}: “{f.acknowledged.note}”</p> : null}
        {asking && !f.acknowledged ? (
          <form className="ss-ack-form" onSubmit={(e) => { e.preventDefault(); const problem = onAck(note); setError(problem); if (!problem) setAsking(false); }}>
            <label className="ss-field"><span>Why is this acceptable? <em>The reviewer reads this.</em></span>
              <input value={note} onChange={(e) => setNote(e.target.value)} autoFocus data-testid="ss-ack-note" /></label>
            <span className="ss-actions"><button type="submit" className="ss-btn small primary" data-testid="ss-ack-confirm">Acknowledge</button><button type="button" className="ss-btn small" onClick={() => setAsking(false)}>Cancel</button></span>
            {error ? <p className="ss-warn-text" role="alert">{error}</p> : null}
          </form>
        ) : null}
      </div>
      <div className="ss-finding-actions">
        {f.where ? <button type="button" className="ss-btn small" onClick={onGo} data-testid="ss-finding-go"><Glyph name="open" size={14} /> Go to it</button> : null}
        {f.severity === 'WARNING' && !f.acknowledged && !asking ? <button type="button" className="ss-btn small" disabled={!canAck} title={canAck ? undefined : 'Only the author acknowledges a warning.'} onClick={() => setAsking(true)} data-testid="ss-ack">Acknowledge</button> : null}
        {f.acknowledged ? <button type="button" className="ss-btn small" disabled={!canAck} onClick={() => onUnack()} data-testid="ss-unack">Withdraw</button> : null}
      </div>
    </li>
  );
}
