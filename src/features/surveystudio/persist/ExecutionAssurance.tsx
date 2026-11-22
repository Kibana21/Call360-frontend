// Survey Studio (EVAL-2B) — execution assurance, inside the Evaluation Workbench. SIMULATION ONLY.
// It shows whether the RECORDED execution of this synthetic journey followed the survey versions it pinned: what was
// expected, what was recorded, in which exact wording, by which branch — and what was left out, and why. The server
// verifies; this screen decides nothing. It is a different statement from the evaluation, from each control's
// outcome and from coverage, and it never establishes that a call may be made. A simulation does not show that a
// person heard anything.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiFailure } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { Glyph, Tag } from '../ui';
import { createAssurance, getAssurance, listAssurance, type ExecutionAssurance, type Journey, type JourneyEvaluation } from './evalApi';
import { short } from './reviewApi';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- the assurance result is read as JSON
type Tone = 'plain' | 'ok' | 'warn' | 'draft';
const say = (e: unknown) => (e instanceof ApiFailure ? (e.status === 403 ? 'You do not have permission for this.' : e.message) : 'The server could not be reached.');
export const ASSURANCE: Record<string, { label: string; tone: Tone; means: string }> = {
  VERIFIED: { label: 'Verified', tone: 'ok', means: 'Every supported check passed for this recording.' },
  INCOMPLETE: { label: 'Incomplete', tone: 'draft', means: 'The recording does not yet let every check finish: a survey is waiting for an answer or was not started.' },
  DEVIATION_DETECTED: { label: 'Deviation detected', tone: 'warn', means: 'The recording differs from the survey version it pinned.' },
  INTEGRITY_FAILED: { label: 'Integrity failed', tone: 'warn', means: 'The recording no longer recomputes to its fingerprints, so nothing about it can be trusted.' },
  NOT_ASSESSABLE: { label: 'Not assessable', tone: 'draft', means: 'A contract this check needs is not supported.' },
  ASSURANCE_DRIFT: { label: 'No longer recomputes', tone: 'warn', means: 'The evidence has changed since this result was recorded.' },
};
export const EVIDENCE: Record<string, { label: string; tone: Tone }> = {
  EXECUTION_VERIFIED: { label: 'Execution verified', tone: 'ok' }, EXECUTION_INCOMPLETE: { label: 'Execution not finished', tone: 'draft' },
  DEVIATION_IN_EVIDENCE: { label: 'Deviation in the evidence', tone: 'warn' }, INTEGRITY_FAILED: { label: 'Evidence integrity failed', tone: 'warn' },
  NOT_ASSESSABLE: { label: 'Execution not assessable', tone: 'draft' }, NO_EXECUTION_EVIDENCE: { label: 'No execution to verify', tone: 'plain' },
};
const NOT_DELIVERED: Record<string, { label: string; valid: boolean }> = {
  VALID_CONDITIONAL_EXCLUSION: { label: 'Left out by the survey’s own condition', valid: true }, EXCLUDED_INFORMATION_MISSING: { label: 'Left out: information was missing', valid: true },
  VALID_ROUTING_EXCLUSION: { label: 'Passed over by a published route', valid: true }, NOT_ON_PATH_TAKEN: { label: 'On another branch than the answers took', valid: true },
  SURVEY_ENDED_BEFORE: { label: 'The survey ended before this', valid: true }, NOT_YET_REACHED: { label: 'Not reached yet', valid: true },
  AWAITING_ANSWER: { label: 'Waiting for an answer', valid: true }, OMISSION: { label: 'Omitted — a route led here and it was never delivered', valid: false },
};
const CHECK: Record<string, string> = {
  INTEGRITY: 'Recording still recomputes', TRACE_WELL_FORMED: 'Trace is whole', DELIVERIES_EXPECTED: 'Only what the version contains was delivered', WORDING_EXACT: 'Exact pinned wording',
  ANSWERS_AND_REJECTIONS: 'Answers valid, invalid ones refused', BRANCHING: 'Branches follow the version', MODULE_SEQUENCE: 'Modules in order, nothing owed left out', TERMINATION: 'Ended as its routes say',
  SELECTION_RECORDED: 'The surveys are the governed selection', GOVERNED_ORDER: 'Started in the governed order', NO_BYPASS: 'No survey passed over', OWN_EVIDENCE: 'Each survey has its own evidence', NO_DEDUPLICATION: 'No requirement dropped or merged',
};
const CHECK_TONE: Record<string, Tone> = { PASSED: 'ok', FAILED: 'warn', INCOMPLETE: 'draft' };
const words = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export function useAssurance(ev: JourneyEvaluation | null) {
  const [state, setState] = useState<{ available: boolean | null; result: ExecutionAssurance | null }>({ available: null, result: null });
  const journey: Journey | null = ev ? (ev.simulation_id ? { simulationId: ev.simulation_id } : { coordinatedId: ev.coordinated_id as string }) : null;
  const key = ev?.id ?? '';
  const load = useCallback(() => {
    if (!journey || !ev) return;
    listAssurance(journey).then(async (list) => {
      if (list === null) return setState({ available: false, result: null });
      const mine = [...list].reverse().find((a) => a.evaluation_id === ev.id);
      setState({ available: true, result: mine ? await getAssurance(mine.id) : null });
    }).catch(() => setState({ available: false, result: null }));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- the evaluation is identified by key
  useEffect(() => { setState({ available: null, result: null }); load(); }, [load]);
  const run = async () => { if (journey && ev) setState({ available: true, result: await createAssurance(journey, ev.id) }); };
  return { ...state, run };
}

export function ExecutionAssurancePanel({ available, result, run, coverage, processing }: { available: boolean | null; result: ExecutionAssurance | null; run: () => Promise<void>; coverage: { label: string; tone: Tone }; processing: string }) {
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (available === null) return null;
  if (!available) return <p className="ss-muted" data-testid="ss-ea-unavailable">Execution assurance is not switched on for this server.</p>;
  const go = () => { setBusy(true); setError(null); run().catch((e) => setError(say(e))).finally(() => setBusy(false)); };
  const st = result ? ASSURANCE[result.current_status] ?? { label: result.current_status, tone: 'draft' as Tone, means: '' } : null;
  const surveys = (result?.surveys ?? []) as Any[];
  const findings = (result?.findings ?? []) as Any[];
  return (
    <section className="ss-srv-block ss-ea" aria-labelledby="ss-ea-h" data-testid="ss-ea" data-status={result?.status ?? 'NOT_CHECKED'} data-current={result?.current_status ?? ''} data-assurance={result?.id ?? ''} data-findings={findings.length}>
      <h2 id="ss-ea-h">Execution assurance</h2>
      <p className="ss-muted">Did the recorded execution of this journey follow the survey versions it pinned? This is checked against the recording only. It does not show that a person heard any wording, and it is not about whether controls are satisfied.</p>
      <dl className="ss-ea-side" data-testid="ss-ea-side" aria-label="Four separate statements about this journey">
        <div><dt>Evaluation</dt><dd>{processing}</dd></div>
        <div><dt>Coverage of required controls</dt><dd><Tag tone={coverage.tone}>{coverage.label}</Tag></dd></div>
        <div><dt>Execution assurance</dt><dd data-testid="ss-ea-status">{st ? <Tag tone={st.tone}>{st.label}</Tag> : <Tag>Not checked yet</Tag>}</dd></div>
        <div><dt>Operational call eligibility</dt><dd><Tag>Not established</Tag></dd></div>
      </dl>
      {error ? <p className="ss-issue" role="alert">{error}</p> : null}
      {!result ? (
        <div className="ss-cb-actions">
          {can('survey.evaluate') ? <button type="button" className="ss-btn" onClick={go} disabled={busy} data-testid="ss-ea-run">Check the recorded execution</button> : <p className="ss-save-note">Checking the execution needs the “evaluate surveys” permission.</p>}
        </div>
      ) : (
        <>
          <p data-testid="ss-ea-means"><strong>{st?.means}</strong> {result.status === 'VERIFIED' ? 'Verified is a technical result about this recording. It is not a compliance outcome and does not make a call eligible.' : ''}</p>
          {result.current_status === 'ASSURANCE_DRIFT' ? <ul className="ss-ev-reasons" data-testid="ss-ea-drift">{((result.replay as Any).reasons as Any[]).map((r) => <li key={r.code} title={r.code}>{r.text}</li>)}</ul> : null}
          {findings.length ? (
            <div data-testid="ss-ea-findings">
              <h3>What differs from the pinned versions</h3>
              <ul className="ss-ev-reasons">{findings.map((f, i) => <li key={i} data-code={f.code} title={f.code}><strong>{f.scope === 'journey' ? 'The journey' : `Survey ${String(f.scope).replace('survey ', '')}`}:</strong> {f.text}</li>)}</ul>
            </div>
          ) : null}
          {(result.journey_checks as Any[]).length ? (
            <div data-testid="ss-ea-journey">
              <h3>The journey as a whole</h3>
              <ul className="ss-ea-checks">{(result.journey_checks as Any[]).map((c) => <li key={c.check} data-check={c.check} data-status={c.status}><Tag tone={CHECK_TONE[c.status]}>{words(c.status)}</Tag> <span title={c.question}>{CHECK[c.check] ?? c.check}</span></li>)}</ul>
            </div>
          ) : null}
          <h3>Each survey’s execution</h3>
          {surveys.map((s) => {
            const sst = ASSURANCE[s.status] ?? { label: s.status, tone: 'draft' as Tone, means: '' };
            const bad = (s.exclusions as Any[]).filter((x) => !NOT_DELIVERED[x.class]?.valid);
            return (
              <details key={s.position} className="ss-ea-survey" data-testid={`ss-ea-survey-${s.position}`} data-status={s.status} data-simulation={s.simulation_id ?? ''}>
                <summary>
                  <span><strong>{s.position}. {s.survey_name}</strong> <span className="ss-muted">{s.simulation_id ? `${s.counts.wording_exact} of ${s.counts.delivered} deliveries in exact wording · ${s.counts.answers} answers${s.counts.refused_inputs ? ` · ${s.counts.refused_inputs} refused` : ''}${s.ending ? ` · ended: ${words(s.ending.state)}` : ' · not ended'}` : 'not started'}</span></span>
                  <Tag tone={sst.tone}>{sst.label}</Tag>
                </summary>
                {s.not_assessable ? <p className="ss-muted">{s.not_assessable.text}</p> : null}
                {s.ending && !s.ending.completed ? <p className="ss-note" data-testid={`ss-ea-ending-${s.position}`}><Glyph name="info" size={14} /><span>This survey did not reach “completed” (it ended as {words(s.ending.state)}{s.ending.survey_outcome ? `: ${words(s.ending.survey_outcome)}` : ''}). That ending is recorded as it happened. It is not a fault in the execution.</span></p> : null}
                {(s.checks as Any[]).length ? (
                  <ul className="ss-ea-checks" data-testid={`ss-ea-checks-${s.position}`}>
                    {(s.checks as Any[]).map((c) => (
                      <li key={c.check} data-check={c.check} data-status={c.status}>
                        <Tag tone={CHECK_TONE[c.status]}>{words(c.status)}</Tag> <span title={c.question}>{CHECK[c.check] ?? c.check}</span>
                        {(c.findings as Any[]).map((f, i) => <span key={i} className="ss-ea-finding" title={f.code}>{f.text}</span>)}
                        {c.incomplete_because ? <span className="ss-muted">{c.incomplete_because}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {(s.deliveries as Any[]).length || (s.exclusions as Any[]).length ? (
                  <details className="ss-cb-tech" data-testid={`ss-ea-expected-${s.position}`}>
                    <summary>Expected and recorded, item by item ({s.counts.delivered} delivered, {(s.exclusions as Any[]).length} not delivered{bad.length ? `, ${bad.length} omitted` : ''})</summary>
                    <table className="ss-table">
                      <thead><tr><th scope="col">Item</th><th scope="col">Recorded</th><th scope="col">Pinned wording</th><th scope="col">Result</th></tr></thead>
                      <tbody>
                        {(s.deliveries as Any[]).map((d) => (
                          <tr key={`d${d.event}`} data-placement={d.placement} data-wording={d.wording}>
                            <th scope="row">{d.kind === 'STATEMENT' ? 'Statement' : 'Question'}<span className="ss-code">{d.placement}</span></th>
                            <td>{d.recorded_text}{d.awaiting_answer ? <small> asked — waiting for an answer</small> : null}</td>
                            <td>{d.wording === 'EXACT' ? <span className="ss-muted">the same, wording version {d.wording_version}</span> : d.expected_text ?? <span className="ss-muted">none pinned</span>}</td>
                            <td><Tag tone={d.wording === 'EXACT' ? 'ok' : 'warn'}>{d.wording === 'EXACT' ? 'Exact' : words(d.wording)}</Tag></td>
                          </tr>
                        ))}
                        {(s.exclusions as Any[]).map((x) => (
                          <tr key={`x${x.placement}`} data-placement={x.placement} data-class={x.class}>
                            <th scope="row">Not delivered<span className="ss-code">{x.placement}</span></th>
                            <td colSpan={2}>{x.why}</td>
                            <td><Tag tone={NOT_DELIVERED[x.class]?.valid ? 'plain' : 'warn'}>{NOT_DELIVERED[x.class]?.label ?? x.class}</Tag></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ) : null}
                {(s.branches as Any[]).length || (s.rejections as Any[]).length ? (
                  <details className="ss-cb-tech" data-testid={`ss-ea-branches-${s.position}`}>
                    <summary>Branches and refused answers ({(s.branches as Any[]).length} branches, {(s.rejections as Any[]).length} refused)</summary>
                    <ul className="ss-ev-reasons">
                      {(s.branches as Any[]).map((b) => <li key={b.event}>At <span className="ss-code">{b.instance}/{b.node}</span>, {b.kind === 'DECISION' ? `a recorded condition (${words(String(b.via))})` : `${String(b.via) === 'AFTER_CAPTURE' ? 'what was recorded here' : `the recorded answer “${words(String(b.via))}”`}`} led {b.to?.node ? <>to <span className="ss-code">{b.instance}/{b.to.node}</span></> : <>out of the module ({words(String(b.to?.outcome ?? 'ended'))})</>}.</li>)}
                      {(s.rejections as Any[]).map((r) => <li key={`r${r.event}`} data-code={r.code}>At <span className="ss-code">{r.placement}</span> an answer was refused ({words(String(r.code))}) and the question stayed current. It was not recorded as an answer.</li>)}
                    </ul>
                  </details>
                ) : null}
                {s.simulation_id ? (
                  <details className="ss-cb-tech"><summary>Technical details</summary>
                    <dl className="ss-srv-ids">
                      <div><dt>Survey version</dt><dd>{s.version_label} · manifest <span className="ss-code">{s.manifest_sha256}</span></dd></div>
                      <div><dt>Run fingerprint</dt><dd className="ss-code">{s.run_sha256}</dd></div>
                      <div><dt>Execution contract</dt><dd className="ss-code">{s.engine_contract}</dd></div>
                      <div><dt>Recorded events</dt><dd>{s.counts.events}</dd></div>
                      <div><dt>Its own simulation trace</dt><dd><Link to={`/survey-studio/surveys/${s.survey_code}/simulate?simulation=${s.simulation_id}`} data-testid={`ss-ea-trace-${s.position}`}>open</Link></dd></div>
                    </dl>
                  </details>
                ) : null}
              </details>
            );
          })}
          <details className="ss-cb-tech" data-testid="ss-ea-integrity">
            <summary>Integrity of this result</summary>
            <dl className="ss-srv-ids">
              <div><dt>Kind of record</dt><dd>{result.record_class === 'SIMULATION' ? 'Simulation' : result.record_class}</dd></div>
              <div><dt>Recomputes to this record</dt><dd data-testid="ss-ea-consistent" data-consistent={String((result.replay as Any).consistent)}>{(result.replay as Any).consistent ? 'Yes' : 'No — the evidence has changed'}</dd></div>
              <div><dt>Assurance contract</dt><dd className="ss-code">{result.contract}</dd></div>
              <div><dt>Result fingerprint</dt><dd className="ss-code" title={result.result_sha256}>{short(result.result_sha256)}</dd></div>
              <div><dt>Input fingerprint</dt><dd className="ss-code" title={result.input_sha256}>{short(result.input_sha256)}</dd></div>
              <div><dt>Checked</dt><dd>{new Date(result.created_at).toLocaleString()}</dd></div>
            </dl>
          </details>
          {can('survey.evaluate') ? <div className="ss-cb-actions"><button type="button" className="ss-btn small" onClick={go} disabled={busy} data-testid="ss-ea-again" title="New evidence gives a new result; this one is kept as it is">Check the execution again</button></div> : null}
        </>
      )}
    </section>
  );
}
