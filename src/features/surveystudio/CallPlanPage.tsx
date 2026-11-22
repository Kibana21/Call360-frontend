// Survey Studio prototype (UC-01, made compact and split into two questions in UC-02) — CALL PLAN PREVIEW.
// Two different questions are answered apart and never merged:
//   A. Can a technical plan be computed from this application's data?
//   B. Is this survey authorised and eligible for an operational callback?  (A draft that plans perfectly is still "no".)
// Below them, three things stay apart: (1) settled before the call, (2) still conditional, (3) actually delivered in one
// simulated run. Everything long is closed until asked for. A browser demonstration on invented data: no call is
// assembled, approved or made.
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { JourneyNav } from './JourneyNav';
import { ITEM_LABEL, ROLE_LABEL, STATEMENT_LABEL } from './labels';
import { PROFILES, playback } from './model/demo';
import { govOf } from './model/governance';
import { findSurvey } from './model/ops';
import { buildCallPlan, liveEligibility, type ConditionState, type PlanItem, type PlanModule } from './model/plan';
import type { QuestionRole, StatementRole } from './model/types';
import { DELIVERY_LABEL } from './model/wording';
import { StudioBar } from './StudioRoot';
import { ServerCallPlan } from './persist/ServerCallPlan';
import { useStudio } from './store';
import { Glyph, Tag } from './ui';

const STATUS: Record<PlanModule['status'], { label: string; tone: string; glyph: 'check' | 'close' | 'branch' | 'stop' }> = {
  IN: { label: 'Included', tone: 'in', glyph: 'check' },
  OUT: { label: 'Excluded', tone: 'out', glyph: 'close' },
  CONDITIONAL: { label: 'Conditional', tone: 'cond', glyph: 'branch' },
  HALTS: { label: 'Cannot be decided', tone: 'halt', glyph: 'stop' },
};
const COND: Record<ConditionState, { label: string; tone: string; glyph: 'check' | 'close' | 'lock' }> = {
  MET: { label: 'Met', tone: 'met', glyph: 'check' },
  NOT_MET: { label: 'Not met', tone: 'notmet', glyph: 'close' },
  NOT_AVAILABLE: { label: 'Cannot be established here', tone: 'na', glyph: 'lock' },
};
const roleText = (i: PlanItem) => (i.statement ? `${STATEMENT_LABEL[(i.role ?? 'TRANSITION') as StatementRole]} statement` : i.role ? ROLE_LABEL[i.role as QuestionRole] : ITEM_LABEL[i.type]);

/** A heading that opens and closes the region beneath it. Closed regions are not rendered at all. */
function Fold({ id, open, onToggle, children, summary }: { id: string; open: boolean; onToggle: () => void; summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <button type="button" className="ss-fold" aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle} data-testid={`${id}-toggle`}>
        <Glyph name={open ? 'up' : 'down'} size={13} /> {summary}
      </button>
      {open ? <div id={`${id}-body`} className="ss-fold-body" data-testid={`${id}-body`}>{children}</div> : null}
    </>
  );
}

export function CallPlanPage() {
  const { surveyId = '' } = useParams();
  const { ws, gov, persisted } = useStudio();
  const [params, setParams] = useSearchParams();
  const survey = findSurvey(ws, surveyId);
  const profile = PROFILES.find((p) => p.id === params.get('profile')) ?? PROFILES[0]!;
  const plan = useMemo(() => (survey ? buildCallPlan(ws, survey, profile.facts) : null), [ws, survey, profile]);
  const live = useMemo(() => (survey && plan ? liveEligibility(ws, survey, govOf(gov, survey.id), plan) : null), [ws, gov, survey, plan]);
  const run = useMemo(() => (survey ? playback(ws, survey, profile) : null), [ws, survey, profile]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!survey || !plan || !run || !live) return <div className="ss-page"><p>This survey no longer exists. <Link to="/survey-studio">Back to the library</Link></p></div>;
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const base = `/survey-studio/surveys/${survey.id}`;
  const runnable = plan.modules.filter((m) => m.status !== 'OUT');
  const moduleIds = runnable.map((m) => `ss-plan-module-${m.instance}`);
  const allOpen = moduleIds.length > 0 && moduleIds.every((id) => open.has(id));
  const missingInputs = plan.inputs.filter((i) => i.state !== 'PRESENT');
  const wordingIssues = plan.issues.filter((i) => i.code === 'WORDING_VALUE_MISSING');
  const openPoints = runnable.flatMap((m) => m.open.map((o) => ({ ...o, module: m.name })));
  const computable = plan.status === 'READY';
  // SS-03B: with saved surveys the server's plan of the published version is the authority; the draft's is a preview
  const onServer = persisted && params.get('engine') !== 'draft';
  const engine = (v: string | null) => { const next = new URLSearchParams(params); if (v) next.set('engine', v); else next.delete('engine'); setParams(next, { replace: true }); };
  return (
    <>
      <StudioBar crumbs={[{ label: 'Survey Studio', to: '/survey-studio' }, { label: survey.name, to: base }, { label: 'Call plan preview' }]} badge={<Tag tone="draft">Draft v{survey.versionLabel}</Tag>} />
      <JourneyNav survey={survey} at="simulate" compact />
      <div className="ss-plan" data-testid="ss-plan">
        <header className="ss-plan-head">
          <div>
            <h1 className="ss-title">Call plan preview</h1>
            <p className="ss-sim-note" data-testid="ss-plan-notice"><Glyph name="info" size={14} /> {onServer ? 'The plan of the published version, assembled by the Call360 server on an invented application.' : persisted ? 'A preview of your draft, computed in your browser on an invented application. It is not the Call360 engine.' : 'A demonstration in your browser on an invented application.'} No call is assembled, approved or made.</p>
          </div>
          <div className="ss-plan-tools">
            <label className="ss-field inline"><span>Synthetic application</span>
              <select value={profile.id} onChange={(e) => { const next = new URLSearchParams(params); next.set('profile', e.target.value); setParams(next, { replace: true }); }} data-testid="ss-plan-profile">
                {PROFILES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
            <Link className="ss-btn" to={`${base}/simulate?profile=${profile.id}`} data-testid="ss-plan-simulate">Run in the simulator</Link>
          </div>
        </header>

        {persisted ? (
          <div className="ss-seg" role="group" aria-label="Which plan" data-testid="ss-plan-engine">
            <button type="button" className={onServer ? 'on' : ''} aria-pressed={onServer} onClick={() => engine(null)} data-testid="ss-plan-engine-server">Published version · Call360 server</button>
            <button type="button" className={onServer ? '' : 'on'} aria-pressed={!onServer} onClick={() => engine('draft')} data-testid="ss-plan-engine-draft">Draft · browser preview</button>
          </div>
        ) : null}
        {onServer ? <ServerCallPlan profile={profile} base={base} /> : <>
        <dl className="ss-plan-identity" data-testid="ss-plan-identity">
          <div><dt>Survey</dt><dd>{survey.name} · draft v{survey.versionLabel}</dd></div>
          <div><dt>Application</dt><dd>{profile.name} — {profile.summary}</dd></div>
          <div><dt>Plan fingerprint</dt><dd className="ss-code" data-testid="ss-plan-hash">{plan.hash}</dd></div>
        </dl>

        {/* the two questions, side by side and never merged */}
        <div className="ss-plan-two">
          <section className={`ss-plan-q ${computable ? 'yes' : 'no'}`} aria-labelledby="ss-plan-a-h" data-testid="ss-plan-verdict" data-status={plan.status}>
            <p className="ss-plan-q-label">A · Can a plan be computed from this data?</p>
            <h2 id="ss-plan-a-h"><Glyph name={computable ? 'check' : 'stop'} size={18} /> {computable ? 'Yes — a plan can be computed' : 'No — the plan cannot be completed'}</h2>
            {computable ? <p>Every item this customer could hear can be worded, and every module can be decided from the application.</p>
              : <ul className="ss-plan-blockers" data-testid="ss-plan-blockers">{plan.blockers.map((b) => <li key={b}><Glyph name="alert" size={14} /> {b}</li>)}</ul>}
            <p className="ss-muted">This is a technical answer only. It says nothing about whether the survey may be used on a call.</p>
          </section>
          <section className="ss-plan-q no" aria-labelledby="ss-plan-b-h" data-testid="ss-plan-live" data-eligible={live.eligible ? 'yes' : 'no'}>
            <p className="ss-plan-q-label">B · May this be used on an operational callback?</p>
            <h2 id="ss-plan-b-h"><Glyph name="stop" size={18} /> {live.eligible ? 'Eligible' : 'No — not eligible for a real call'}</h2>
            <p data-testid="ss-plan-live-count">{live.met} of {live.conditions.length} conditions met · {live.notMet} not met · {live.notAvailable} cannot be established here.</p>
            <ul className="ss-plan-conds" data-testid="ss-plan-conditions">
              {live.conditions.map((c) => (
                <li key={c.id} className={COND[c.state].tone} data-testid={`ss-plan-cond-${c.id}`} data-state={c.state}>
                  <Glyph name={COND[c.state].glyph} size={13} /><span>{c.label}</span><em>{c.group === 'GATES' ? (c.state === 'MET' ? 'Present' : 'Not present') : COND[c.state].label}</em>
                  {open.has('conds') ? <small>{c.detail}</small> : null}
                </li>
              ))}
            </ul>
            <p className="ss-plan-gate-note" data-testid="ss-plan-gate-note"><Glyph name="info" size={13} /> “Present” means only that the gate question is in the survey. It does not mean that what the call does after a “no”, a refusal or silence is approved — that is a separate condition, and it is not met.</p>
            <button type="button" className="ss-link quiet" aria-expanded={open.has('conds')} onClick={() => toggle('conds')} data-testid="ss-plan-conds-toggle">{open.has('conds') ? 'Hide the reasons' : 'Show the reason for each'}</button>
          </section>
        </div>

        <dl className="ss-plan-counts" data-testid="ss-plan-counts">
          <div><dt>Modules included</dt><dd data-testid="ss-plan-in">{plan.counts.modulesIn}</dd></div>
          <div><dt>Excluded</dt><dd data-testid="ss-plan-out">{plan.counts.modulesOut}</dd></div>
          <div><dt>Conditional or undecided</dt><dd data-testid="ss-plan-cond">{plan.counts.modulesConditional}</dd></div>
          <div className={missingInputs.length ? 'warn' : ''}><dt>Missing inputs</dt><dd data-testid="ss-plan-missing">{missingInputs.length}</dd></div>
          <div className={wordingIssues.length ? 'warn' : ''}><dt>Wording issues</dt><dd data-testid="ss-plan-wording">{wordingIssues.length}</dd></div>
          <div><dt>Unresolved answer branches</dt><dd data-testid="ss-plan-open-count">{openPoints.length}</dd></div>
        </dl>

        <section className="ss-plan-section" aria-labelledby="ss-plan-inputs-h">
          <Fold id="ss-plan-inputs" open={open.has('inputs')} onToggle={() => toggle('inputs')}
            summary={<><strong id="ss-plan-inputs-h">Application data used</strong><span>{plan.inputs.length} field{plan.inputs.length === 1 ? '' : 's'}{missingInputs.length ? ` · ${missingInputs.map((i) => i.label).join(', ')} missing or not usable` : ' · all present'}</span></>}>
            <table className="ss-plan-table">
              <thead><tr><th scope="col">Field</th><th scope="col">Value</th><th scope="col">State</th><th scope="col">Used for</th></tr></thead>
              <tbody>{plan.inputs.map((i) => (
                <tr key={i.code} className={`state-${i.state.toLowerCase()}`} data-testid={`ss-plan-input-${i.code}`}>
                  <th scope="row">{i.label}</th><td>{i.value}</td><td>{i.state === 'PRESENT' ? 'Present' : i.state === 'MISSING' ? 'Missing' : 'Not usable'}</td><td>{i.usedBy.join(' · ')}</td>
                </tr>))}</tbody>
            </table>
          </Fold>
        </section>

        <section className="ss-plan-section" aria-labelledby="ss-plan-modules-h">
          <div className="ss-plan-section-head">
            <h2 id="ss-plan-modules-h">1 · Settled before the call</h2>
            {moduleIds.length ? <button type="button" className="ss-link quiet" onClick={() => setOpen((s) => { const n = new Set(s); for (const id of moduleIds) if (allOpen) n.delete(id); else n.add(id); return n; })} data-testid="ss-plan-expand-all">{allOpen ? 'Close all' : 'Show all wording'}</button> : null}
          </div>
          <ul className="ss-plan-modules">
            {plan.modules.map((m, k) => {
              const st = STATUS[m.status];
              const id = `ss-plan-module-${m.instance}`;
              const bad = m.items.filter((i) => i.text === null).length;
              const head = (
                <>
                  <span className="ss-q-num">{k + 1}</span><strong>{m.name}</strong>
                  <span className={`ss-plan-status ${st.tone}`}><Glyph name={st.glyph} size={13} /> {st.label}</span>
                  <span className="ss-plan-why">{m.why}</span>
                  {m.items.length ? <span className="ss-plan-n">{m.items.length} item{m.items.length === 1 ? '' : 's'}{bad ? ` · ${bad} cannot be worded` : ''}</span> : null}
                </>
              );
              return (
                <li key={m.instance} className={`ss-plan-module ${st.tone}`} data-testid={id} data-status={m.status}>
                  {m.items.length ? (
                    <Fold id={id} open={open.has(id)} onToggle={() => toggle(id)} summary={head}>
                      <ol className="ss-plan-items">
                        {m.items.map((i) => (
                          <li key={i.key} className={`${i.statement ? 'statement' : 'question'} ${i.text === null ? 'error' : ''}`} data-testid={`ss-plan-item-${i.key}`}>
                            <div className="ss-plan-item-head">
                              <span className={`ss-q-num ${i.statement ? 'stmt' : ''}`}>{i.number}</span>
                              <span className="ss-q-type"><Glyph name={i.statement ? 'say' : 'text'} size={13} /> {roleText(i)}</span>
                              {i.mandatory ? <Tag>Mandatory</Tag> : null}
                              <span className={`ss-plan-certainty ${i.certainty === 'ALWAYS' ? 'always' : 'some'}`}>{i.certainty === 'ALWAYS' ? 'On every path' : 'Only on some paths'}</span>
                            </div>
                            {i.text !== null ? <p className="ss-plan-text">{i.text || <em>(no text yet)</em>}</p>
                              : <p className="ss-issue" role="alert"><Glyph name="alert" size={14} /> Cannot be delivered: {i.errors.join(' ')}</p>}
                            <p className="ss-muted">{DELIVERY_LABEL[i.delivery]} · wording v{i.wordingVersion} · not approved{i.values.length ? ` · from the application: ${i.values.map((v) => `${v.label} = ${v.value ?? 'missing'}`).join(', ')}` : ''}</p>
                          </li>
                        ))}
                      </ol>
                    </Fold>
                  ) : <div className="ss-fold static">{head}</div>}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="ss-plan-section" aria-labelledby="ss-plan-open-h">
          <Fold id="ss-plan-open" open={open.has('open')} onToggle={() => toggle('open')}
            summary={<><strong id="ss-plan-open-h">2 · Still conditional — decided by answers during the call</strong><span>{openPoints.length ? `${openPoints.length} point${openPoints.length === 1 ? '' : 's'} the plan leaves open` : 'nothing is open'}</span></>}>
            {openPoints.length ? (
              <dl className="ss-plan-open">
                {openPoints.map((o) => (
                  <div key={o.key} data-testid={`ss-plan-open-${o.key}`}>
                    <dt>{o.module} · {o.title}</dt>
                    <dd>{o.alternatives.map((a, n) => <span key={n}>{a.when} <Glyph name="right" size={12} /> {a.leads}</span>)}</dd>
                  </div>
                ))}
              </dl>
            ) : <p className="ss-quiet">Every customer with this data follows one path.</p>}
            <p className="ss-muted">The plan lists the alternatives. It does not choose between them.</p>
          </Fold>
        </section>

        <section className="ss-plan-section" aria-labelledby="ss-plan-said-h">
          <Fold id="ss-plan-said" open={open.has('said')} onToggle={() => toggle('said')}
            summary={<><strong id="ss-plan-said-h">3 · Actually delivered — one simulated run</strong><span data-testid="ss-plan-said-end" data-terminal={run.end?.status ?? 'PENDING'}>{run.deliveries.length} item{run.deliveries.length === 1 ? '' : 's'} delivered · {run.end?.headline ?? 'not finished'}</span></>}>
            <p className="ss-muted" data-testid="ss-plan-said-note">Not part of the plan. This is what one simulated call delivered, with this invented customer giving the answers set for them. A different answer gives a different call from the same plan.</p>
            <ol className="ss-plan-said" data-testid="ss-plan-said">
              {run.deliveries.map((d) => {
                const a = run.events.find((e) => e.kind === 'ANSWER' && e.key === d.item_instance);
                return <li key={d.item_instance} className={d.statement ? 'statement' : 'question'}><span className="ss-plan-text">{d.text}</span>{a && a.kind === 'ANSWER' ? <span className="ss-plan-answer">Customer: {a.given}</span> : null}</li>;
              })}
            </ol>
          </Fold>
        </section>
        </>}
      </div>
    </>
  );
}
