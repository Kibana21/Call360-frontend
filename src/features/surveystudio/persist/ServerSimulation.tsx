// Survey Studio (SS-03B.3) — the Simulator on the Call360 server. SIMULATION ONLY.
// A PUBLISHED version is run by the authoritative Python engine: every sentence, decision, route, refusal and ending
// shown here is the server's. The browser decides nothing. Beside it, the browser's own engine is run on the same
// published documents and the same inputs, and any difference between the two is shown in full — never hidden.
import { JourneyEvaluations } from './EvaluationWorkbench';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiFailure } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { PROFILES, scriptedAnswer, type SimProfile } from '../model/demo';
import { simulateInputs, type SimAnswer } from '../model/sim';
import { FIELDS } from '../model/sample';
import { Glyph, Tag } from '../ui';
import { usePersistence } from './Persistence';
import { getCandidateDocuments, getHistory, short, when, type SurveyHistory } from './reviewApi';
import { createSimulation, getSimulation, giveInput, type Facts, type ServerSimulation as Sim } from './simApi';
import { REJECTION_TEXT, STATUS_TEXT, TERMINAL_TEXT, compareRuns, describe, inputsOf, versionWorkspace, type Difference, type PyPending, type PyRun } from './serverRun';

export const SIMULATION_NOTE = 'A simulation on the Call360 server with an invented customer. It is not a call and not a record of one, and it makes nothing eligible for a real call.';
export const NO_SIMULATE = 'You can read this survey, but running a simulation needs the “simulate surveys” permission (survey.simulate), which you do not hold. Nothing was created.';
const say = (e: unknown) => (e instanceof ApiFailure ? (e.status === 403 ? NO_SIMULATE : e.code === 'REPLAY_DRIFT' ? 'This simulation no longer recomputes to its recorded result, so it takes no further input. Start a new one.' : e.status === 404 ? 'Simulation is not available on this server, or this version is not available to you.' : e.message) : 'The server could not be reached.');
const runOf = (s: Sim) => s.run as unknown as PyRun;
type Versions = SurveyHistory['versions'];
export const publishedOf = (h: SurveyHistory | null): Versions => (h?.versions ?? []).filter((v) => v.status === 'PUBLISHED' || v.status === 'SUPERSEDED');
const factText = (v: unknown) => (v === null || v === undefined || v === '' ? null : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'number' ? v.toLocaleString('en-SG') : String(v));

/** Loads the survey's published versions and the documents of the chosen one (for the browser comparison). */
export function usePublishedVersion() {
  const p = usePersistence();
  const [history, setHistory] = useState<SurveyHistory | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [vw, setVw] = useState<ReturnType<typeof versionWorkspace> | null>(null);
  const surveyId = p?.surveyId;
  useEffect(() => { if (surveyId) getHistory(surveyId).then(setHistory).catch((e) => setFailed(say(e))); }, [surveyId]);
  const versions = useMemo(() => publishedOf(history), [history]);
  const version = versions.find((v) => v.id === chosen) ?? versions.find((v) => v.status === 'PUBLISHED') ?? versions[0] ?? null;
  useEffect(() => {
    setVw(null);
    if (!version || !history) return;
    let live = true;
    getCandidateDocuments(version.candidate_id).then((d) => { if (live) setVw(versionWorkspace(d, { name: history.name, label: version.label })); }).catch(() => undefined);
    return () => { live = false; };
  }, [version, history]);
  return { loading: !!surveyId && !history && !failed, failed, history, versions, version, choose: setChosen, vw };
}

export function ServerSimulation({ profile, other, onProfile, onCompare, base, simulationId, assignmentId, onLeaveOpened }: { profile: SimProfile; other: SimProfile | null; onProfile: (id: string) => void; onCompare: (id: string | null) => void; base: string; simulationId?: string | null; assignmentId?: string | null; onLeaveOpened?: () => void }) {
  const pv = usePublishedVersion();
  const { can } = useAuth();
  const allowed = can('survey.simulate');
  const { version, vw } = pv;
  const [sim, setSim] = useState<Sim | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ identical: boolean; first: string; second: string; inputs: number } | null>(null);
  const attempt = useRef(0);
  const versionId = version?.id;
  const start = useCallback(() => {
    if (!versionId || !allowed) return;
    const mine = ++attempt.current;
    setBusy(true); setError(null); setReplay(null);
    createSimulation(versionId, profile.facts as Facts, profile.name).then((s) => { if (mine === attempt.current) setSim(s); })
      .catch((e) => { if (mine === attempt.current) { setSim(null); setError(say(e)); } }).finally(() => { if (mine === attempt.current) setBusy(false); });
  }, [versionId, profile, allowed]);
  // a simulation opened by its link (for instance one started from an assignment selection) is READ, not created again
  const opened = !!simulationId;
  useEffect(() => {
    if (!simulationId) { setSim(null); start(); return; }
    setError(null);
    getSimulation(simulationId).then(setSim).catch((e) => setError(say(e)));
  }, [start, simulationId]);
  useEffect(() => { if (sim && version && sim.version_id !== version.id && pv.versions.some((v) => v.id === sim.version_id)) pv.choose(sim.version_id); }, [sim, version]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = sim ? runOf(sim) : null;
  const answerAs = (key: string): SimAnswer => (vw ? scriptedAnswer(vw.ws, vw.survey, profile, key) : {});
  const act = (work: () => Promise<Sim>) => { setBusy(true); setError(null); setReplay(null); work().then(setSim).catch((e) => setError(say(e))).finally(() => setBusy(false)); };
  const give = (a: SimAnswer) => { if (sim && run?.pending) act(() => giveInput(sim, run.pending!.key, a)); };
  const runAll = () => {
    if (!sim) return;
    act(async () => {
      let s = sim;
      for (let i = 0; i < 400 && runOf(s).status === 'PENDING' && runOf(s).pending; i++) {
        const next = await giveInput(s, runOf(s).pending!.key, answerAs(runOf(s).pending!.key));
        const refused = next.inputs[next.inputs.length - 1]?.accepted === false;
        s = next;
        if (refused) break; // never loop on an answer the server refuses
      }
      return s;
    });
  };
  const replayNow = () => {
    if (!sim || !versionId) return;
    setBusy(true); setError(null);
    (async () => {
      let again = await createSimulation(versionId, sim.facts as Facts, `Replay of ${sim.id.slice(0, 8)}`);
      for (const i of sim.inputs) again = await giveInput(again, i.key, i.answer as SimAnswer);
      setReplay({ identical: again.run_sha256 === sim.run_sha256, first: sim.run_sha256, second: again.run_sha256, inputs: sim.inputs.length });
    })().catch((e) => setError(say(e))).finally(() => setBusy(false));
  };
  const differences: Difference[] | null = useMemo(() => (sim && vw ? compareRuns(runOf(sim), simulateInputs(vw.ws, vw.survey, sim.facts as Facts, inputsOf(sim.inputs))) : null), [sim, vw]);

  if (pv.loading) return <p className="ss-loading" role="status" data-testid="ss-srv-loading"><span className="ss-spinner" aria-hidden="true" /> Loading the published versions…</p>;
  if (pv.failed) return <div className="ss-empty" role="alert" data-testid="ss-srv-failed"><p><strong>The published versions could not be loaded.</strong> {pv.failed}</p></div>;
  if (!version) {
    return (
      <div className="ss-empty" data-testid="ss-srv-none">
        <p><strong>This survey has no published version yet.</strong> The Call360 server simulates published versions only: what it runs is then exactly what was reviewed and published.</p>
        <Link className="ss-btn" to={`${base}/review`}>Review and publish</Link>
      </div>
    );
  }
  const head = (
    <div className="ss-srv-head">
      <p className="ss-note" data-testid="ss-srv-notice"><Glyph name="info" size={14} /><span>{SIMULATION_NOTE} All wording is synthetic sample text.</span></p>
      <div className="ss-srv-pick">
        <label className="ss-field inline"><span>Published version</span>
          <select value={version.id} onChange={(e) => pv.choose(e.target.value)} data-testid="ss-srv-version">
            {pv.versions.map((v) => <option key={v.id} value={v.id}>Version {v.label}{v.status === 'SUPERSEDED' ? ' (superseded)' : ''} · published {when(v.published_at)}</option>)}
          </select></label>
        <label className="ss-field inline"><span>Compare with</span>
          <select value={other?.id ?? ''} onChange={(e) => onCompare(e.target.value || null)} data-testid="ss-srv-compare-pick">
            <option value="">— one customer —</option>
            {PROFILES.filter((x) => x.id !== profile.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></label>
      </div>
    </div>
  );
  if (!allowed) return <div className="ss-srv" data-testid="ss-srv" data-status="NOT_PERMITTED">{head}<div className="ss-empty" role="status" data-testid="ss-srv-not-permitted"><p><strong>You cannot run a simulation.</strong> {NO_SIMULATE}</p></div></div>;
  if (other) return <div className="ss-srv" data-testid="ss-srv">{head}<ServerCompare versionId={version.id} label={version.label} a={profile} b={other} vw={vw} onClose={() => onCompare(null)} /></div>;

  return (
    <div className="ss-srv" data-testid="ss-srv" data-version={version.id} data-simulation={sim?.id ?? ''} data-status={sim?.status ?? ''}>
      {head}
      {assignmentId ? <p className="ss-note" data-testid="ss-srv-from-assignment"><Glyph name="branch" size={14} /><span>This simulation was started from an assignment selection, with that application’s facts. <Link to={`/survey-studio/assignment?evaluation=${assignmentId}`} data-testid="ss-srv-assignment-link">See why this survey was selected</Link>.</span></p> : null}
      {sim?.drift ? (
        <section className="ss-srv-diff" role="alert" data-testid="ss-srv-drift" aria-labelledby="ss-srv-drift-h">
          <h2 id="ss-srv-drift-h"><Glyph name="alert" size={15} /> This simulation no longer recomputes to what was recorded</h2>
          <p>It was recorded under execution contract <span className="ss-code">{String(sim.drift.recorded_engine_contract)}</span>; the server now runs <span className="ss-code">{String(sim.drift.current_engine_contract)}</span>. {sim.drift.result_differs ? 'The result computed now differs from the recorded one.' : 'The result happens to be the same, but the contract is not.'} What is shown below is today’s recomputation, not the historical result. The simulation takes no further input: start a new one.</p>
        </section>
      ) : null}
      {error ? <p className="ss-note warn" role="alert" data-testid="ss-srv-error"><Glyph name="alert" size={14} /><span>{error}</span></p> : null}
      <div className="ss-sim-grid">
        <aside className="ss-sim-side" aria-label="Customer and modules">
          <section aria-labelledby="ss-srv-profile-h">
            <h2 id="ss-srv-profile-h">Synthetic customer</h2>
            <div className="ss-sim-profiles" role="radiogroup" aria-label="Synthetic customer">
              {PROFILES.map((x) => (
                <button key={x.id} type="button" role="radio" aria-checked={x.id === profile.id} className={`ss-sim-profile ${x.id === profile.id ? 'on' : ''}`} onClick={() => { if (opened && onLeaveOpened) onLeaveOpened(); onProfile(x.id); }} data-testid={`ss-srv-profile-${x.id}`}>
                  <strong>{x.name}</strong><small>{x.summary}</small></button>
              ))}
            </div>
          </section>
          <section aria-labelledby="ss-srv-facts-h">
            <h2 id="ss-srv-facts-h">Facts given to the server</h2>
            <dl className="ss-sim-facts" data-testid="ss-srv-facts">
              {FIELDS.map((f) => { const v = factText((sim?.facts ?? profile.facts)[f.code]); return <div key={f.code}><dt>{f.label}</dt><dd className={v === null ? 'missing' : ''}>{v ?? 'missing'}</dd></div>; })}
            </dl>
          </section>
          {run ? <ServerModules run={run} /> : null}
        </aside>

        <main className="ss-sim-main" aria-label="The simulated call">
          {!sim || !run ? <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Starting the simulation on the server…</p> : (
            <>
              <ServerStage key={`${sim.id}:${sim.inputs.length}`} sim={sim} run={run} busy={busy} canScript={!!vw} onGive={give} onStep={() => run.pending && give(answerAs(run.pending.key))} onRunAll={runAll} onRestart={() => { if (opened && onLeaveOpened) onLeaveOpened(); else start(); }} onReplay={replayNow} />
              {replay ? (
                <p className={`ss-note ${replay.identical ? '' : 'warn'}`} role="status" data-testid="ss-srv-replay" data-identical={String(replay.identical)}>
                  <Glyph name={replay.identical ? 'check' : 'alert'} size={14} />
                  <span>{replay.identical ? <>Replayed in a new simulation with the same {replay.inputs} input{replay.inputs === 1 ? '' : 's'}: <strong>the run is identical</strong>.</> : <><strong>The replay differs from the first run.</strong> This must be investigated.</>} Run fingerprints <span className="ss-code">{short(replay.first)}</span> and <span className="ss-code">{short(replay.second)}</span>.</span>
                </p>
              ) : null}
              <Parity differences={differences} what="run" />
            </>
          )}
        </main>

        <aside className="ss-sim-timeline" aria-label="Execution trace">
          <h2>Execution trace</h2>
          <p className="ss-muted">Every step the server took, in order, with what it read.</p>
          {run ? <ServerTrace run={run} /> : null}
          {run && sim ? (
            <>
              <details className="ss-sim-evidence" data-testid="ss-srv-delivered">
                <summary>Exact wording delivered ({run.delivered.length})</summary>
                <ol className="ss-srv-said">{run.delivered.map((d) => <li key={d.key}><span className="ss-code">{d.key} · {d.item} · wording {d.wording_version}</span><span>{d.text}</span></li>)}</ol>
              </details>
              <details className="ss-sim-evidence" data-testid="ss-srv-evaluation" open>
                <summary>Control evaluation</summary>
                <JourneyEvaluations journey={{ simulationId: sim.id }} inputs={sim.inputs.length} />
              </details>
              <details className="ss-sim-evidence" data-testid="ss-srv-identity">
                <summary>What exactly was run</summary>
                <dl className="ss-srv-ids">
                  <div><dt>Kind of record</dt><dd data-testid="ss-srv-class">{sim.record_class === 'SIMULATION' ? 'Simulation' : sim.record_class}</dd></div>
                  <div><dt>Version</dt><dd>{sim.version_label} of {sim.survey_code}</dd></div>
                  <div><dt>Content fingerprint</dt><dd className="ss-code">{short(sim.content_sha256)}</dd></div>
                  <div><dt>Manifest fingerprint</dt><dd className="ss-code">{short(sim.manifest_sha256)}</dd></div>
                  <div><dt>Facts fingerprint</dt><dd className="ss-code">{short(sim.facts_sha256)}</dd></div>
                  <div><dt>Execution contract</dt><dd className="ss-code" data-testid="ss-srv-contract">{sim.engine_contract}</dd></div>
                  <div><dt>Recomputes to the recorded result</dt><dd data-testid="ss-srv-consistent">{sim.replay_consistent ? 'Yes' : 'No — drifted'}</dd></div>
                  <div><dt>Run fingerprint</dt><dd className="ss-code" data-testid="ss-srv-run-sha">{short(sim.run_sha256)}</dd></div>
                  <div><dt>Inputs recorded</dt><dd>{sim.inputs.length} ({sim.inputs.filter((i) => !i.accepted).length} refused)</dd></div>
                </dl>
              </details>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function ServerModules({ run }: { run: PyRun }) {
  const why = (instance: string) => { const e = run.events.find((x) => x.kind === 'ENTRY' && x.instance === instance); return e ? describe(e, run).detail : 'The run has not reached this module.'; };
  return (
    <section aria-labelledby="ss-srv-modules-h">
      <h2 id="ss-srv-modules-h">Modules</h2>
      <ol className="ss-srv-modules" data-testid="ss-srv-modules">
        {run.modules.map((m) => (
          <li key={m.instance} data-testid={`ss-srv-module-${m.instance}`} data-status={m.status}>
            <strong>{m.name}</strong>
            <span>{STATUS_TEXT[m.status] ?? m.status}{m.outcome ? ` · ${m.outcome}` : ''}</span>
            <small>{why(m.instance)}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ServerTrace({ run }: { run: PyRun }) {
  return (
    <ol className="ss-srv-trace" data-testid="ss-srv-trace">
      {run.events.map((e) => { const l = describe(e, run); return <li key={l.at} className={`tone-${l.tone}`} data-kind={l.kind}><strong>{l.title}</strong>{l.detail ? <span>{l.detail}</span> : null}</li>; })}
    </ol>
  );
}

/** Whether the browser's engine agrees with the server. A difference is listed in full; it is never smoothed over. */
export function Parity({ differences, what }: { differences: Difference[] | null; what: 'run' | 'plan' }) {
  if (differences === null) return <p className="ss-muted" data-testid="ss-srv-parity" data-agree="pending">Comparing with the browser’s own engine…</p>;
  if (!differences.length) {
    return (
      <p className="ss-note" data-testid="ss-srv-parity" data-agree="true"><Glyph name="check" size={14} />
        <span>The browser’s own engine, given the same published documents and the same {what === 'run' ? 'inputs' : 'facts'}, produces the same {what}. The server’s result is the one that counts.</span></p>
    );
  }
  return (
    <section className="ss-srv-diff" role="alert" data-testid="ss-srv-parity" data-agree="false" aria-labelledby="ss-srv-diff-h">
      <h2 id="ss-srv-diff-h"><Glyph name="alert" size={15} /> The browser’s engine does not agree with the server</h2>
      <p>The server’s {what} is the authoritative one and is what this screen shows. The difference below must be investigated before the browser preview is relied on.</p>
      <table className="ss-table"><thead><tr><th scope="col">What</th><th scope="col">Server (Python)</th><th scope="col">Browser</th></tr></thead>
        <tbody>{differences.map((d) => <tr key={d.what}><th scope="row">{d.what}</th><td>{d.server}</td><td>{d.browser}</td></tr>)}</tbody></table>
    </section>
  );
}

function ServerStage({ sim, run, busy, canScript, onGive, onStep, onRunAll, onRestart, onReplay }: { sim: Sim; run: PyRun; busy: boolean; canScript: boolean; onGive: (a: SimAnswer) => void; onStep: () => void; onRunAll: () => void; onRestart: () => void; onReplay: () => void }) {
  const p = run.pending;
  const last = sim.inputs[sim.inputs.length - 1];
  const refused = last && !last.accepted && p && last.key === p.key ? last : null;
  const controls = (
    <div className="ss-sim-controls" role="group" aria-label="Simulation controls">
      {p ? <button type="button" className="ss-btn" onClick={onStep} disabled={busy || !canScript} data-testid="ss-srv-step" title="Give the ordinary answer to this question">Step</button> : null}
      {p ? <button type="button" className="ss-btn" onClick={onRunAll} disabled={busy || !canScript} data-testid="ss-srv-run-all">Run to the end</button> : null}
      <button type="button" className="ss-btn" onClick={onRestart} disabled={busy} data-testid="ss-srv-restart">Start again</button>
      <button type="button" className="ss-btn" onClick={onReplay} disabled={busy || sim.inputs.length === 0} data-testid="ss-srv-replay-go" title="Run the same inputs again in a new simulation and compare">Replay the same inputs</button>
    </div>
  );
  if (!p) {
    const t = run.terminal;
    const tone = t?.state === 'COMPLETED' ? 'ok' : t?.state === 'ENDED_WITH_OUTCOME' || t?.state === 'MANDATORY_ESCALATION' ? 'alt' : 'halt';
    return (
      <section className={`ss-sim-stage end tone-${tone}`} aria-labelledby="ss-srv-stage-h" data-testid="ss-srv-end" data-terminal={t?.state ?? ''}>
        <p className="ss-sim-eyebrow"><Glyph name={t?.state === 'COMPLETED' ? 'check' : 'stop'} size={14} /> End of the simulated run</p>
        <h2 id="ss-srv-stage-h" data-testid="ss-srv-end-headline">{TERMINAL_TEXT[t?.state ?? ''] ?? t?.state}{t?.survey_outcome && t.survey_outcome !== 'COMPLETED' ? `: ${t.survey_outcome}` : ''}</h2>
        {t?.reason ? <p data-testid="ss-srv-end-reason">Reason code <span className="ss-code">{t.reason}</span> at <span className="ss-code">{t.at}</span>.</p> : null}
        <p className="ss-sim-fine">This is how the simulation ended. It is not the result of a call, and no case, finding or disposition was created.</p>
        {controls}
      </section>
    );
  }
  return (
    <section className="ss-sim-stage" aria-labelledby="ss-srv-stage-h" data-testid="ss-srv-stage" data-key={p.key} data-attempt={p.attempt}>
      <p className="ss-sim-eyebrow"><span className="ss-code">{p.key}</span>{p.followup ? ' · follow-up question' : ''} <Tag>Server · Python engine</Tag></p>
      <p className="ss-sim-hears">The customer would hear, exactly</p>
      <h2 id="ss-srv-stage-h" data-testid="ss-srv-question">{p.text}</h2>
      {run.status === 'POLICY_UNRESOLVED' && run.policy_unresolved ? (
        <div className="ss-srv-policy" role="alert" data-testid="ss-srv-policy">
          <strong><Glyph name="stop" size={14} /> Policy unresolved</strong>
          <p>The customer did not acknowledge at <span className="ss-code">{run.policy_unresolved.key}</span> (reason code <span className="ss-code">{run.policy_unresolved.reason}</span>). What a call does then has not been decided by the business, so the simulation does not continue past this point. This is not an outcome of the call: nothing was completed, escalated or closed. The question is still current.</p>
        </div>
      ) : refused ? <p className="ss-issue" role="alert" data-testid="ss-srv-reject" data-code={refused.rejection_code ?? ''}><Glyph name="alert" size={14} /> Not accepted ({refused.rejection_code}): {REJECTION_TEXT[refused.rejection_code ?? ''] ?? ''} The same question is still current.</p> : null}
      <AnswerForm p={p} busy={busy} onGive={onGive} />
      {p.queue ? <div className="ss-sim-queue" data-testid="ss-srv-queue"><h3>Follow-up queue</h3><ol>{p.queue.map((x) => <li key={x.node} className={x.state.toLowerCase()}><span>{x.state === 'DONE' ? 'Asked' : x.state === 'NOW' ? 'Now' : 'Next'}</span>{x.node}</li>)}</ol></div> : null}
      {controls}
    </section>
  );
}

export function AnswerForm({ p, busy, onGive }: { p: PyPending; busy: boolean; onGive: (a: SimAnswer) => void }) {
  const [choice, setChoice] = useState<string | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [text, setText] = useState('');
  const multi = p.answer_type === 'MULTI_SELECT';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // what was typed is sent as it is; the server alone decides whether it is a valid answer
    const a: SimAnswer = p.answer_type === 'NUMERIC' ? (text.trim() === '' || Number.isNaN(Number(text)) ? {} : { number: Number(text) }) : p.answer_type === 'FREE_TEXT' ? { text } : multi ? { choices } : choice === null ? {} : { choice };
    onGive(a);
  };
  if (p.answer_type === 'ACKNOWLEDGEMENT') {
    return (
      <div className="ss-sim-submit">
        <button type="button" className="ss-btn primary" disabled={busy} onClick={() => onGive({ acknowledged: true })} data-testid="ss-srv-ack">The customer acknowledges</button>
        <button type="button" className="ss-btn" disabled={busy} onClick={() => onGive({ acknowledged: false })} data-testid="ss-srv-no-ack">The customer does not acknowledge</button>
      </div>
    );
  }
  return (
    <form className="ss-sim-answer" onSubmit={submit}>
      {p.answer_type === 'NUMERIC' ? (
        <label className="ss-field"><span>The customer says a number</span><input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} data-testid="ss-srv-number" /></label>
      ) : p.answer_type === 'FREE_TEXT' ? (
        <label className="ss-field"><span>The customer says</span><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} data-testid="ss-srv-text" /></label>
      ) : (
        <fieldset className="ss-sim-options">
          <legend>{multi ? `The customer chooses${p.selection ? ` (${p.selection.min} to ${p.selection.max})` : ' one or more'}` : 'The customer answers'}</legend>
          {p.options.map((o) => {
            const on = multi ? choices.includes(o.code) : choice === o.code;
            return (
              <label key={o.code} className={`ss-sim-option ${on ? 'on' : ''}`}>
                <input type={multi ? 'checkbox' : 'radio'} name="ss-srv-answer" checked={on} data-testid={`ss-srv-opt-${o.code}`}
                  onChange={(e) => (multi ? setChoices(e.target.checked ? [...choices, o.code] : choices.filter((c) => c !== o.code)) : setChoice(o.code))} />
                <span>{o.label || o.code}</span>
              </label>
            );
          })}
        </fieldset>
      )}
      <div className="ss-sim-submit"><button type="submit" className="ss-btn primary" disabled={busy} data-testid="ss-srv-answer">Give this answer</button></div>
    </form>
  );
}

/** Two customers, each run to the end on the server with the ordinary answers; what differs is which modules ran. */
function ServerCompare({ versionId, label, a, b, vw, onClose }: { versionId: string; label: string; a: SimProfile; b: SimProfile; vw: ReturnType<typeof versionWorkspace> | null; onClose: () => void }) {
  const [runs, setRuns] = useState<[PyRun, PyRun] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!vw) return undefined;
    let live = true;
    setRuns(null); setError(null);
    const finish = async (p: SimProfile): Promise<PyRun> => {
      let s = await createSimulation(versionId, p.facts as Facts, `Comparison: ${p.name}`);
      for (let i = 0; i < 400 && runOf(s).status === 'PENDING' && runOf(s).pending; i++) {
        s = await giveInput(s, runOf(s).pending!.key, scriptedAnswer(vw.ws, vw.survey, p, runOf(s).pending!.key));
        if (s.inputs[s.inputs.length - 1]?.accepted === false) break;
      }
      return runOf(s);
    };
    (async () => { const first = await finish(a); const second = await finish(b); if (live) setRuns([first, second]); })().catch((e) => { if (live) setError(say(e)); });
    return () => { live = false; };
  }, [versionId, a, b, vw]);
  if (error) return <p className="ss-note warn" role="alert"><Glyph name="alert" size={14} /><span>{error}</span></p>;
  if (!runs) return <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Running both customers on the server…</p>;
  const end = (r: PyRun) => (r.terminal ? `${TERMINAL_TEXT[r.terminal.state] ?? r.terminal.state}${r.terminal.survey_outcome && r.terminal.survey_outcome !== 'COMPLETED' ? `: ${r.terminal.survey_outcome}` : ''}` : r.status === 'POLICY_UNRESOLVED' ? 'Stopped: policy unresolved' : 'Waiting for an answer');
  return (
    <section className="ss-srv-compare" data-testid="ss-srv-compare" aria-labelledby="ss-srv-compare-h">
      <header><h2 id="ss-srv-compare-h">Two customers, the same published version {label}</h2><button type="button" className="ss-btn" onClick={onClose} data-testid="ss-srv-compare-close">Back to one customer</button></header>
      <p className="ss-muted">Each was run to the end on the server, giving the ordinary answer to every question. Rows that differ are marked.</p>
      <table className="ss-table">
        <thead><tr><th scope="col">Module</th><th scope="col">{a.name}</th><th scope="col">{b.name}</th></tr></thead>
        <tbody>
          {runs[0].modules.map((m, i) => { const n = runs[1].modules[i]!; const same = m.status === n.status && m.outcome === n.outcome; return (
            <tr key={m.instance} className={same ? '' : 'differs'} data-testid={`ss-srv-compare-${m.instance}`} data-differs={String(!same)}>
              <th scope="row">{m.name}{same ? null : <> <Tag tone="warn">Differs</Tag></>}</th>
              <td>{STATUS_TEXT[m.status] ?? m.status}{m.outcome ? ` · ${m.outcome}` : ''}</td><td>{STATUS_TEXT[n.status] ?? n.status}{n.outcome ? ` · ${n.outcome}` : ''}</td>
            </tr>); })}
          <tr><th scope="row">Items delivered</th><td>{runs[0].delivered.length}</td><td>{runs[1].delivered.length}</td></tr>
          <tr data-testid="ss-srv-compare-end"><th scope="row">How it ended</th><td>{end(runs[0])}</td><td>{end(runs[1])}</td></tr>
        </tbody>
      </table>
    </section>
  );
}
