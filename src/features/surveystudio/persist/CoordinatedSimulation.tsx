// Survey Studio (ASG-2B) — the Simulator's coordinated mode: every survey of one composite plan, in its governed
// order, as one testing journey. SIMULATION ONLY.
// Each survey is run by its own simulation on the Call360 server — its own published version, trace, answers and
// fingerprint. This screen shows them one after another and decides nothing: when to go on and when to stop is the
// server's, by one rule authorised for technical simulation only (a completed survey lets the next one start).
// Nothing is merged, shortened or skipped, and none of it says anything about a real call.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiFailure } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import type { SimAnswer } from '../model/sim';
import { Glyph, Tag } from '../ui';
import { KIND } from './AssignmentGroups';
import { getCoordinated, giveCoordinatedInput, startCoordinated, type CoordinatedSimulation as Co } from './assignmentApi';
import { JourneyEvaluations } from './EvaluationWorkbench';
import { short } from './reviewApi';
import { AnswerForm, ServerTrace } from './ServerSimulation';
import { REJECTION_TEXT, TERMINAL_TEXT, type PyPending, type PyRun } from './serverRun';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- the coordinated state is read as JSON
const say = (e: unknown) => (e instanceof ApiFailure ? (e.status === 403 ? 'You do not have permission for this.' : e.status === 404 ? 'Coordinated simulation is not available on this server, or this is outside your market.' : e.message) : 'The server could not be reached.');
const STATE: Record<string, { label: string; tone?: 'ok' | 'warn' | 'draft' }> = {
  COMPLETED: { label: 'Completed', tone: 'ok' }, CURRENT: { label: 'Current survey', tone: 'draft' }, NOT_STARTED: { label: 'Not started' }, STOPPED: { label: 'Ended without “completed”', tone: 'warn' }, DRIFTED: { label: 'No longer recomputes', tone: 'warn' },
};
const STATUS: Record<string, { title: string; tone: string }> = {
  RUNNING: { title: 'The current survey is waiting for an answer', tone: 'yes' },
  POLICY_UNRESOLVED: { title: 'Stopped: a non-answer whose handling is not decided', tone: 'no' },
  CROSS_SURVEY_POLICY_UNRESOLVED: { title: 'Stopped: a survey ended without “completed”, and what follows is not decided', tone: 'no' },
  ALL_SURVEYS_COMPLETED: { title: 'Every survey reached “completed”', tone: 'yes' },
  REPLAY_DRIFT: { title: 'A survey’s simulation no longer recomputes to its record', tone: 'no' },
};
/** The ordinary answer to a question, from what the server says the question accepts. A convenience of the tester. */
export const ordinaryFor = (p: PyPending): SimAnswer =>
  p.answer_type === 'YES_NO' ? { choice: 'YES' } : p.answer_type === 'ACKNOWLEDGEMENT' ? { acknowledged: true } : p.answer_type === 'NUMERIC' ? { number: Math.min(Math.max(20, p.number_rule?.min ?? 20), p.number_rule?.max ?? 20) }
    : p.answer_type === 'FREE_TEXT' ? { text: 'Nothing further, thank you.' } : p.answer_type === 'MULTI_SELECT' ? { choices: p.options[0] ? [p.options[0].code] : [] } : { choice: p.options[0]?.code };
const answerWords = (a: Any): string => (a.acknowledged !== undefined && a.acknowledged !== null ? (a.acknowledged ? 'acknowledged' : 'not acknowledged') : a.number !== undefined && a.number !== null ? String(a.number) : a.choices ? (a.choices.length ? a.choices.join(', ') : 'nothing selected') : a.choice ?? (a.text !== undefined ? `“${a.text}”` : 'no answer'));

export function CoordinatedSimulationPage() {
  const { coordinatedId = '' } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const [co, setCo] = useState<Co | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replay, setReplay] = useState<{ identical: boolean; first: string; second: string; inputs: number; id: string } | null>(null);
  const allowed = can('survey.assignment.read');
  const load = useCallback(() => { if (allowed) getCoordinated(coordinatedId).then(setCo).catch((e) => setError(say(e))); }, [coordinatedId, allowed]);
  useEffect(() => { setCo(null); setReplay(null); load(); }, [load]);

  const give = (key: string, a: SimAnswer) => { if (!co) return; setBusy(true); setError(null); setReplay(null); giveCoordinatedInput(co, key, a as Record<string, unknown>).then(setCo).catch((e) => { setError(say(e)); load(); }).finally(() => setBusy(false)); };
  const replayNow = () => {
    if (!co) return;
    setBusy(true); setError(null);
    (async () => {
      let again = await startCoordinated(co.composite_plan_id, `Replay of ${co.id.slice(0, 8)}`);
      for (const s of co.surveys as Any[]) for (const i of (s.simulation?.inputs ?? []) as Any[]) again = await giveCoordinatedInput(again, i.key, i.answer);
      setReplay({ identical: again.replay_sha256 === co.replay_sha256, first: co.replay_sha256, second: again.replay_sha256, inputs: co.progress.inputs ?? 0, id: again.id });
    })().catch((e) => setError(say(e))).finally(() => setBusy(false));
  };

  const bar = (
    <div className="ss-bar">
      <nav className="ss-crumbs" aria-label="Survey Studio breadcrumb"><Link to="/survey-studio">Survey Studio</Link><Glyph name="right" size={13} /><Link to="/survey-studio/assignment">Survey assignment</Link><Glyph name="right" size={13} /><span aria-current="page">Coordinated simulation</span></nav>
      <div className="ss-bar-tools"><span className="ss-proto saved-mode"><Glyph name="info" size={14} /> Simulation · synthetic</span></div>
    </div>
  );
  if (!allowed) return <>{bar}<div className="ss-empty page" role="status" data-testid="ss-co-not-permitted"><p><strong>You cannot open this coordinated simulation.</strong> Reading assignment data needs its own permission, which you do not hold.</p></div></>;
  if (!co) return <>{bar}{error ? <div className="ss-empty page" role="alert" data-testid="ss-co-failed"><p><strong>The coordinated simulation could not be loaded.</strong> {error}</p></div> : <p className="ss-loading page" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading the coordinated simulation…</p>}</>;

  const surveys = co.surveys as Any[];
  const current = surveys.find((s) => s.state === 'CURRENT') ?? null;
  const pending = (co.current as Any)?.pending as PyPending | null;
  const currentSim = current?.simulation as Any;
  const lastInput = currentSim?.inputs?.[currentSim.inputs.length - 1];
  const refused = lastInput && !lastInput.accepted && pending && lastInput.key === pending.key ? lastInput : null;
  const st = STATUS[co.status] ?? { title: co.status, tone: 'no' };
  const stop = co.stop as Any;
  const total = co.progress.surveys_total ?? surveys.length;
  const done = co.progress.surveys_completed ?? 0;
  return (
    <>
      {bar}
      <div className="ss-co" data-testid="ss-co" data-coordinated={co.id} data-status={co.status} data-replay={co.replay_sha256} data-completed={done} data-total={total}>
        <header>
          <h1 className="ss-title">Journey simulator · coordinated</h1>
          <p className="ss-note" data-testid="ss-co-notice"><Glyph name="info" size={14} /><span><strong>Coordinated simulation only.</strong> Every survey this invented application requires, in the governed order, each run on its own by the Call360 server. It is not a call. Going on to the next survey after one is completed is a rule for testing only: it approves nothing about what a real call does, and <strong>operational call eligibility has not been established</strong>.</span></p>
        </header>
        {error ? <p className="ss-note warn" role="alert" data-testid="ss-co-error"><Glyph name="alert" size={14} /><span>{error}</span></p> : null}

        <section className={`ss-plan-q ${st.tone}`} aria-labelledby="ss-co-status-h" data-testid="ss-co-summary">
          <p className="ss-plan-q-label">Survey {Math.min(done + 1, total)} of {total} · {done} completed</p>
          <h2 id="ss-co-status-h" data-testid="ss-co-status"><Glyph name={co.status === 'RUNNING' || co.status === 'ALL_SURVEYS_COMPLETED' ? 'check' : 'stop'} size={18} /> {st.title}</h2>
          {co.status === 'ALL_SURVEYS_COMPLETED' ? <p data-testid="ss-co-all-completed">This is progress, not an outcome: the coordinated simulation gives the application no result of its own. Each survey’s own ending is below.</p> : null}
          {stop ? <p data-testid="ss-co-stop" data-code={stop.code}><span className="ss-code">{stop.code}</span> at <span className="ss-code">{stop.at}</span> — {stop.reason}</p> : null}
          <progress max={total} value={done} aria-label="Surveys completed" />
          <p className="ss-muted">Application <span className="ss-code" title={co.application_sha256}>{short(co.application_sha256)}</span> · <Link to={`/survey-studio/assignment?composite=${co.composite_plan_id}`} data-testid="ss-co-composite-link">composite plan <span className="ss-code" title={co.composite_fingerprint}>{short(co.composite_fingerprint)}</span></Link>{co.composite_intact ? '' : ' (no longer intact)'} · coordinated result <span className="ss-code" title={co.replay_sha256} data-testid="ss-co-replay-sha">{short(co.replay_sha256)}</span> · {co.progress.inputs ?? 0} inputs, {co.progress.refused_inputs ?? 0} refused · kind of record: Simulation</p>
          <p className="ss-muted">The inputs the rules read and the facts the plans read are not reconciled ({String((co.input_consistency as Any).status).toLowerCase()}).</p>
        </section>

        <div className="ss-co-grid">
          <aside aria-label="Surveys in the governed order">
            <h2>Surveys, in the governed order</h2>
            <ol className="ss-co-surveys" data-testid="ss-co-surveys">
              {surveys.map((s) => {
                const tag: { label: string; tone?: 'ok' | 'warn' | 'draft' } = STATE[s.state] ?? { label: String(s.state) };
                return (
                  <li key={s.position} data-testid={`ss-co-survey-${s.position}`} data-state={s.state} data-group={s.group.code} data-version={s.survey_version_id} data-simulation={s.simulation_id ?? ''} className={s.state === 'CURRENT' ? 'on' : ''}>
                    <header><strong>{s.position}. {s.survey_name}</strong> <Tag tone={tag.tone}>{tag.label}</Tag></header>
                    <p className="ss-muted">{KIND[s.group.kind]?.label ?? s.group.kind} · <Link to={`/survey-studio/surveys/${s.survey_code}/versions/${s.survey_version_id}`}>version {s.version_label}</Link> · rule <span className="ss-code">{s.rule}</span></p>
                    {s.simulation ? <p className="ss-muted">{s.started_because === 'FIRST_IN_ORDER' ? 'Started first in the order.' : 'Started because the survey before it was completed.'} {s.inputs} inputs{s.refused_inputs ? `, ${s.refused_inputs} refused` : ''} · run <span className="ss-code" title={s.run_sha256}>{short(s.run_sha256)}</span>{s.simulation.run.terminal ? ` · ended: ${TERMINAL_TEXT[s.simulation.run.terminal.state] ?? s.simulation.run.terminal.state}${s.simulation.run.terminal.survey_outcome && s.simulation.run.terminal.survey_outcome !== 'COMPLETED' ? ` (${s.simulation.run.terminal.survey_outcome})` : ''}` : ''}</p>
                      : <p className="ss-muted">Not started: it starts only when the survey before it is completed.</p>}
                  </li>
                );
              })}
            </ol>
            <h2>Why it went on, or stopped</h2>
            {(co.decisions as Any[]).length ? (
              <ul className="ss-co-decisions" data-testid="ss-co-decisions">
                {(co.decisions as Any[]).map((d) => <li key={d.after} data-decision={d.decision} data-rule={d.rule}>{d.decision === 'PROCEED' ? <>After <strong>{d.after}</strong> was completed, <strong>{d.to}</strong> was started. <span className="ss-muted">Simulation rule only.</span></> : <>After <strong>{d.after}</strong> ended as “{TERMINAL_TEXT[d.ending] ?? d.ending}”, nothing was started: what follows is not decided.</>}</li>)}
              </ul>
            ) : <p className="ss-muted" data-testid="ss-co-no-decisions">No boundary between surveys has been reached yet.</p>}
          </aside>

          <main aria-label="The current survey">
            {current && pending ? (
              <section className="ss-sim-stage" aria-labelledby="ss-co-stage-h" data-testid="ss-co-stage" data-key={pending.key} data-survey={current.position}>
                <p className="ss-sim-eyebrow">Survey {current.position} of {total} · {current.survey_name} · <span className="ss-code">{pending.key}</span> <Tag>Server · Python engine</Tag></p>
                <p className="ss-sim-hears">The customer would hear, exactly</p>
                <h2 id="ss-co-stage-h" data-testid="ss-co-question">{pending.text}</h2>
                {co.status === 'POLICY_UNRESOLVED' ? (
                  <div className="ss-srv-policy" role="alert" data-testid="ss-co-policy"><strong><Glyph name="stop" size={14} /> Policy unresolved</strong>
                    <p>The customer did not acknowledge. What a call does then has not been decided by the business, so this survey does not continue and no other survey is started. Nothing was completed, escalated or closed. The question is still current.</p></div>
                ) : refused ? <p className="ss-issue" role="alert" data-testid="ss-co-reject" data-code={refused.rejection_code ?? ''}><Glyph name="alert" size={14} /> Not accepted ({refused.rejection_code}): {REJECTION_TEXT[refused.rejection_code ?? ''] ?? ''} The same question is still current, and no other survey is started.</p> : null}
                {can('survey.simulate') ? (
                  <>
                    <AnswerForm key={`${current.simulation_id}:${currentSim.inputs.length}`} p={pending} busy={busy} onGive={(a) => give(pending.key, a)} />
                    <div className="ss-sim-controls" role="group" aria-label="Simulation controls">
                      <button type="button" className="ss-btn" disabled={busy} onClick={() => give(pending.key, ordinaryFor(pending))} data-testid="ss-co-step" title="Give the ordinary answer to this question">Step</button>
                      <button type="button" className="ss-btn" disabled={busy || (co.progress.inputs ?? 0) === 0} onClick={replayNow} data-testid="ss-co-replay-go">Replay the same inputs</button>
                    </div>
                  </>
                ) : <p className="ss-save-note">You can read this coordinated simulation. Answering needs the “simulate surveys” permission.</p>}
              </section>
            ) : (
              <section className={`ss-sim-stage end tone-${co.status === 'ALL_SURVEYS_COMPLETED' ? 'ok' : 'halt'}`} aria-labelledby="ss-co-stage-h" data-testid="ss-co-end" data-status={co.status}>
                <p className="ss-sim-eyebrow"><Glyph name={co.status === 'ALL_SURVEYS_COMPLETED' ? 'check' : 'stop'} size={14} /> The coordinated simulation is not waiting for an answer</p>
                <h2 id="ss-co-stage-h">{st.title}</h2>
                <p className="ss-sim-fine">No case, call attempt, finding or disposition was created. Whether any of this may be used on a real call has not been established.</p>
                {can('survey.simulate') ? <div className="ss-sim-controls"><button type="button" className="ss-btn" disabled={busy || (co.progress.inputs ?? 0) === 0} onClick={replayNow} data-testid="ss-co-replay-go">Replay the same inputs</button></div> : null}
              </section>
            )}
            {replay ? (
              <p className={`ss-note ${replay.identical ? '' : 'warn'}`} role="status" data-testid="ss-co-replay" data-identical={String(replay.identical)}><Glyph name={replay.identical ? 'check' : 'alert'} size={14} />
                <span>{replay.identical ? <>Replayed in a new coordinated simulation with the same {replay.inputs} inputs: <strong>the coordinated result is identical</strong>.</> : <><strong>The replay differs.</strong> This must be investigated.</>} Fingerprints <span className="ss-code">{short(replay.first)}</span> and <span className="ss-code">{short(replay.second)}</span>. <button type="button" className="ss-link" onClick={() => nav(`/survey-studio/coordinated-simulations/${replay.id}`)}>Open the replay</button></span></p>
            ) : null}

            <section className="ss-srv-block" aria-labelledby="ss-co-report-h" data-testid="ss-co-report">
              <h2 id="ss-co-report-h">Consolidated simulation report</h2>
              <p className="ss-muted">Everything delivered and answered so far, survey by survey, exactly as each survey’s own run recorded it. Statements and questions that appear in more than one survey appear more than once: nothing is merged or left out.</p>
              <table className="ss-table">
                <thead><tr><th scope="col">Survey</th><th scope="col">Item</th><th scope="col">Exact wording</th><th scope="col">Answer</th></tr></thead>
                <tbody>
                  {surveys.flatMap((s) => ((s.simulation?.run.delivered ?? []) as Any[]).map((d) => {
                    const a = (s.simulation.run.events as Any[]).find((e) => e.kind === 'ANSWER' && e.key === d.key);
                    return <tr key={`${s.position}:${d.key}`} data-survey={s.position}><th scope="row">{s.position}. {s.survey_name}</th><td><span className="ss-code">{d.key}</span></td><td>{d.text}</td><td>{d.statement ? <span className="ss-muted">statement — no answer</span> : a ? answerWords(a.answer) : '—'}</td></tr>;
                  }))}
                  {surveys.flatMap((s) => ((s.simulation?.inputs ?? []) as Any[]).filter((i) => !i.accepted).map((i) => <tr key={`${s.position}:r${i.seq}`} className="refused" data-survey={s.position}><th scope="row">{s.position}. {s.survey_name}</th><td><span className="ss-code">{i.key}</span></td><td><span className="ss-muted">refused answer ({i.rejection_code})</span></td><td>{answerWords(i.answer)}</td></tr>))}
                </tbody>
              </table>
            </section>
          </main>

          <aside aria-label="Individual traces and fingerprints">
            <h2>Control evaluation</h2>
            <JourneyEvaluations journey={{ coordinatedId: co.id }} inputs={co.progress.inputs ?? 0} />
            <h2>Each survey’s own trace</h2>
            {surveys.filter((s) => s.simulation).map((s) => (
              <details key={s.position} className="ss-sim-evidence" open={s.state === 'CURRENT'} data-testid={`ss-co-trace-${s.position}`}>
                <summary>{s.position}. {s.survey_name} — {(s.simulation.run as PyRun).events.length} steps</summary>
                <dl className="ss-srv-ids">
                  <div><dt>Version</dt><dd>{s.version_label} · content <span className="ss-code">{short(s.content_sha256)}</span></dd></div>
                  <div><dt>Run fingerprint</dt><dd className="ss-code" title={s.run_sha256}>{short(s.run_sha256)}</dd></div>
                  <div><dt>Execution contract</dt><dd className="ss-code">{s.engine_contract}</dd></div>
                  <div><dt>Its own simulation</dt><dd><Link to={`/survey-studio/surveys/${s.survey_code}/simulate?simulation=${s.simulation_id}`} data-testid={`ss-co-open-sim-${s.position}`}>open</Link></dd></div>
                </dl>
                <ServerTrace run={s.simulation.run as PyRun} />
              </details>
            ))}
          </aside>
        </div>
      </div>
    </>
  );
}
