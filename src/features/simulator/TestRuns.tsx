// S2-E test runs: recorded single / batch runs and two-version comparisons, each result with its explained
// differences, the exact script snapshot and scenario revision used, structural coverage and the controller trace.
import { DISCLAIMER, EvaluationTable, EvaluationTotals, totalsOf, type EvaluationItem } from './AnswerEvaluation';
import { FindingsView, type Finding } from './RunFindings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useId, useMemo, useState } from 'react';
import { api, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useAuth } from '../../auth/AuthContext';
import { Empty } from '../../components/StateView';
import { Badge, Button, Card } from '../../components/ui';
import { humanize, Region, when } from '../cases/shared';
import { ErrorBox, Field } from '../scripts/ScriptEditor';
import { ActualSummary, errorText, LINK_BUTTON, ResultExplanation, STATUS_TONE, useVersions, VersionOptions } from './ScenarioLibrary';

type Batch = components['schemas']['SimBatchOut'];
type Result = components['schemas']['SimResultOut'];
type Totals = Record<string, Record<string, number>>;

export function TestRuns({ batchId, onSelect, onOpenScenario }: { batchId: string | null; onSelect: (id: string) => void; onOpenScenario: (id: string) => void }) {
  const list = useQuery({ queryKey: ['sim-batches'], queryFn: async () => unwrap(await api.GET('/api/v1/simulation-runs')) });
  return (
    <div className="layout sd-grid">
      <div className="stack" style={{ gap: 16 }}>
        <CompareForm onDone={onSelect} />
        <Card title="Test runs" subtitle="Newest first">
          <Region query={list} label="test runs">
            {() => (
              <ul className="plain-list stack" style={{ gap: 0 }} data-testid="batch-list">
                {list.data!.items.map((b) => {
                  const t = (b.totals as Totals).A ?? {};
                  return (
                    <li key={b.id}><button type="button" className={`script-item${b.id === batchId ? ' active' : ''}`} style={{ textAlign: 'left', width: '100%', background: 'none' }} onClick={() => onSelect(b.id)} aria-current={b.id === batchId ? 'true' : undefined} data-testid={`batch-${b.batch_ref}`}>
                      <div className="row between"><strong className="small mono">{b.batch_ref}</strong><Badge tone={b.kind === 'COMPARISON' ? 'purple' : 'blue'}>{b.kind === 'COMPARISON' ? 'Comparison' : 'Run'}</Badge></div>
                      <div className="xsmall muted" style={{ marginTop: 4 }}>{t.PASSED ?? 0} passed · {t.FAILED ?? 0} failed{t.ERROR ? ` · ${t.ERROR} error` : ''}{t.INVALID ? ` · ${t.INVALID} invalid` : ''} · {b.version_b ? `${b.version_a} vs ${b.version_b}` : b.version_a ?? 'own versions'} · {when(b.started_at)}</div>
                    </button></li>
                  );
                })}
                {!list.data!.items.length ? <li className="small muted">No test runs yet. Run scenarios from the library.</li> : null}
              </ul>
            )}
          </Region>
        </Card>
      </div>
      <div className="stack" style={{ gap: 16 }}>
        {batchId ? <BatchView id={batchId} onOpenScenario={onOpenScenario} /> : <Card><Empty title="Choose a test run">Results show expected versus actual controller behaviour, coverage and comparisons.</Empty></Card>}
      </div>
    </div>
  );
}

function CompareForm({ onDone }: { onDone: (id: string) => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const uid = useId();
  const versions = useVersions();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const fam = versions.data?.items.find((v) => v.id === a)?.family_id;
  const scenarios = useQuery({ enabled: !!fam, queryKey: ['scenarios-fam', fam], queryFn: async () => unwrap(await api.GET('/api/v1/simulation-scenarios', { params: { query: { family_id: fam } } })) });
  const [picked, setPicked] = useState<string[] | null>(null);
  const ids = picked ?? (scenarios.data?.items.map((s) => s.id) ?? []);
  const run = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/simulation-runs', { body: { scenario_ids: ids, script_version_id: a, compare_with_version_id: b || null } })),
    onSuccess: (x) => { void qc.invalidateQueries({ queryKey: ['sim-batches'] }); void qc.invalidateQueries({ queryKey: ['scenarios'] }); onDone(x.id); },
  });
  if (!can('script.simulate')) return null;
  const sameFamily = (versions.data?.items ?? []).filter((v) => v.family_id === fam && v.id !== a);
  return (
    <Card title="Run scenarios against versions" subtitle="One version, or compare two versions of the same script">
      <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); run.mutate(); }} data-testid="compare-form">
        <Field id={`${uid}-a`} label="Version A">{(p) => <select {...p} className="field labelled" value={a} onChange={(e) => { setA(e.target.value); setB(''); setPicked(null); }} data-testid="cmp-a"><option value="">Choose…</option><VersionOptions items={versions.data?.items ?? []} /></select>}</Field>
        <Field id={`${uid}-b`} label="Version B (optional — compare)">{(p) => <select {...p} className="field labelled" value={b} onChange={(e) => setB(e.target.value)} disabled={!a} data-testid="cmp-b"><option value="">No comparison</option><VersionOptions items={sameFamily} /></select>}</Field>
        {fam ? (
          <fieldset className="stack xsmall" style={{ gap: 2, border: 0, padding: 0 }} data-testid="cmp-scenarios">
            <legend className="xsmall strong">Scenarios of this script ({ids.length} selected)</legend>
            {(scenarios.data?.items ?? []).map((s) => <label key={s.id} className="row" style={{ gap: 6 }}><input type="checkbox" checked={ids.includes(s.id)} onChange={() => setPicked(ids.includes(s.id) ? ids.filter((x) => x !== s.id) : [...ids, s.id])} /> {s.name} <span className="muted mono">{s.scenario_ref}</span></label>)}
            {scenarios.data && !scenarios.data.items.length ? <span className="muted">No scenarios for this script yet.</span> : null}
          </fieldset>
        ) : null}
        <div><Button type="submit" variant="primary" icon="play" disabled={!a || !ids.length || run.isPending} data-testid="cmp-run">{run.isPending ? 'Running…' : b ? 'Run comparison' : 'Run'}</Button></div>
        <ErrorBox error={run.error ? errorText(run.error) : null} />
      </form>
    </Card>
  );
}

function BatchView({ id, onOpenScenario }: { id: string; onOpenScenario: (id: string) => void }) {
  const q = useQuery({ queryKey: ['sim-batch', id], queryFn: async () => unwrap(await api.GET('/api/v1/simulation-runs/{batch_id}', { params: { path: { batch_id: id } } })) });
  return (
    <Region query={q} label="the test run">
      {() => {
        const b = q.data!;
        return (
          <>
            <section className="card card-pad stack" style={{ gap: 10 }} data-testid="batch-header">
              <div className="row wrap" style={{ gap: 8 }}><span className="mono strong">{b.batch_ref}</span><Badge tone={b.kind === 'COMPARISON' ? 'purple' : 'blue'}>{b.kind === 'COMPARISON' ? 'Version comparison' : 'Scenario run'}</Badge>
                <span className="small muted">{b.version_b ? `A: ${b.version_a} · B: ${b.version_b}` : b.version_a ? `All against ${b.version_a}` : "Each scenario's own version"} · {b.started_by ?? '—'} · {when(b.started_at)}</span></div>
              <Totals totals={b.totals as Totals} comparison={b.kind === 'COMPARISON'} />
              <p className="xsmall muted" style={{ margin: 0 }}>{b.note}</p>
            </section>
            {b.kind === 'COMPARISON' ? <Comparison b={b} /> : null}
            <ResultsTable b={b} onOpenScenario={onOpenScenario} />
            {b.coverage.map((c, i) => <CoverageCard key={i} c={c} comparison={b.kind === 'COMPARISON'} />)}
          </>
        );
      }}
    </Region>
  );
}

function Totals({ totals, comparison }: { totals: Totals; comparison: boolean }) {
  return (
    <div className="info-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))' }} data-testid="batch-totals">
      {Object.entries(totals).sort().map(([side, t]) => ['PASSED', 'FAILED', 'ERROR', 'INVALID', 'STALE'].map((k) => (
        <div key={`${side}${k}`} className="info-tile"><label>{comparison ? `${side} · ` : ''}{k === 'INVALID' ? 'Invalid' : k === 'STALE' ? 'Stale' : k === 'ERROR' ? 'Execution error' : humanize(k)}</label><strong>{t[k] ?? 0}</strong></div>
      )))}
    </div>
  );
}

function ResultsTable({ b, onOpenScenario }: { b: Batch; onOpenScenario: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(b.results.find((r) => r.status !== 'PASSED')?.id ?? null);
  return (
    <Card title="Results" subtitle="Expected versus actual controller behaviour; select a row for the explanation and trace">
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Results"><table className="data-table" data-testid="batch-results">
        <thead><tr><th>Scenario</th>{b.kind === 'COMPARISON' ? <th>Side</th> : null}<th>Version</th><th>Status</th><th>Actual outcome</th><th /></tr></thead>
        <tbody>{b.results.map((r) => {
          const a = r.actual as Record<string, unknown>;
          return (
            <Fragment key={r.id}>
              <tr data-testid={`result-${r.scenario_ref}-${r.side}`}>
                <td><button type="button" className="link" style={LINK_BUTTON} onClick={() => onOpenScenario(r.scenario_id)}>{r.scenario_name}</button><div className="xsmall muted mono">{r.scenario_ref} r{r.revision}</div></td>
                {b.kind === 'COMPARISON' ? <td>{r.side}</td> : null}
                <td className="small">{r.version_label}{r.version_status === 'DRAFT' ? ' (draft)' : ''}<div className="xsmall muted mono" title="Exact script content snapshot used">{r.content_sha256 ? `snapshot ${r.content_sha256.slice(0, 10)}…` : '—'}</div></td>
                <td><Badge tone={STATUS_TONE[r.status] ?? 'gray'}>{r.status === 'ERROR' ? 'Execution error' : humanize(r.status)}</Badge>{r.stale ? <> <Badge tone="amber">Stale</Badge></> : null}</td>
                <td className="small">{a.outcome ? `${humanize(String(a.outcome))}${a.termination_reason ? ` · ${humanize(String(a.termination_reason))}` : ''}` : '—'}</td>
                <td><Button tiny onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id} data-testid={`result-open-${r.scenario_ref}-${r.side}`}>{open === r.id ? 'Hide' : 'Details'}</Button></td>
              </tr>
              {open === r.id ? <tr><td colSpan={6}><ResultDetail r={r} /></td></tr> : null}
            </Fragment>
          );
        })}</tbody>
      </table></div>
    </Card>
  );
}

function ResultDetail({ r }: { r: Result }) {
  return (
    <div className="stack" style={{ gap: 10, whiteSpace: 'normal' }} data-testid="result-detail">
      <ResultExplanation status={r.status} failures={r.failures} problems={r.problems} error={r.error} stale={r.stale_reasons} />
      <ActualSummary a={r.actual as Record<string, unknown>} />
      {Array.isArray((r.actual as { evaluations?: unknown }).evaluations) ? (
        <div className="stack" style={{ gap: 6 }} data-testid="result-evaluation">
          <div className="row wrap" style={{ gap: 8 }}><strong className="small">Answer evaluation</strong>
            <EvaluationTotals totals={totalsOf((r.actual as { evaluations: EvaluationItem[] }).evaluations)} testId="result-eval-totals" /></div>
          <p className="xsmall muted" style={{ margin: 0 }}>{DISCLAIMER} Facts: scenario revision ({String(((r.actual as { fact_source?: { sha256?: string } }).fact_source ?? {}).sha256 ?? '—').slice(0, 12)}…).</p>
          <EvaluationTable items={(r.actual as { evaluations: EvaluationItem[] }).evaluations} testId="result-eval-table" />
        </div>
      ) : null}
      {Array.isArray((r.actual as { findings?: unknown }).findings) ? (
        <div className="stack" style={{ gap: 6 }} data-testid="result-findings">
          <strong className="small">Findings · {String(((r.actual as { finding_rule_set?: { label?: string } }).finding_rule_set ?? {}).label ?? '')}</strong>
          <FindingsView findings={(r.actual as { findings: Finding[] }).findings} notConverted={((r.actual as { findings_not_converted?: Record<string, unknown>[] }).findings_not_converted) ?? []} human={[]} testId="result-findings-view" />
        </div>
      ) : (r.actual as { evaluations?: unknown }).evaluations ? <p className="xsmall muted" style={{ margin: 0 }} data-testid="result-no-rules">No finding rule set was published when this ran, so no findings were generated.</p> : null}
      {r.response_log.length ? (
        <details><summary className="small strong" style={{ cursor: 'pointer', minHeight: 28, display: 'flex', alignItems: 'center' }}>How each item was answered ({r.response_log.length})</summary>
          <ol className="plain-list xsmall" style={{ margin: '6px 0 0' }}>{r.response_log.map((l, i) => <li key={i}><span className="mono">{String(l.action_id)}</span> — {String(l.response)} <span className="muted">({String(l.by)})</span></li>)}</ol></details>
      ) : null}
      {r.events.length ? (
        <details><summary className="small strong" style={{ cursor: 'pointer', minHeight: 28, display: 'flex', alignItems: 'center' }}>Controller trace ({r.events.length} events)</summary>
          <ol className="plain-list xsmall" style={{ margin: '6px 0 0' }} data-testid="result-trace">{r.events.map((e, i) => {
            const d = (e.data ?? {}) as Record<string, unknown>;
            const extra = ['status', 'answer_kind', 'value', 'gate', 'reason', 'kind', 'detail', 'outcome'].filter((k) => d[k] != null && typeof d[k] !== 'object').map((k) => `${k}: ${String(d[k])}`).join(' · ');
            return <li key={i}><Badge tone="gray">{humanize(String(e.type))}</Badge> <span className="mono">{String(e.action_id ?? e.question_code ?? '')}</span> {extra}</li>;
          })}</ol></details>
      ) : null}
    </div>
  );
}

function Comparison({ b }: { b: Batch }) {
  return (
    <Card title="Version comparison" subtitle="Per scenario: applicability, sequencing and controller outcome differences (A → B)">
      <div className="stack" style={{ gap: 12 }} data-testid="comparison">
        {b.comparison.map((c) => {
          const pd = c.plan_diff as Record<string, unknown> | null;
          const od = (c.outcome_diff as { field: string; a: unknown; b: unknown }[]) ?? [];
          const list = (k: string) => ((pd?.[k] as string[]) ?? []);
          const show = (v: unknown) => (Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? Object.values(x as Record<string, unknown>).filter(Boolean).join(' ') : String(x))).join(Array.isArray(v) && v.some((x) => typeof x === 'object') ? '; ' : ' → ') || '—' : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${String(x)}`).join(', ') : v == null ? '—' : String(v));
          return (
            <div key={String(c.scenario_id)} className="softbox stack" style={{ gap: 6 }} data-testid={`cmp-${String(c.scenario_ref)}`}>
              <div className="row wrap" style={{ gap: 6 }}><strong className="small">{String(c.scenario_name)}</strong>
                <Badge tone={STATUS_TONE[String(c.status_a)] ?? 'gray'}>{`A: ${humanize(String(c.status_a))}`}</Badge><Badge tone={STATUS_TONE[String(c.status_b)] ?? 'gray'}>{`B: ${humanize(String(c.status_b))}`}</Badge>
                {!od.length && pd && !list('only_in_a').length && !list('only_in_b').length && !pd.order_changed && !((pd.item_changes as unknown[]) ?? []).length && !((pd.rule_changes as unknown[]) ?? []).length ? <Badge tone="green">No difference</Badge> : null}</div>
              {pd ? (
                <ul className="plain-list xsmall stack" style={{ gap: 2 }}>
                  {list('only_in_a').length ? <li>Removed in B: <span className="mono">{list('only_in_a').join(', ')}</span></li> : null}
                  {list('only_in_b').length ? <li>Added in B: <span className="mono">{list('only_in_b').join(', ')}</span></li> : null}
                  {list('applicable_only_in_a').length ? <li>Applies only in A (these facts): <span className="mono">{list('applicable_only_in_a').join(', ')}</span></li> : null}
                  {list('applicable_only_in_b').length ? <li>Applies only in B (these facts): <span className="mono">{list('applicable_only_in_b').join(', ')}</span></li> : null}
                  {pd.order_changed ? <li>Delivery order of shared questions changed</li> : null}
                  {((pd.item_changes as { question: string; changes: Record<string, { from: unknown; to: unknown }> }[]) ?? []).map((x) => (
                    <li key={x.question}>Changed in B: <span className="mono">{x.question}</span> — {Object.entries(x.changes).map(([k, v]) => `${humanize(k.toUpperCase())}: ${typeof v.from === 'string' ? humanize(v.from) : String(v.from)} → ${typeof v.to === 'string' ? humanize(v.to) : String(v.to)}`).join('; ')}</li>))}
                  {((pd.rule_changes as { question: string; from: string; to: string }[]) ?? []).map((x) => (
                    <li key={`rule-${x.question}`} data-testid={`rule-change-${x.question}`}>Evaluation rule changed in B: <span className="mono">{x.question}</span> — {x.from} → {x.to}</li>))}
                </ul>
              ) : <p className="xsmall muted" style={{ margin: 0 }}>No plan comparison (a side could not run).</p>}
              {od.length ? (
                <table className="data-table"><thead><tr><th>Controller result</th><th>A</th><th>B</th></tr></thead>
                  <tbody>{od.map((x) => <tr key={x.field}><td className="small">{x.field.startsWith('evaluation:') ? <>Answer evaluation <span className="mono">{x.field.slice(11)}</span></> : x.field === 'findings' ? 'Findings (question · category · severity)' : humanize(x.field.toUpperCase())}</td><td className="xsmall mono" style={{ whiteSpace: 'normal' }}>{show(x.a)}</td><td className="xsmall mono" style={{ whiteSpace: 'normal' }}>{show(x.b)}</td></tr>)}</tbody></table>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CoverageCard({ c, comparison }: { c: Record<string, unknown>; comparison: boolean }) {
  const l = (k: string) => (c[k] as string[]) ?? [];
  const total = Number(c.questions_total ?? 0);
  const unresolved = (c.mandatory_unresolved as { question: string; reasons: string[] }[]) ?? [];
  const pct = useMemo(() => (total ? Math.round((l('questions_exercised').length / total) * 100) : 0), [c]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card title={`Coverage${comparison ? ` · ${String(c.side)}` : ''} · ${String(c.version_label)}`} subtitle={`${String(c.runs)} executed scenario(s) · snapshot ${String(c.content_sha256).slice(0, 10)}…`}>
      <div className="stack" style={{ gap: 10 }} data-testid="coverage">
        <p className="topnotice" role="note" style={{ margin: 0 }}><span>{String(c.note)}</span></p>
        <div className="info-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
          <div className="info-tile"><label>Questions exercised</label><strong>{l('questions_exercised').length} / {total} ({pct}%)</strong></div>
          <div className="info-tile"><label>Conditional modules exercised</label><strong>{l('conditional_modules_exercised').length} / {l('conditional_modules').length}</strong></div>
          <div className="info-tile"><label>Lifecycle paths exercised</label><strong>{l('lifecycle_paths_exercised').length} / {l('lifecycle_paths_possible').length}</strong></div>
          <div className="info-tile"><label>Mandatory never completed</label><strong>{l('mandatory_never_completed').length}</strong></div>
        </div>
        <dl className="kv xsmall">
          <dt>Not exercised</dt><dd className="mono">{l('questions_not_exercised').join(', ') || 'none'}</dd>
          <dt>Modules not exercised</dt><dd className="mono">{l('conditional_modules_not_exercised').join(', ') || 'none'}</dd>
          <dt>Paths exercised</dt><dd>{l('lifecycle_paths_exercised').map((p) => <Fragment key={p}><Badge tone="green">{humanize(p)}</Badge> </Fragment>)}</dd>
          <dt>Paths not exercised</dt><dd>{l('lifecycle_paths_not_exercised').map((p) => <Fragment key={p}><Badge tone="gray">{humanize(p)}</Badge> </Fragment>)}</dd>
          <dt>Unresolved mandatory</dt><dd>{unresolved.length ? unresolved.map((u) => `${u.question} (${u.reasons.join(', ')})`).join('; ') : 'none'}</dd>
          <dt>Mandatory never completed</dt><dd className="mono">{l('mandatory_never_completed').join(', ') || 'none'}</dd>
          <dt>Evaluation results observed</dt><dd data-testid="coverage-evaluations">{((c.evaluation_results_observed as { question: string; results: string[] }[]) ?? [])
            .filter((x) => x.results.some((r) => !['NOT_EVALUATED', 'NOT_APPLICABLE'].includes(r)))
            .map((x) => `${x.question}: ${x.results.map((r) => humanize(r).toLowerCase()).join(', ')}`).join('; ') || 'none'}</dd>
        </dl>
      </div>
    </Card>
  );
}
