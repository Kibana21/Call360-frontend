// Text Simulator (`/simulator?case=…&run=…`, S2-D): a minimal text-only harness for the deterministic question
// controller. The backend decides every next action; this page only reports simulated delivery and answers against the
// current action id. S2-D.1 adds the conversation lifecycle: stage, simulated identity / consent gates, conversation
// events and termination. Simulation never contacts a customer, verifies identity, evaluates compliance or changes a case.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiFailure, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useAuth } from '../../auth/AuthContext';
import { Empty } from '../../components/StateView';
import { Badge, Button, Card, PageHead, type Tone } from '../../components/ui';
import { humanize, Region, when } from '../cases/shared';
import { ErrorBox, errorText, Field } from '../scripts/ScriptEditor';
import { ScenarioLibrary, useVersions, VersionOptions } from './ScenarioLibrary';
import { TestRuns } from './TestRuns';
import { RunEvaluation } from './AnswerEvaluation';

type Run = components['schemas']['SimRunOut'];
type Action = components['schemas']['SimActionOut'];

const Q_TONE: Record<string, Tone> = {
  PENDING: 'gray', REQUESTED: 'blue', PRESENTED: 'purple', ANSWER_RECEIVED: 'purple', CLARIFICATION_REQUIRED: 'amber',
  COMPLETED: 'green', UNRESOLVED: 'red', SKIPPED_BY_CONDITION: 'gray',
};
const RUN_TONE: Record<string, Tone> = { IN_PROGRESS: 'blue', SEQUENCE_FINISHED: 'purple', COMPLETED: 'green', INCOMPLETE: 'amber', ABANDONED: 'gray', TERMINATED: 'red' };
const STAGES = ['OPENING', 'IDENTITY', 'DISCLOSURE', 'CONSENT', 'VERIFICATION', 'CLOSING'];
const GATE_TONE: Record<string, Tone> = {
  CONFIRMED: 'green', AGREED: 'green', GRANTED: 'green', PENDING: 'blue', NOT_ASKED: 'gray', NOT_CONFIGURED: 'amber',
  FAILED: 'red', INCONCLUSIVE: 'red', WRONG_PERSON: 'red', DECLINED: 'red', CALLBACK_REQUESTED: 'amber',
};
const GATES: [string, string][] = [['identity', 'Identity'], ['willingness', 'Willingness to proceed'], ['recording_consent', 'Recording consent'], ['cloud_processing', 'Cloud-processing authorisation']];
const EVENTS: [string, string][] = [['WRONG_PERSON', 'Wrong person answered'], ['CALLBACK_REQUESTED', 'Callback requested'], ['DECLINED_TO_CONTINUE', 'Declined to continue'], ['INTERRUPTED', 'Interrupted / dropped']];
interface Life {
  stage?: string; gates?: Record<string, string>; flags?: string[]; termination?: { reason: string; detail: string; stage: string } | null;
  disclosures_delivered?: string[]; disclosures_undelivered?: string[]; blocked_by_identity_gate?: string[]; compliance_outcome?: string;
}

/** Stage stepper and gate panel. Every identity and consent outcome here is simulated. */
function LifecyclePanel({ life }: { life: Life }) {
  const cur = (life.stage ?? '').replace('TERMINATION_', '');
  const idx = STAGES.indexOf(cur);
  const stopped = life.termination ? STAGES.indexOf(life.termination.stage) : -1;
  // After a termination, stages between the stop and the closing were never reached (not "done").
  const tone = (st: string, i: number): Tone => {
    if (st === cur) return 'blue';
    if (stopped >= 0) return i < stopped ? 'green' : i === stopped ? 'red' : 'gray';
    return idx > i || life.stage === 'FINISHED' || life.stage === 'ENDED' ? 'green' : 'gray';
  };
  return (
    <section className="card card-pad stack" style={{ gap: 12 }} data-testid="sim-lifecycle" aria-label="Conversation lifecycle">
      <div className="row wrap between" style={{ gap: 8 }}><strong className="small">Conversation lifecycle</strong>
        <span className="row wrap" style={{ gap: 6 }}><Badge tone="amber">All identity and consent outcomes are simulated</Badge><Badge tone="gray">Compliance: {humanize(life.compliance_outcome ?? 'NOT_EVALUATED')}</Badge></span></div>
      <ol className="plain-list" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-start', gap: 6, margin: 0, padding: 0 }} aria-label="Stages" data-testid="sim-stages">
        {STAGES.map((st, i) => (
          <li key={st} aria-current={st === cur ? 'step' : undefined}>
            <Badge tone={tone(st, i)}>{`${i + 1}. ${humanize(st)}${st === cur ? ' (current)' : i === stopped ? ' (terminated here)' : stopped >= 0 && i > stopped && st !== 'CLOSING' ? ' (not reached)' : ''}`}</Badge></li>
        ))}
        {life.stage && !STAGES.includes(cur) ? <li><Badge tone={life.termination ? 'red' : 'purple'}>{humanize(life.stage)}</Badge></li> : null}
      </ol>
      <div className="info-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }} data-testid="sim-gates">
        {GATES.map(([k, label]) => (
          <div key={k} className="info-tile"><label>{label} (simulated)</label><strong><Badge tone={GATE_TONE[life.gates?.[k] ?? ''] ?? 'gray'}>{humanize(life.gates?.[k] ?? 'NOT_ASKED')}</Badge></strong></div>
        ))}
      </div>
      <dl className="kv xsmall">
        <dt>Disclosures</dt><dd>{(life.disclosures_delivered ?? []).length} delivered{(life.disclosures_undelivered ?? []).length ? ` · not delivered: ${life.disclosures_undelivered!.join(', ')}` : ''}</dd>
        {(life.flags ?? []).length ? <><dt>Continued with</dt><dd>{life.flags!.map((f) => humanize(f.split(':').pop() ?? f)).join(' · ')}</dd></> : null}
        {(life.blocked_by_identity_gate ?? []).length ? <><dt>Withheld (identity not confirmed)</dt><dd className="mono">{life.blocked_by_identity_gate!.join(', ')}</dd></> : null}
        {life.termination ? <><dt>Termination</dt><dd data-testid="sim-termination"><strong>{humanize(life.termination.reason)}</strong> at {humanize(life.termination.stage)} — {life.termination.detail}</dd></> : null}
      </dl>
    </section>
  );
}

const TABS = [['interactive', 'Interactive simulator'], ['scenarios', 'Scenario library'], ['runs', 'Test runs and coverage']] as const;

/** S2-E Simulation Workbench (`/simulator?tab=…`): interactive simulation, the scenario library and recorded test runs,
 * all over the one deterministic controller. */
export function TextSimulatorPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'interactive') as (typeof TABS)[number][0];
  const go = (next: Record<string, string>) => setParams(new URLSearchParams(next));
  return (
    <>
      <PageHead eyebrow="Callback simulation workbench (S2-D, S2-D.1, S2-E)" title="Simulation Workbench"
        description="Test scripts and conversation workflows against the deterministic controller: simulate interactively, keep reusable scenarios, run them in batches, compare script versions and review structural coverage." />
      <div className="topnotice" role="note" data-testid="sim-banner"><span><strong>Simulation only.</strong> No customer is contacted, no identity is verified, no answer is evaluated for compliance,
        and no case outcome, assignment, hold, attempt or KPI changes. Scripts are synthetic and not production-approved wording.</span></div>
      <div className="subtabs" role="tablist" aria-label="Simulation workbench views" style={{ margin: '16px 0' }}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" id={`wb-tab-${k}`} aria-selected={tab === k} aria-controls={`wb-panel-${k}`}
            className={tab === k ? 'active' : ''} onClick={() => go({ tab: k })} data-testid={`wb-tab-${k}`}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`wb-panel-${tab}`} aria-labelledby={`wb-tab-${tab}`}>
        {tab === 'scenarios' ? (
          <ScenarioLibrary selected={params.get('scenario')} fromRun={params.get('fromRun')}
            onSelect={(id) => go(id ? { tab: 'scenarios', scenario: id } : { tab: 'scenarios' })} onShowRun={(id) => go({ tab: 'runs', batch: id })} />
        ) : tab === 'runs' ? (
          <TestRuns batchId={params.get('batch')} onSelect={(id) => go({ tab: 'runs', batch: id })} onOpenScenario={(id) => go({ tab: 'scenarios', scenario: id })} />
        ) : <Interactive />}
      </div>
    </>
  );
}

function Interactive() {
  const [params, setParams] = useSearchParams();
  const caseId = params.get('case');
  const runId = params.get('run');
  const version = params.get('version');
  const set = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };
  return (
    <div className="layout sd-grid">
      <CasePicker caseId={caseId} anyCase={!!version} onPick={(id) => { const p = new URLSearchParams(params); p.set('case', id); p.delete('run'); setParams(p); }} />
      <div className="stack" style={{ gap: 16 }}>
        {!caseId ? <Card><Empty title="Choose a synthetic case">Use the case's pinned script, or choose any draft or published version to test on it.</Empty></Card> : null}
        {caseId && !runId ? <PlanView caseId={caseId} version={version} onVersion={(v) => set('version', v)} onStarted={(id) => set('run', id)} /> : null}
        {caseId && runId ? <RunView runId={runId} caseId={caseId} version={version} onRestart={(id) => set('run', id)} onPlan={() => set('run', null)}
          onSaveScenario={() => setParams(new URLSearchParams({ tab: 'scenarios', scenario: 'new', fromRun: runId }))} /> : null}
      </div>
    </div>
  );
}

function CasePicker({ caseId, anyCase, onPick }: { caseId: string | null; anyCase: boolean; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(anyCase);
  const cases = useQuery({ queryKey: ['sim-cases', q, all], queryFn: async () => unwrap(await api.GET('/api/v1/script-simulations/cases', { params: { query: { q: q || undefined, include_unassigned: all } } })) });
  return (
    <Card title={all ? 'Synthetic cases' : 'Cases with a pinned script'} subtitle={all ? 'Any case with a fact snapshot (for version testing)' : 'Newest assignment first'}>
      <label className="row small" style={{ gap: 6, marginBottom: 8 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} data-testid="sim-all-cases" /> Include cases without a pinned script</label>
      <label className="form-label" htmlFor="sim-q">Find a case</label>
      <input id="sim-q" className="field labelled" value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} placeholder="CB-2026-…" />
      <Region query={cases} label="cases">
        {() => (
          <nav aria-label="Cases" className="stack" style={{ gap: 0, marginTop: 10 }} data-testid="sim-case-list">
            {cases.data!.items.map((c) => (
              <button key={c.case_id} type="button" className={`script-item${c.case_id === caseId ? ' active' : ''}`} style={{ textAlign: 'left', width: '100%', background: 'none' }}
                aria-current={c.case_id === caseId ? 'true' : undefined} onClick={() => onPick(c.case_id)} data-testid={`sim-case-${c.case_ref}`}>
                <div className="row between"><strong className="small mono">{c.case_ref}</strong><Badge tone="gray">{humanize(c.state)}</Badge></div>
                <div className="xsmall muted" style={{ marginTop: 6 }}>{c.script_label} · {humanize(c.origin)}{c.simulations ? ` · ${c.simulations} run(s)` : ''}</div>
              </button>
            ))}
            {!cases.data!.items.length ? <p className="small muted">No case with a pinned script matches.</p> : null}
          </nav>
        )}
      </Region>
    </Card>
  );
}

function PlanView({ caseId, version, onVersion, onStarted }: { caseId: string; version: string | null; onVersion: (v: string | null) => void; onStarted: (id: string) => void }) {
  const { can } = useAuth();
  const versions = useVersions();
  const plan = useQuery({ queryKey: ['sim-plan', caseId, version], queryFn: async () => unwrap(await api.GET('/api/v1/script-simulations/plan', { params: { query: { case_id: caseId, script_version_id: version ?? undefined } } })) });
  const runs = useQuery({ queryKey: ['sim-runs', caseId], queryFn: async () => unwrap(await api.GET('/api/v1/cases/{case_id}/script-simulations', { params: { path: { case_id: caseId } } })) });
  const [contact, setContact] = useState('');
  const start = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/script-simulations', { body: { case_id: caseId, contact_selection_id: contact || null, script_version_id: version } })),
    onSuccess: (r) => onStarted(r.id),
  });
  const picker = (
    <Card title="Script to simulate" subtitle="The case's pinned script, or any draft or published version (tested from an isolated snapshot; no assignment changes)">
      <Field id="sim-version" label="Script version">
        {(fp) => <select {...fp} className="field labelled" value={version ?? ''} onChange={(e) => onVersion(e.target.value || null)} data-testid="sim-version">
          <option value="">Pinned script of the case (assignment)</option><VersionOptions items={versions.data?.items ?? []} /></select>}
      </Field>
    </Card>
  );
  if (plan.isError && !version && plan.error instanceof ApiFailure && plan.error.code === 'NO_SCRIPT_ASSIGNED') {
    return <>{picker}<Card><Empty title="This case has no pinned script">Choose a script version above to test it on this synthetic case.</Empty></Card></>;
  }
  return (
    <>{picker}
    <Region query={plan} label="the script plan">
      {() => {
        const p = plan.data!;
        const mand = p.questions.filter((q) => q.mandatory && q.applicable).length;
        return (
          <>
            <Card title={`${p.case_ref} · ${p.script_label}`} subtitle="Pinned script, fact snapshot and SBQ band decide the plan before the first question">
              <div className="stack" style={{ gap: 12 }} data-testid="sim-plan">
                <div className="row wrap" style={{ gap: 6 }}>
                  <Link className="link small" to={`/scripts/${p.script_family_id}?version=${p.script_version_id}`}>Open in Script Studio</Link>
                  <Link className="link small" to={`/cases/${p.case_id}`}>Open Call Detail</Link>
                  <Badge tone="amber">Synthetic · not production-approved</Badge>
                  <Badge tone={p.mode === 'VERSION_TEST' ? 'purple' : 'blue'}>{p.mode === 'VERSION_TEST' ? `Version test · ${humanize(p.version_status ?? '')}` : 'Pinned assignment'}</Badge>
                  {p.live_eligibility ? <Badge tone={(p.live_eligibility as { structurally_eligible?: boolean }).structurally_eligible ? 'green' : 'red'}>{(p.live_eligibility as { structurally_eligible?: boolean }).structurally_eligible ? 'Lifecycle gates present' : 'Not eligible for live conversations (lifecycle gates missing)'}</Badge> : null}
                </div>
                <dl className="kv xsmall">
                  <dt>Facts used</dt><dd>{Object.entries(p.facts).map(([k, v]) => `${humanize(k.toUpperCase())}: ${String(v)}`).join(' · ')} · SBQ band: {p.risk_band ?? 'Unassessed'}</dd>
                  <dt>Questions</dt><dd>{p.questions.filter((q) => q.applicable).length} applicable of {p.questions.length} · {mand} mandatory to ask</dd>
                  <dt>Identity gate</dt><dd data-testid="sim-identity-configured">{p.identity_gate_configured ? 'Configured — policy information is withheld until identity is confirmed (simulated)' : 'Not configured — items that disclose policy information will be withheld'}</dd>
                </dl>
                <div className="section-label" style={{ margin: 0 }}>Modules</div>
                <ul className="plain-list stack" style={{ gap: 4 }} data-testid="sim-modules">
                  {p.sections.map((s) => <li key={s.module_code} className="small"><Badge tone={s.included ? 'green' : 'gray'}>{s.included ? 'Included' : 'Not included'}</Badge> <span className="mono">{s.module_code}</span> · {s.name} <span className="xsmall muted">· {humanize(s.stage ?? 'VERIFICATION')} stage · when {s.condition}</span></li>)}
                </ul>
                <div className="section-label" style={{ margin: 0 }}>Questions in delivery order</div>
                <ol className="plain-list stack" style={{ gap: 4 }} data-testid="sim-plan-questions">
                  {p.questions.map((q) => (
                    <li key={q.code} className="small"><span className="q-num">{q.position}</span> <span className="mono strong">{q.code}</span>{' '}
                      {q.mandatory ? <Badge tone="red">Mandatory</Badge> : <Badge tone="gray">Optional</Badge>} <Badge tone="blue">{humanize(q.answer_type)}</Badge> <Badge tone="gray">{humanize(q.stage ?? 'VERIFICATION')}</Badge>
                      {q.role && q.role !== 'VERIFICATION' ? <> <Badge tone="purple">{humanize(q.role)}</Badge></> : null}
                      {q.discloses_policy_information ? <> <Badge tone="amber">Policy info · after identity</Badge></> : null}
                      {!q.applicable ? <div className="xsmall muted" style={{ marginLeft: 30 }}>Skipped by approved condition: {q.skip_reason}</div> : null}</li>
                  ))}
                </ol>
              </div>
            </Card>
            <Card title="Start a simulation" subtitle="The callback contact must be a current eligible contact (and the one the script was assigned for, when recorded)">
              <div className="stack" style={{ gap: 10 }}>
                {p.contacts.length > 1 ? (
                  <Field id="sim-contact" label="Callback contact">
                    {(fp) => <select {...fp} className="field labelled" value={contact} onChange={(e) => setContact(e.target.value)} data-testid="sim-contact">
                      <option value="">Choose a contact…</option>
                      {p.contacts.map((c) => <option key={c.selection_id} value={c.selection_id}>{humanize(c.role)} · {c.label}{c.assignment_contact ? ' (assignment contact)' : ''}</option>)}
                    </select>}
                  </Field>
                ) : <p className="small" style={{ margin: 0 }}>Callback contact: {p.contacts[0] ? `${humanize(p.contacts[0].role)} · ${p.contacts[0].label}` : 'none eligible'}</p>}
                {can('script.simulate') ? <div><Button variant="primary" icon="play" onClick={() => start.mutate()} disabled={start.isPending} data-testid="sim-start">Start simulation</Button></div>
                  : <p className="xsmall muted">Running a simulation needs the script-simulation permission.</p>}
                <ErrorBox error={start.error ? errorText(start.error) : null} />
              </div>
            </Card>
            {runs.data?.items.length ? (
              <Card title="Earlier runs" subtitle="Kept for review; restarting creates a new run">
                <ul className="plain-list" data-testid="sim-runs">{runs.data.items.map((r) => <li key={r.id} className="small"><Link className="link mono" to={`/simulator?case=${caseId}&run=${r.id}`}>{r.sim_ref}</Link>{' '}
                  <span className="xsmall muted">{r.script_label}{r.mode === 'VERSION_TEST' ? ' (version test)' : ''}</span>{' '}
                  <Badge tone={RUN_TONE[r.status] ?? 'gray'}>{humanize(r.status)}</Badge> <span className="xsmall muted">{r.started_by} · {when(r.started_at)} SGT</span></li>)}</ul>
              </Card>
            ) : null}
          </>
        );
      }}
    </Region>
    </>
  );
}

function RunView({ runId, caseId, version, onRestart, onPlan, onSaveScenario }: { runId: string; caseId: string; version: string | null; onRestart: (id: string) => void; onPlan: () => void; onSaveScenario: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const run = useQuery({ queryKey: ['sim-run', runId], queryFn: async () => unwrap(await api.GET('/api/v1/script-simulations/{run_id}', { params: { path: { run_id: runId } } })) });
  const step = useMutation({
    mutationFn: async (fn: () => Promise<Run>) => fn(),
    onSuccess: (r) => { qc.setQueryData(['sim-run', runId], r); void qc.invalidateQueries({ queryKey: ['sim-runs', caseId] }); },
  });
  const restart = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/script-simulations', { body: { case_id: caseId, contact_selection_id: null, script_version_id: version } })),
    onSuccess: (r) => onRestart(r.id),
  });
  const path = { params: { path: { run_id: runId } } };
  return (
    <Region query={run} label="the simulation">
      {() => {
        const r = run.data!;
        const s = r.summary as Record<string, string[] | number>;
        const list = (k: string) => (s[k] as string[] | undefined) ?? [];
        const open = r.status === 'IN_PROGRESS' || r.status === 'SEQUENCE_FINISHED';
        const editable = open && can('script.simulate');
        const life = (r.lifecycle ?? {}) as Life;
        return (
          <>
            <section className="card card-pad" data-testid="sim-run-header">
              <div className="row wrap" style={{ gap: 8 }}><Badge tone={RUN_TONE[r.status] ?? 'gray'}>{humanize(r.status)}</Badge><span className="mono strong small">{r.sim_ref}</span>
                <span className="small muted">{r.case_ref} · {r.script_label} · contact {r.contact_role ? humanize(r.contact_role) : '—'}</span></div>
              <div className="info-grid" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }} data-testid="sim-progress">
                <div className="info-tile"><label>Mandatory completed</label><strong>{list('mandatory_completed').length} / {Number(s.mandatory_total) - list('mandatory_skipped_by_condition').length}</strong></div>
                <div className="info-tile"><label>Mandatory unresolved</label><strong>{list('mandatory_unresolved').length}</strong></div>
                <div className="info-tile"><label>{life.termination ? 'Mandatory not reached (terminated)' : 'Mandatory still open'}</label><strong>{list('mandatory_open').length}</strong></div>
                <div className="info-tile"><label>Skipped by condition</label><strong>{list('skipped_by_condition').length}</strong></div>
              </div>
            </section>
            <LifecyclePanel life={life} />
            {open ? <ActionCard a={r.next_action} editable={editable} pending={step.isPending} terminated={!!life.termination}
              report={(kind) => step.mutate(async () => unwrap(await api.POST('/api/v1/script-simulations/{run_id}/event', { ...path, body: { kind: kind as components['schemas']['SimEventIn']['kind'], note: null } })))}
              send={(kind, body) => step.mutate(async () => unwrap(kind === 'delivery'
                ? await api.POST('/api/v1/script-simulations/{run_id}/delivery', { ...path, body: body as components['schemas']['SimDeliveryIn'] })
                : kind === 'answer' ? await api.POST('/api/v1/script-simulations/{run_id}/answer', { ...path, body: body as components['schemas']['SimAnswerIn'] })
                  : await api.POST('/api/v1/script-simulations/{run_id}/clarification', { ...path, body: body as components['schemas']['SimClarificationIn'] })))}
              end={(abandon) => step.mutate(async () => unwrap(await api.POST('/api/v1/script-simulations/{run_id}/end', { ...path, body: { abandon, reason: abandon ? 'Abandoned in the text simulator' : null } })))} />
              : <Card title={`Execution ${humanize(r.status).toLowerCase()}`}>
                <p className="small" data-testid="sim-outcome" style={{ marginTop: 0 }}>{r.status === 'COMPLETED' ? 'Every applicable mandatory question was completed. This is a simulation result, not a customer verification.'
                  : r.status === 'INCOMPLETE' ? `Mandatory questions without a completed answer: ${[...list('mandatory_unresolved'), ...list('mandatory_open')].join(', ') || '—'}.`
                    : r.status === 'TERMINATED' ? `The conversation was terminated (${humanize(life.termination?.reason ?? '')}): ${life.termination?.detail ?? ''}. Simulated outcome; no case, hold or attempt changed.` : 'The run was abandoned.'}</p>
              </Card>}
            <ErrorBox error={step.error ? errorText(step.error) : null} />
            <div className="row wrap" style={{ gap: 8 }}>
              {can('script.simulate') ? <Button icon="refresh" onClick={() => restart.mutate()} disabled={restart.isPending} data-testid="sim-restart">Restart (new run)</Button> : null}
              <Button onClick={onPlan}>Back to plan</Button>
              {can('script.simulate') ? <Button icon="plus" onClick={onSaveScenario} data-testid="sim-save-scenario">Save as scenario</Button> : null}
            </div>
            <RunEvaluation key={runId} runId={runId} canEvaluate={can('script.simulate')} status={r.status} />
            <Card title="Question progress" subtitle="Mandatory order is fixed; a question is skipped only by an approved condition">
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Question progress"><table className="data-table" data-testid="sim-questions">
                <thead><tr><th>#</th><th>Stage</th><th>Question</th><th>Status</th><th>Answer</th><th>Re-prompts</th></tr></thead>
                <tbody>{r.questions.map((q) => (
                  <tr key={q.code}><td>{q.position}</td><td className="xsmall">{humanize(q.stage ?? 'VERIFICATION')}{q.role && q.role !== 'VERIFICATION' ? <div className="muted">{humanize(q.role)}</div> : null}</td><td><span className="mono">{q.code}</span> {q.mandatory ? <Badge tone="red">Mandatory</Badge> : null}<div className="xsmall muted">{q.section} · {humanize(q.answer_type)}</div></td>
                    <td><Badge tone={Q_TONE[q.status] ?? 'gray'}>{humanize(q.status)}</Badge>{q.reason ? <div className="xsmall muted" style={{ whiteSpace: 'normal', maxWidth: 320 }}>{q.reason}</div> : null}</td>
                    <td className="small">{q.answer ? `${humanize(String(q.answer.answer_state))}${q.answer.value != null && typeof q.answer.value !== 'boolean' ? `: ${String(q.answer.value)}` : ''}` : '—'}</td>
                    <td>{q.reprompts_used} / {q.reprompts_allowed}</td></tr>
                ))}</tbody>
              </table></div>
            </Card>
            <Card title="Execution trace" subtitle="Insert-only event log; the state above is its replay">
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Execution trace"><table className="data-table" data-testid="sim-trace-table">
                <thead><tr><th>#</th><th>Event</th><th>Question / action</th><th>Detail</th><th>When</th></tr></thead>
                <tbody>{r.trace.map((e) => (
                  <tr key={e.seq}><td>{e.seq}</td><td><Badge tone="gray">{humanize(e.event_type)}</Badge></td><td className="mono xsmall">{e.action_id ?? e.question_code ?? '—'}</td>
                    <td className="xsmall" style={{ whiteSpace: 'normal', maxWidth: 380 }}>{detail(e.data as Record<string, unknown>)}</td><td className="xsmall">{when(e.occurred_at)}</td></tr>
                ))}</tbody>
              </table></div>
            </Card>
          </>
        );
      }}
    </Region>
  );
}

function detail(d: Record<string, unknown>): string {
  const keys = ['stage', 'status', 'kind', 'gate', 'answer_kind', 'answer_state', 'value', 'reason', 'detail', 'flag', 'outcome', 'attempt'];
  return keys.filter((k) => d[k] != null && d[k] !== '').map((k) => `${humanize(k.toUpperCase())}: ${String(d[k])}`).join(' · ');
}

function ActionCard({ a, editable, pending, send, end, report, terminated }: {
  a: Action; editable: boolean; pending: boolean; terminated: boolean; report: (kind: string) => void;
  send: (kind: 'delivery' | 'answer' | 'clarification', body: Record<string, unknown>) => void; end: (abandon: boolean) => void;
}) {
  const [num, setNum] = useState('');
  const [choice, setChoice] = useState('');
  const [txt, setTxt] = useState('');
  const [why, setWhy] = useState('');
  const answer = (kind: string, value?: unknown) => send('answer', { action_id: a.action_id, kind, value: value ?? null });
  if (a.kind === 'SEQUENCE_FINISHED') {
    return (
      <Card title={terminated ? 'Conversation terminated' : 'Question sequence finished'} subtitle={a.note}>
        <p className="small" style={{ marginTop: 0 }} data-testid="sim-finished">{terminated ? 'End the execution to record the terminated outcome.' : 'End the execution to record whether every applicable mandatory question was completed.'}</p>
        {editable ? <div className="row" style={{ gap: 8 }}><Button variant="primary" onClick={() => end(false)} disabled={pending} data-testid="sim-end">End execution</Button></div> : null}
      </Card>
    );
  }
  return (
    <Card title={a.kind === 'REPROMPT' ? `Re-prompt ${a.reprompts_used} of ${a.reprompts_allowed}` : a.completes_on_delivery ? 'Next permitted statement' : 'Next permitted question'} subtitle={a.note}>
      <div className="stack" style={{ gap: 12 }} data-testid="sim-action">
        <div className="row wrap" style={{ gap: 6 }}>{a.stage ? <Badge tone="blue">{`${humanize(a.stage)} stage`}</Badge> : null}{a.role && a.role !== 'VERIFICATION' ? <Badge tone="purple">{humanize(a.role)}</Badge> : null}
          {terminated ? <Badge tone="red">After termination</Badge> : null}<span className="mono strong">{a.question_code}</span>{a.mandatory ? <Badge tone="red">Mandatory</Badge> : <Badge tone="gray">Optional</Badge>}
          <Badge tone="blue">{humanize(a.answer_type ?? '')}</Badge>{a.statement ? <Badge tone="purple">Statement to acknowledge</Badge> : null}
          {a.verbatim_required ? <Badge tone="amber">Exact wording required</Badge> : null}<span className="xsmall muted mono">{a.action_id}</span></div>
        <blockquote className="softbox small" style={{ margin: 0 }} data-testid="sim-wording">{a.wording}</blockquote>
        {!editable ? <p className="xsmall muted">Read-only view.</p> : !a.presented ? (
          <div className="row wrap" style={{ gap: 8 }}>
            <Button variant="primary" onClick={() => send('delivery', { action_id: a.action_id, delivered: true })} disabled={pending} data-testid="sim-present">{a.completes_on_delivery ? 'Mark as delivered (simulated)' : 'Mark as presented (simulated)'}</Button>
            <Button onClick={() => send('delivery', { action_id: a.action_id, delivered: false })} disabled={pending}>Not delivered</Button>
            <span className="xsmall muted">Requested is not delivered: answers are accepted only after presentation.</span>
          </div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            <div className="row wrap" style={{ gap: 8 }} data-testid="sim-answer">
              {a.answer_type === 'YES_NO' || a.answer_type === 'ACKNOWLEDGEMENT' ? (
                <><Button variant="primary" onClick={() => answer('ANSWER', true)} disabled={pending} data-testid="sim-yes">{a.answer_type === 'ACKNOWLEDGEMENT' ? 'Acknowledged' : 'Yes'}</Button>
                  <Button onClick={() => answer('ANSWER', false)} disabled={pending} data-testid="sim-no">{a.answer_type === 'ACKNOWLEDGEMENT' ? 'Not acknowledged' : 'No'}</Button></>
              ) : a.answer_type === 'NUMERIC' ? (
                <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); answer('ANSWER', num); }}>
                  <label className="form-label" htmlFor="sim-num" style={{ margin: 0 }}>Number</label>
                  <input id="sim-num" className="field" value={num} onChange={(e) => setNum(e.target.value)} inputMode="decimal" data-testid="sim-num" />
                  <Button type="submit" variant="primary" disabled={pending} data-testid="sim-submit">Submit</Button></form>
              ) : a.answer_type === 'ENUM' ? (
                <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); answer('ANSWER', choice); }}>
                  <label className="form-label" htmlFor="sim-choice" style={{ margin: 0 }}>Answer</label>
                  <select id="sim-choice" className="field" value={choice} onChange={(e) => setChoice(e.target.value)} data-testid="sim-choice"><option value="">Choose…</option>{a.options.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}</select>
                  <Button type="submit" variant="primary" disabled={pending || !choice} data-testid="sim-submit">Submit</Button></form>
              ) : (
                <form className="row wrap" style={{ gap: 6, flex: 1 }} onSubmit={(e) => { e.preventDefault(); answer('ANSWER', txt); }}>
                  <label className="form-label" htmlFor="sim-text" style={{ margin: 0 }}>Answer text</label>
                  <input id="sim-text" className="field grow" value={txt} onChange={(e) => setTxt(e.target.value)} data-testid="sim-text" />
                  <Button type="submit" variant="primary" disabled={pending} data-testid="sim-submit">Submit</Button></form>
              )}
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <Button tiny onClick={() => answer('UNCLEAR')} disabled={pending} data-testid="sim-unclear">Unclear answer</Button>
              <Button tiny onClick={() => answer('REFUSED')} disabled={pending} data-testid="sim-refused">Refused</Button>
              <Button tiny onClick={() => answer('UNKNOWN')} disabled={pending} data-testid="sim-unknown">Doesn't know</Button>
              <input aria-label="Clarification reason" className="field" placeholder="Clarification reason" value={why} onChange={(e) => setWhy(e.target.value)} style={{ height: 29 }} />
              <Button tiny onClick={() => send('clarification', { action_id: a.action_id, reason: why || 'Customer asked for clarification' })} disabled={pending} data-testid="sim-clarify">Needs clarification</Button>
            </div>
          </div>
        )}
        {editable && !terminated ? (
          <div className="row wrap" style={{ gap: 8 }} data-testid="sim-events" role="group" aria-label="Conversation events (simulated)">
            <span className="xsmall muted">Conversation event (simulated):</span>
            {EVENTS.map(([k, label]) => <Button key={k} tiny onClick={() => report(k)} disabled={pending} data-testid={`sim-event-${k}`}>{label}</Button>)}
          </div>
        ) : null}
        {editable ? <div className="row wrap" style={{ gap: 8 }}><Button tiny onClick={() => end(false)} disabled={pending} data-testid="sim-end-early">{terminated ? 'End now (terminated)' : 'End now (incomplete)'}</Button>
          <Button tiny variant="danger" onClick={() => end(true)} disabled={pending} data-testid="sim-abandon">Abandon</Button></div> : null}
      </div>
    </Card>
  );
}
