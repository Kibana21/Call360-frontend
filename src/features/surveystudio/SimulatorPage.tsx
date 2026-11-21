// Survey Studio prototype — the Journey Simulator (SS-02B.3). DEMONSTRATION ONLY.
// Three things side by side, always in this order: what the customer hears, what the engine decided and why, and the
// journey so far. It runs the same in-memory model the Guided and Graph editors write (model/sim.ts) — an edit made in
// either is in the next run. Nothing is saved, sent, approved or executed by the Call360 runtime.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ExplainTree } from './EntryRuleDrawer';
import { PROFILES, playback, scriptedAnswer, type SimProfile } from './model/demo';
import { fieldDef } from './model/engine';
import { buildFlow, validateSurvey } from './model/flow';
import { findModule, findSurvey } from './model/ops';
import { FIELDS, OUTCOME_CATALOG, OUTCOME_LABEL } from './model/sample';
import { firstDivergence, simulateInputs, type ModuleStatus, type Read, type SimAnswer, type SimEvent, type SimResult, type TerminalState } from './model/sim';
import { isQuestion, mKey, type Survey, type Workspace } from './model/types';
import { JourneyNav } from './JourneyNav';
import { StudioBar } from './StudioRoot';
import { useStudio } from './store';
import { Glyph, Tag, type GlyphName } from './ui';

const STATUS_TEXT: Record<ModuleStatus, string> = {
  ACTIVATED: 'Ran', RUNNING: 'Running now', SKIPPED_FALSE: 'Skipped · did not apply', SKIPPED_UNKNOWN: 'Skipped · information missing', SKIPPED_PRIOR_OUTCOME: 'Skipped · not triggered',
  SKIPPED_BY_ROUTE: 'Passed over by a jump', HALTED_MISSING_INFORMATION: 'Halted · information missing', NOT_REACHED: 'Not reached',
};
const STATUS_TONE: Record<ModuleStatus, string> = { ACTIVATED: 'ok', RUNNING: 'now', SKIPPED_FALSE: 'skip', SKIPPED_UNKNOWN: 'unknown', SKIPPED_PRIOR_OUTCOME: 'skip', SKIPPED_BY_ROUTE: 'skip', HALTED_MISSING_INFORMATION: 'halt', NOT_REACHED: 'none' };
/** The six ways a run can end are different facts and are named apart; none is shown as another. */
const TERMINAL: Record<TerminalState, { eyebrow: string; tone: string; kind: string }> = {
  COMPLETED: { eyebrow: 'End of the call', tone: 'ok', kind: 'A completed run.' },
  ENDED_WITH_OUTCOME: { eyebrow: 'End of the call', tone: 'alt', kind: 'The call ended early with a named outcome.' },
  MANDATORY_ESCALATION: { eyebrow: 'End of the call · mandatory escalation', tone: 'alt', kind: 'A mandatory escalation: the answer itself required it, whatever else was routed.' },
  REVIEW_REQUIRED: { eyebrow: 'Halted · pending review', tone: 'halt', kind: 'The governed outcome “Review required”: a module ran and ended with it. Not a completed run.' },
  MISSING_INFORMATION_HALT: { eyebrow: 'Halted · pending review', tone: 'halt', kind: 'A missing-information halt: whether a module applies could not be decided, so it never started. This is not a module outcome, and not a completed run.' },
  DRAFT_INVALID: { eyebrow: 'The draft cannot run', tone: 'blocked', kind: 'Not a result of a call: the draft itself is incomplete or invalid here.' },
};
const READ_TEXT: Record<Read['state'], string> = { KNOWN: 'known', MISSING: 'missing', ANSWERED: 'answered', ANSWERED_EMPTY: 'answered · nothing selected', UNANSWERED: 'asked · left unanswered', SKIPPED: 'not asked on this path' };
const fmtFact = (code: string, v: unknown) => {
  const f = fieldDef(code);
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return `${v.toLocaleString('en-SG')}${f?.unit ? ` ${f.unit}` : ''}`;
  const t = String(v);
  return t.length <= 3 ? t : t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, ' ');
};

export function SimulatorPage() {
  const { surveyId = '' } = useParams();
  const { ws } = useStudio();
  const [params, setParams] = useSearchParams();
  const survey = findSurvey(ws, surveyId);
  const profile = PROFILES.find((p) => p.id === params.get('profile')) ?? PROFILES[0]!;
  const other = PROFILES.find((p) => p.id === params.get('compare')) ?? null;
  const [inputs, setInputs] = useState<SimAnswer[]>([]);
  const [playing, setPlaying] = useState(false);
  // read from the address bar itself, which the router updates at once (its React state can follow a moment later):
  // two quick changes — customer, then comparison — must both land
  const set = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k); }
    setParams(p, { replace: true });
  };
  const result = useMemo(() => (survey ? simulateInputs(ws, survey, profile.facts, inputs) : null), [ws, survey, profile, inputs]);
  const issues = useMemo(() => (survey ? validateSurvey(ws, survey) : []), [ws, survey]);

  // full-run playback: one answer at a time, as this customer would give it
  useEffect(() => {
    if (!playing || !survey || !result) return undefined;
    if (!result.pending) { setPlaying(false); return undefined; }
    const key = result.pending.key;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = window.setTimeout(() => setInputs((i) => [...i, scriptedAnswer(ws, survey, profile, key)]), still ? 0 : 420);
    return () => window.clearTimeout(t);
  }, [playing, result, survey, ws, profile]);

  if (!survey || !result) {
    return (<><StudioBar crumbs={[{ label: 'Survey Studio', to: '/survey-studio' }, { label: 'Survey not found' }]} />
      <div className="ss-empty page"><p><strong>This survey is not in the prototype workspace.</strong> It may have been cleared by a reset.</p><Link className="ss-btn" to="/survey-studio">Back to Survey Studio</Link></div></>);
  }
  const choose = (id: string) => { setPlaying(false); setInputs([]); set({ profile: id }); };
  const step = () => { if (result.pending) setInputs([...inputs, scriptedAnswer(ws, survey, profile, result.pending.key)]); };
  const runAll = () => {
    setPlaying(false);
    const all = [...inputs];
    for (let i = 0; i < 400; i++) { const r = simulateInputs(ws, survey, profile.facts, all); if (!r.pending) break; all.push(scriptedAnswer(ws, survey, profile, r.pending.key)); }
    setInputs(all);
  };

  return (
    <>
      <StudioBar crumbs={[{ label: 'Survey Studio', to: '/survey-studio' }, { label: survey.name, to: `/survey-studio/surveys/${survey.id}` }, { label: 'Journey simulator' }]} badge={<Tag tone="draft">Draft v{survey.versionLabel}</Tag>} />
      <JourneyNav survey={survey} at="simulate" />
      <div className="ss-sim" data-testid="ss-sim">
        <header className="ss-sim-head">
          <div>
            <h1 className="ss-title">Journey simulator</h1>
            <p className="ss-sim-note" data-testid="ss-sim-notice"><Glyph name="info" size={14} /> A demonstration in your browser with invented customers. It is not the Call360 runtime: nothing here was executed, approved, saved or sent.</p>
          </div>
          <div className="ss-sim-head-tools">
            {issues.length ? <Link className="ss-tool warn" to={`/survey-studio/surveys/${survey.id}`} data-testid="ss-sim-draft-issues" title="The simulator stops where the draft is incomplete; it never guesses a route."><Glyph name="alert" size={14} /> {issues.length} to fix in this draft</Link> : null}
            <label className="ss-sim-compare"><span>Compare with</span>
              <select value={other?.id ?? ''} onChange={(e) => set({ compare: e.target.value || null })} data-testid="ss-sim-compare">
                <option value="">— one customer —</option>
                {PROFILES.filter((p) => p.id !== profile.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
          </div>
        </header>

        {other ? <Compare ws={ws} survey={survey} a={profile} b={other} onClose={() => set({ compare: null })} /> : (
          <div className="ss-sim-grid">
            <aside className="ss-sim-side" aria-label="Customer and modules">
              <section aria-labelledby="ss-sim-profile-h">
                <h2 id="ss-sim-profile-h">Synthetic customer</h2>
                <div className="ss-sim-profiles" role="radiogroup" aria-label="Synthetic customer">
                  {PROFILES.map((p) => (
                    <button key={p.id} type="button" role="radio" aria-checked={p.id === profile.id} className={`ss-sim-profile ${p.id === profile.id ? 'on' : ''}`} onClick={() => choose(p.id)} data-testid={`ss-sim-profile-${p.id}`}>
                      <strong>{p.name}</strong><small>{p.summary}</small></button>
                  ))}
                </div>
              </section>
              <section aria-labelledby="ss-sim-facts-h">
                <h2 id="ss-sim-facts-h">What is on record</h2>
                <dl className="ss-sim-facts" data-testid="ss-sim-facts">
                  {FIELDS.map((f) => { const v = fmtFact(f.code, profile.facts[f.code]); return <div key={f.code}><dt>{f.label}</dt><dd className={v === null ? 'missing' : ''}>{v ?? 'missing'}</dd></div>; })}
                </dl>
              </section>
              <ModuleList key={profile.id} result={result} />
            </aside>

            <main className="ss-sim-main" aria-label="The call">
              <Stage key={result.pending?.key ?? 'end'} ws={ws} survey={survey} result={result} canBack={inputs.length > 0} playing={playing}
                onAnswer={(a) => { setPlaying(false); setInputs([...inputs, a]); }} onStep={() => { setPlaying(false); step(); }}
                onBack={() => { setPlaying(false); setInputs(inputs.slice(0, -1)); }} onRestart={() => { setPlaying(false); setInputs([]); }}
                onPlay={() => setPlaying(!playing)} onRunAll={runAll} />
              <JustDecided result={result} />
              <WhatNext ws={ws} survey={survey} result={result} />
            </main>

            <aside className="ss-sim-timeline" aria-label="The journey so far">
              <h2>The journey so far</h2>
              <Timeline events={result.events} testId="ss-sim-timeline" />
              <details className="ss-sim-evidence" data-testid="ss-sim-evidence">
                <summary>Answers and evidence</summary>
                <p className="ss-muted">Every question of every module that ran. “Not asked on this path” is different from “left unanswered” and from “nothing selected”.</p>
                <table><thead><tr><th scope="col">Question</th><th scope="col">Answer</th><th scope="col">Stands as</th></tr></thead>
                  <tbody>{result.answerLines.map((l) => (
                    <tr key={l.key} className={`state-${l.state.toLowerCase()}`}><th scope="row">{l.number} <span>{l.text}</span></th><td>{l.given}</td>
                      <td>{l.state === 'NOT_REACHED' ? 'not reached yet' : READ_TEXT[l.state]}</td></tr>
                  ))}</tbody></table>
              </details>
            </aside>
          </div>
        )}
      </div>
    </>
  );
}

// ---- executed and skipped modules --------------------------------------------------------------------------------
function ModuleList({ result }: { result: SimResult }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-labelledby="ss-sim-modules-h">
      <h2 id="ss-sim-modules-h">Modules</h2>
      <ol className="ss-sim-modules" data-testid="ss-sim-modules">
        {result.modules.map((m) => (
          <li key={m.instance} className={`tone-${STATUS_TONE[m.status]}`} data-testid={`ss-sim-module-${m.instance}`}>
            <button type="button" aria-expanded={open === m.instance} onClick={() => setOpen(open === m.instance ? null : m.instance)}>
              <span className="ss-sim-mod-name">{m.name}</span>
              <span className="ss-sim-mod-status">{STATUS_TEXT[m.status]}{m.outcome ? ` · ${OUTCOME_LABEL[m.outcome]}` : ''}</span>
            </button>
            {open === m.instance ? <p className="ss-sim-mod-why" data-testid={`ss-sim-module-why-${m.instance}`}><strong>{m.status === 'ACTIVATED' || m.status === 'RUNNING' ? 'Why did this run?' : m.status === 'NOT_REACHED' ? 'Why was this not reached?' : 'Why was this skipped?'}</strong> {m.why}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---- what the customer hears, and the answer controls --------------------------------------------------------------
function Stage({ ws, survey, result, canBack, playing, onAnswer, onStep, onBack, onRestart, onPlay, onRunAll }: {
  ws: Workspace; survey: Survey; result: SimResult; canBack: boolean; playing: boolean;
  onAnswer: (a: SimAnswer) => void; onStep: () => void; onBack: () => void; onRestart: () => void; onPlay: () => void; onRunAll: () => void;
}) {
  const p = result.pending;
  const [choice, setChoice] = useState<string | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [otherText, setOtherText] = useState('');
  const lastReject = (() => { const e = result.events[result.events.length - 1]; return e && e.kind === 'REJECT' && p && e.key === p.key ? e : null; })();
  const controls = (
    <div className="ss-sim-controls" role="group" aria-label="Simulator controls">
      {p ? <button type="button" className="ss-btn" onClick={onStep} data-testid="ss-sim-step" title="Answer this question as this customer would">Step</button> : null}
      <button type="button" className="ss-btn" onClick={onBack} disabled={!canBack} data-testid="ss-sim-back" title="Take back the last answer">Back</button>
      <button type="button" className="ss-btn" onClick={onRestart} disabled={!canBack} data-testid="ss-sim-restart">Restart</button>
      {p ? <button type="button" className="ss-btn" onClick={onPlay} data-testid="ss-sim-play" aria-pressed={playing}>{playing ? 'Pause' : 'Play the whole call'}</button> : null}
      {p ? <button type="button" className="ss-link quiet" onClick={onRunAll} data-testid="ss-sim-run-all">Skip to the end</button> : null}
    </div>
  );
  if (!p) {
    const end = result.end!;
    const t = TERMINAL[end.status];
    const halted = end.status === 'REVIEW_REQUIRED' || end.status === 'MISSING_INFORMATION_HALT';
    const inst = end.where ? survey.sequence.find((x) => end.where!.startsWith(x.id)) : undefined;
    return (
      <section className={`ss-sim-stage end tone-${t.tone}`} aria-labelledby="ss-sim-stage-h" data-testid="ss-sim-end" data-terminal={end.status}>
        <p className="ss-sim-eyebrow"><Glyph name={end.status === 'COMPLETED' ? 'check' : 'stop'} size={14} /> {t.eyebrow}</p>
        <h2 id="ss-sim-stage-h" data-testid="ss-sim-end-headline">{end.headline}</h2>
        <p>{end.why}</p>
        <p className="ss-sim-fine" data-testid="ss-sim-terminal">{t.kind}</p>
        {halted ? <p className="ss-sim-fine" data-testid="ss-sim-review-note">Resuming, closing or resolving a halted call belongs to a separate review capability with its own permissions and audit trail. This prototype only shows where the call halts.</p> : null}
        {end.surveyOutcome && (end.status === 'ENDED_WITH_OUTCOME' || end.status === 'MANDATORY_ESCALATION') ? <p className="ss-sim-fine">{OUTCOME_LABEL[end.surveyOutcome]} is classified as {OUTCOME_CATALOG[end.surveyOutcome].cls === 'ESCALATION' ? 'an escalation' : 'an exception, not an escalation'}.</p> : null}
        {end.status === 'DRAFT_INVALID' && inst ? <Link className="ss-btn primary" to={`/survey-studio/surveys/${survey.id}/modules/${inst.id}`} data-testid="ss-sim-open-module"><Glyph name="open" size={14} /> Open {findModule(ws, mKey(inst.module))?.name} in the builder</Link> : null}
        {end.status === 'DRAFT_INVALID' ? <Link className="ss-btn" to={`/survey-studio/surveys/${survey.id}`} data-testid="ss-sim-open-survey">Open the survey</Link> : null}
        {controls}
      </section>
    );
  }
  const q = p.question;
  const answer: SimAnswer = q.answerType === 'FREE_TEXT' ? { text } : q.answerType === 'MULTI_SELECT' ? { choices } : { ...(choice ? { choice } : {}) };
  const hasOther = q.options.some((o) => o.isOther && (q.answerType === 'MULTI_SELECT' ? choices.includes(o.code) : choice === o.code));
  if (hasOther || otherText) answer.other_text = otherText;
  const sel = q.selection;
  return (
    <section className="ss-sim-stage" aria-labelledby="ss-sim-stage-h" data-testid="ss-sim-stage">
      <p className="ss-sim-eyebrow"><span className="ss-q-num">{p.number}</span> {p.module}{p.followup ? ' · follow-up question' : ''}</p>
      <p className="ss-sim-hears">The customer hears</p>
      <h2 id="ss-sim-stage-h" data-testid="ss-sim-question">{q.wording.text || 'Untitled question'}</h2>
      <form className="ss-sim-answer" onSubmit={(e) => { e.preventDefault(); onAnswer(answer); }}>
        {q.answerType === 'FREE_TEXT' ? (
          <label className="ss-field"><span>The customer says{q.textRule?.required === false ? ' (optional)' : ''}</span>
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} data-testid="ss-sim-text" /></label>
        ) : (
          <fieldset className="ss-sim-options">
            <legend>{q.answerType === 'MULTI_SELECT' ? `The customer chooses${sel ? ` (${sel.min} to ${sel.max})` : ' one or more'}` : 'The customer answers'}</legend>
            {q.options.map((o) => {
              const on = q.answerType === 'MULTI_SELECT' ? choices.includes(o.code) : choice === o.code;
              return (
                <label key={o.code} className={`ss-sim-option ${on ? 'on' : ''}`}>
                  <input type={q.answerType === 'MULTI_SELECT' ? 'checkbox' : 'radio'} name="ss-sim-answer" checked={on} data-testid={`ss-sim-opt-${o.code}`}
                    onChange={(e) => (q.answerType === 'MULTI_SELECT' ? setChoices(e.target.checked ? [...choices, o.code] : choices.filter((c) => c !== o.code)) : setChoice(o.code))} />
                  <span>{o.label}</span>
                  {o.interrupt === 'MANDATORY' ? <Tag tone="warn" glyph="stop">Must escalate</Tag> : null}
                  {o.exclusive ? <Tag>Only on its own</Tag> : null}
                </label>
              );
            })}
            {hasOther ? <label className="ss-field"><span>Please specify</span><input value={otherText} onChange={(e) => setOtherText(e.target.value)} data-testid="ss-sim-other-text" /></label> : null}
          </fieldset>
        )}
        {lastReject ? <p className="ss-issue" role="alert" data-testid="ss-sim-reject"><Glyph name="alert" size={14} /> Not accepted: {lastReject.message} The question is asked again.</p> : null}
        <div className="ss-sim-submit">
          <button type="submit" className="ss-btn primary" data-testid="ss-sim-answer">Give this answer</button>
          <span className="ss-muted">or press <strong>Step</strong> to answer as this customer would.</span>
        </div>
      </form>
      {p.queue ? (
        <div className="ss-sim-queue" data-testid="ss-sim-queue">
          <h3>Follow-up queue</h3>
          <ol>{p.queue.map((x) => <li key={x.node} className={x.state.toLowerCase()}><span>{x.state === 'DONE' ? 'Asked' : x.state === 'NOW' ? 'Now' : 'Next'}</span>{x.label}</li>)}</ol>
        </div>
      ) : null}
      {controls}
    </section>
  );
}

// ---- what the engine just decided, and why ------------------------------------------------------------------------
/** The decisions made since the previous answer: the route taken, any condition, any queue, any module boundary. */
function JustDecided({ result }: { result: SimResult }) {
  const ev = result.events;
  let from = ev.length - 1;
  while (from >= 0 && ev[from]!.kind !== 'ANSWER') from -= 1;
  const recent = ev.slice(from + 1).filter((e) => e.kind !== 'ASK' && e.kind !== 'REJECT' && e.kind !== 'END');
  if (!recent.length) return null;
  return (
    <section className="ss-sim-now" aria-labelledby="ss-sim-now-h" data-testid="ss-sim-decided">
      <h2 id="ss-sim-now-h">What the engine just decided</h2>
      <ul>{recent.map((e) => <li key={e.at}><EventBody e={e} open /></li>)}</ul>
    </section>
  );
}

/** For a simple question: where each possible answer leads — so "what happens next" is visible before answering. */
function WhatNext({ ws, survey, result }: { ws: Workspace; survey: Survey; result: SimResult }) {
  const p = result.pending;
  if (!p) return null;
  const inst = survey.sequence.find((x) => x.id === p.instance)!;
  const m = findModule(ws, mKey(inst.module))!;
  const node = m.nodes.find((x) => x.id === p.node);
  if (!node || !isQuestion(node)) return null;
  const numbers = buildFlow(ws, m).numbers;
  const q = p.question;
  const name = (t: unknown): string => {
    const x = t as { node?: string; outcome?: keyof typeof OUTCOME_LABEL; ret?: boolean } | undefined;
    if (!x) return 'not decided in the draft — the simulator would stop';
    if (x.ret) return 'back to the follow-up queue';
    if (x.outcome) return x.outcome === 'REVIEW_REQUIRED' ? 'stop: review required' : `the module ends: ${OUTCOME_LABEL[x.outcome]}`;
    const n = m.nodes.find((y) => y.id === x.node);
    return n && !isQuestion(n) ? `the condition ${numbers.get(x.node!)}` : `${numbers.get(x.node!)}`;
  };
  const r = node.routing;
  const lines: Array<[string, string]> = p.followup ? [['Any answer', 'back to the follow-up queue (or the module ends, if that answer is routed to an outcome)']]
    : r.mode === 'SEQUENTIAL_FOLLOWUPS' ? [['Each selected answer', 'may add a follow-up question; they are asked in the configured order, then the journey rejoins']]
      : r.mode === 'ORDERED_RULES' ? [['The selection', `is checked against ${r.rules?.length ?? 0} rule${r.rules?.length === 1 ? '' : 's'} from the top; the first that fits decides`]]
        : q.answerType === 'YES_NO' || q.answerType === 'SINGLE_SELECT'
          ? q.options.map((o) => [o.label, name((m.edges.find((x) => x.from === node.id && x.on === o.code) ?? m.edges.find((x) => x.from === node.id && x.on === 'ANY'))?.to)] as [string, string])
          : [['Any answer', name(m.edges.find((x) => x.from === node.id && (x.on === 'ANY' || x.on === 'AFTER_CAPTURE'))?.to)]];
  return (
    <section className="ss-sim-next" aria-labelledby="ss-sim-next-h" data-testid="ss-sim-next">
      <h2 id="ss-sim-next-h">What happens next</h2>
      <dl>{lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd><Glyph name="right" size={12} /> {v}</dd></div>)}</dl>
    </section>
  );
}

// ---- the timeline ----------------------------------------------------------------------------------------------------
const ICON: Record<SimEvent['kind'], GlyphName> = { ENTRY: 'flow', ASK: 'text', ANSWER: 'check', REJECT: 'alert', ROUTE: 'right', DECISION: 'branch', QUEUE: 'list', MODULE_END: 'merge', SURVEY_ROUTE: 'next', DISPOSITION: 'next', END: 'stop' };
const headline = (e: SimEvent): string =>
  (e.kind === 'ASK' ? `${e.number} asked: ${e.text}` : e.kind === 'ANSWER' ? `Customer: ${e.given}` : e.kind === 'REJECT' ? `Not accepted (${e.given}): ${e.message}` : e.headline);
const tone = (e: SimEvent): string =>
  (e.kind === 'ENTRY' ? (e.status === 'ACTIVATED' ? 'ok' : e.status === 'HALTED_MISSING_INFORMATION' ? 'halt' : e.status === 'SKIPPED_UNKNOWN' ? 'unknown' : 'skip')
    : e.kind === 'DECISION' ? (e.result === 'UNKNOWN' ? 'unknown' : 'plain') : e.kind === 'REJECT' ? 'unknown' : e.kind === 'QUEUE' && e.interrupt?.outcome ? 'halt'
      : e.kind === 'END' ? (TERMINAL[e.status].tone === 'blocked' ? 'halt' : TERMINAL[e.status].tone) : e.kind === 'DISPOSITION' ? 'skip' : e.kind === 'ANSWER' ? 'answer' : 'plain');

function Reads({ reads }: { reads: Read[] }) {
  if (!reads.length) return null;
  return (
    <table className="ss-sim-reads"><caption>What was read</caption>
      <tbody>{reads.map((r, i) => <tr key={i} className={`state-${r.state.toLowerCase()}`}><th scope="row">{r.what}</th><td>{r.value}</td><td>{READ_TEXT[r.state] === r.value ? '' : READ_TEXT[r.state]}</td></tr>)}</tbody></table>
  );
}

function EventBody({ e, open = false }: { e: SimEvent; open?: boolean }) {
  const [more, setMore] = useState(open);
  const why = 'why' in e ? e.why : '';
  const has = !!why || (e.kind === 'ANSWER' && e.state !== 'ANSWERED');
  return (
    <div className={`ss-sim-event kind-${e.kind.toLowerCase()} tone-${tone(e)}`} data-testid={`ss-sim-event-${e.at}`} data-kind={e.kind}>
      <div className="ss-sim-event-line">
        <span className="ss-sim-event-icon" aria-hidden="true"><Glyph name={ICON[e.kind]} size={13} /></span>
        <span className="ss-sim-event-text">{headline(e)}{e.kind === 'ANSWER' && e.state !== 'ANSWERED' ? <em> · {READ_TEXT[e.state]}</em> : null}</span>
        {has && !open ? <button type="button" className="ss-link quiet" aria-expanded={more} onClick={() => setMore(!more)} data-testid={`ss-sim-why-${e.at}`}>{more ? 'Hide' : 'Why?'}</button> : null}
      </div>
      {more && has ? (
        <div className="ss-sim-why">
          {why ? <p>{why}</p> : null}
          {(e.kind === 'ENTRY' || e.kind === 'DECISION') && e.reads ? <Reads reads={e.reads} /> : null}
          {(e.kind === 'ENTRY' || e.kind === 'DECISION') && e.explain ? (
            <details><summary>How the result was worked out</summary><ExplainTree e={e.explain} /></details>
          ) : null}
          {e.kind === 'QUEUE' ? (
            <>
              {e.queued.length ? <p>Queued: {e.queued.map((x, i) => `${i + 1}. ${x.label} (because of “${x.because}”)`).join(' · ')}</p> : null}
              {e.deduped.length ? <p>Asked once, though two selected answers lead to it: {e.deduped.join(' · ')}</p> : null}
              {e.interrupt?.skipped.length ? <p>Not asked because the queue was stopped: {e.interrupt.skipped.join(' · ')}</p> : null}
              {!e.interrupt?.outcome && e.notAsked.length ? <p>Not asked, because their answers were not selected: {e.notAsked.join(' · ')}</p> : null}
            </>
          ) : null}
          {(e.kind === 'ROUTE' || e.kind === 'DECISION') && e.notChosen.length ? (
            <details open={open}><summary>Why not another route</summary><ul>{e.notChosen.map((t, i) => <li key={i}>{t}</li>)}</ul></details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Timeline({ events, testId, mark, dimBefore }: { events: SimEvent[]; testId: string; mark?: number; dimBefore?: number }) {
  const end = useRef<HTMLLIElement | null>(null);
  useEffect(() => { if (mark === undefined) end.current?.scrollIntoView({ block: 'nearest' }); }, [events.length, mark]);
  let last = '';
  return (
    <ol className="ss-sim-events" data-testid={testId}>
      {events.map((e, i) => {
        const head = e.instance !== last && e.kind !== 'END' ? e.module : null;
        last = e.instance;
        return (
          <li key={e.at} ref={i === events.length - 1 ? end : undefined} className={`${mark === i ? 'diverge' : ''} ${dimBefore !== undefined && i < dimBefore ? 'same' : ''}`} data-step={i}>
            {head ? <h3 className="ss-sim-module-head">{head}</h3> : null}
            <EventBody e={e} open={mark === i} />
          </li>
        );
      })}
    </ol>
  );
}

// ---- two customers side by side ----------------------------------------------------------------------------------------
function Compare({ ws, survey, a, b, onClose }: { ws: Workspace; survey: Survey; a: SimProfile; b: SimProfile; onClose: () => void }) {
  const ra = useMemo(() => playback(ws, survey, a), [ws, survey, a]);
  const rb = useMemo(() => playback(ws, survey, b), [ws, survey, b]);
  const at = firstDivergence(ra.events, rb.events);
  const box = useRef<HTMLDivElement | null>(null);
  const jump = () => box.current?.querySelectorAll<HTMLElement>(`li[data-step="${at}"]`).forEach((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  const ea = at >= 0 ? ra.events[at] : undefined, eb = at >= 0 ? rb.events[at] : undefined;
  const facts = FIELDS.filter((f) => a.facts[f.code] !== b.facts[f.code]);
  const say = (e?: SimEvent) => (e ? `${headline(e)}${'why' in e && e.why ? ` — ${e.why}` : ''}` : 'the call had already ended');
  return (
    <div className="ss-sim-compare-view" ref={box} data-testid="ss-sim-compare-view">
      <section className="ss-sim-diverge" aria-labelledby="ss-sim-div-h" data-testid="ss-sim-divergence">
        <h2 id="ss-sim-div-h">{at < 0 ? 'These two customers have the same journey' : `The same for the first ${at} step${at === 1 ? '' : 's'}, then they part`}</h2>
        {at >= 0 ? (
          <>
            <dl>
              <div><dt>{a.name}</dt><dd data-testid="ss-sim-div-a">{say(ea)}</dd></div>
              <div><dt>{b.name}</dt><dd data-testid="ss-sim-div-b">{say(eb)}</dd></div>
            </dl>
            {facts.length ? <p className="ss-muted" data-testid="ss-sim-div-facts">On record, they differ in: {facts.map((f) => `${f.label} (${fmtFact(f.code, a.facts[f.code]) ?? 'missing'} / ${fmtFact(f.code, b.facts[f.code]) ?? 'missing'})`).join(' · ')}.</p> : <p className="ss-muted">Their records are the same; they differ in what they answer.</p>}
            <div className="ss-actions">
              <button type="button" className="ss-btn primary" onClick={jump} data-testid="ss-sim-jump">Jump to the first difference</button>
              <button type="button" className="ss-btn" onClick={onClose}>Back to one customer</button>
            </div>
          </>
        ) : <button type="button" className="ss-btn" onClick={onClose}>Back to one customer</button>}
        <p className="ss-muted">Both journeys are played to the end with each customer’s own answers.</p>
      </section>
      <div className="ss-sim-columns">
        {([[a, ra, 'a'], [b, rb, 'b']] as Array<[SimProfile, SimResult, string]>).map(([p, r, id]) => (
          <section key={id} className="ss-sim-column" aria-label={`Journey of ${p.name}`} data-testid={`ss-sim-col-${id}`}>
            <header><h3>{p.name}</h3><p className="ss-muted">{p.summary}</p>
              <p className={`ss-sim-col-end tone-${r.end ? (TERMINAL[r.end.status].tone === 'blocked' ? 'halt' : TERMINAL[r.end.status].tone) : 'halt'}`} data-testid={`ss-sim-col-end-${id}`}>{r.end?.headline}</p></header>
            <Timeline events={r.events} testId={`ss-sim-col-timeline-${id}`} mark={at >= 0 ? at : -2} dimBefore={at >= 0 ? at : r.events.length} />
          </section>
        ))}
      </div>
    </div>
  );
}
