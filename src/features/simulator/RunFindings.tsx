// S3-B simulated findings for an interactive run's evaluation: generate with the published finding rule set (or a draft
// for testing), then findings grouped by category and severity with why each was generated, the compliance controls,
// supporting evidence, items requiring human assessment and discrepancies no rule converts. Simulation only.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { Badge, Button, type Tone } from '../../components/ui';
import { humanize, when } from '../cases/shared';
import { CLASS_TONE, SEVERITY_TONE, useFindingRuleSets } from '../findings/FindingRulesPage';
import { ErrorBox, errorText } from '../scripts/ScriptEditor';

type FindingSet = components['schemas']['SimFindingSetOut'];
export interface Finding {
  finding_key: string; question_code: string; question_revision_id?: string; revision?: number; mandatory?: boolean; trigger: string;
  finding_class: string; category: string; severity: string; severity_justification: string; severity_source: string;
  review_required: boolean; description: string; explanation: string; control_unmapped: boolean;
  rule: { rule_code: string; text: string; rule_set: { label: string; sha256: string; status: string } };
  controls: { control_code: string; control_name?: string; mapping_status?: string; regulatory_reference?: { title?: string } | null }[];
  evidence: Record<string, unknown>; engine: string;
}
const ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export function FindingsView({ findings, notConverted, human, testId = 'findings' }: { findings: Finding[]; notConverted: Record<string, unknown>[]; human: Record<string, unknown>[]; testId?: string }) {
  const groups = new Map<string, Finding[]>();
  for (const f of [...findings].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || a.question_code.localeCompare(b.question_code))) {
    const k = f.category;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  return (
    <div className="stack" style={{ gap: 12 }} data-testid={testId}>
      {!findings.length ? <p className="small" style={{ margin: 0 }} data-testid={`${testId}-none`}><Badge tone="green">No findings</Badge> No evaluation outcome met a finding rule.</p> : null}
      {[...groups.entries()].map(([cat, fs]) => (
        <section key={cat} className="softbox stack" style={{ gap: 8 }} aria-label={humanize(cat)} data-testid={`${testId}-cat-${cat}`}>
          <div className="row wrap" style={{ gap: 6 }}><strong className="small">{humanize(cat)}</strong>
            {ORDER.filter((s) => fs.some((f) => f.severity === s)).map((s) => <Badge key={s} tone={SEVERITY_TONE[s] ?? 'gray'}>{`${s} ${fs.filter((f) => f.severity === s).length}`}</Badge>)}</div>
          {fs.map((f) => (
            <article key={f.finding_key} className="stack" style={{ gap: 4, borderTop: '1px solid var(--line, #e5e7eb)', paddingTop: 8 }} data-testid={`finding-${f.question_code}`}>
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="mono small strong">{f.question_code}</span>
                <Badge tone={SEVERITY_TONE[f.severity] ?? 'gray'}>{f.severity}</Badge>
                <Badge tone={(CLASS_TONE[f.finding_class] ?? 'gray') as Tone}>{humanize(f.finding_class)}</Badge>
                {f.review_required ? <Badge tone="purple">Human review required</Badge> : null}
                <span className="xsmall muted">{f.rule.rule_code}</span>
              </div>
              <p className="small" style={{ margin: 0 }}>{f.description}</p>
              <p className="xsmall" style={{ margin: 0 }}><span className="muted">Why: </span>{f.explanation}</p>
              <p className="xsmall" style={{ margin: 0 }}><span className="muted">Severity: </span>{f.severity} — {f.severity_justification} <span className="muted">({f.severity_source})</span></p>
              <p className="xsmall" style={{ margin: 0 }} data-testid={`finding-controls-${f.question_code}`}><span className="muted">Compliance controls: </span>
                {f.controls.length ? f.controls.map((c) => `${c.control_code}${c.control_name ? ` ${c.control_name}` : ''}${c.mapping_status ? ` (${humanize(c.mapping_status).toLowerCase()} mapping)` : ''}`).join('; ')
                  : <Badge tone="amber">No control mapped to this question</Badge>}</p>
              <details><summary className="xsmall muted" style={{ cursor: 'pointer', minHeight: 24, display: 'inline-flex', alignItems: 'center' }}>Supporting evidence</summary>
                <dl className="kv xsmall" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }} data-testid={`finding-evidence-${f.question_code}`}>
                  <dt>Execution</dt><dd className="mono">{String(f.evidence.execution_ref ?? '—')}{f.evidence.case_ref ? ` · ${String(f.evidence.case_ref)}` : ''}</dd>
                  <dt>Script version</dt><dd>{String(f.evidence.script_label ?? '—')} · content <span className="mono">{String(f.evidence.content_sha256 ?? '').slice(0, 16)}…</span></dd>
                  <dt>Question revision</dt><dd className="mono">r{f.revision ?? '—'} · {f.question_revision_id ?? '—'}</dd>
                  <dt>Answer</dt><dd className="mono">{JSON.stringify(f.evidence.answer)}</dd>
                  <dt>Expected</dt><dd className="mono">{JSON.stringify(f.evidence.expected)}</dd>
                  <dt>Evaluation</dt><dd>{humanize(String(f.evidence.evaluation_result ?? ''))} — {String(f.evidence.evaluation_explanation ?? '')} {f.evidence.evaluation_ref ? <span className="mono">({String(f.evidence.evaluation_ref)})</span> : null}</dd>
                  <dt>Policy facts</dt><dd className="mono">{JSON.stringify(f.evidence.fact_source)}</dd>
                  <dt>Finding rule</dt><dd>{f.rule.text} · {f.rule.rule_set.label} <span className="mono">{f.rule.rule_set.sha256.slice(0, 12)}…</span></dd>
                  <dt>Engines</dt><dd className="mono">{f.engine} · {String(f.evidence.evaluation_engine ?? '')}</dd>
                  <dt>Finding key</dt><dd className="mono">{f.finding_key}</dd>
                </dl></details>
            </article>
          ))}
        </section>
      ))}
      {human.length ? (
        <div className="stack" style={{ gap: 4 }} data-testid={`${testId}-human`}>
          <strong className="small">Items requiring human assessment ({human.length})</strong>
          <ul className="plain-list xsmall stack" style={{ gap: 2 }}>{human.map((h, i) => <li key={i}><span className="mono">{String(h.question_code)}</span> — {String(h.explanation ?? '')}</li>)}</ul>
        </div>
      ) : null}
      {notConverted.length ? (
        <div className="stack" style={{ gap: 4 }} data-testid={`${testId}-not-converted`}>
          <strong className="small">Outcomes not converted to findings ({notConverted.length})</strong>
          <ul className="plain-list xsmall stack" style={{ gap: 2 }}>{notConverted.map((n, i) => <li key={i}><span className="mono">{String(n.question_code)}</span> <Badge tone="gray">{humanize(String(n.result))}</Badge> {String(n.reason)}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

export function RunFindings({ runId, evaluationId, canGenerate }: { runId: string; evaluationId: string; canGenerate: boolean }) {
  const qc = useQueryClient();
  const sets = useFindingRuleSets();
  const listQ = useQuery({ queryKey: ['sim-finding-sets', evaluationId], queryFn: async () => unwrap(await api.GET('/api/v1/script-simulations/{run_id}/evaluations/{evaluation_id}/findings', { params: { path: { run_id: runId, evaluation_id: evaluationId } } })) });
  const [rs, setRs] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [last, setLast] = useState<FindingSet | null>(null);
  const current = chosen ?? listQ.data?.items[0]?.id ?? null;
  const one = useQuery({ enabled: !!current, queryKey: ['sim-finding-set', current], queryFn: async () => unwrap(await api.GET('/api/v1/script-simulations/{run_id}/finding-sets/{finding_set_id}', { params: { path: { run_id: runId, finding_set_id: current! } } })) });
  const gen = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/script-simulations/{run_id}/evaluations/{evaluation_id}/findings', { params: { path: { run_id: runId, evaluation_id: evaluationId } }, body: { rule_set_version_id: rs || null } })),
    onSuccess: (s) => { setLast(s); setChosen(s.id); qc.setQueryData(['sim-finding-set', s.id], s); void qc.invalidateQueries({ queryKey: ['sim-finding-sets', evaluationId] }); },
  });
  const testable = (sets.data?.items ?? []).filter((v) => ['DRAFT', 'SUBMITTED_FOR_REVIEW', 'APPROVED'].includes(v.status));
  const s = one.data;
  const sum = (s?.summary ?? {}) as { findings?: number; by_class?: Record<string, number>; review_required?: number };
  return (
    <div className="stack" style={{ gap: 10 }} data-testid="sim-findings">
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <strong className="small">Findings</strong>
        <label className="row xsmall" style={{ gap: 6 }}>Rule set
          <select className="field" value={rs} onChange={(e) => setRs(e.target.value)} data-testid="sim-findings-ruleset">
            <option value="">Published{sets.data?.published_id ? '' : ' (none yet)'}</option>
            {testable.map((v) => <option key={v.id} value={v.id}>{v.label} — testing only</option>)}</select></label>
        {canGenerate ? <Button variant="primary" icon="alert" onClick={() => gen.mutate()} disabled={gen.isPending} data-testid="sim-generate-findings">{gen.isPending ? 'Generating…' : 'Generate findings'}</Button> : null}
        {(listQ.data?.items.length ?? 0) > 1 ? (
          <select className="field" aria-label="Finding set" value={current ?? ''} onChange={(e) => setChosen(e.target.value)} data-testid="sim-findings-pick">
            {listQ.data!.items.map((x) => <option key={x.id} value={x.id}>{x.finding_set_ref} · {x.rule_set_label} · {when(x.created_at)}</option>)}</select>
        ) : null}
        {last && !last.created ? <span className="xsmall muted" data-testid="sim-findings-reused">Same inputs as {last.finding_set_ref}: existing findings shown (no duplicates written).</span> : null}
      </div>
      <ErrorBox error={gen.error ? errorText(gen.error) : null} />
      {s ? (
        <>
          <div className="row wrap" style={{ gap: 6 }} data-testid="sim-findings-summary">
            <span className="mono small strong">{s.finding_set_ref}</span>
            <Badge tone={s.rule_set_status === 'PUBLISHED' ? 'blue' : 'amber'}>{`${s.rule_set_label}${s.rule_set_status !== s.rule_set_current_status ? ` (now ${humanize(s.rule_set_current_status).toLowerCase()})` : ''}`}</Badge>
            <Badge tone={sum.findings ? 'red' : 'green'}>{`${sum.findings ?? 0} finding${sum.findings === 1 ? '' : 's'}`}</Badge>
            {Object.entries(sum.by_class ?? {}).map(([c, n]) => <Badge key={c} tone={CLASS_TONE[c] ?? 'gray'}>{`${humanize(c)} ${n}`}</Badge>)}
            {sum.review_required ? <Badge tone="purple">{`Review required ${sum.review_required}`}</Badge> : null}
          </div>
          <FindingsView findings={s.findings as unknown as Finding[]} notConverted={s.not_converted} human={s.human_assessment} />
          <details data-testid="sim-findings-trace"><summary className="small strong" style={{ cursor: 'pointer', minHeight: 28 }}>Finding generation trace</summary>
            <dl className="kv xsmall" style={{ marginTop: 6, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
              <dt>Finding set</dt><dd>{s.finding_set_ref} · {when(s.created_at)} · {s.created_by_name ?? '—'}</dd>
              <dt>From evaluation</dt><dd>{s.evaluation_ref}</dd>
              <dt>Rule set</dt><dd>{s.rule_set_label} · <span className="mono">{s.rule_set_sha256}</span></dd>
              <dt>Engine</dt><dd className="mono">{s.engine_version}</dd>
              <dt>Input digest</dt><dd className="mono">{s.input_sha256}</dd>
              <dt>Replay</dt><dd data-testid="sim-findings-replay"><Badge tone={s.replay.matches ? 'green' : 'red'}>{s.replay.matches ? 'Reproduced' : 'Differs'}</Badge> {s.replay.detail}</dd>
            </dl></details>
          <p className="xsmall muted" style={{ margin: 0 }}>{s.note}</p>
        </>
      ) : <p className="xsmall muted" style={{ margin: 0 }} data-testid="sim-findings-none-yet">No findings generated for this evaluation yet.</p>}
    </div>
  );
}
