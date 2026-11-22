// Survey Studio (EVAL-1) — the Evaluation Workbench: one synthetic journey, evaluated control by control.
// SIMULATION ONLY. The journey is the subject; a survey is a filter and a place to look for evidence. This screen
// decides nothing: every outcome, explanation, finding and severity is the server's — answers judged by the existing
// deterministic evaluator, findings made by the published finding rules. A completed survey is not a satisfied
// control, and a satisfied control is not a compliance verdict.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiFailure } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { Glyph, Tag } from '../ui';
import { evaluateUnder, getEvaluation, listEvaluations, listPolicies, type ControlPolicy, type Journey, type JourneyEvaluation, type JourneyEvaluationRef } from './evalApi';
import { EVIDENCE, ExecutionAssurancePanel, useAssurance } from './ExecutionAssurance';
import { short } from './reviewApi';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- the evaluation is read as JSON
type Tone = 'plain' | 'ok' | 'warn' | 'draft';
const say = (e: unknown) => (e instanceof ApiFailure ? (e.status === 403 ? 'You do not have permission for this.' : e.status === 404 ? 'This evaluation is not available on this server, or it is outside your market.' : e.message) : 'The server could not be reached.');
export const OUTCOME: Record<string, { label: string; tone: Tone; means: string }> = {
  SATISFIED: { label: 'Satisfied', tone: 'ok', means: 'Every required piece of evidence matched its governed rule.' },
  NOT_SATISFIED: { label: 'Not satisfied', tone: 'warn', means: 'A required answer did not match its governed rule.' },
  INSUFFICIENT_EVIDENCE: { label: 'Insufficient evidence', tone: 'draft', means: 'Required evidence is missing. It is not read as satisfied, and not as failed.' },
  NOT_APPLICABLE: { label: 'Not applicable', tone: 'plain', means: 'The governed applicability condition is false for this application.' },
  UNRESOLVED: { label: 'Unresolved', tone: 'draft', means: 'Nothing governed decides this control here.' },
  REQUIRES_REVIEW: { label: 'Requires review', tone: 'draft', means: 'A person has to look: the evidence conflicts, or needs human assessment.' },
};
const outcomeOf = (o: string): { label: string; tone: Tone; means: string } => OUTCOME[o] ?? { label: o, tone: 'draft', means: '' };
/** Coverage: whether trustworthy evidence EXISTS for what a control policy requires. Not whether a control is satisfied. */
export const COVERAGE: Record<string, { label: string; tone: Tone; means: string }> = {
  COMPLETE_WITHIN_POLICY_SCOPE: { label: 'Complete within the policy’s scope', tone: 'ok', means: 'Every control the policy requires for this application has trustworthy evaluation evidence.' },
  INCOMPLETE: { label: 'Incomplete', tone: 'warn', means: 'Some control the policy requires lacks trustworthy evaluation evidence.' },
  NOT_ASSERTED: { label: 'Not asserted', tone: 'draft', means: 'Nothing is claimed about coverage.' },
  EVIDENCED: { label: 'Evidenced', tone: 'ok', means: 'Required, mapped, and every required piece of evidence has a deterministic result.' },
  EVIDENCE_MISSING: { label: 'Evidence missing', tone: 'warn', means: 'Required and mapped; required evidence is missing.' },
  NOT_MAPPED: { label: 'Not mapped', tone: 'warn', means: 'Required, and no governed mapping supplies its evidence.' },
  APPLICABILITY_UNKNOWN: { label: 'Applicability unknown', tone: 'draft', means: 'Whether it applies could not be decided.' },
  EVIDENCE_CONFLICTING: { label: 'Evidence conflicting', tone: 'warn', means: 'The same question was answered differently.' },
  EVALUATION_UNSUPPORTED: { label: 'Evaluation unsupported', tone: 'draft', means: 'No evaluation exists for this evidence or combination.' },
  HUMAN_ASSESSMENT_PENDING: { label: 'Human assessment pending', tone: 'draft', means: 'Evidence exists and needs a person’s assessment.' },
  INTEGRITY_FAILED: { label: 'Integrity failed', tone: 'warn', means: 'The journey’s evidence could not be trusted.' },
  NOT_REQUIRED: { label: 'Not required', tone: 'plain', means: 'Not applicable to this application.' },
};
const ORDER = ['NOT_SATISFIED', 'REQUIRES_REVIEW', 'INSUFFICIENT_EVIDENCE', 'UNRESOLVED', 'SATISFIED', 'NOT_APPLICABLE'];
const PROCESSING: Record<string, { title: string; tone: string; text: string }> = {
  COMPLETED: { title: 'Evaluation completed', tone: 'yes', text: 'Every control has a deterministic outcome. That is not a statement that the application is compliant.' },
  INCOMPLETE: { title: 'Evaluation incomplete', tone: 'no', text: 'Some controls could not be decided: the journey did not complete every survey, evidence is missing, or nothing governs them.' },
  REQUIRES_REVIEW: { title: 'Evaluation requires review', tone: 'no', text: 'At least one control needs a person: conflicting evidence or an answer for human assessment.' },
  FAILED_TECHNICALLY: { title: 'Evaluation failed technically', tone: 'no', text: 'The journey’s evidence could not be trusted, so no control outcome is asserted. This is not a pass.' },
  EVALUATION_DRIFT: { title: 'This evaluation no longer recomputes to its record', tone: 'no', text: 'What it was computed from has changed. It is kept as recorded; evaluate again for the journey as it stands.' },
};
const RESULT: Record<string, string> = {
  MATCH: 'Match', MISMATCH: 'Mismatch', UNRESOLVED: 'Unresolved', NOT_ASKED: 'Not asked', MISSING_EXPECTED_FACT: 'Expected fact missing', NOT_APPLICABLE: 'Excluded by the survey',
  NOT_EVALUATED: 'Not evaluated', HUMAN_ASSESSMENT_REQUIRED: 'Human assessment', DELIVERED: 'Delivered', NOT_DELIVERED: 'Not delivered', UNSUPPORTED_EVIDENCE: 'Not evaluable',
};
const GAP: Record<string, string> = {
  SURVEY_NOT_STARTED: 'the survey was not started', AWAITING_ANSWER: 'the question is waiting for an answer', ASKED_NO_ACCEPTED_ANSWER: 'asked; no answer was accepted', NON_ANSWER_POLICY_UNRESOLVED: 'a non-answer whose handling is not decided',
  ANSWERED_BLANK: 'answered with nothing', MODULE_EXCLUDED_BY_CONDITION: 'the survey’s own condition left this module out', MODULE_ELIGIBILITY_UNKNOWN: 'the module was skipped because information was missing',
  MODULE_SKIPPED_PRIOR_OUTCOME: 'skipped after an earlier outcome', MODULE_SKIPPED_BY_ROUTE: 'skipped by the route taken', MODULE_HALTED_MISSING_INFORMATION: 'the survey halted for missing information', NOT_REACHED: 'not reached',
  NOT_ON_PATH_TAKEN: 'not on the path taken', ITEM_NOT_IN_JOURNEY: 'no survey of this journey contains it', ITEM_REVISION_NOT_IN_JOURNEY: 'the journey contains another revision of it', ANSWER_TYPE_NOT_EVALUABLE: 'no evaluation method exists for this kind of answer',
};
const resultTone = (r: string): Tone => (r === 'MATCH' || r === 'DELIVERED' ? 'ok' : r === 'MISMATCH' ? 'warn' : 'draft');
const answerWords = (ev: Any): string => {
  const a = ev?.answer;
  if (!a || a.kind !== 'ANSWER') return '—';
  return a.value === true ? 'yes' : a.value === false ? 'no' : String(a.value);
};
const simLink = (o: Any) => (o.survey && o.simulation_id ? `/survey-studio/surveys/${o.survey.survey_code}/simulate?simulation=${o.simulation_id}` : null);

/** Where a journey is evaluated from: shown on a simulation and on a coordinated simulation. Offers nothing when
 *  evaluation is not switched on for this server, rather than a control that can only fail. */
export function JourneyEvaluations({ journey, inputs }: { journey: Journey; inputs: number }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const key = 'simulationId' in journey ? journey.simulationId : journey.coordinatedId;
  const [list, setList] = useState<JourneyEvaluationRef[] | null | undefined>(undefined);
  const [policies, setPolicies] = useState<ControlPolicy[]>([]);
  const [policy, setPolicy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = can('survey.evaluation.read');
  useEffect(() => { if (read) listEvaluations(journey).then(setList).catch(() => setList(null)); }, [key, inputs, read]); // eslint-disable-line react-hooks/exhaustive-deps -- the journey is identified by key
  // published control policies, when this server has them: a journey can be evaluated under one, or without any
  useEffect(() => { if (read) listPolicies().then((p) => setPolicies((p ?? []).filter((x) => x.status === 'PUBLISHED'))).catch(() => setPolicies([])); }, [read]);
  if (!read || list === undefined) return null;
  if (list === null) return <p className="ss-muted" data-testid="ss-ev-unavailable">Control evaluation is not switched on for this server.</p>;
  const go = () => { setBusy(true); setError(null); evaluateUnder(journey, policy || null).then((e) => nav(`/survey-studio/evaluations/${e.id}`)).catch((e) => setError(say(e))).finally(() => setBusy(false)); };
  return (
    <div className="ss-ev-entry" data-testid="ss-ev-entry" data-count={list.length}>
      <p className="ss-muted">Evaluate this journey, as it stands, against the governed control mappings. An unfinished journey can be evaluated: what is missing stays missing.</p>
      {list.length ? <ul>{list.map((e, i) => <li key={e.id}><Link to={`/survey-studio/evaluations/${e.id}`} data-testid={`ss-ev-open-${i + 1}`}>Evaluation {i + 1}</Link> <span className="ss-muted">{e.policy ? `under ${(e.policy as Any).code} r${(e.policy as Any).revision} · ` : ''}{PROCESSING[e.processing_status]?.title ?? e.processing_status} · {new Date(e.created_at).toLocaleString()}</span></li>)}</ul> : null}
      {policies.length ? (
        <label className="ss-field"><span>Control policy</span>
          <select value={policy} onChange={(e) => setPolicy(e.target.value)} data-testid="ss-ev-policy-pick"><option value="">No policy — coverage is not asserted</option>{policies.map((p) => <option key={p.id} value={p.id}>{p.name} · revision {p.revision}</option>)}</select>
        </label>
      ) : null}
      {can('survey.evaluate') ? <button type="button" className="ss-btn" onClick={go} disabled={busy} data-testid="ss-ev-evaluate">Evaluate this journey</button> : <p className="ss-save-note">Evaluating needs the “evaluate surveys” permission.</p>}
      {error ? <p className="ss-issue" role="alert">{error}</p> : null}
    </div>
  );
}

export function EvaluationWorkbenchPage() {
  const { evaluationId = '' } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const [ev, setEv] = useState<JourneyEvaluation | null>(null);
  const [others, setOthers] = useState<JourneyEvaluationRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [survey, setSurvey] = useState('');
  const [finding, setFinding] = useState('');
  const [covered, setCovered] = useState('');
  const allowed = can('survey.evaluation.read');
  const load = useCallback(() => {
    if (!allowed) return;
    setEv(null); setError(null);
    getEvaluation(evaluationId).then((e) => {
      setEv(e);
      listEvaluations(e.simulation_id ? { simulationId: e.simulation_id } : { coordinatedId: e.coordinated_id as string }).then((l) => setOthers(l ?? [])).catch(() => setOthers([]));
    }).catch((e) => setError(say(e)));
  }, [evaluationId, allowed]);
  useEffect(load, [load]);

  const assurance = useAssurance(ev);
  const trustOf = (c: Any): Any | null => ((assurance.result?.control_evidence ?? []) as Any[]).find((x) => x.control_code === c.control_code && (x.obligation ?? '') === (c.obligation ?? '')) ?? null;
  const controls = useMemo(() => [...((ev?.controls ?? []) as Any[])].sort((a, b) => ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome) || a.control_code.localeCompare(b.control_code)), [ev]);
  const findings = (ev?.findings ?? []) as Any[];
  const shown = controls.filter((c) => (!outcome || c.outcome === outcome) && (!survey || (c.observations as Any[]).some((o) => o.survey?.survey_code === survey)) && (!finding || (finding === 'WITH' ? c.findings > 0 : c.findings === 0)) && (!covered || c.coverage === covered));

  const bar = (
    <div className="ss-bar">
      <nav className="ss-crumbs" aria-label="Survey Studio breadcrumb"><Link to="/survey-studio">Survey Studio</Link><Glyph name="right" size={13} /><span aria-current="page">Evaluation workbench</span></nav>
      <div className="ss-bar-tools"><span className="ss-proto saved-mode"><Glyph name="info" size={14} /> Simulation · synthetic</span></div>
    </div>
  );
  if (!allowed) return <>{bar}<div className="ss-empty page" role="status" data-testid="ss-ev-not-permitted"><p><strong>You cannot open this evaluation.</strong> Reading control evaluations needs its own permission, which you do not hold.</p></div></>;
  if (!ev) return <>{bar}{error ? <div className="ss-empty page" role="alert" data-testid="ss-ev-failed"><p><strong>The evaluation could not be loaded.</strong> {error}</p></div> : <p className="ss-loading page" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading the evaluation…</p>}</>;

  const journey = ev.journey as Any;
  const executions = journey.executions as Any[];
  const summary = ev.summary as Any;
  const by = summary.by_outcome as Record<string, number>;
  const coverage = ev.coverage as Any;
  const replay = ev.replay as Any;
  const pins = ev.pins as Any;
  const st = PROCESSING[ev.status] ?? { title: ev.status, tone: 'no', text: '' };
  const back = ev.coordinated_id ? `/survey-studio/coordinated-simulations/${ev.coordinated_id}` : simLink({ survey: executions[0], simulation_id: ev.simulation_id });
  const again = () => { setBusy(true); setError(null); evaluateUnder(ev.simulation_id ? { simulationId: ev.simulation_id } : { coordinatedId: ev.coordinated_id as string }, ev.control_policy_id ?? null).then((e) => (e.id === ev.id ? load() : nav(`/survey-studio/evaluations/${e.id}`))).catch((e) => setError(say(e))).finally(() => setBusy(false)); };
  const superseded = ev.superseded_by_current_governance as Any[];
  const policy = ev.policy as Any | null;
  const cov = COVERAGE[coverage.status] ?? { label: coverage.status, tone: 'draft' as Tone, means: '' };
  const keyOf = (c: Any) => (c.obligation ? `${c.control_code}-${c.obligation}` : c.control_code);
  return (
    <>
      {bar}
      <div className="ss-co ss-ev" data-testid="ss-ev" data-evaluation={ev.id} data-status={ev.status} data-processing={ev.processing_status} data-result={ev.result_sha256} data-kind={ev.journey_kind} data-coverage={coverage.status} data-policy={ev.control_policy_id ?? ''}>
        <header>
          <h1 className="ss-title">Evaluation workbench</h1>
          <p className="ss-note" data-testid="ss-ev-notice"><Glyph name="info" size={14} /><span><strong>Evaluation of a simulation.</strong> One invented application’s journey, checked control by control. Answers are judged by Call360’s existing deterministic evaluator and findings come from the published finding rules — no model judges anything. A match is not a compliance pass, and nothing here is an operational finding or a case disposition.</span></p>
        </header>
        {error ? <p className="ss-note warn" role="alert" data-testid="ss-ev-error"><Glyph name="alert" size={14} /><span>{error}</span></p> : null}

        <section className={`ss-plan-q ${st.tone}`} aria-labelledby="ss-ev-status-h" data-testid="ss-ev-summary">
          <p className="ss-plan-q-label">{ev.journey_kind === 'COORDINATED' ? `Coordinated journey · ${executions.length} surveys` : 'Single-survey journey'} · {summary.surveys_completed} of {summary.surveys} surveys completed</p>
          <h2 id="ss-ev-status-h" data-testid="ss-ev-status"><Glyph name={ev.status === 'COMPLETED' ? 'check' : 'stop'} size={18} /> {st.title}</h2>
          <p>{st.text}</p>
          <ul className="ss-ev-counts" data-testid="ss-ev-counts" aria-label="Controls by outcome">
            <li data-testid="ss-ev-count-applicable"><strong>{summary.applicable}</strong><span>applicable of {summary.controls} controls</span></li>
            {ORDER.map((o) => <li key={o} data-outcome={o} data-count={by[o] ?? 0}><strong>{by[o] ?? 0}</strong><span>{outcomeOf(o).label.toLowerCase()}</span></li>)}
            <li data-testid="ss-ev-count-findings"><strong>{summary.findings}</strong><span>findings</span></li>
          </ul>
          {policy ? null : <p className="ss-muted" data-testid="ss-ev-coverage" data-coverage={coverage.status}><strong>Complete coverage is not asserted.</strong> No authoritative policy says which controls apply to an application: every control of the register is listed, and one without a governed mapping is unresolved.</p>}
        </section>

        {policy ? (
          <section className={`ss-plan-q ${coverage.status === 'COMPLETE_WITHIN_POLICY_SCOPE' ? 'yes' : 'no'}`} aria-labelledby="ss-ev-cov-h" data-testid="ss-ev-coverage" data-coverage={coverage.status} data-reason={coverage.reason}>
            <p className="ss-plan-q-label">Required-control coverage · under <Link to={`/survey-studio/controls?view=policy&policy=${policy.id}`} data-testid="ss-ev-policy-link">{policy.name}, revision {policy.revision}</Link> ({policy.completeness === 'DECLARED_COMPLETE' ? 'declared complete' : 'partial'})</p>
            <h2 id="ss-ev-cov-h" data-testid="ss-ev-coverage-status"><Glyph name={coverage.status === 'COMPLETE_WITHIN_POLICY_SCOPE' ? 'check' : 'stop'} size={18} /> Coverage: {cov.label.toLowerCase()}</h2>
            <p data-testid="ss-ev-coverage-why">{coverage.explanation}</p>
            <ul className="ss-ev-counts" data-testid="ss-ev-coverage-counts" aria-label="Control instances by coverage">
              <li><strong>{coverage.evidenced}</strong><span>of {coverage.required} required controls evidenced</span></li>
              {Object.entries(coverage.by_instance as Record<string, number>).filter(([k, n]) => n > 0 && k !== 'EVIDENCED').map(([k, n]) => <li key={k} data-coverage={k} data-count={n}><strong>{n}</strong><span>{(COVERAGE[k]?.label ?? k).toLowerCase()}</span></li>)}
            </ul>
            <p className="ss-muted">Coverage is about evidence, not results: a covered control can still be not satisfied. It is never inferred from survey questions having been answered.</p>
            {(ev.applicability as Any)?.missing_inputs?.length ? <p className="ss-muted" data-testid="ss-ev-missing-inputs">Not known about this application: <span className="ss-code">{(ev.applicability as Any).missing_inputs.join(', ')}</span>.</p> : null}
            <p className="ss-muted">The application’s facts are invented catalog facts; their link to assignment inputs and call-plan facts is {String((ev.applicability as Any)?.input_lineage?.status ?? 'unverified').toLowerCase()}.</p>
          </section>
        ) : null}
        <p className="ss-note" data-testid="ss-ev-eligibility" data-status={(ev.operational_compliance_eligibility as Any).status}><Glyph name="info" size={14} /><span><strong>Operational compliance eligibility: not established.</strong> Four things are reported separately — how the evaluation ended, each control’s outcome, coverage of what is required, and this. No simulation, evaluation or coverage result establishes it.</span></p>

        <ExecutionAssurancePanel available={assurance.available} result={assurance.result} run={assurance.run} coverage={{ label: cov.label, tone: cov.tone }} processing={st.title} />

        <div className="ss-co-grid">
          <aside aria-label="The journey and its surveys">
            <h2>The journey</h2>
            <ol className="ss-co-surveys" data-testid="ss-ev-surveys">
              {executions.map((x) => (
                <li key={x.position} data-testid={`ss-ev-survey-${x.position}`} data-state={x.state} data-simulation={x.simulation_id ?? ''}>
                  <header><strong>{x.position}. {x.survey_name}</strong> <Tag tone={x.state === 'COMPLETED' ? 'ok' : x.state === 'NOT_STARTED' ? 'plain' : 'warn'}>{x.ending ? String(x.ending).toLowerCase().replace(/_/g, ' ') : x.state === 'NOT_STARTED' ? 'not started' : 'in progress'}</Tag></header>
                  <p className="ss-muted">Version {x.version_label} · manifest <span className="ss-code" title={x.manifest_sha256}>{short(x.manifest_sha256)}</span></p>
                  {x.simulation_id ? <p className="ss-muted">Run <span className="ss-code" title={x.run_sha256}>{short(x.run_sha256)}</span> · <Link to={simLink({ survey: x, simulation_id: x.simulation_id }) as string}>its own simulation</Link></p> : <p className="ss-muted">No simulation: its evidence does not exist.</p>}
                </li>
              ))}
            </ol>
            <p className="ss-muted">A survey’s ending is its own. It does not decide any control.</p>
            {back ? <p><Link to={back} data-testid="ss-ev-back">Back to the {ev.coordinated_id ? 'coordinated simulation' : 'simulation'}</Link></p> : null}

            <h2>Show</h2>
            <div className="ss-ev-filters" role="group" aria-label="Filter controls">
              <label className="ss-field"><span>Control outcome</span><select value={outcome} onChange={(e) => setOutcome(e.target.value)} data-testid="ss-ev-filter-outcome"><option value="">Every outcome</option>{ORDER.map((o) => <option key={o} value={o}>{outcomeOf(o).label} ({by[o] ?? 0})</option>)}</select></label>
              <label className="ss-field"><span>Evidence from survey</span><select value={survey} onChange={(e) => setSurvey(e.target.value)} data-testid="ss-ev-filter-survey"><option value="">Every survey</option>{executions.map((x) => <option key={x.position} value={x.survey_code}>{x.position}. {x.survey_name}</option>)}</select></label>
              <label className="ss-field"><span>Findings</span><select value={finding} onChange={(e) => setFinding(e.target.value)} data-testid="ss-ev-filter-finding"><option value="">With or without</option><option value="WITH">With findings</option><option value="WITHOUT">Without findings</option></select></label>
              {policy ? <label className="ss-field"><span>Coverage</span><select value={covered} onChange={(e) => setCovered(e.target.value)} data-testid="ss-ev-filter-coverage"><option value="">Any coverage</option>{Object.entries(coverage.by_instance as Record<string, number>).filter(([, n]) => n > 0).map(([k, n]) => <option key={k} value={k}>{COVERAGE[k]?.label ?? k} ({n})</option>)}</select></label> : null}
            </div>
          </aside>

          <main aria-label="Controls of this journey">
            <section className="ss-srv-block" aria-labelledby="ss-ev-controls-h">
              <h2 id="ss-ev-controls-h">Controls <span className="ss-count" data-testid="ss-ev-shown">{shown.length}</span></h2>
              {shown.length === 0 ? <p className="ss-muted" data-testid="ss-ev-none">No control matches these filters.</p> : null}
              <ul className="ss-ev-controls" data-testid="ss-ev-controls">
                {shown.map((c) => {
                  const o = outcomeOf(c.outcome);
                  const mine = findings.filter((f) => f.control_code === c.control_code && (f.obligation ?? '') === (c.obligation ?? ''));
                  const k = keyOf(c);
                  const cv = c.coverage ? COVERAGE[c.coverage] ?? { label: c.coverage, tone: 'draft' as Tone, means: '' } : null;
                  const obs = (c.observations as Any[]).filter((x) => !survey || x.survey?.survey_code === survey);
                  return (
                    <li key={k} data-testid={`ss-ev-control-${k}`} data-outcome={c.outcome} data-applicability={c.applicability.status} data-findings={c.findings} data-coverage={c.coverage ?? ''}>
                      <details>
                        <summary>
                          <span className="ss-ev-control-name"><span className="ss-code">{c.control_code}</span> {c.control_name}{c.obligation_title ? <span className="ss-ev-obligation"> — {c.obligation_title}</span> : null}</span>
                          <span className="ss-ev-control-tags">{c.findings ? <Tag tone="warn">{c.findings} {c.findings === 1 ? 'finding' : 'findings'}</Tag> : null}{cv ? <Tag tone={cv.tone}>{cv.label}</Tag> : null}<Tag tone={o.tone}>{o.label}</Tag></span>
                        </summary>
                        <p className="ss-ev-means">{o.means}{cv ? ` Coverage: ${cv.means}` : ''}</p>
                        {(() => { const t = trustOf(c); if (!t) return null; const e = EVIDENCE[t.execution_evidence] ?? { label: t.execution_evidence, tone: 'draft' as Tone }; return (
                          <p className={`ss-ea-trust ${t.result_is_trustworthy ? '' : 'bad'}`} data-testid={`ss-ev-trust-${k}`} data-execution={t.execution_evidence} data-trustworthy={String(t.result_is_trustworthy)}>
                            <Tag tone={e.tone}>{e.label}</Tag> {t.result_is_trustworthy ? 'The recorded execution behind this result was checked against the pinned survey versions.' : <strong>This result rests on execution evidence that could not be trusted. Do not rely on it.</strong>}
                            {(t.evidence as Any[]).filter((x) => x.not_delivered_class).map((x) => <span key={x.seq} className="ss-muted"> Not delivered at {x.placement}: {x.why}.</span>)}
                          </p>); })()}
                        {c.purpose ? <p className="ss-ev-means"><strong>What this control is for:</strong> {c.purpose}</p> : null}
                        {c.requirements ? <ul className="ss-ev-reasons" data-testid={`ss-ev-requirements-${k}`}>{(c.requirements as Any[]).map((r) => <li key={r.key} data-requirement={r.key} data-status={r.status}>{r.description} — {r.evidence_type === 'ANSWER' ? 'an answer' : 'a delivery'}, {r.required ? 'required' : 'optional'}: {r.status === 'MAPPED' ? `supplied by ${r.mapped_entries} mapped ${r.mapped_entries === 1 ? 'item' : 'items'}` : 'nothing is mapped to it'}</li>)}</ul> : null}
                        {(c.reasons as Any[]).length ? <ul className="ss-ev-reasons" data-testid={`ss-ev-reasons-${k}`}>{(c.reasons as Any[]).map((r, i) => <li key={i} data-code={r.code}>{r.text}</li>)}</ul> : null}
                        <dl className="ss-srv-ids">
                          <div><dt>Applies to this application</dt><dd>{c.applicability.status === 'NOT_DETERMINED' ? 'not determined' : c.applicability.status.toLowerCase().replace('_', ' ')} — {c.applicability.explanation}</dd></div>
                          <div><dt>Governed mapping</dt><dd data-testid={`ss-ev-mapping-${k}`}>{c.mapping ? <>revision {c.mapping.revision} · every required piece of evidence must match</> : 'none published — a configuration gap'}</dd></div>
                          <div><dt>Control content</dt><dd>{c.content_approval_status === 'SYNTHETIC_UNAPPROVED' ? 'synthetic, not approved' : c.content_approval_status}</dd></div>
                        </dl>
                        <details className="ss-cb-tech" data-testid={`ss-ev-tech-${k}`}><summary>Technical details</summary><ul className="ss-ev-reasons">
                          <li>Control <span className="ss-code">{c.control_code}</span>{c.obligation ? <> · obligation <span className="ss-code">{c.obligation}</span></> : null} · outcome <span className="ss-code">{c.outcome}</span>{c.coverage ? <> · coverage <span className="ss-code">{c.coverage}</span></> : null}</li>
                          {(c.reasons as Any[]).map((r, i) => <li key={i}>Reason <span className="ss-code">{r.code}</span></li>)}
                          {c.mapping ? <li>Mapping fingerprint <span className="ss-code">{c.mapping.sha256}</span> · combination <span className="ss-code">{c.mapping.combination}</span></li> : null}
                          <li>Control fingerprint <span className="ss-code">{c.control_sha256}</span></li>
                        </ul></details>
                        {obs.length ? (
                          <table className="ss-table ss-ev-evidence" data-testid={`ss-ev-evidence-${k}`}>
                            <thead><tr><th scope="col">Evidence</th><th scope="col">Exact wording delivered</th><th scope="col">Answer</th><th scope="col">Governed rule</th><th scope="col">Result</th></tr></thead>
                            <tbody>
                              {obs.map((x) => (
                                <tr key={x.seq} data-seq={x.seq} data-result={x.result} data-gap={x.gap ?? ''} data-survey={x.survey?.position ?? ''} data-simulation={x.simulation_id ?? ''}>
                                  <th scope="row">
                                    {x.survey ? <>{x.survey.position}. {x.survey.survey_code}<span className="ss-code">{x.placement}</span></> : <>No survey of this journey</>}
                                    <span className="ss-code">{x.item.code} v{x.item.version}</span>
                                    <span className="ss-muted">{x.evidence_type === 'DELIVERY' ? 'delivery' : 'answer'} · {x.required ? 'required' : 'optional'}</span>
                                  </th>
                                  <td>{x.wording ? x.wording.text : <span className="ss-muted">not delivered</span>}</td>
                                  <td>{x.evidence_type === 'DELIVERY' ? <span className="ss-muted">a statement takes no answer</span> : answerWords(x.evaluation)}{(x.refused_inputs as string[]).length ? <small> refused: {(x.refused_inputs as string[]).join(', ')}</small> : null}</td>
                                  <td>{x.evaluation ? x.evaluation.rule_text : x.evidence_type === 'DELIVERY' ? 'The pinned wording is delivered' : '—'}</td>
                                  <td>
                                    <Tag tone={resultTone(x.result)}>{RESULT[x.result] ?? x.result}</Tag>
                                    {x.gap ? <small data-testid="ss-ev-gap">{GAP[x.gap] ?? x.gap}</small> : null}
                                    <small>{x.explanation}</small>
                                    {simLink(x) ? <small><Link to={simLink(x) as string}>trace events {(x.trace as number[]).join(', ') || '—'}</Link></small> : null}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : <p className="ss-muted" data-testid={`ss-ev-no-evidence-${k}`}>{c.mapping ? (survey ? 'No evidence of this control comes from the chosen survey.' : 'No evidence was looked for: the control does not apply, or the evidence could not be trusted.') : 'No evidence can be looked for without a governed mapping.'}</p>}
                        {mine.map((f) => <FindingCard key={f.finding_key} f={f} />)}
                      </details>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="ss-srv-block" aria-labelledby="ss-ev-findings-h" data-testid="ss-ev-findings" data-status={ev.findings_status} data-count={findings.length}>
              <h2 id="ss-ev-findings-h">Findings <span className="ss-count">{findings.length}</span></h2>
              {ev.findings_status === 'FINDING_RULES_MISSING' ? <p className="ss-note warn" data-testid="ss-ev-no-rules"><Glyph name="alert" size={14} /><span><strong>No finding rule set is published for this market.</strong> No finding could be generated. That is not the same as no findings.</span></p>
                : ev.findings_status !== 'GENERATED' ? <p className="ss-note warn"><Glyph name="alert" size={14} /><span>Findings were not generated because the evidence could not be trusted.</span></p>
                : <p className="ss-muted">Flagged potential concerns for a person to review, from finding rule set <strong>{(ev.finding_rules as Any).label}</strong> <span className="ss-code" title={(ev.finding_rules as Any).sha256}>{short((ev.finding_rules as Any).sha256)}</span>. Severity is the rule set’s. None is a breach determination, and none is an operational finding.</p>}
              {findings.length === 0 && ev.findings_status === 'GENERATED' ? <p className="ss-muted">The published rules produced no finding for this journey.</p> : null}
              {findings.map((f) => <FindingCard key={f.finding_key} f={f} withControl />)}
              {(ev.not_converted as Any[]).length ? (
                <details className="ss-sim-evidence" data-testid="ss-ev-not-converted">
                  <summary>Evaluation results that no finding rule covers ({(ev.not_converted as Any[]).length})</summary>
                  <ul className="ss-ev-reasons">{(ev.not_converted as Any[]).map((n, i) => <li key={i}><span className="ss-code">{n.control_code} · {n.question_code}</span> {n.reason}</li>)}</ul>
                </details>
              ) : null}
              {(ev.human_assessment as Any[]).length ? <p className="ss-muted" data-testid="ss-ev-human">{(ev.human_assessment as Any[]).length} free-text answers need a person’s assessment.</p> : null}
            </section>

            <section className="ss-srv-block" aria-labelledby="ss-ev-gaps-h" data-testid="ss-ev-gaps">
              <h2 id="ss-ev-gaps-h">Mapping and coverage gaps</h2>
              <p className="ss-muted">What nothing governed speaks for. None of this is treated as satisfactory.</p>
              <dl className="ss-srv-ids">
                <div><dt>Controls with no published mapping</dt><dd data-testid="ss-ev-gap-controls">{(coverage.controls_without_mapping as string[]).join(', ') || 'none'}</dd></div>
                <div><dt>Controls whose applicability is unknown</dt><dd>{(coverage.controls_with_unknown_applicability as string[]).join(', ') || 'none'}</dd></div>
                <div><dt>Items of this journey that no mapping names</dt><dd data-testid="ss-ev-gap-items">{(coverage.items_without_mapping as Any[]).length}</dd></div>
              </dl>
              {(coverage.items_without_mapping as Any[]).length ? (
                <details className="ss-sim-evidence"><summary>Those items</summary>
                  <ul className="ss-ev-reasons">{(coverage.items_without_mapping as Any[]).map((u, i) => <li key={i}><span className="ss-code">{u.survey.survey_code} · {u.placement} · {u.item.code} v{u.item.version}</span> {String(u.item.answer_type).toLowerCase().replace('_', ' ')}</li>)}</ul>
                </details>
              ) : null}
            </section>
          </main>

          <aside aria-label="Integrity and versions">
            <h2>Integrity</h2>
            <dl className="ss-srv-ids" data-testid="ss-ev-integrity">
              <div><dt>Kind of record</dt><dd data-testid="ss-ev-class">{ev.record_class === 'SIMULATION' ? 'Simulation' : ev.record_class}</dd></div>
              <div><dt>Evidence trusted</dt><dd>{journey.trusted ? 'Yes' : 'No'}</dd></div>
              <div><dt>Recomputes to this record</dt><dd data-testid="ss-ev-consistent" data-consistent={String(replay.consistent)}>{replay.consistent ? 'Yes' : 'No — drifted'}</dd></div>
              <div><dt>Result fingerprint</dt><dd className="ss-code" title={ev.result_sha256}>{short(ev.result_sha256)}</dd></div>
              <div><dt>Input fingerprint</dt><dd className="ss-code" title={ev.input_sha256}>{short(ev.input_sha256)}</dd></div>
              <div><dt>Evaluated</dt><dd>{new Date(ev.created_at).toLocaleString()}</dd></div>
            </dl>
            {(journey.problems as Any[]).map((p, i) => <p key={i} className="ss-issue" role="alert"><span className="ss-code">{p.code}</span> {p.text}</p>)}
            {!replay.consistent ? <ul className="ss-ev-reasons" data-testid="ss-ev-drift">{(replay.reasons as Any[]).map((r) => <li key={r.code}><span className="ss-code">{r.code}</span> {r.text}</li>)}</ul> : null}
            {superseded.length ? <ul className="ss-ev-reasons" data-testid="ss-ev-superseded">{superseded.map((s, i) => <li key={i}><span className="ss-code">{s.code}</span> {s.text}</li>)}</ul> : null}
            {can('survey.evaluation.read') ? <p><Link to="/survey-studio/controls" data-testid="ss-ev-open-builder">Controls and evidence</Link></p> : null}
            <p><Link to={`/survey-studio/journeys/${ev.coordinated_id ? 'coordinated' : 'survey'}/${ev.coordinated_id ?? ev.simulation_id}?evaluation=${ev.id}`} data-testid="ss-ev-open-journey">Follow this journey end to end</Link></p>
            {can('survey.evaluate') ? <button type="button" className="ss-btn" onClick={again} disabled={busy} data-testid="ss-ev-again" title="A changed journey, mapping or rule set gives a new evaluation; this one is kept as it is">Evaluate the journey again</button> : null}

            <h2>Exactly what was used</h2>
            <dl className="ss-srv-ids" data-testid="ss-ev-pins">
              <div><dt>Answer evaluation</dt><dd className="ss-code">{(ev.engines as Any).answer_evaluation}</dd></div>
              <div><dt>Findings</dt><dd className="ss-code">{(ev.engines as Any).findings}</dd></div>
              <div><dt>Control evaluation</dt><dd className="ss-code">{ev.contract}</dd></div>
              <div><dt>Finding rule set</dt><dd data-testid="ss-ev-rule-set">{pins.finding_rule_set ? <>{pins.finding_rule_set.label} <span className="ss-code" title={pins.finding_rule_set.sha256}>{short(pins.finding_rule_set.sha256)}</span></> : 'none published'}</dd></div>
              {(pins.mappings as Any[]).map((m) => <div key={m.control_code}><dt>{m.control_code} mapping</dt><dd>revision {m.revision} <span className="ss-code" title={m.sha256}>{short(m.sha256)}</span></dd></div>)}
            </dl>

            <h2>Evaluations of this journey</h2>
            <ol className="ss-ev-history" data-testid="ss-ev-history">
              {others.map((e, i) => <li key={e.id} aria-current={e.id === ev.id ? 'true' : undefined}>{e.id === ev.id ? <strong>Evaluation {i + 1} (this one)</strong> : <Link to={`/survey-studio/evaluations/${e.id}`}>Evaluation {i + 1}</Link>} <span className="ss-muted">{new Date(e.created_at).toLocaleString()}</span></li>)}
            </ol>
            <p className="ss-muted">A revised rule or mapping adds an evaluation. None is rewritten.</p>
          </aside>
        </div>
      </div>
    </>
  );
}

function FindingCard({ f, withControl = false }: { f: Any; withControl?: boolean }) {
  return (
    <article className="ss-ev-finding" data-testid="ss-ev-finding" data-rule={f.rule.rule_code} data-control={f.control_code} data-severity={f.severity}>
      <header><strong>{f.description}</strong> <Tag tone="warn">{String(f.category).toLowerCase().replace(/_/g, ' ')}</Tag> <Tag>severity {String(f.severity).toLowerCase()}</Tag></header>
      <p>{f.explanation}</p>
      <dl className="ss-srv-ids">
        {withControl ? <div><dt>Control</dt><dd className="ss-code">{f.control_code}</dd></div> : null}
        <div><dt>Rule</dt><dd><span className="ss-code">{f.rule.rule_code}</span> in {f.rule.rule_set.label} <span className="ss-code" title={f.rule.rule_set.sha256}>{short(f.rule.rule_set.sha256)}</span></dd></div>
        <div><dt>Severity comes from</dt><dd>{f.severity_source} — {f.severity_justification}</dd></div>
        <div><dt>Evidence</dt><dd>{f.survey ? <>{f.survey.position}. {f.survey.survey_code} · <span className="ss-code">{f.placement}</span> · </> : 'no survey of this journey · '}<span className="ss-code">{f.item.code} v{f.item.version}</span></dd></div>
        <div><dt>Captured</dt><dd>{f.evidence.answer?.kind === 'ANSWER' ? `answer ${f.evidence.normalized_answer ?? String(f.evidence.answer.value)}` : 'no answer — the evidence is missing'}{f.evidence.evaluation_rule ? ` · ${f.evidence.evaluation_rule}` : ''}</dd></div>
      </dl>
    </article>
  );
}
