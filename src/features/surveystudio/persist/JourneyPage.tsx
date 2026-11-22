// Survey Studio (E2E-1) — one synthetic application's journey, end to end. SIMULATION ONLY. READ ONLY.
// A reviewer's way through screens that already exist: what was required, which surveys were selected, what happened
// in each, which controls were assessed, what evidence was missing or contradictory, what findings arose, and
// whether the execution was faithful to its pinned plan. Every record shown is kept by another screen's service; the
// server lays them out as one chain and this page decides nothing. Five statements are kept apart, and whether a
// real customer may be called is never established here.
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiFailure } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { Glyph, Tag } from '../ui';
import { getJourneyTrace, listJourneys, type JourneyRef, type JourneyTrace, type JourneyTraceLink, type TraceKind } from './evalApi';
import { short } from './reviewApi';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- the trace's records are read as JSON
type Tone = 'plain' | 'ok' | 'warn' | 'draft';
const words = (s: unknown) => String(s ?? '').toLowerCase().replace(/_/g, ' ');
const say = (e: unknown) => (e instanceof ApiFailure ? (e.status === 403 ? 'You do not have permission for this.' : e.message) : 'The server could not be reached.');
const KIND: Record<string, TraceKind> = { COORDINATED: 'coordinated', SINGLE_SURVEY: 'survey', APPLICATION_ONLY: 'application' };
export const journeyLink = (kind: string, id: string, evaluationId?: string | null) => `/survey-studio/journeys/${KIND[kind] ?? kind}/${id}${evaluationId ? `?evaluation=${evaluationId}` : ''}`;

const COMPLETION: Record<string, { label: string; tone: Tone }> = {
  ALL_SURVEYS_COMPLETED: { label: 'All surveys completed', tone: 'ok' }, COMPLETED: { label: 'Completed', tone: 'ok' }, RUNNING: { label: 'Not finished', tone: 'draft' }, PENDING: { label: 'Not finished', tone: 'draft' },
  NOT_STARTED: { label: 'Nothing was simulated', tone: 'plain' }, POLICY_UNRESOLVED: { label: 'Stopped: policy unresolved', tone: 'warn' },
};
const COVERAGE: Record<string, { label: string; tone: Tone }> = {
  COMPLETE_WITHIN_POLICY_SCOPE: { label: 'Complete within the policy’s scope', tone: 'ok' }, INCOMPLETE: { label: 'Incomplete', tone: 'warn' }, NOT_ASSERTED: { label: 'Not asserted', tone: 'draft' }, NOT_EVALUATED: { label: 'Not evaluated', tone: 'plain' },
};
const ASSURANCE: Record<string, { label: string; tone: Tone }> = {
  VERIFIED: { label: 'Verified', tone: 'ok' }, INCOMPLETE: { label: 'Incomplete', tone: 'draft' }, DEVIATION_DETECTED: { label: 'Deviation detected', tone: 'warn' }, INTEGRITY_FAILED: { label: 'Integrity failed', tone: 'warn' },
  NOT_ASSESSABLE: { label: 'Not assessable', tone: 'draft' }, ASSURANCE_DRIFT: { label: 'No longer recomputes', tone: 'warn' }, NOT_CHECKED: { label: 'Not checked', tone: 'plain' }, NOT_AVAILABLE: { label: 'Not switched on', tone: 'plain' },
};
const LINK_STATUS: Record<string, { label: string; tone: Tone }> = {
  RECORDED: { label: 'Recorded', tone: 'ok' }, NOT_RECORDED_YET: { label: 'Not recorded yet', tone: 'draft' }, NOT_PART_OF_THIS_JOURNEY: { label: 'Not part of this journey', tone: 'plain' },
  NONE: { label: 'None', tone: 'plain' }, NONE_SELECTED: { label: 'None selected', tone: 'warn' }, WITHHELD: { label: 'Withheld', tone: 'draft' }, NOT_AVAILABLE: { label: 'Not switched on', tone: 'plain' },
};
/** Records that support a link's main record; shown on demand, to keep the chain readable. */
const SUPPORTING: Record<string, string> = { CALL_PLAN: 'each survey’s call plan', CONTROL_REGISTER_ROW: 'the control register rows as read', FINDING_RULE_SET: 'the finding rule set' };
const OUTCOME_TONE: Record<string, Tone> = { SATISFIED: 'ok', NOT_SATISFIED: 'warn', REQUIRES_REVIEW: 'warn', INSUFFICIENT_EVIDENCE: 'draft', UNRESOLVED: 'draft', NOT_APPLICABLE: 'plain' };

/** What a record says, in a sentence — from the facts the server recorded for it. */
function saysOf(r: Any): string {
  const f = r.facts ?? {};
  switch (r.kind) {
    case 'SYNTHETIC_APPLICATION': return `${Object.keys(f.facts ?? {}).length} fact(s) given for the simulation. Invented; not a customer application.`;
    case 'ASSIGNMENT_INPUTS': return `${Object.entries(f.inputs ?? {}).map(([k, v]) => `${words(k)}: ${Array.isArray(v) ? v.join(', ') : String(v)}`).join(' · ')}${f.missing_inputs ? ` — missing: ${f.missing_inputs.join(', ')}` : ''}`;
    case 'ASSIGNMENT_RULE_VERSION': return `Matched in ${(f.matched_in_groups ?? []).join(', ')}${(f.selected_in_groups ?? []).length ? `; selected the survey for ${f.selected_in_groups.join(', ')}` : '; did not win'}. Conditions: ${(f.conditions ?? []).map((c: Any) => `${words(c.field)} is ${Array.isArray(c.actual) ? c.actual.join(', ') : c.actual}`).join('; ')}.`;
    case 'SURVEY_BINDING': return `Rule ${f.rule} is bound to one exact published survey version.`;
    case 'REQUIREMENT_GROUP': return `${f.outcome === 'SELECTED' ? 'Selected a survey' : `No survey selected (${words(f.outcome)})`}${f.missing_inputs ? ` — input missing: ${f.missing_inputs.join(', ')}` : ''}. ${f.reason ?? ''}`;
    case 'SURVEY_VERSION': return f.group ? `Selected for ${f.group} by ${f.selected_by}${f.by_fallback ? ' (fallback)' : ''}.` : 'The survey version that was simulated.';
    case 'COMPOSITE_PLAN': return `Selection ${words(f.selection_status)}; order ${words(f.ordering_status)}; plan ${words(f.plan_status)}.${f.blockers ? ` A coordinated simulation cannot start: ${f.blockers.map(words).join(', ')}.` : ''}${f.recomputes_to_its_record === false ? ' Composed again today it would differ; the record is unchanged.' : ''}`;
    case 'CALL_PLAN': return 'The exact modules, items and wording planned for this survey.';
    case 'SIMULATION': return r.id ? `${f.accepted} answer(s) accepted${(f.refused ?? []).length ? `, ${f.refused.length} refused` : ''}; ${f.delivered ?? 0} item(s) delivered; ${f.ending ? `ended: ${words(f.ending)}` : f.pending ? `waiting at ${f.pending}` : words(f.state)}.` : 'Not started.';
    case 'COORDINATED_SIMULATION': return `${f.progress?.surveys_completed} of ${f.progress?.surveys_total} surveys completed${f.stop ? `; stopped: ${f.stop.text ?? words(f.stop.code ?? f.stop.reason)}` : ''}.`;
    case 'CONTROL_POLICY_REVISION': return `${f.completeness === 'DECLARED_COMPLETE' ? 'Declared complete within its own scope' : 'Partial'}. Named by the person who ran the evaluation.`;
    case 'CONTROL_MAPPING_REVISION': return `Which published survey items evidence ${f.control_code}.`;
    case 'JOURNEY_EVALUATION': return `${words(f.processing_status)}. ${f.recomputes_to_its_record ? 'Recomputes to its record.' : 'No longer recomputes to its record.'}${f.superseded_by_current_governance ? ` Governance has since moved on (${f.superseded_by_current_governance.map(words).join(', ')}); this record is unchanged.` : ''}`;
    case 'FINDING_RULE_SET': return 'The published finding rules the existing findings engine applied.';
    case 'CONTROL_REGISTER_ROW': return 'The control as the register held it when it was read.';
    case 'CONTROL_OBLIGATION_RESULT': return `${(f.evidence ?? []).length} piece(s) of evidence${f.mapping_revision ? `, under mapping revision ${f.mapping_revision}` : ''}.`;
    case 'FINDING': return `Rule ${f.rule} on ${words(f.trigger)}, at ${f.placement}. Severity as the synthetic rule set gives it: ${words(f.severity)}.`;
    case 'EXECUTION_ASSURANCE': return `${(f.surveys ?? []).map((s: Any) => `survey ${s.position} ${words(s.status)}`).join(', ')}${f.deviations ? `; deviations: ${f.deviations.map(words).join(', ')}` : ''}.`;
    default: return '';
  }
}
function openOf(r: Any, t: JourneyTrace): { to: string; label: string } | null {
  const f = r.facts ?? {};
  switch (r.kind) {
    case 'SURVEY_VERSION': return f.survey_code && r.id ? { to: `/survey-studio/surveys/${f.survey_code}/versions/${r.id}`, label: 'Open the published version' } : null;
    case 'SIMULATION': return r.id && f.survey_code ? { to: `/survey-studio/surveys/${f.survey_code}/simulate?simulation=${r.id}`, label: 'Open its simulation' } : null;
    case 'COORDINATED_SIMULATION': return { to: `/survey-studio/coordinated-simulations/${r.id}`, label: 'Open the coordinated simulation' };
    case 'COMPOSITE_PLAN': case 'ASSIGNMENT_INPUTS': return { to: '/survey-studio/assignment', label: 'Open survey assignment' };
    case 'CONTROL_POLICY_REVISION': return { to: `/survey-studio/controls?view=policy&policy=${r.id}`, label: 'Open the policy' };
    case 'CONTROL_MAPPING_REVISION': return { to: '/survey-studio/controls', label: 'Open controls and evidence' };
    case 'JOURNEY_EVALUATION': return { to: `/survey-studio/evaluations/${r.id}`, label: 'Open the evaluation workbench' };
    case 'EXECUTION_ASSURANCE': return t.evaluation_id ? { to: `/survey-studio/evaluations/${t.evaluation_id}`, label: 'Open it in the evaluation workbench' } : null;
    default: return null;
  }
}

function LinkBlock({ link, trace }: { link: JourneyTraceLink; trace: JourneyTrace }) {
  const st = LINK_STATUS[link.status] ?? { label: words(link.status), tone: 'draft' as Tone };
  const records = link.records as Any[];
  const main = records.filter((r) => !(r.kind in SUPPORTING));
  const supporting = records.filter((r) => r.kind in SUPPORTING);
  const row = (r: Any, i: number) => {
            const open = openOf(r, trace);
            const f = r.facts ?? {};
            return (
              <li key={`${r.kind}-${r.id ?? i}`} data-kind={r.kind} data-id={r.id ?? ''} data-sha={r.sha256 ?? ''}>
                <p className="ss-jr-rec-head"><strong>{r.label}</strong>{r.version !== null && r.version !== undefined && !String(r.version).startsWith('call360.') ? <span className="ss-muted"> · {/^\d/.test(String(r.version)) ? `version ${r.version}` : String(r.version)}</span> : null}
                  {r.kind === 'CONTROL_OBLIGATION_RESULT' ? <> <Tag tone={OUTCOME_TONE[f.outcome] ?? 'draft'}>{words(f.outcome)}</Tag>{f.coverage ? <span className="ss-muted"> evidence: {words(f.coverage)}</span> : null}</> : null}
                  {r.sha256 ? <span className="ss-code ss-jr-fp" title={`${r.sha256} — fingerprint of ${r.sha256_of}`}>{short(r.sha256)}</span> : null}</p>
                <p className="ss-jr-says">{saysOf(r)}</p>
                <details className="ss-cb-tech">
                  <summary>Technical details</summary>
                  <dl className="ss-srv-ids">
                    <div><dt>Record</dt><dd><span className="ss-code">{words(r.kind)}</span>{r.id ? <> · <span className="ss-code">{r.id}</span></> : ' · no record of its own'}</dd></div>
                    {r.version !== null && r.version !== undefined ? <div><dt>Version</dt><dd className="ss-code">{String(r.version)}</dd></div> : null}
                    <div><dt>Fingerprint</dt><dd className="ss-code">{r.sha256 ? `${r.sha256} (${r.sha256_of})` : 'none recorded for this record on its own'}</dd></div>
                    <div><dt>Where it comes from</dt><dd>{r.source}</dd></div>
                    {Object.entries(f).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => <div key={k}><dt>{words(k)}</dt><dd className="ss-code">{String(v)}</dd></div>)}
                    {open ? <div><dt>Existing screen</dt><dd><Link to={open.to}>{open.label}</Link></dd></div> : null}
                  </dl>
                </details>
              </li>
            );
  };
  return (
    <li className="ss-jr-link" data-testid={`ss-jr-link-${link.key}`} data-status={link.status} data-records={records.length}>
      <header><span className="ss-jr-step" aria-hidden="true">{link.step}</span><h3>{link.title}</h3><Tag tone={st.tone}>{st.label}</Tag></header>
      {main.length ? <ul className="ss-jr-records">{main.map(row)}</ul> : null}
      {supporting.length ? (
        <details className="ss-cb-tech ss-jr-more" data-testid={`ss-jr-more-${link.key}`}>
          <summary>{supporting.length} supporting record(s): {[...new Set(supporting.map((r) => SUPPORTING[r.kind]))].join(', ')}</summary>
          <ul className="ss-jr-records">{supporting.map(row)}</ul>
        </details>
      ) : null}
      {link.notes.map((n) => <p key={n} className="ss-muted ss-jr-note">{n}</p>)}
    </li>
  );
}

export function JourneyListPage() {
  const { can } = useAuth();
  const allowed = can('survey.evaluation.read');
  const [rows, setRows] = useState<JourneyRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (allowed) listJourneys().then(setRows).catch((e) => setError(say(e))); }, [allowed]);
  return (
    <>
      <div className="ss-bar"><nav className="ss-crumbs" aria-label="Survey Studio breadcrumb"><Link to="/survey-studio">Survey Studio</Link><Glyph name="right" size={13} /><span aria-current="page">Application journeys</span></nav>
        <div className="ss-bar-tools"><span className="ss-proto saved-mode"><Glyph name="info" size={14} /> Simulation · synthetic</span></div></div>
      <div className="ss-co ss-jr" data-testid="ss-jr-list">
        <header><h1 className="ss-title">Application journeys</h1>
          <p className="ss-muted">Each is one invented application, simulated. Open one to follow it from what was required to whether its execution was faithful. A journey starts on the <Link to="/survey-studio/assignment">survey assignment</Link> screen.</p></header>
        {!allowed ? <div className="ss-empty" role="status" data-testid="ss-jr-not-permitted"><p><strong>You cannot open journeys.</strong> Reading control evaluations needs its own permission, which you do not hold.</p></div>
          : error ? <div className="ss-empty" role="alert"><p><strong>The journeys could not be loaded.</strong> {error}</p></div>
            : rows === null ? <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading journeys…</p>
              : rows.length === 0 ? <div className="ss-empty" data-testid="ss-jr-none"><p><strong>No journey has been simulated yet.</strong> Start one from the survey assignment screen.</p></div>
                : <ul className="ss-jr-list">{rows.map((j) => <li key={j.id} data-testid={`ss-jr-row-${j.id}`}><Link to={journeyLink(j.kind, j.id)}><strong>{j.label || j.title}</strong></Link><span className="ss-muted"> {j.kind === 'COORDINATED' ? `${j.surveys} surveys, coordinated` : 'one survey'} · {new Date(j.created_at).toLocaleString()}</span></li>)}</ul>}
      </div>
    </>
  );
}

export function JourneyPage() {
  const { kind = '', journeyId = '' } = useParams();
  const [search] = useSearchParams();
  const evaluationId = search.get('evaluation');
  const { can } = useAuth();
  const allowed = can('survey.evaluation.read');
  const [trace, setTrace] = useState<JourneyTrace | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!allowed) return;
    let current = true; // a slower answer to an earlier question must never replace the answer to this one
    setTrace(undefined); setError(null);
    getJourneyTrace(kind as TraceKind, journeyId, evaluationId).then((t) => { if (current) setTrace(t); }).catch((e) => { if (current) setError(say(e)); });
    return () => { current = false; };
  }, [kind, journeyId, evaluationId, allowed]);
  const bar = (
    <div className="ss-bar">
      <nav className="ss-crumbs" aria-label="Survey Studio breadcrumb"><Link to="/survey-studio">Survey Studio</Link><Glyph name="right" size={13} /><Link to="/survey-studio/journeys">Application journeys</Link><Glyph name="right" size={13} /><span aria-current="page">Journey</span></nav>
      <div className="ss-bar-tools"><span className="ss-proto saved-mode"><Glyph name="info" size={14} /> Simulation · synthetic</span></div>
    </div>
  );
  if (!allowed) return <>{bar}<div className="ss-empty page" role="status" data-testid="ss-jr-not-permitted"><p><strong>You cannot open this journey.</strong> Reading control evaluations needs its own permission, which you do not hold.</p></div></>;
  if (error) return <>{bar}<div className="ss-empty page" role="alert" data-testid="ss-jr-failed"><p><strong>The journey could not be loaded.</strong> {error}</p></div></>;
  if (trace === undefined) return <>{bar}<p className="ss-loading page" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading the journey…</p></>;
  if (trace === null) return <>{bar}<div className="ss-empty page" role="status" data-testid="ss-jr-unavailable"><p><strong>This journey cannot be shown.</strong> Either it is not available to you, or the journey view is not switched on for this server.</p></div></>;

  const d = trace.dimensions as Any;
  const journey = trace.journey as Any;
  const by = (d.satisfaction.by_outcome ?? {}) as Record<string, number>;
  const completion = COMPLETION[d.completion.status] ?? { label: words(d.completion.status), tone: (d.completion.complete ? 'ok' : 'warn') as Tone };
  const coverage = COVERAGE[d.coverage.status] ?? { label: words(d.coverage.status), tone: 'draft' as Tone };
  const assurance = ASSURANCE[d.assurance.status] ?? { label: words(d.assurance.status), tone: 'draft' as Tone };
  const links = Object.fromEntries(trace.chain.map((l) => [l.key, l]));
  const gaps = trace.evidence_gaps as Any[];
  const integrity = trace.integrity as Any;
  const evaluations = trace.evaluations as Any[];
  return (
    <>
      {bar}
      <div className="ss-co ss-jr" data-testid="ss-jr" data-kind={journey.kind} data-journey={journey.id} data-evaluation={trace.evaluation_id ?? ''} data-assurance={trace.assurance_id ?? ''} data-trace={trace.trace_sha256} data-recompute={String(integrity.all_records_recompute)}>
        <header>
          <h1 className="ss-title">{journey.kind === 'APPLICATION_ONLY' ? 'Application (no journey started)' : 'Application journey'}{journey.label ? `: ${journey.label}` : ''}</h1>
          <p className="ss-note" data-testid="ss-jr-notice"><Glyph name="info" size={14} /><span><strong>One invented application, followed end to end.</strong> Everything here was recorded by the screens you already know; this page only lays the records out in order and decides nothing. It is a simulation: nothing was spoken, no customer was called, and nothing here is a compliance outcome.</span></p>
        </header>

        <dl className="ss-jr-dims" data-testid="ss-jr-dims" aria-label="Five separate statements about this journey">
          <div data-testid="ss-jr-dim-completion" data-status={d.completion.status}><dt>Did the surveys finish?</dt><dd><Tag tone={completion.tone}>{completion.label}</Tag></dd><dd className="ss-muted">{d.completion.surveys_completed} of {d.completion.surveys} survey(s) completed{d.completion.surveys_started < d.completion.surveys ? `; ${d.completion.surveys - d.completion.surveys_started} not started` : ''}.</dd></div>
          <div data-testid="ss-jr-dim-satisfaction" data-status={d.satisfaction.status} data-not-satisfied={by.NOT_SATISFIED ?? 0} data-satisfied={by.SATISFIED ?? 0}><dt>Were the controls satisfied?</dt><dd>{d.satisfaction.status === 'EVALUATED' ? <Tag tone={(by.NOT_SATISFIED ?? 0) || (by.REQUIRES_REVIEW ?? 0) ? 'warn' : 'ok'}>{by.SATISFIED ?? 0} satisfied · {by.NOT_SATISFIED ?? 0} not satisfied</Tag> : <Tag>Not evaluated</Tag>}</dd><dd className="ss-muted">{d.satisfaction.status === 'EVALUATED' ? `${by.REQUIRES_REVIEW ?? 0} need review · ${by.INSUFFICIENT_EVIDENCE ?? 0} lack evidence · ${by.NOT_APPLICABLE ?? 0} not applicable. Each obligation has its own result.` : 'No evaluation of this journey is shown.'}</dd></div>
          <div data-testid="ss-jr-dim-coverage" data-status={d.coverage.status}><dt>Was the required evidence there?</dt><dd><Tag tone={coverage.tone}>{coverage.label}</Tag></dd><dd className="ss-muted">{d.coverage.required !== undefined && d.coverage.required !== null ? `${d.coverage.evidenced} of ${d.coverage.required} required control(s) evidenced. ` : ''}About evidence, not results.</dd></div>
          <div data-testid="ss-jr-dim-assurance" data-status={d.assurance.status}><dt>Was the execution faithful?</dt><dd><Tag tone={assurance.tone}>{assurance.label}</Tag></dd><dd className="ss-muted">Against the recording only. Not about whether controls are satisfied.</dd></div>
          <div data-testid="ss-jr-dim-eligibility" data-status={d.eligibility.status}><dt>May a customer be called?</dt><dd><Tag>Not established</Tag></dd><dd className="ss-muted">Never established by a simulation.</dd></div>
        </dl>
        <p className="ss-muted">These are five separate statements. None follows from another: surveys can finish with a control not satisfied, evidence can be complete for a control that is not satisfied, and a faithful execution says nothing about either.</p>

        <div className="ss-jr-tools">
          {trace.evaluation_id ? <Link className="ss-btn small" to={`/survey-studio/evaluations/${trace.evaluation_id}`} data-testid="ss-jr-open-evaluation">Open the evaluation workbench</Link> : null}
          {journey.kind === 'COORDINATED' ? <Link className="ss-btn small" to={`/survey-studio/coordinated-simulations/${journey.id}`} data-testid="ss-jr-open-coordinated">Open the coordinated simulation</Link> : null}
          {evaluations.length > 1 ? <span className="ss-muted" data-testid="ss-jr-evaluations">Evaluations of this journey: {evaluations.map((e, i) => <span key={e.id}>{i ? ' · ' : ''}{e.id === trace.evaluation_id ? <strong>{new Date(e.created_at).toLocaleTimeString()} (shown)</strong> : <Link to={journeyLink(journey.kind, journey.id, e.id)}>{new Date(e.created_at).toLocaleTimeString()}</Link>}</span>)}. Each is kept as it was recorded.</span> : null}
        </div>

        {(trace.questions as Any[]).map((q) => (
          <section key={q.key} className="ss-srv-block ss-jr-q" aria-labelledby={`ss-jr-q-${q.key}`} data-testid={`ss-jr-q-${q.key}`}>
            <h2 id={`ss-jr-q-${q.key}`}>{q.question}</h2>
            {q.key === 'GAPS' ? (
              trace.evaluation_id === null ? <p className="ss-muted">This journey has not been evaluated, so nothing is known about its evidence.</p>
                : gaps.length === 0 ? <p data-testid="ss-jr-no-gaps">In the evaluation shown, no required evidence is missing and none is contradictory.</p>
                  : <ul className="ss-jr-gaps" data-testid="ss-jr-gaps">{gaps.map((g) => (
                    <li key={`${g.control_code}-${g.obligation ?? ''}`} data-control={g.control_code} data-obligation={g.obligation ?? ''} data-coverage={g.coverage ?? ''} data-outcome={g.outcome}>
                      <p><strong>{g.control_code}{g.obligation ? ` / ${g.obligation}` : ''}</strong> <Tag tone={OUTCOME_TONE[g.outcome] ?? 'draft'}>{words(g.outcome)}</Tag>{g.coverage ? <span className="ss-muted"> evidence: {words(g.coverage)}</span> : null}</p>
                      {(g.why as string[]).map((w) => <p key={w} className="ss-jr-says">{w}</p>)}
                      {(g.evidence as Any[]).length ? <ul className="ss-ev-reasons">{(g.evidence as Any[]).map((e, i) => <li key={i}>{e.survey ?? 'No survey'} at <span className="ss-code">{e.placement}</span>: {e.result ? words(e.result) : words(e.gap ?? 'no evidence')}{e.explanation ? ` — ${e.explanation}` : ''}</li>)}</ul> : <p className="ss-muted">No evidence was recorded for it.</p>}
                    </li>))}</ul>
            ) : <ol className="ss-jr-chain">{(q.links as string[]).map((k) => links[k]).filter((l): l is JourneyTraceLink => Boolean(l)).map((l) => <LinkBlock key={l.key} link={l} trace={trace} />)}</ol>}
          </section>
        ))}

        <section className="ss-srv-block" aria-labelledby="ss-jr-open-h" data-testid="ss-jr-open-points">
          <h2 id="ss-jr-open-h">What this does not show</h2>
          <ul className="ss-ev-reasons">{trace.open_points.map((o) => <li key={o.code} data-code={o.code} title={o.code}>{o.text}</li>)}</ul>
        </section>

        <details className="ss-cb-tech" data-testid="ss-jr-integrity">
          <summary>Integrity of the records ({integrity.all_records_recompute ? 'every record recomputes to itself' : 'something has changed since it was recorded'})</summary>
          <ul className="ss-ev-reasons">{(integrity.checks as Any[]).map((c) => <li key={c.record} data-record={c.record} data-ok={String(c.ok)}><Tag tone={c.ok ? 'ok' : 'warn'}>{c.ok ? 'yes' : 'no'}</Tag> {words(c.record)} {c.check}</li>)}</ul>
          <dl className="ss-srv-ids"><div><dt>Fingerprint of this chain</dt><dd className="ss-code">{trace.trace_sha256}</dd></div><div><dt>Contract</dt><dd className="ss-code">{trace.contract}</dd></div></dl>
        </details>
      </div>
    </>
  );
}
