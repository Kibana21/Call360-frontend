// Survey Applicability (APPL-X4a) — recorded evaluation runs: immutable evidence of what the Python evaluator returned
// for one exact policy revision and one exact set of scenarios. A run is read as it was recorded, whatever has changed
// since; it can be re-evaluated from its own record, and compared with another run or with the policy's current draft.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Plan } from './model/types';
import { PlanView } from './plan';
import {
  againstCurrent, compareRuns, factWord, getRun, getRunResult, listRuns, verifyRun, when, why, OUTCOME, STATUS_WORD,
  type Coverage, type Dep, type Difference, type Expectation, type PairRow, type RunComparison, type RunDetail, type RunResultBrief, type RunSummary, type Verification,
} from './scenarioApi';
import type { StudioPolicy } from './ScenarioStudio';
import { useAppl } from './store';
import { CoveragePanel } from './SuiteBuilder';
import { DrawerPanel, Empty, Icon, Tag, short, useParamState } from './ui';
import { BASE, shortName } from './usage';

const tone = (s: string) => OUTCOME[s]?.tone ?? 'plain';
export function RunHistory({ policy }: { policy: StudioPolicy }) {
  const [chosen, setChosen] = useParamState('r');
  const [offset, setOffset] = useState(0);
  const list = useQuery({ queryKey: ['x4-runs', policy.id, offset], queryFn: () => listRuns({ policy_id: policy.id, limit: 25, offset }), placeholderData: (p) => p });
  if (chosen) return <RunView key={chosen} id={chosen} policy={policy} others={(list.data?.items ?? []).filter((r) => r.id !== chosen)} onBack={() => setChosen(null)} />;
  const items = list.data?.items ?? [];
  return (
    <div className="ap-runs" data-testid="ap-runs" data-state={list.isLoading ? 'loading' : list.isError ? 'error' : 'ready'} data-total={list.data?.total ?? ''}>
      <header className="ap-suites-head"><div><h2>Recorded runs of this policy</h2><p className="ap-quiet">Each run is kept exactly as it was recorded: the policy revision, every scenario, every expectation and every result. Nothing here is ever changed or deleted.</p></div></header>
      {list.isError ? <p className="ap-callout warn">The runs could not be read: {why(list.error)}</p> : null}
      {list.isSuccess && !items.length ? <Empty icon="history" title="No run recorded yet" action={<Link className="ap-btn primary" to="?view=suites">Go to the suites</Link>}>Run a regression suite to record what the policy selects.</Empty> : null}
      {items.length ? <table className="ap-runs-table"><thead><tr><th scope="col">Result</th><th scope="col">Suite</th><th scope="col">Passed</th><th scope="col">Policy</th><th scope="col">Recorded</th><th scope="col">Fingerprint</th></tr></thead>
        <tbody>{items.map((r) => <RunRow key={r.id} r={r} onOpen={() => setChosen(r.id)} />)}</tbody></table> : null}
      {list.data && list.data.total > 25 ? <p className="ap-pager" data-testid="ap-runs-pager"><button type="button" className="ap-btn quiet" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Newer</button><span className="ap-quiet">{offset + 1}–{Math.min(offset + 25, list.data.total)} of {list.data.total}</span><button type="button" className="ap-btn quiet" disabled={offset + 25 >= list.data.total} onClick={() => setOffset(offset + 25)}>Older</button></p> : null}
    </div>
  );
}
function RunRow({ r, onOpen }: { r: RunSummary; onOpen: () => void }) {
  return (
    <tr data-testid={`ap-run-${r.id}`} data-status={r.status}>
      <th scope="row"><button type="button" className="ap-linkbtn strong" onClick={onOpen} data-testid="ap-run-open"><Tag tone={tone(r.status)}>{OUTCOME[r.status]?.word ?? r.status}</Tag></button></th>
      <td>{r.suite_name}<small> · revision {r.suite_revision}</small></td><td>{r.passed} of {r.scenarios}</td><td>revision {r.policy_revision}</td><td>{when(r.created_at)}<small> · {r.created_by}</small></td><td><code title={r.run_sha256}>{short(r.run_sha256)}</code></td>
    </tr>
  );
}

function RunView({ id, policy, others, onBack }: { id: string; policy: StudioPolicy; others: RunSummary[]; onBack: () => void }) {
  const { say } = useAppl();
  const [outcome, setOutcome] = useState<'' | RunResultBrief['outcome']>('');
  const [offset, setOffset] = useState(0);
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [proof, setProof] = useState<Verification | null>(null);
  const [cmp, setCmp] = useState<{ with: string; data: RunComparison } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useQuery({ queryKey: ['x4-run', id, outcome, offset], queryFn: () => getRun(id, { outcome: outcome || undefined, limit: 50, offset }), placeholderData: (p) => p });
  const r = run.data as RunDetail | undefined;
  if (run.isError) return <Empty icon="warn" title="This run could not be read" action={<button type="button" className="ap-btn" onClick={onBack}>Back to the runs</button>}>{why(run.error)}</Empty>;
  if (!r) return <p className="ap-quiet" data-testid="ap-run-view" data-state="loading">Reading the recorded run…</p>;
  const compare = async (target: string) => {
    if (!target) { setCmp(null); return; }
    setBusy(true);
    try { setCmp({ with: target, data: target === 'current' ? await againstCurrent(id) : await compareRuns(target, id) }); } catch (e) { say(why(e), 'warn'); } finally { setBusy(false); }
  };
  const moved = r.policy_revision !== policy.revision;
  return (
    <div className="ap-run" data-testid="ap-run-view" data-state="ready" data-status={r.status} data-fingerprint={r.run_sha256} data-record={r.record_sha256} data-policy-revision={r.policy_revision}>
      <p className="ap-back"><button type="button" className="ap-linkbtn" onClick={onBack} data-testid="ap-run-back"><Icon name="left" size={12} /> All recorded runs</button></p>
      <header className="ap-run-head">
        <div className={`ap-suite-verdict is-${tone(r.status)}`} data-testid="ap-run-verdict"><strong>{OUTCOME[r.status]?.word ?? r.status}</strong><span>{r.passed} passed · {r.failed} failed{r.not_evaluated ? ` · ${r.not_evaluated} could not be evaluated` : ''}{r.invalid ? ` · ${r.invalid} invalid` : ''}{r.no_expectation ? ` · ${r.no_expectation} without an expected outcome` : ''} · of {r.scenarios}</span></div>
        <dl className="ap-run-facts">
          <div><dt>Suite</dt><dd><Link to={`?view=suites&u=${r.suite_id}`}>{r.suite_name}</Link> · revision {r.suite_revision} · {r.suite_purpose === 'PUBLICATION_GATING' ? 'publication-gating' : 'exploratory'}</dd></div>
          <div><dt>Policy</dt><dd>{r.policy_name} · saved revision {r.policy_revision} · <code title={r.policy_document_sha256}>{short(r.policy_document_sha256)}</code></dd></div>
          <div><dt>Recorded</dt><dd>{when(r.created_at)} by {r.created_by} · {r.duration_ms} ms</dd></div>
          <div><dt>Evidence</dt><dd>run <code title={r.run_sha256} data-testid="ap-run-fingerprint">{short(r.run_sha256)}</code> · record <code title={r.record_sha256}>{short(r.record_sha256)}</code> · evaluator <code>{r.evaluator_contract}</code></dd></div>
        </dl>
      </header>
      <p className="ap-callout" data-testid="ap-run-immutable"><Icon name="lock" /> <span><strong>Immutable record.</strong> This is exactly what was evaluated then. {moved ? <>The policy is now at saved revision {policy.revision}; this run still shows revision {r.policy_revision}.</> : 'The policy has not been saved again since.'} A new run is a new record; it never replaces this one.</span></p>
      {r.policy_status !== 'OK' ? <p className="ap-callout warn" data-testid="ap-run-policy-blocked"><Icon name="warn" /> <span>The policy could not be evaluated when this ran: {(r.policy_reasons[0] as { message?: string } | undefined)?.message ?? r.policy_status}. Nothing passed.</span></p> : null}
      <div className="ap-run-tools">
        <button type="button" className="ap-btn" disabled={busy} onClick={async () => { setBusy(true); try { setProof(await verifyRun(id)); } catch (e) { say(why(e), 'warn'); } finally { setBusy(false); } }} data-testid="ap-run-verify"><Icon name="check" size={13} /> Re-evaluate from the record</button>
        <label className="ap-run-compare">Compare with <select className="ap-input" value={cmp?.with ?? ''} onChange={(e) => void compare(e.target.value)} data-testid="ap-run-compare">
          <option value="">nothing</option><option value="current">the policy’s current saved draft (not recorded)</option>
          {others.filter((o) => o.suite_id === r.suite_id).map((o) => <option key={o.id} value={o.id}>the run of {when(o.created_at)} · {OUTCOME[o.status]?.word} · policy revision {o.policy_revision}</option>)}</select></label>
      </div>
      {proof ? <p className={`ap-callout${proof.reproduced ? '' : ' warn'}`} data-testid="ap-run-proof" data-reproduced={String(proof.reproduced)}><Icon name={proof.reproduced ? 'check' : 'warn'} /> <span><strong>{proof.reproduced ? 'Reproduced.' : 'Not reproduced.'}</strong> {proof.results_reproduced} of {proof.results_checked} results re-evaluated to the same fingerprint and verdict; the record {proof.record_intact && proof.run_fingerprint_intact ? 'is intact' : 'does NOT match its fingerprint'}. {proof.note}</span></p> : null}
      {cmp ? <ComparisonView c={cmp.data} policy={policy} /> : null}

      <section className="ap-members" aria-label="Recorded results">
        <header><h3>Expected and actual, scenario by scenario <span className="ap-count">{r.results_total}</span></h3>
          <select className="ap-input" aria-label="Show" value={outcome} onChange={(e) => { setOutcome(e.target.value as typeof outcome); setOffset(0); }} data-testid="ap-run-filter"><option value="">All results</option>{Object.entries(OUTCOME).map(([k, v]) => <option key={k} value={k}>{v.word}</option>)}</select></header>
        <ol className="ap-member-list" data-testid="ap-run-results">
          {r.results.map((x) => { const exp = x.expectation as unknown as Expectation | null; const act = x.actual as { status?: string; selected?: { name: string; version: number }[]; pending?: string[] }; return (
            <li key={x.position} className={`ap-member is-${x.outcome.toLowerCase()}`} data-testid={`ap-result-${x.scenario_code}`} data-outcome={x.outcome} data-plan={x.plan_fingerprint ?? ''}>
              <div className="ap-member-row">
                <span className="ap-member-order"><b>{x.position}</b></span>
                <span className="ap-member-name"><strong>{x.scenario_name}</strong><small>{x.scenario_code} · as it was at revision {x.scenario_revision}</small></span>
                <span className="ap-member-exp"><small>Expected</small>{exp ? <Brief status={exp.status} surveys={exp.selected.map((s) => `${shortName(s.name)}${s.version ? ` v${s.version}` : ''}`)} pending={exp.pending.length} /> : <em className="ap-quiet">not stated</em>}</span>
                <span className="ap-member-act"><small>Actual</small>{act.status ? <Brief status={act.status} surveys={(act.selected ?? []).map((s) => `${shortName(s.name)} v${s.version}`)} pending={act.pending?.length} /> : <em className="ap-quiet">not evaluated</em>}</span>
                <span className="ap-member-verdict"><Tag tone={tone(x.outcome)}>{OUTCOME[x.outcome]?.word ?? x.outcome}</Tag></span>
                <button type="button" className="ap-btn quiet" onClick={() => setOpenAt(x.position)} data-testid={`ap-result-${x.scenario_code}-open`}>Full result</button>
              </div>
              {x.differences.length ? <ul className="ap-member-diffs" data-testid={`ap-result-${x.scenario_code}-differences`}>{(x.differences as unknown as Difference[]).map((d, k) => <li key={k} data-kind={d.kind}><Icon name="warn" size={12} /> {d.text}{d.requirements?.length ? <> · {d.requirements.slice(0, 3).map((rid) => <Link key={rid} to={`${BASE}/policies/${policy.code}?r=${rid}`}>open requirement {rid}</Link>)}</> : null}</li>)}</ul> : null}
              {x.reason && x.outcome !== 'PASSED' && x.outcome !== 'FAILED' ? <p className="ap-member-diffs"><Icon name="warn" size={12} /> {x.reason}</p> : null}
            </li>); })}
        </ol>
        {r.results_total > 50 ? <p className="ap-pager" data-testid="ap-run-pager"><button type="button" className="ap-btn quiet" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} data-testid="ap-run-prev">Previous</button><span className="ap-quiet" data-testid="ap-run-range">{offset + 1}–{Math.min(offset + 50, r.results_total)} of {r.results_total}</span><button type="button" className="ap-btn quiet" disabled={offset + 50 >= r.results_total} onClick={() => setOffset(offset + 50)} data-testid="ap-run-next">Next</button></p> : null}
      </section>
      <CoveragePanel cov={r.coverage as unknown as Coverage} policy={policy} purpose={r.suite_purpose} />
      {openAt !== null ? <ResultDrawer runId={id} position={openAt} policy={policy} onClose={() => setOpenAt(null)} /> : null}
    </div>
  );
}
function Brief({ status, surveys, pending }: { status: string; surveys: string[]; pending?: number }) {
  return <span className="ap-xout" data-status={status}><b className={`is-${status === 'RESOLVED' ? 'true' : 'unknown'}`}>{STATUS_WORD[status] ?? status}</b>{surveys.length ? surveys.map((s) => <span key={s} className="ap-chip survey">{s}</span>) : <span className="ap-chip plain">no survey</span>}{pending ? <span className="ap-chip plain">+{pending} pending</span> : null}</span>;
}

function ResultDrawer({ runId, position, policy, onClose }: { runId: string; position: number; policy: StudioPolicy; onClose: () => void }) {
  const { look, setPreview } = useAppl();
  const q = useQuery({ queryKey: ['x4-run-result', runId, position], queryFn: () => getRunResult(runId, position) });
  const x = q.data;
  const facts = ((x?.scenario_document as { facts?: Record<string, unknown> } | undefined)?.facts ?? {}) as Record<string, unknown>;
  const plan = x?.plan as unknown as Plan | null | undefined;
  return (
    <DrawerPanel title={x ? x.scenario_name : 'Recorded result'} subtitle={x ? <>{OUTCOME[x.outcome]?.word} · recorded at scenario revision {x.scenario_revision}</> : undefined} onClose={onClose} wide testid="ap-result-drawer">
      {q.isError ? <p className="ap-callout warn">{why(q.error)}</p> : !x ? <p className="ap-quiet">Reading the recorded result…</p> : <div className="ap-result-full" data-outcome={x.outcome} data-plan={x.plan_fingerprint ?? ''}>
        <p className="ap-quiet">Everything below is the record: the facts as they were, the definitions that were read, and the complete plan the evaluator returned. Result <code title={x.plan_fingerprint ?? ''}>{short(x.plan_fingerprint)}</code> · scenario <code title={x.scenario_fingerprint ?? ''}>{short(x.scenario_fingerprint)}</code>{x.reproducible ? '' : ' · read an unpublished definition, so not reproducible evidence'}.</p>
        <h3>Facts as recorded</h3>
        <ul className="ap-diff-facts" data-testid="ap-result-facts">{Object.entries(facts).map(([k, v]) => <li key={k}><strong>{look.variable(k)?.name ?? k}</strong> <span className="now">{factWord(v)}</span></li>)}{!Object.keys(facts).length ? <li className="ap-quiet">No fact was given.</li> : null}</ul>
        <h3>Read at these exact versions</h3>
        <ul className="ap-deps-list">{(x.resolved as unknown as Dep[]).map((d) => <li key={`${d.kind}-${d.code}`}><Icon name={d.kind === 'PROFILE' ? 'profile' : 'variable'} size={13} /> <strong>{d.name}</strong> <span className="ap-dep-at">{d.state === 'PUBLISHED' ? `version ${d.version_no}` : `draft revision ${d.draft_revision}`} · <code title={d.content_sha256}>{short(d.content_sha256)}</code></span></li>)}</ul>
        {x.differences.length ? <><h3>Why it failed</h3><ul className="ap-member-diffs">{(x.differences as unknown as Difference[]).map((d, k) => <li key={k}><Icon name="warn" size={12} /> {d.text}</li>)}</ul></> : null}
        <h3>What the policy selected</h3>
        {plan ? <PlanView plan={plan} testid="ap-result-plan" onSurvey={(c) => { const e = [...plan.selected, ...plan.pending].find((y) => y.survey.code === c); if (e) setPreview(e.survey); }} /> : <p className="ap-callout warn">{x.reason ?? 'It could not be evaluated.'}</p>}
        {plan ? <p className="ap-quiet">Select a survey to preview its published content. <Link to={`${BASE}/policies/${policy.code}`}>Open the policy in the designer</Link>.</p> : null}
      </div>}
    </DrawerPanel>
  );
}

function ComparisonView({ c, policy }: { c: RunComparison; policy: StudioPolicy }) {
  const { look } = useAppl();
  const rows = c.scenarios as unknown as PairRow[];
  const deps = c.dependency_changes as unknown as { kind: string; code: string; before: string | null; after: string | null; change: string }[];
  const after = c.after as { policy_revision?: number; recorded?: boolean; created_at?: string };
  const [all, setAll] = useState(false);
  const shown = rows.filter((r) => all || r.changed);
  return (
    <section className="ap-coverage ap-compare" data-testid="ap-run-comparison" data-kind={c.kind} data-changed={c.changed} data-unchanged={c.unchanged} aria-label="Comparison">
      <header><h3>{c.kind === 'RUN_TO_CURRENT_DRAFT' ? 'This run against the policy’s current saved draft' : 'Between two recorded runs'}</h3><Tag tone={c.changed ? 'warn' : 'published'}>{c.changed ? `${c.changed} scenario${c.changed === 1 ? '' : 's'} differ` : 'No difference'}</Tag></header>
      <p className="ap-quiet" data-testid="ap-run-comparison-note">Before: policy revision {c.before.policy_revision}, recorded {when(c.before.created_at)}. After: policy revision {after.policy_revision}{after.recorded === false ? ', evaluated now and NOT recorded' : after.created_at ? `, recorded ${when(after.created_at)}` : ''}. {c.note}</p>
      {deps.length ? <ul className="ap-gaps" data-testid="ap-run-comparison-deps">{deps.map((d, i) => <li key={i}><Icon name="link" size={12} /> {d.kind.toLowerCase()} <strong>{d.code}</strong>: {d.change === 'ADDED' ? `added at ${d.after}` : d.change === 'REMOVED' ? `no longer read (was ${d.before})` : `${d.before} → ${d.after}`}</li>)}</ul> : <p className="ap-quiet">{c.policy_changed ? 'The policy document changed; its dependencies did not.' : 'The policy and its dependencies are the same.'}</p>}
      <ul className="ap-compare-rows">{shown.map((r) => (
        <li key={r.scenario_id} data-testid="ap-compare-row" data-changed={String(r.changed)}>
          <header><strong>{r.scenario_name}</strong>{r.in !== 'BOTH' ? <Tag tone="info">{r.in === 'AFTER_ONLY' ? 'only in the later run' : 'only in the earlier run'}</Tag> : null}
            {r.outcome_before !== r.outcome_after ? <span className="ap-compare-verdict"><Tag tone={tone(r.outcome_before ?? '')}>{OUTCOME[r.outcome_before ?? '']?.word ?? '—'}</Tag> <Icon name="arrow" size={12} /> <Tag tone={tone(r.outcome_after ?? '')}>{OUTCOME[r.outcome_after ?? '']?.word ?? '—'}</Tag></span> : <Tag tone={tone(r.outcome_after ?? '')}>{OUTCOME[r.outcome_after ?? '']?.word ?? '—'}</Tag>}</header>
          {r.facts_changed.length ? <p>{r.facts_changed.map((f) => <span key={f.variable} className="ap-chip fact">fact {look.variable(f.variable)?.name ?? f.variable}: {factWord(f.before, f.before_given)} → {factWord(f.after, f.after_given)}</span>)}</p> : null}
          {r.expectation_changed ? <p><span className="ap-chip plain">the expected outcome was changed</span></p> : null}
          {r.comparison ? <p className="ap-diff-surveys">
            {r.comparison.added.map((s) => <span key={s} className="ap-chip survey is-added" data-change="added">+ {shortName(s)}</span>)}
            {r.comparison.removed.map((s) => <span key={s} className="ap-chip plain is-removed" data-change="removed">− {shortName(s)}</span>)}
            {r.comparison.revised.map((s) => <span key={s} className="ap-chip survey" data-change="revised">{shortName(s)}</span>)}
            {r.comparison.pending_added.map((s) => <span key={s} className="ap-chip plain" data-change="pending">now pending: {s}</span>)}
            {r.comparison.new_unknown ? <span className="ap-chip plain" data-change="unresolved">newly unresolved</span> : null}{r.comparison.now_resolved ? <span className="ap-chip plain" data-change="resolved">now resolved</span> : null}
            {!r.comparison.changed ? <span className="ap-quiet">Same selection.</span> : null}
          </p> : null}
          {r.comparison?.because.length ? <ul className="ap-diff-why">{r.comparison.because.map((b) => <li key={b.requirement}><Link to={`${BASE}/policies/${policy.code}?r=${b.requirement}`}>{b.text}</Link></li>)}</ul> : null}
        </li>))}</ul>
      {!shown.length ? <p className="ap-quiet">No scenario differs.</p> : null}
      {c.unchanged ? <button type="button" className="ap-linkbtn" onClick={() => setAll(!all)} data-testid="ap-compare-all">{all ? 'Show only what differs' : `Also show the ${c.unchanged} unchanged`}</button> : null}
    </section>
  );
}
