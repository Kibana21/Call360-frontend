// S3-A deterministic answer evaluation views: the per-question table (question, expected value, actual answer, method,
// result, explanation) and, for an interactive run, the evaluation record with its evidence trace and replay check.
// The backend engine decides every result; this UI only displays them.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { api, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { Badge, Button, Card, type Tone } from '../../components/ui';
import { humanize, when } from '../cases/shared';
import { METHOD_LABEL } from '../scripts/ScriptEditor';
import { ErrorBox, errorText } from '../scripts/ScriptEditor';
import { RunFindings } from './RunFindings';

export type EvaluationItem = components['schemas']['AnswerEvaluationItem'];
type Evaluation = components['schemas']['SimEvaluationOut'];

export const EVAL_TONE: Record<string, Tone> = {
  MATCH: 'green', MISMATCH: 'red', UNRESOLVED: 'amber', NOT_ASKED: 'amber', MISSING_EXPECTED_FACT: 'amber',
  NOT_APPLICABLE: 'gray', NOT_EVALUATED: 'gray', HUMAN_ASSESSMENT_REQUIRED: 'purple',
};
export const EVAL_LABEL: Record<string, string> = {
  MATCH: 'Match', MISMATCH: 'Mismatch', UNRESOLVED: 'Unresolved', NOT_ASKED: 'Not asked', MISSING_EXPECTED_FACT: 'Missing expected fact',
  NOT_APPLICABLE: 'Not applicable', NOT_EVALUATED: 'Not evaluated', HUMAN_ASSESSMENT_REQUIRED: 'Human assessment required',
};
const ORDER = ['MISMATCH', 'UNRESOLVED', 'MISSING_EXPECTED_FACT', 'NOT_ASKED', 'HUMAN_ASSESSMENT_REQUIRED', 'MATCH', 'NOT_EVALUATED', 'NOT_APPLICABLE'];
export const DISCLAIMER = 'Deterministic comparison with the approved expected values. A match is not a compliance pass; a mismatch is a discrepancy for review, not a finding or breach. Controller completion is reported separately.';

function shown(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (Array.isArray(v)) return v.map(String).join(' or ');
  return String(v);
}

function expectedText(x: EvaluationItem): string {
  const e = (x.expected ?? null) as { value?: unknown; unit?: string; operator?: string; tolerance?: string; source?: string } | null;
  if (!e) return x.rule_text;
  const ops: Record<string, string> = { EQ: '', GTE: '≥ ', LTE: '≤ ', GT: '> ', LT: '< ' };
  const tol = e.tolerance && Number(e.tolerance) > 0 ? ` ± ${e.tolerance}` : '';
  const src = e.source?.startsWith('POLICY_FACT:') ? ` (policy fact ${e.source.slice(12)})` : '';
  return `${ops[e.operator ?? 'EQ'] ?? ''}${shown(e.value)}${e.unit ? ` ${e.unit.toLowerCase()}` : ''}${tol}${src}`;
}

function answerText(x: EvaluationItem): string {
  const a = x.answer as { kind?: string; value?: unknown; state?: string } | null;
  if (!a) return '—';
  if (a.kind !== 'ANSWER') return humanize(a.kind ?? '');
  return shown(a.value);
}

export function EvaluationTotals({ totals, testId = 'eval-totals' }: { totals: Record<string, number>; testId?: string }) {
  return (
    <div className="row wrap" style={{ gap: 6 }} data-testid={testId}>
      {ORDER.filter((k) => (totals[k] ?? 0) > 0).map((k) => <Badge key={k} tone={EVAL_TONE[k] ?? 'gray'}>{`${EVAL_LABEL[k]} ${totals[k]}`}</Badge>)}
    </div>
  );
}

export function totalsOf(items: EvaluationItem[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const x of items) t[x.result] = (t[x.result] ?? 0) + 1;
  return t;
}

/** Question · expected · actual · method · result · explanation, with the per-question evidence on expand. */
export function EvaluationTable({ items, testId = 'eval-table', hideStatements = true }: { items: EvaluationItem[]; testId?: string; hideStatements?: boolean }) {
  const [all, setAll] = useState(!hideStatements);
  const rows = all ? items : items.filter((x) => !(x.result === 'NOT_EVALUATED' && !x.answer && x.rule_text.startsWith('Statement')));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Answer evaluation"><table className="data-table" data-testid={testId}>
        <thead><tr><th>Question</th><th>Expected value</th><th>Actual answer</th><th>Method</th><th>Result</th></tr></thead>
        <tbody>{rows.map((x) => {
          const raw = (x.answer as { value?: unknown } | null)?.value;
          const norm = x.normalized_answer != null && String(x.normalized_answer).toLowerCase() !== shown(raw).toLowerCase() ? shown(x.normalized_answer) : null;
          return (
            <Fragment key={x.question_code}>
              <tr data-testid={`eval-${x.question_code}`} style={{ borderBottom: 0 }}>
                <td><span className="mono small">{x.question_code}</span> {x.mandatory ? <Badge tone="red">Mandatory</Badge> : null}
                  <div className="xsmall muted">r{x.revision}{x.stage ? ` · ${humanize(x.stage)}` : ''}</div></td>
                <td className="small" style={{ whiteSpace: 'normal' }}>{expectedText(x)}</td>
                <td className="small" style={{ whiteSpace: 'normal' }}>{answerText(x)}{norm ? <div className="xsmall muted">normalised {norm}</div> : null}</td>
                <td className="xsmall" style={{ whiteSpace: 'normal' }}>{METHOD_LABEL[x.method] ?? humanize(x.method)}</td>
                <td><Badge tone={EVAL_TONE[x.result] ?? 'gray'}>{EVAL_LABEL[x.result] ?? humanize(x.result)}</Badge></td>
              </tr>
              <tr data-testid={`eval-why-${x.question_code}`}>
                <td colSpan={5} className="xsmall" style={{ whiteSpace: 'normal', paddingTop: 0 }}>
                  <span className="muted">Explanation: </span>{x.explanation}
                  <details style={{ marginTop: 2 }}><summary className="muted" style={{ cursor: 'pointer', minHeight: 24, display: 'inline-flex', alignItems: 'center' }}>Evidence</summary>
                    <dl className="kv xsmall" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }} data-testid={`eval-evidence-${x.question_code}`}>
                      <dt>Question revision</dt><dd className="mono">r{x.revision} · {x.question_revision_id || '—'}</dd>
                      <dt>Rule</dt><dd>{x.rule_text}</dd>
                      <dt>Rule data</dt><dd className="mono">{JSON.stringify(x.rule)}</dd>
                      <dt>Original answer</dt><dd className="mono">{JSON.stringify(x.answer)}</dd>
                      <dt>Normalised answer</dt><dd className="mono">{shown(x.normalized_answer)}</dd>
                      <dt>Expected and source</dt><dd className="mono">{JSON.stringify(x.expected)}</dd>
                      <dt>Equivalent S0 rule result</dt><dd>{humanize(x.rule_evaluation_equivalent)}</dd>
                    </dl>
                  </details>
                </td>
              </tr>
            </Fragment>
          );
        })}</tbody>
      </table></div>
      {hideStatements ? <button type="button" className="link-button xsmall" style={{ border: 0, background: 'none', padding: 0, color: 'var(--blue-600, #1d4ed8)', cursor: 'pointer', alignSelf: 'flex-start', minHeight: 24 }}
        onClick={() => setAll(!all)} data-testid={`${testId}-toggle`}>{all ? 'Hide statements' : 'Show statements'}</button> : null}
    </div>
  );
}

/** An interactive run's answer evaluation: evaluate, inspect results and the evidence trace, replay check. */
export function RunEvaluation({ runId, canEvaluate, status }: { runId: string; canEvaluate: boolean; status: string }) {
  const qc = useQueryClient();
  const path = { params: { path: { run_id: runId } } };
  const list = useQuery({ queryKey: ['sim-evals', runId], queryFn: async () => unwrap(await api.GET('/api/v1/script-simulations/{run_id}/evaluations', path)) });
  const [chosen, setChosen] = useState<string | null>(null);
  const latest = chosen ?? list.data?.items[0]?.id ?? null;
  const one = useQuery({
    queryKey: ['sim-eval', runId, latest], enabled: !!latest,
    queryFn: async () => unwrap(await api.GET('/api/v1/script-simulations/{run_id}/evaluations/{evaluation_id}', { params: { path: { run_id: runId, evaluation_id: latest! } } })),
  });
  const [last, setLast] = useState<Evaluation | null>(null);
  const evaluate = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/script-simulations/{run_id}/evaluations', path)),
    onSuccess: (e) => { setLast(e); setChosen(e.id); qc.setQueryData(['sim-eval', runId, e.id], e); void qc.invalidateQueries({ queryKey: ['sim-evals', runId] }); },
  });
  const e = one.data;
  return (
    <Card title="Answer evaluation" subtitle="Deterministic engine · no LLM · separate from controller completion">
      <div className="stack" style={{ gap: 12, minWidth: 0, overflowWrap: 'anywhere' }} data-testid="sim-evaluation">
        <p className="xsmall muted" style={{ margin: 0 }}>{DISCLAIMER}</p>
        <div className="row wrap" style={{ gap: 8 }}>
          {canEvaluate ? <Button variant="primary" icon="check" onClick={() => evaluate.mutate()} disabled={evaluate.isPending} data-testid="sim-evaluate">
            {evaluate.isPending ? 'Evaluating…' : status === 'IN_PROGRESS' || status === 'SEQUENCE_FINISHED' ? 'Evaluate answers so far' : 'Evaluate answers'}</Button> : null}
          {(list.data?.items.length ?? 0) > 1 ? (
            <label className="row small" style={{ gap: 6 }}>Evaluation
              <select className="field" value={latest ?? ''} onChange={(ev) => setChosen(ev.target.value)} data-testid="sim-eval-pick">
                {list.data!.items.map((x) => <option key={x.id} value={x.id}>{x.evaluation_ref} · {x.events_evaluated} events · {when(x.created_at)}</option>)}</select></label>
          ) : null}
          {last && !last.created ? <span className="xsmall muted" data-testid="sim-eval-reused">Same inputs as {last.evaluation_ref}: the existing evaluation is shown (deterministic; nothing new written).</span> : null}
        </div>
        <ErrorBox error={evaluate.error ? errorText(evaluate.error) : null} />
        {!latest ? <p className="small muted" style={{ margin: 0 }} data-testid="sim-eval-none">No evaluation yet. Evaluating records an insert-only simulation evidence record; earlier evaluations are kept.</p> : null}
        {e ? (
          <>
            <div className="row wrap" style={{ gap: 8 }} data-testid="sim-eval-header">
              <span className="mono strong small">{e.evaluation_ref}</span>
              <Badge tone={e.controller_outcome === 'COMPLETED' ? 'green' : 'gray'}>{`Controller: ${humanize(e.controller_outcome ?? e.controller_status)}`}</Badge>
              <EvaluationTotals totals={e.totals} />
            </div>
            {e.controller_outcome === 'COMPLETED' && ((e.totals.MISMATCH ?? 0) + (e.totals.UNRESOLVED ?? 0) > 0) ? (
              <p className="small" style={{ margin: 0 }} data-testid="sim-eval-separate"><strong>The conversation completed</strong>, but the answers contain {e.totals.MISMATCH ?? 0} mismatch{(e.totals.MISMATCH ?? 0) === 1 ? '' : 'es'} and {e.totals.UNRESOLVED ?? 0} unresolved answer{(e.totals.UNRESOLVED ?? 0) === 1 ? '' : 's'}.</p>
            ) : null}
            <EvaluationTable items={e.results} />
            <details data-testid="sim-eval-trace" open>
              <summary className="small strong" style={{ cursor: 'pointer', minHeight: 28 }}>Evidence trace</summary>
              <dl className="kv xsmall" style={{ marginTop: 8, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                <dt>Evaluation</dt><dd>{e.evaluation_ref} · {when(e.created_at)} · {e.created_by_name ?? '—'}</dd>
                <dt>Engine version</dt><dd className="mono">{e.engine_version}</dd>
                <dt>Script version</dt><dd>{e.script_label} ({humanize(e.version_status)}) · {e.mode === 'VERSION_TEST' ? 'version test' : 'pinned assignment'}</dd>
                <dt>Script content</dt><dd className="mono">{e.content_sha256} · {e.content_source === 'CONTENT_SNAPSHOT' ? 'exact content snapshot' : 'published manifest'}</dd>
                <dt>Policy fact snapshot</dt><dd className="mono">{e.policy_fact_snapshot_id} · sha256 {e.policy_fact_snapshot_sha256}</dd>
                <dt>Answers evaluated</dt><dd className="mono">{e.events_evaluated} controller events · sha256 {e.events_sha256}</dd>
                <dt>Input digest</dt><dd className="mono">{e.input_sha256}</dd>
                <dt>Replay</dt><dd data-testid="sim-eval-replay"><Badge tone={e.replay.matches ? 'green' : 'red'}>{e.replay.matches ? 'Reproduced' : 'Differs'}</Badge> {e.replay.detail}</dd>
                <dt>Run</dt><dd>{e.sim_ref} · {e.case_ref}</dd>
              </dl>
            </details>
            <RunFindings key={e.id} runId={runId} evaluationId={e.id} canGenerate={canEvaluate} />
          </>
        ) : null}
      </div>
    </Card>
  );
}
