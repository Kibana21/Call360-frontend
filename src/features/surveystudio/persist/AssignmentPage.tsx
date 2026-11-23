// Survey Studio (ASG-1) — which published survey the existing assignment rules select for a synthetic application.
// SIMULATION ONLY. The rules themselves are authored, approved and published in Assignment Rules, unchanged; this
// page only shows them, lets three different people bind a published rule to a published survey version, and asks the
// server to select, plan and simulate. It decides nothing itself and assigns nothing to any customer.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiFailure } from '../../../api/client';
import { useAuth } from '../../../auth/AuthContext';
import { PROFILES } from '../model/demo';
import { Glyph, Tag } from '../ui';
import { listSurveys } from './api';
import { CompositeResult, GroupsSection } from './AssignmentGroups';
import {
  composePlan, getCompositePlan, getGroups, decideBinding, evaluateAssignment, getAssignmentOptions, getAssignmentPolicy, getEvaluation, proposeBinding, publishBinding, simulateEvaluation, withdrawBinding,
  type AssignmentBinding, type AssignmentEvaluation, type AssignmentGroup, type CompositePlan, type AssignmentField, type AssignmentInputs, type AssignmentPolicy, type AssignmentRule,
} from './assignmentApi';
import { getHistory, short, when } from './reviewApi';
import type { PyPlan } from './serverRun';
import type { Facts } from './simApi';

const RULE_TEXT: Record<string, string> = {
  SELF_REVIEW_DENIED: 'You proposed this binding. The person who proposes cannot approve or reject it, whatever permissions they hold.',
  SELF_PUBLISH_DENIED: 'You proposed this binding. The proposer cannot publish it: a third person must.',
  APPROVER_PUBLISH_DENIED: 'You approved this binding. The approver cannot publish it: a third person must.',
  BINDING_OPEN: 'This rule already has a binding waiting for a decision or publication.',
  VERSION_NOT_PUBLISHED: 'That survey version is not the currently published version.',
  RULE_NOT_PUBLISHED: 'That rule version is no longer published.',
  MARKET_MISMATCH: 'The rule and the survey belong to different markets.',
};
const say = (e: unknown) => (e instanceof ApiFailure ? ((e.code && RULE_TEXT[e.code]) || (e.status === 403 ? 'You do not have permission for this.' : e.status === 404 ? 'Survey assignment is not available on this server, or this is outside your market.' : e.message)) : 'The server could not be reached.');
const SELECTION: Record<string, { tone: string; title: string }> = {
  MATCHED: { tone: 'yes', title: 'A survey version was selected' },
  NO_MATCH: { tone: 'no', title: 'No rule matches: no survey was selected' },
  AMBIGUOUS: { tone: 'no', title: 'Ambiguous: rules of equal precedence match, so none was chosen' },
  UNKNOWN_INPUT: { tone: 'no', title: 'An input is not known: no survey was selected' },
  TARGET_UNAVAILABLE: { tone: 'no', title: 'The winning rule has no usable survey version: nothing was selected' },
};
const STATUS: Record<string, string> = { PROPOSED: 'Proposed', APPROVED: 'Approved', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn', PUBLISHED: 'Published', SUPERSEDED: 'Superseded' };
const MODULE: Record<string, string> = { IN: 'Included', OUT: 'Excluded', CONDITIONAL: 'Conditional', HALTS: 'Cannot be decided' };
const shown = (v: unknown) => (v === null || v === undefined ? 'not known' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : String(v));
interface PublishedVersion { id: string; label: string; survey_code: string; survey_name: string }
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- the decision trace is read as JSON

export function AssignmentPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [policy, setPolicy] = useState<AssignmentPolicy | null>(null);
  const [fields, setFields] = useState<AssignmentField[]>([]);
  const [versions, setVersions] = useState<PublishedVersion[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inputs, setInputs] = useState<AssignmentInputs>({});
  const profile = PROFILES.find((p) => p.id === params.get('profile')) ?? PROFILES[0]!;
  const [result, setResult] = useState<AssignmentEvaluation | null>(null);
  const evaluationId = params.get('evaluation');
  // ASG-2A: requirement groups, when this server offers them (null = not switched on: single-survey assignment only)
  const [groups, setGroups] = useState<AssignmentGroup[] | null>(null);
  const [composite, setComposite] = useState<CompositePlan | null>(null);
  const compositeId = params.get('composite');
  // a recorded result still loading from its link must never replace a newer one the person has just asked for
  const asked = useRef(0);

  const allowed = can('survey.assignment.read');
  const load = useCallback(() => { if (allowed) { getAssignmentPolicy().then(setPolicy).catch((e) => setFailed(say(e))); getGroups().then(setGroups).catch(() => setGroups(null)); } }, [allowed]);
  useEffect(() => {
    if (!allowed) return;
    load();
    getAssignmentOptions().then((f) => {
      setFields(f);
      // a starting application: the first governed value of every field, so every input the rules read is known
      setInputs((cur) => (Object.keys(cur).length ? cur : Object.fromEntries(f.map((x) => [x.field, x.field === 'contact_role' ? (x.values[0] ? [String(x.values[0].value)] : []) : x.values[0]?.value ?? null]))));
    }).catch(() => undefined);
    (async () => {
      const out: PublishedVersion[] = [];
      for (const s of (await listSurveys()).filter((x) => x.latest_version_label)) {
        const v = (await getHistory(s.id)).versions.find((x) => x.status === 'PUBLISHED');
        if (v) out.push({ id: v.id, label: v.label, survey_code: s.code, survey_name: s.name });
      }
      setVersions(out);
    })().catch(() => undefined);
  }, [load, allowed]);
  // a recorded selection opened by its link: its inputs, decision, plan and simulations, exactly as recorded
  useEffect(() => { if (allowed && evaluationId && result?.id !== evaluationId) { const mine = asked.current; getEvaluation(evaluationId).then((e) => { if (mine !== asked.current) return; setResult(e); setInputs(e.assignment_inputs as AssignmentInputs); }).catch((e) => setError(say(e))); } }, [evaluationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (allowed && compositeId && composite?.id !== compositeId) { const mine = asked.current; getCompositePlan(compositeId).then((c) => { if (mine !== asked.current) return; setComposite(c); setInputs((c.composite as Any).application.assignment_inputs as AssignmentInputs); }).catch((e) => setError(say(e))); } }, [compositeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const compose = () => {
    asked.current += 1;
    setBusy(true); setError(null); setResult(null);
    composePlan(inputs, profile.facts as Facts).then((c) => { setComposite(c); const p = new URLSearchParams(params); p.set('composite', c.id); p.delete('evaluation'); setParams(p, { replace: true }); })
      .catch((e) => { setComposite(null); setError(say(e)); }).finally(() => setBusy(false));
  };
  const act = (work: () => Promise<unknown>) => { setBusy(true); setError(null); work().then(load).catch((e) => { setError(say(e)); load(); }).finally(() => setBusy(false)); };
  const evaluate = () => {
    asked.current += 1;
    setBusy(true); setError(null); setComposite(null);
    evaluateAssignment(inputs, profile.facts as Facts).then((e) => { setResult(e); const p = new URLSearchParams(params); p.set('evaluation', e.id); p.delete('composite'); setParams(p, { replace: true }); })
      .catch((e) => { setResult(null); setError(say(e)); }).finally(() => setBusy(false));
  };
  const simulate = () => {
    if (!result?.decision.selected) return;
    setBusy(true); setError(null);
    simulateEvaluation(result.id).then((sim) => nav(`/survey-studio/surveys/${(result.decision.selected as Any).survey_code}/simulate?simulation=${sim.id}&assignment=${result.id}`))
      .catch((e) => { setError(say(e)); setBusy(false); });
  };
  const bindings = useMemo(() => new Map((policy?.bindings ?? []).map((b) => [b.id, b])), [policy]);

  return (
    <>
      <div className="ss-bar">
        <nav className="ss-crumbs" aria-label="Survey Studio breadcrumb"><Link to="/survey-studio">Survey Studio</Link><Glyph name="right" size={13} /><span aria-current="page">Survey assignment</span></nav>
        <div className="ss-bar-tools"><span className="ss-proto saved-mode"><Glyph name="info" size={14} /> Simulation · synthetic</span></div>
      </div>
      <div className="ss-asg" data-testid="ss-asg">
        <header>
          <h1 className="ss-title">Survey assignment</h1>
          <p className="ss-note" data-testid="ss-asg-notice"><Glyph name="info" size={14} /><span>Which published survey the assignment rules select for an invented application. <strong>Simulation only:</strong> nothing here assigns a survey to a customer case, and a selected survey or a computed plan is not permission to call anyone. The rules are written, approved and published in <Link to="/assignment-rules">Assignment Rules</Link>; this page does not change them.</span></p>
        </header>
        {allowed ? null : <div className="ss-empty" role="status" data-testid="ss-asg-not-permitted"><p><strong>You cannot open the assignment policy.</strong> It shows the conditions of published assignment rules, so reading it needs its own permission (“read survey assignment”), which you do not hold. Being able to read surveys is not enough.</p><Link className="ss-btn" to="/survey-studio">Back to Survey Studio</Link></div>}
        {failed ? <div className="ss-empty" role="alert" data-testid="ss-asg-failed"><p><strong>The assignment policy could not be loaded.</strong> {failed}</p></div> : null}
        {error ? <p className="ss-note warn" role="alert" data-testid="ss-asg-error"><Glyph name="alert" size={14} /><span>{error}</span></p> : null}

        {allowed ? <>
        <section className="ss-srv-block" aria-labelledby="ss-asg-policy-h">
          <h2 id="ss-asg-policy-h">1 · The assignment policy</h2>
          <p className="ss-muted">Published rules in the order the engine considers them: priority first (1 is highest), then how specific the rule is. A rule stands for a survey only through a binding that one person proposed, a second approved and a third published.</p>
          {!policy ? (failed ? null : <p className="ss-loading" role="status"><span className="ss-spinner" aria-hidden="true" /> Loading the policy…</p>) : policy.rules.length === 0 ? <p className="ss-muted" data-testid="ss-asg-no-rules">There are no published assignment rules in your market.</p> : (
            <table className="ss-table ss-asg-rules" data-testid="ss-asg-rules">
              <thead><tr><th scope="col">Rule</th><th scope="col">Applies when</th><th scope="col">Precedence</th><th scope="col">Survey version it stands for</th></tr></thead>
              <tbody>{policy.rules.map((r) => <RuleRow key={r.ref} rule={r} published={r.published_binding ? bindings.get(r.published_binding) : undefined} open={r.open_binding ? bindings.get(r.open_binding) : undefined} versions={versions} busy={busy} can={can} act={act} />)}</tbody>
            </table>
          )}
        </section>

        {groups && policy ? <GroupsSection groups={groups} rules={policy.rules} busy={busy} can={can} act={act} /> : null}

        <section className="ss-srv-block" aria-labelledby="ss-asg-app-h">
          <h2 id="ss-asg-app-h">2 · A synthetic application</h2>
          <p className="ss-muted">The inputs the rules read, each from its governed list. “Not known” is a real state: the engine never treats it as “does not match”.</p>
          <div className="ss-asg-form" data-testid="ss-asg-inputs">
            {fields.map((f) => {
              const multi = f.field === 'contact_role';
              const value = inputs[f.field];
              const current = multi ? ((value as string[] | null)?.[0] ?? '') : value === null || value === undefined ? '' : String(value);
              return (
                <label key={f.field} className="ss-field"><span>{f.label}</span>
                  <select value={current} data-testid={`ss-asg-in-${f.field}`} title={f.source}
                    onChange={(e) => { const raw = f.values.find((v) => String(v.value) === e.target.value); setResult(null); setComposite(null); setInputs({ ...inputs, [f.field]: e.target.value === '' ? null : multi ? [e.target.value] : (raw?.value ?? null) }); }}>
                    <option value="">— not known —</option>
                    {f.values.map((v) => <option key={String(v.value)} value={String(v.value)}>{v.label}</option>)}
                  </select></label>
              );
            })}
            <label className="ss-field"><span>Facts for the call plan</span>
              <select value={profile.id} data-testid="ss-asg-profile" onChange={(e) => { setResult(null); setComposite(null); const p = new URLSearchParams(params); p.set('profile', e.target.value); p.delete('evaluation'); p.delete('composite'); setParams(p, { replace: true }); }}>
                {PROFILES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
          </div>
          <div className="ss-actions">
            {can('survey.simulate') && groups ? <button type="button" className="ss-btn primary" onClick={compose} disabled={busy || !fields.length} data-testid="ss-asg-compose">Select every required survey and plan each</button> : null}
            {can('survey.simulate') ? <button type="button" className={`ss-btn ${groups ? '' : 'primary'}`} onClick={evaluate} disabled={busy || !fields.length} data-testid="ss-asg-evaluate" title="The single-survey selection: every rule competes and one survey wins">{groups ? 'Single-survey selection only' : 'Select the survey and plan the call'}</button>
              : <span className="ss-save-note" data-testid="ss-asg-read-only">You can read the policy and recorded selections. Making a selection needs the “simulate surveys” permission.</span>}
          </div>
        </section>

        </> : null}
        {composite ? <CompositeResult c={composite} canSimulate={can('survey.simulate')} /> : null}
        {result ? <Result e={result} busy={busy} canSimulate={can('survey.simulate')} onSimulate={simulate} /> : null}
      </div>
    </>
  );
}

function RuleRow({ rule, published, open, versions, busy, can, act }: { rule: AssignmentRule; published?: AssignmentBinding; open?: AssignmentBinding; versions: PublishedVersion[]; busy: boolean; can: (p: string) => boolean; act: (w: () => Promise<unknown>) => void }) {
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');
  return (
    <tr data-testid={`ss-asg-rule-${rule.rule_code}`} data-bound={String(!!published)} data-target-kind={rule.target_kind}>
      <th scope="row"><strong>{rule.name}</strong><span className="ss-code">{rule.ref}</span>{rule.is_fallback ? <Tag tone="warn">Default fallback</Tag> : null}{rule.effective_now ? null : <Tag>Not in effect now</Tag>}
        {/* SHARED-1: a rule that names no script exists only to select a survey here */}
        {rule.target_kind === 'SURVEY_BINDING' ? <Tag tone="shared">Survey only · names no script</Tag> : null}</th>
      <td>{rule.when.length ? <ul className="ss-asg-when">{rule.when.map((w) => <li key={w}>{w}</li>)}</ul> : 'every application'}</td>
      <td>Priority {rule.priority}<br /><span className="ss-muted">specificity {rule.specificity}</span></td>
      <td>
        {published ? (
          <p data-testid={`ss-asg-bound-${rule.rule_code}`} data-version={published.survey_version_id}>
            <Link to={`/survey-studio/surveys/${published.survey_code}/versions/${published.survey_version_id}`}><strong>{published.survey_name}</strong> · version {published.version_label}</Link>
            {published.survey_version_status === 'PUBLISHED' ? null : <> <Tag tone="warn">That version is {String(published.survey_version_status).toLowerCase()}: not selectable</Tag></>}
            <br /><span className="ss-muted">Bound {when(published.proposed_at)} · content {short(published.content_sha256)}</span>
          </p>
        ) : <p className="ss-muted" data-testid={`ss-asg-unbound-${rule.rule_code}`}>No survey bound. If this rule wins, nothing is selected.</p>}
        {open ? (
          <div className="ss-asg-open" data-testid={`ss-asg-open-${rule.rule_code}`} data-status={open.status}>
            <p><Tag tone="draft">{STATUS[open.status]}</Tag> {open.survey_name} · version {open.version_label}{open.note ? <> — “{open.note}”</> : null}</p>
            <div className="ss-actions">
              {open.status === 'PROPOSED' && can('survey.approve') ? <button type="button" className="ss-btn" disabled={busy} onClick={() => act(() => decideBinding(open.id, 'APPROVE', ''))} data-testid={`ss-asg-approve-${rule.rule_code}`}>Approve</button> : null}
              {open.status === 'APPROVED' && can('survey.publish') ? <button type="button" className="ss-btn primary" disabled={busy} onClick={() => act(() => publishBinding(open.id))} data-testid={`ss-asg-publish-${rule.rule_code}`}>Publish binding</button> : null}
              {open.is_proposer ? <><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for withdrawing" aria-label="Reason for withdrawing" /><button type="button" className="ss-btn" disabled={busy || reason.trim().length < 10} onClick={() => act(() => withdrawBinding(open.id, reason))}>Withdraw</button></> : null}
            </div>
          </div>
        ) : can('survey.edit') && rule.rule_version ? (
          <div className="ss-actions">
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={`Published survey version for ${rule.name}`} data-testid={`ss-asg-pick-${rule.rule_code}`}>
              <option value="">— choose a published survey version —</option>
              {versions.map((v) => <option key={v.id} value={v.id}>{v.survey_name} · version {v.label} ({v.survey_code})</option>)}
            </select>
            <button type="button" className="ss-btn" disabled={busy || !pick} onClick={() => act(() => proposeBinding({ rule_code: rule.rule_code, rule_version: rule.rule_version!, survey_version_id: pick, note: '' }).then(() => setPick('')))} data-testid={`ss-asg-propose-${rule.rule_code}`}>{published ? 'Propose a different version' : 'Propose binding'}</button>
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function Result({ e, busy, canSimulate, onSimulate }: { e: AssignmentEvaluation; busy: boolean; canSimulate: boolean; onSimulate: () => void }) {
  const d = e.decision as Any;
  const s = SELECTION[e.selection] ?? { tone: 'no', title: e.selection };
  const plan = e.call_plan ? (e.call_plan.plan as unknown as PyPlan) : null;
  const missingFacts = plan ? plan.inputs.filter((i) => i.state !== 'PRESENT') : [];
  const open = plan ? plan.modules.flatMap((m) => m.open) : [];
  return (
    <section className="ss-asg-result" aria-labelledby="ss-asg-result-h" data-testid="ss-asg-result" data-evaluation={e.id} data-outcome={e.outcome} data-selection={e.selection} data-version={e.survey_version_id ?? ''} data-fingerprint={e.plan_fingerprint ?? ''}>
      <div className={`ss-plan-q ${s.tone}`}>
        <p className="ss-plan-q-label">3 · What the rules decided</p>
        <h2 id="ss-asg-result-h"><Glyph name={e.selection === 'MATCHED' ? 'check' : 'stop'} size={18} /> {s.title}{d.by_fallback ? ' — by the default fallback rule' : ''}</h2>
        <p data-testid="ss-asg-reason">{d.reason}</p>
        {d.selected ? <p data-testid="ss-asg-selected">Rule <span className="ss-code">{d.selected.rule}</span> stands for <Link to={`/survey-studio/surveys/${d.selected.survey_code}/versions/${d.selected.survey_version_id}`}><strong>{d.selected.survey_name}</strong> · version {d.selected.version_label}</Link> <span className="ss-muted">(content {short(d.selected.content_sha256)}, manifest verified)</span>.</p> : null}
        {d.missing_inputs?.length ? <p data-testid="ss-asg-missing-inputs">Not known: <strong>{d.missing_inputs.join(', ')}</strong>. An unknown input is never read as “does not match”.</p> : null}
        {e.recompute_consistent ? null : <p className="ss-issue" role="alert" data-testid="ss-asg-drift"><Glyph name="alert" size={14} /> The rules or bindings have changed since this was recorded: decided again now, the result would differ. What is shown is the recorded decision.</p>}
        <p className="ss-muted">Outcome code <span className="ss-code">{e.outcome}</span> · decision fingerprint <span className="ss-code" title={e.decision_sha256}>{short(e.decision_sha256)}</span> · decided for {when(e.evaluated_at)} · kind of record: Simulation</p>
      </div>

      <details className="ss-sim-evidence" open data-testid="ss-asg-trace">
        <summary>Why — every rule the engine considered</summary>
        <table className="ss-table"><thead><tr><th scope="col">Rule</th><th scope="col">Result</th><th scope="col">Conditions</th><th scope="col">Stands for</th></tr></thead>
          <tbody>{(d.trace as Any[]).map((t) => (
            <tr key={t.ref} data-testid={`ss-asg-trace-${t.rule_code}`} data-match={t.match} data-selected={String(t.selected)}>
              <th scope="row"><span className="ss-code">{t.ref}</span><br /><span className="ss-muted">priority {t.priority} · specificity {t.specificity}{t.is_fallback ? ' · fallback' : ''}</span></th>
              <td>{t.selected ? <Tag tone="ok">Selected</Tag> : !t.eligible ? `Not considered: ${t.excluded_reason}` : t.match === 'UNKNOWN' ? <Tag tone="warn">Cannot be decided</Tag> : t.tied ? <Tag tone="warn">Tied</Tag> : t.match === 'MATCH' ? (d.outcome === 'SURVEY_NOT_BOUND' || d.outcome === 'TARGET_NOT_EFFECTIVE' ? (d.winning_rules.includes(t.ref) ? <Tag tone="warn">Wins, but has no usable survey</Tag> : 'Matches, lower precedence — not used instead') : 'Matches, lower precedence') : 'Does not match'}</td>
              <td>{(t.conditions as Any[]).length ? (t.conditions as Any[]).map((c) => <div key={c.field} className={`ss-asg-cond ${String(c.result).toLowerCase()}`}>{c.field}: {shown(c.actual)} <span className="ss-muted">(needs {c.expected.map(shown).join(' or ')})</span> — {c.result === 'PASS' ? 'met' : c.result === 'FAIL' ? 'not met' : 'not known'}</div>) : <span className="ss-muted">no conditions</span>}</td>
              <td>{t.survey_version_id ? t.target_label : <span className="ss-muted">no survey bound</span>}</td>
            </tr>))}</tbody></table>
      </details>

      {e.call_plan && plan ? (
        <div className="ss-srv-block" data-testid="ss-asg-plan" data-status={plan.status}>
          <h2>4 · The call plan of the selected version</h2>
          <p className="ss-note"><Glyph name="info" size={14} /><span>Assembled by the Call360 server for these facts. Whether a plan can be computed is a technical answer; it is <strong>not</strong> whether a call may be made.</span></p>
          <dl className="ss-plan-identity">
            <div><dt>Can a plan be computed?</dt><dd data-testid="ss-asg-plan-status">{plan.status === 'READY' ? 'Yes' : 'No — blocked'}</dd></div>
            <div><dt>Plan fingerprint</dt><dd className="ss-code" title={e.call_plan.fingerprint} data-testid="ss-asg-plan-fingerprint">{short(e.call_plan.fingerprint)}</dd></div>
            <div><dt>Still decided during the call</dt><dd data-testid="ss-asg-plan-open">{open.length} point{open.length === 1 ? '' : 's'}</dd></div>
          </dl>
          <ul className="ss-asg-mods" data-testid="ss-asg-plan-modules">{plan.modules.map((m) => <li key={m.instance} data-status={m.status}><strong>{m.name}</strong> <Tag tone={m.status === 'IN' ? 'ok' : m.status === 'HALTS' ? 'warn' : undefined}>{MODULE[m.status] ?? m.status}</Tag></li>)}</ul>
          {missingFacts.length ? <p data-testid="ss-asg-plan-missing">Facts missing or unusable: {missingFacts.map((i) => <span key={i.field} className="ss-code">{i.field} </span>)}— nothing is assumed in their place.</p> : <p className="ss-muted">Every fact the plan reads is present.</p>}
          {plan.issues.length ? <ul className="ss-plan-blockers">{plan.issues.map((i) => <li key={`${i.code}${i.at}`}><Glyph name="alert" size={14} /> <span className="ss-code">{i.code}</span> at <span className="ss-code">{i.at}</span></li>)}</ul> : null}
          <div className="ss-actions">
            {canSimulate ? <button type="button" className="ss-btn primary" onClick={onSimulate} disabled={busy} data-testid="ss-asg-simulate">Start a simulation of this version</button> : null}
            <Link className="ss-btn" to={`/survey-studio/surveys/${(e.decision as Any).selected.survey_code}/plan`} data-testid="ss-asg-open-plan">Open the full call plan</Link>
          </div>
        </div>
      ) : null}
      {e.simulations.length ? <p className="ss-muted" data-testid="ss-asg-simulations">Simulations started from this selection: {e.simulations.map((id) => <Link key={id} to={`/survey-studio/surveys/${(e.decision as Any).selected?.survey_code}/simulate?simulation=${id}&assignment=${e.id}`}> {id.slice(0, 8)} </Link>)}</p> : null}
    </section>
  );
}
