// S2-E scenario library: structured, versioned test scenarios for the deterministic controller (no code, no LLM).
// The editor builds steps and expectations from the version's real plan; a dry run shows what the controller does and
// can fill the expectations; saving creates a new revision; running records results with the exact script snapshot.
import { EVAL_LABEL, EVAL_TONE, EvaluationTable, EvaluationTotals, type EvaluationItem } from './AnswerEvaluation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiFailure, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { useAuth } from '../../auth/AuthContext';
import { Empty } from '../../components/StateView';
import { Badge, Button, Card, type Tone } from '../../components/ui';
import { humanize, Region, when } from '../cases/shared';
import { ErrorBox, Field } from '../scripts/ScriptEditor';

type Content = components['schemas']['ScenarioContent'];
type Step = components['schemas']['ScenarioStep'];
type Expect = components['schemas']['ScenarioExpectations'];
type Plan = components['schemas']['WorkbenchPlanOut'];
type Preview = components['schemas']['ScenarioPreviewOut'];
type Options = components['schemas']['WorkbenchOptions'];

/** Workbench errors: the message plus each validation problem the server listed. */
export function errorText(e: unknown) {
  if (e instanceof ApiFailure) {
    const details = ((e.body?.details ?? []) as { message?: string }[]).filter((d) => d && d.message);
    return { message: e.message, issues: details.map((d) => ({ severity: 'ERROR' as const, code: '', message: String(d.message) })) };
  }
  return { message: 'The request could not be completed', issues: [] };
}

/** A button that looks like an inline link (no native border or background). */
export const LINK_BUTTON = { background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer', textAlign: 'left' } as const;

export const STATUS_TONE: Record<string, Tone> = { PASSED: 'green', FAILED: 'red', ERROR: 'amber', INVALID: 'gray' };
const STEP_LABEL: Record<string, string> = {
  ANSWER: 'Answers', UNCLEAR: 'Unclear answer', REFUSED: 'Refuses', UNKNOWN: "Doesn't know", CLARIFICATION: 'Asks for clarification',
  NOT_DELIVERED: 'Not delivered', DELIVERED: 'Delivered (statement)', EVENT: 'Conversation event',
};

export function useWorkbenchOptions() {
  return useQuery({ queryKey: ['wb-options'], queryFn: async () => unwrap(await api.GET('/api/v1/simulation-workbench/options')), staleTime: 300_000 });
}
export function useVersions() {
  return useQuery({ queryKey: ['wb-versions'], queryFn: async () => unwrap(await api.GET('/api/v1/simulation-workbench/versions')) });
}
export function VersionOptions({ items }: { items: components['schemas']['WorkbenchVersion'][] }) {
  const fams = [...new Set(items.map((v) => v.family))];
  return <>{fams.map((f) => (
    <optgroup key={f} label={f}>{items.filter((v) => v.family === f).map((v) => (
      <option key={v.id} value={v.id}>{`${v.family} v${v.version_label} · ${humanize(v.status)}${v.status === 'DRAFT' ? ' (unpublished draft)' : ''}`}</option>))}</optgroup>
  ))}</>;
}

export function ScenarioLibrary({ selected, fromRun, onSelect, onShowRun }: {
  selected: string | null; fromRun: string | null; onSelect: (id: string | null) => void; onShowRun: (batchId: string) => void;
}) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const list = useQuery({ queryKey: ['scenarios', q, archived], queryFn: async () => unwrap(await api.GET('/api/v1/simulation-scenarios', { params: { query: { q: q || undefined, include_archived: archived } } })) });
  const run = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/simulation-runs', { body: { scenario_ids: checked } })),
    onSuccess: (b) => { void qc.invalidateQueries({ queryKey: ['scenarios'] }); void qc.invalidateQueries({ queryKey: ['sim-batches'] }); onShowRun(b.id); },
  });
  const toggle = (id: string) => setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  return (
    <div className="layout sd-grid">
      <Card title="Scenario library" subtitle="Reusable, versioned test scenarios">
        <div className="stack" style={{ gap: 8 }}>
          <label className="form-label" htmlFor="scn-q">Find a scenario</label>
          <input id="scn-q" className="field labelled" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or SCN-…" />
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Include archived</label>
          {can('script.simulate') ? (
            <div className="row wrap" style={{ gap: 6 }}>
              <Button tiny icon="plus" onClick={() => onSelect('new')} data-testid="scn-new">New scenario</Button>
              <Button tiny variant="primary" icon="play" disabled={!checked.length || run.isPending} onClick={() => run.mutate()} data-testid="scn-run-selected">
                {run.isPending ? 'Running…' : `Run selected (${checked.length})`}</Button>
            </div>
          ) : null}
          <ErrorBox error={run.error ? errorText(run.error) : null} />
          <Region query={list} label="scenarios">
            {() => (
              <ul className="plain-list stack" style={{ gap: 0 }} data-testid="scn-list">
                {list.data!.items.map((s) => (
                  <li key={s.id} className={`script-item${s.id === selected ? ' active' : ''}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    {can('script.simulate') && s.status === 'ACTIVE' ? <input type="checkbox" aria-label={`Select ${s.name}`} checked={checked.includes(s.id)} onChange={() => toggle(s.id)} style={{ marginTop: 3 }} data-testid={`scn-check-${s.scenario_ref}`} /> : null}
                    <button type="button" onClick={() => onSelect(s.id)} style={{ background: 'none', border: 0, textAlign: 'left', flex: 1, minWidth: 0, padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }} aria-current={s.id === selected ? 'true' : undefined} data-testid={`scn-item-${s.scenario_ref}`}>
                      <div className="row between" style={{ gap: 6 }}><strong className="small">{s.name}</strong>
                        {s.last_status ? <Badge tone={STATUS_TONE[s.last_status] ?? 'gray'}>{humanize(s.last_status)}</Badge> : <Badge tone="gray">Not run</Badge>}</div>
                      <div className="xsmall muted" style={{ marginTop: 4 }}><span className="mono">{s.scenario_ref}</span> r{s.current_revision} · {s.family} v{s.version_label}{s.version_status === 'DRAFT' ? ' (draft)' : ''} · {s.steps} step{s.steps === 1 ? '' : 's'}{s.status === 'ARCHIVED' ? ' · archived' : ''}</div>
                    </button>
                  </li>
                ))}
                {!list.data!.items.length ? <li className="small muted">No scenarios yet.</li> : null}
              </ul>
            )}
          </Region>
        </div>
      </Card>
      <div className="stack" style={{ gap: 16 }}>
        {selected ? <ScenarioEditor key={`${selected}:${fromRun ?? ''}`} id={selected === 'new' ? null : selected} fromRun={selected === 'new' ? fromRun : null}
          onSaved={(id) => onSelect(id)} onShowRun={onShowRun} />
          : <Card><Empty title="Choose or create a scenario">A scenario is a structured test: synthetic facts, ordered customer responses and events, and the controller behaviour you expect.</Empty></Card>}
      </div>
    </div>
  );
}

const EMPTY_EXP: Expect = { outcome: null, termination_reason: null, gates: {}, mandatory_complete: null, applicable_questions: null, sequence: null, question_states: {}, evaluations: {}, basis: null, findings: null };

function ScenarioEditor({ id, fromRun, onSaved, onShowRun }: { id: string | null; fromRun: string | null; onSaved: (id: string) => void; onShowRun: (b: string) => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const uid = useId();
  const options = useWorkbenchOptions();
  const versions = useVersions();
  const existing = useQuery({ enabled: !!id, queryKey: ['scenario', id], queryFn: async () => unwrap(await api.GET('/api/v1/simulation-scenarios/{scenario_id}', { params: { path: { scenario_id: id! } } })) });
  const recorded = useQuery({ enabled: !id && !!fromRun, queryKey: ['as-scenario', fromRun], queryFn: async () => unwrap(await api.GET('/api/v1/script-simulations/{run_id}/as-scenario', { params: { path: { run_id: fromRun! } } })) });
  const [c, setC] = useState<Content | null>(null);
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => {
    if (c) return;
    if (id && existing.data) setC(existing.data.content);
    else if (!id && fromRun && recorded.data) setC({ ...recorded.data, name: recorded.data.name ?? 'Recorded scenario' } as Content);
    else if (!id && !fromRun && versions.data?.items[0]) setC({ name: '', description: null, script_version_id: versions.data.items[0].id, facts: {}, risk_band: null, source_case_id: null, steps: [], expectations: EMPTY_EXP, default_response: 'AFFIRMATIVE' });
  }, [c, id, fromRun, existing.data, recorded.data, versions.data]);
  const plan = useQuery({
    enabled: !!c?.script_version_id, queryKey: ['wb-plan', c?.script_version_id, c?.facts, c?.risk_band],
    queryFn: async () => unwrap(await api.POST('/api/v1/simulation-workbench/plan', { body: { script_version_id: c!.script_version_id, facts: c!.facts ?? {}, risk_band: c!.risk_band ?? null } })),
  });
  const set = (patch: Partial<Content>) => { setC((x) => (x ? { ...x, ...patch } : x)); setPreview(null); };
  const setExp = (patch: Partial<Expect>) => setC((x) => (x ? { ...x, expectations: { ...EMPTY_EXP, ...x.expectations, ...patch } } : x));
  const save = useMutation({
    mutationFn: async () => id
      ? unwrap(await api.PUT('/api/v1/simulation-scenarios/{scenario_id}', { params: { path: { scenario_id: id } }, body: { expected_row_version: existing.data!.row_version, content: c!, change_note: note || null } }))
      : unwrap(await api.POST('/api/v1/simulation-scenarios', { body: c! })),
    onSuccess: (s) => { setNote(''); qc.setQueryData(['scenario', s.id], s); void qc.invalidateQueries({ queryKey: ['scenarios'] }); onSaved(s.id); },
  });
  const dry = useMutation({ mutationFn: async () => unwrap(await api.POST('/api/v1/simulation-scenarios/preview', { body: c! })), onSuccess: setPreview });
  const runNow = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/simulation-runs', { body: { scenario_ids: [id!] } })),
    onSuccess: (b) => { void qc.invalidateQueries({ queryKey: ['scenarios'] }); void qc.invalidateQueries({ queryKey: ['sim-batches'] }); onShowRun(b.id); },
  });
  const copy = useMutation({ mutationFn: async () => unwrap(await api.POST('/api/v1/simulation-scenarios/{scenario_id}/copy', { params: { path: { scenario_id: id! } }, body: { name: null } })), onSuccess: (s) => { void qc.invalidateQueries({ queryKey: ['scenarios'] }); onSaved(s.id); } });
  const status = useMutation({
    mutationFn: async (st: 'ACTIVE' | 'ARCHIVED') => unwrap(await api.POST('/api/v1/simulation-scenarios/{scenario_id}/status', { params: { path: { scenario_id: id! } }, body: { expected_row_version: existing.data!.row_version, status: st } })),
    onSuccess: (s) => { qc.setQueryData(['scenario', s.id], s); void qc.invalidateQueries({ queryKey: ['scenarios'] }); },
  });
  if (!c || !options.data) return <Card><p className="small muted">Loading…</p></Card>;
  const o = options.data;
  const x = existing.data;
  const editable = can('script.simulate') && (!x || x.status === 'ACTIVE');
  const questions = plan.data?.questions ?? [];
  const exp = { ...EMPTY_EXP, ...c.expectations };
  const err = save.error ?? dry.error ?? runNow.error ?? copy.error ?? status.error;
  const useActual = () => {
    if (!preview) return;
    const a = preview.actual as Record<string, unknown>;
    setExp({ outcome: (a.outcome as string) ?? null, termination_reason: (a.termination_reason as string) ?? 'NONE', gates: (a.gates as Record<string, string>) ?? {},
      mandatory_complete: (a.mandatory_complete as boolean) ?? null, sequence: (a.sequence as string[]) ?? null, applicable_questions: (a.applicable as string[]) ?? null,
      evaluations: Object.fromEntries(Object.entries((a.evaluation_results as Record<string, string>) ?? {}).filter(([, r]) => !['NOT_EVALUATED', 'NOT_APPLICABLE'].includes(r))),
      basis: 'GENERATED_BASELINE',
      findings: Array.isArray(a.findings_view) ? (a.findings_view as { question: string; category: string; severity: string }[]).map((f) => ({ question: f.question, category: f.category, severity: f.severity as 'LOW' })) : null });
  };
  return (
    <>
      <Card title={x ? `${x.name}` : 'New scenario'} subtitle={x ? `${x.scenario_ref} · revision ${x.revision} · ${x.version_label}${x.copied_from_ref ? ` · copied from ${x.copied_from_ref}` : ''}` : fromRun ? 'Recorded from an interactive run — review, then save' : 'Structured inputs only; nothing here is executable code'}
        aside={x ? <Badge tone={x.status === 'ACTIVE' ? 'green' : 'gray'}>{humanize(x.status)}</Badge> : undefined}>
        <form className="stack" style={{ gap: 14 }} data-testid="scn-editor" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <fieldset disabled={!editable} className="stack" style={{ gap: 12, border: 0, padding: 0, margin: 0 }}>
            <div className="input-grid">
              <Field id={`${uid}-n`} label="Scenario name">{(p) => <input {...p} className="field labelled" value={c.name} onChange={(e) => set({ name: e.target.value })} required minLength={3} maxLength={120} data-testid="scn-name" />}</Field>
              <Field id={`${uid}-v`} label="Script version" hint="Drafts are tested from an isolated snapshot; no assignment changes">
                {(p) => <select {...p} className="field labelled" value={c.script_version_id} onChange={(e) => set({ script_version_id: e.target.value })} data-testid="scn-version"><VersionOptions items={versions.data?.items ?? []} /></select>}</Field>
            </div>
            <Field id={`${uid}-d`} label="Description (optional)">{(p) => <textarea {...p} className="field textarea labelled" rows={2} value={c.description ?? ''} onChange={(e) => set({ description: e.target.value || null })} maxLength={2000} />}</Field>
            <FactsEditor c={c} o={o} set={set} />
            {plan.data ? <PlanSummary plan={plan.data} /> : <ErrorBox error={plan.error ? errorText(plan.error) : null} />}
            <StepsEditor steps={c.steps ?? []} questions={questions} o={o} onChange={(steps) => set({ steps })} />
            <Field id={`${uid}-dr`} label="Items without a step">{(p) => (
              <select {...p} className="field labelled" value={c.default_response} onChange={(e) => set({ default_response: e.target.value as Content['default_response'] })} data-testid="scn-default">
                <option value="AFFIRMATIVE">Default response: statements delivered, questions answered yes / first option</option>
                <option value="STRICT">Strict: every item needs a step (otherwise an execution error)</option></select>)}</Field>
            <ExpectationsEditor exp={exp} o={o} questions={questions} setExp={setExp} />
          </fieldset>
          {editable ? (
            <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
              {x ? <Field id={`${uid}-cn`} label="Change note (optional)">{(p) => <input {...p} className="field labelled" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} style={{ minWidth: 240 }} />}</Field> : null}
              <Button type="submit" variant="primary" disabled={save.isPending} data-testid="scn-save">{x ? 'Save new revision' : 'Save scenario'}</Button>
              <Button icon="play" onClick={() => dry.mutate()} disabled={dry.isPending} data-testid="scn-dry-run">Dry run</Button>
              {x ? <Button icon="play" onClick={() => runNow.mutate()} disabled={runNow.isPending} data-testid="scn-run">Run and record</Button> : null}
            </div>
          ) : null}
          {x && can('script.simulate') ? (
            <div className="row wrap" style={{ gap: 8 }}>
              <Button tiny onClick={() => copy.mutate()} disabled={copy.isPending} data-testid="scn-copy">Copy</Button>
              <Button tiny onClick={() => status.mutate(x.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE')} disabled={status.isPending} data-testid="scn-archive">{x.status === 'ACTIVE' ? 'Archive' : 'Restore'}</Button>
            </div>
          ) : null}
          <ErrorBox error={err ? errorText(err) : null} />
        </form>
      </Card>
      {preview ? <PreviewCard p={preview} onUse={editable ? useActual : undefined} /> : null}
      {x ? (
        <Card title="History" subtitle="Each save is a new revision; results keep the revision and script snapshot they used">
          <div className="input-grid">
            <ul className="plain-list stack" style={{ gap: 4 }} aria-label="Revisions">{x.revisions.map((r) => <li key={r.revision} className="small"><strong>r{r.revision}</strong> · {r.version_label} · {r.created_by ?? '—'} · {when(r.created_at)}{r.change_note ? ` — ${r.change_note}` : ''}</li>)}</ul>
            <ul className="plain-list stack" style={{ gap: 4 }} aria-label="Recent results" data-testid="scn-runs">{x.runs.map((r, i) => (
              <li key={i} className="small"><Badge tone={STATUS_TONE[String(r.status)] ?? 'gray'}>{humanize(String(r.status))}</Badge>{r.stale ? <> <Badge tone="amber">Stale</Badge></> : null}{' '}
                <button type="button" className="link" style={LINK_BUTTON} onClick={() => onShowRun(String(r.batch_id))}>{String(r.batch_ref)}</button> · r{String(r.revision)} · {String(r.version_label)}</li>))}
              {!x.runs.length ? <li className="small muted">Not run yet.</li> : null}</ul>
          </div>
        </Card>
      ) : null}
    </>
  );
}

function FactsEditor({ c, o, set }: { c: Content; o: Options; set: (p: Partial<Content>) => void }) {
  const uid = useId();
  const [ref, setRef] = useState('');
  const cases = useQuery({ enabled: ref.length >= 4, queryKey: ['wb-cases', ref], queryFn: async () => unwrap(await api.GET('/api/v1/script-simulations/cases', { params: { query: { q: ref, include_unassigned: true } } })) });
  const load = useMutation({
    mutationFn: async (caseId: string) => unwrap(await api.GET('/api/v1/simulation-workbench/case-facts', { params: { query: { case_id: caseId } } })),
    onSuccess: (f) => set({ facts: f.facts as Content['facts'], risk_band: f.risk_band ?? null, source_case_id: f.case_id }),
  });
  const facts = (c.facts ?? {}) as Record<string, string | boolean | number>;
  const setFact = (k: string, v: string) => {
    const n = { ...facts };
    if (v === '') delete n[k]; else n[k] = v === 'true' ? true : v === 'false' ? false : k === 'premium_term_years' && /^\d+$/.test(v) ? Number(v) : v;
    set({ facts: n, source_case_id: null });
  };
  return (
    <fieldset className="softbox stack" style={{ gap: 8 }} data-testid="scn-facts">
      <legend className="small strong">Synthetic case facts</legend>
      <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
        <Field id={`${uid}-c`} label="Copy facts from a synthetic case" hint="Copies the latest fact snapshot and SBQ band">{(p) => <input {...p} className="field labelled" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} placeholder="CB-2026-…" data-testid="scn-case-q" />}</Field>
        {(cases.data?.items ?? []).slice(0, 4).map((x) => <Button key={x.case_id} tiny onClick={() => load.mutate(x.case_id)} data-testid={`scn-case-${x.case_ref}`}>Use {x.case_ref}</Button>)}
      </div>
      <div className="input-grid">
        {Object.entries(o.condition_facts).map(([k, vals]) => (
          <Field key={k} id={`${uid}-${k}`} label={humanize(k.toUpperCase())}>{(p) => (
            <select {...p} className="field labelled" value={facts[k] === undefined ? '' : String(facts[k])} onChange={(e) => setFact(k, e.target.value)} data-testid={`scn-fact-${k}`}>
              <option value="">Not set</option>{vals.map((v) => <option key={String(v)} value={String(v)}>{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : humanize(String(v))}</option>)}</select>)}</Field>
        ))}
        <Field id={`${uid}-b`} label="SBQ sale-selection risk band">{(p) => (
          <select {...p} className="field labelled" value={c.risk_band ?? ''} onChange={(e) => set({ risk_band: e.target.value || null, source_case_id: null })} data-testid="scn-band">
            <option value="">Unassessed</option>{o.risk_bands.map((b) => <option key={b} value={b}>{humanize(b)}</option>)}</select>)}</Field>
      </div>
      <div className="input-grid" data-testid="scn-eval-facts">
        <Field id={`${uid}-term`} label="Premium term (years)" hint="For policy-fact evaluation rules">{(p) => <input {...p} className="field labelled" inputMode="numeric" value={facts.premium_term_years === undefined ? '' : String(facts.premium_term_years)} onChange={(e) => setFact('premium_term_years', e.target.value.trim())} data-testid="scn-fact-premium_term_years" />}</Field>
        <Field id={`${uid}-amt`} label="Premium amount">{(p) => <input {...p} className="field labelled" inputMode="decimal" value={facts.premium_amount === undefined ? '' : String(facts.premium_amount)} onChange={(e) => setFact('premium_amount', e.target.value.trim())} data-testid="scn-fact-premium_amount" />}</Field>
        <Field id={`${uid}-cur`} label="Currency">{(p) => <select {...p} className="field labelled" value={facts.currency === undefined ? '' : String(facts.currency)} onChange={(e) => setFact('currency', e.target.value)} data-testid="scn-fact-currency"><option value="">Not set</option><option value="SGD">SGD</option></select>}</Field>
      </div>
      {c.source_case_id ? <p className="xsmall muted" style={{ margin: 0 }}>Facts copied from a synthetic case snapshot (kept with the revision).</p> : null}
    </fieldset>
  );
}

function PlanSummary({ plan }: { plan: Plan }) {
  const live = plan.live_eligibility as { structurally_eligible?: boolean; missing_mandatory_gates?: string[] };
  const app = plan.questions.filter((q) => q.applicable);
  return (
    <div className="softbox stack" style={{ gap: 6 }} data-testid="scn-plan">
      <div className="row wrap" style={{ gap: 6 }}><strong className="small">Plan for these facts</strong>
        <Badge tone={plan.version_status === 'DRAFT' ? 'amber' : 'blue'}>{humanize(plan.version_status)}</Badge>
        <Badge tone="amber">Synthetic · not production-approved</Badge>
        <Badge tone={live.structurally_eligible ? 'green' : 'red'}>{live.structurally_eligible ? 'Lifecycle gates present' : `Not eligible for live conversations — missing ${(live.missing_mandatory_gates ?? []).map(humanize).join(', ')}`}</Badge></div>
      <p className="xsmall muted" style={{ margin: 0 }}>{app.length} of {plan.questions.length} items apply · modules not included: {plan.sections.filter((s) => !s.included).map((s) => s.module_code).join(', ') || 'none'}</p>
      <ol className="plain-list xsmall" style={{ columns: 2, margin: 0 }}>{plan.questions.map((q) => <li key={q.code} className={q.applicable ? '' : 'muted'}><span className="mono">{q.code}</span> · {humanize(q.stage ?? 'VERIFICATION')}{q.applicable ? '' : ' · not applicable'}</li>)}</ol>
    </div>
  );
}

function StepsEditor({ steps, questions, o, onChange }: { steps: Step[]; questions: Plan['questions']; o: Options; onChange: (s: Step[]) => void }) {
  const byCode = useMemo(() => new Map(questions.map((q) => [q.code, q])), [questions]);
  const upd = (i: number, patch: Partial<Step>) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) => { const n = [...steps]; const [s] = n.splice(i, 1); n.splice(i + d, 0, s!); onChange(n); };
  const first = questions.find((q) => q.applicable);
  return (
    <fieldset className="softbox stack" style={{ gap: 8 }} data-testid="scn-steps">
      <legend className="small strong">Customer responses and events (in conversation order)</legend>
      {!steps.length ? <p className="xsmall muted" style={{ margin: 0 }}>No steps: every item gets the default response.</p> : null}
      {steps.map((s, i) => {
        const q = byCode.get(s.question);
        return (
          <div key={i} className="row wrap" style={{ gap: 6, alignItems: 'center' }} data-testid={`scn-step-${i + 1}`}>
            <span className="q-num">{i + 1}</span>
            <select aria-label={`Step ${i + 1} question`} className="field" value={s.question} onChange={(e) => upd(i, { question: e.target.value })} data-testid={`scn-step-${i + 1}-q`}>
              {!q ? <option value={s.question}>{s.question} (not in this version)</option> : null}
              {questions.map((x) => <option key={x.code} value={x.code}>{x.code} · {humanize(x.stage ?? '')}</option>)}</select>
            <select aria-label={`Step ${i + 1} response`} className="field" value={s.kind} onChange={(e) => upd(i, { kind: e.target.value as Step['kind'], value: null, event: e.target.value === 'EVENT' ? Object.keys(o.events)[0] : null })} data-testid={`scn-step-${i + 1}-kind`}>
              {o.step_kinds.map((k) => <option key={k} value={k}>{STEP_LABEL[k] ?? humanize(k)}</option>)}</select>
            {s.kind === 'ANSWER' ? <ValueInput q={q} value={s.value} onChange={(v) => upd(i, { value: v })} label={`Step ${i + 1} value`} testid={`scn-step-${i + 1}-value`} /> : null}
            {s.kind === 'EVENT' ? <select aria-label={`Step ${i + 1} event`} className="field" value={s.event ?? ''} onChange={(e) => upd(i, { event: e.target.value })} data-testid={`scn-step-${i + 1}-event`}>
              {Object.entries(o.events).map(([k, l]) => <option key={k} value={k} title={l}>{humanize(k)}</option>)}</select> : null}
            <Button tiny onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move step ${i + 1} up`}>↑</Button>
            <Button tiny onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label={`Move step ${i + 1} down`}>↓</Button>
            <Button tiny variant="danger" onClick={() => onChange(steps.filter((_, j) => j !== i))} aria-label={`Remove step ${i + 1}`}>Remove</Button>
          </div>
        );
      })}
      <div><Button tiny icon="plus" disabled={!first} onClick={() => onChange([...steps, { question: first!.code, kind: 'ANSWER', value: first!.answer_type === 'YES_NO' || first!.answer_type === 'ACKNOWLEDGEMENT' ? false : null, event: null, note: null }])} data-testid="scn-add-step">Add step</Button></div>
    </fieldset>
  );
}

function ValueInput({ q, value, onChange, label, testid }: { q: Plan['questions'][number] | undefined; value: Step['value']; onChange: (v: Step['value']) => void; label: string; testid: string }) {
  if (!q || q.answer_type === 'YES_NO' || q.answer_type === 'ACKNOWLEDGEMENT') {
    return <select aria-label={label} className="field" value={value === true ? 'yes' : value === false ? 'no' : ''} onChange={(e) => onChange(e.target.value === 'yes')} data-testid={testid}>
      <option value="" disabled>Choose…</option><option value="yes">{q?.answer_type === 'ACKNOWLEDGEMENT' ? 'Acknowledged' : 'Yes'}</option><option value="no">{q?.answer_type === 'ACKNOWLEDGEMENT' ? 'Not acknowledged' : 'No'}</option></select>;
  }
  if (q.answer_type === 'ENUM') return <select aria-label={label} className="field" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} data-testid={testid}><option value="">Choose…</option>{q.options.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select>;
  if (q.answer_type === 'NUMERIC') return <input aria-label={label} className="field" inputMode="decimal" value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : Number.isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value))} style={{ width: 100 }} data-testid={testid} />;
  return <input aria-label={label} className="field" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} data-testid={testid} />;
}

function ExpectationsEditor({ exp, o, questions, setExp }: { exp: Expect; o: Options; questions: Plan['questions']; setExp: (p: Partial<Expect>) => void }) {
  const uid = useId();
  const gates = exp.gates ?? {};
  const states = exp.question_states ?? {};
  const [stateQ, setStateQ] = useState('');
  const [evalQ, setEvalQ] = useState('');
  const evals = (exp.evaluations ?? {}) as Record<string, string>;
  const results = (o as { evaluation_results?: string[] }).evaluation_results ?? [];
  return (
    <fieldset className="softbox stack" style={{ gap: 8 }} data-testid="scn-expect">
      <legend className="small strong">Expected controller behaviour (only what you set is checked)</legend>
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <BasisBadge basis={exp.basis ?? null} />
        <Field id={`${uid}-basis`} label="How these expectations were set">{(p) => <select {...p} className="field labelled" value={exp.basis ?? ''} onChange={(e) => setExp({ basis: (e.target.value || null) as Expect['basis'] })} data-testid="scn-exp-basis">
          <option value="">Not recorded</option><option value="INDEPENDENT">Independently specified (what the script is meant to do)</option><option value="GENERATED_BASELINE">Generated baseline from an observed run (not independently validated)</option></select>}</Field>
      </div>
      <div className="input-grid">
        <Field id={`${uid}-o`} label="Outcome">{(p) => <select {...p} className="field labelled" value={exp.outcome ?? ''} onChange={(e) => setExp({ outcome: e.target.value || null })} data-testid="scn-exp-outcome"><option value="">Not checked</option>{o.outcomes.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select>}</Field>
        <Field id={`${uid}-t`} label="Termination reason">{(p) => <select {...p} className="field labelled" value={exp.termination_reason ?? ''} onChange={(e) => setExp({ termination_reason: e.target.value || null })} data-testid="scn-exp-termination"><option value="">Not checked</option><option value="NONE">No termination</option>{o.termination_reasons.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select>}</Field>
        <Field id={`${uid}-m`} label="Mandatory completion">{(p) => <select {...p} className="field labelled" value={exp.mandatory_complete == null ? '' : exp.mandatory_complete ? 'yes' : 'no'} onChange={(e) => setExp({ mandatory_complete: e.target.value === '' ? null : e.target.value === 'yes' })} data-testid="scn-exp-mandatory"><option value="">Not checked</option><option value="yes">All applicable mandatory completed</option><option value="no">Incomplete</option></select>}</Field>
        {o.gates.map((g) => (
          <Field key={g} id={`${uid}-g-${g}`} label={`${humanize(g.toUpperCase())} gate (simulated)`}>{(p) => <select {...p} className="field labelled" value={gates[g] ?? ''} onChange={(e) => { const n = { ...gates }; if (e.target.value) n[g] = e.target.value; else delete n[g]; setExp({ gates: n }); }} data-testid={`scn-exp-gate-${g}`}><option value="">Not checked</option>{o.gate_statuses.map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select>}</Field>
        ))}
      </div>
      <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
        <span className="xsmall muted">Question final state:</span>
        <select aria-label="Question for an expected state" className="field" value={stateQ} onChange={(e) => setStateQ(e.target.value)}><option value="">Choose…</option>{questions.map((q) => <option key={q.code} value={q.code}>{q.code}</option>)}</select>
        {o.question_states.map((st) => <Button key={st} tiny disabled={!stateQ} onClick={() => setExp({ question_states: { ...states, [stateQ]: st } })}>{humanize(st)}</Button>)}
      </div>
      {Object.keys(states).length ? <ul className="plain-list row wrap" style={{ gap: 6, flexDirection: 'row' }}>{Object.entries(states).map(([q, st]) => <li key={q}><Badge tone="purple">{`${q}: ${humanize(st)}`}</Badge> <button type="button" className="link xsmall" onClick={() => { const n = { ...states }; delete n[q]; setExp({ question_states: n }); }} aria-label={`Remove expected state of ${q}`}>remove</button></li>)}</ul> : null}
      <div className="stack" style={{ gap: 6 }} data-testid="scn-exp-evaluations">
        <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
          <span className="xsmall muted">Expected answer evaluation:</span>
          <select aria-label="Question for an expected evaluation result" className="field" value={evalQ} onChange={(e) => setEvalQ(e.target.value)} data-testid="scn-exp-eval-q"><option value="">Choose…</option>{questions.filter((q) => !['OPENING_STATEMENT', 'DISCLOSURE', 'CLOSING_STATEMENT'].includes(q.role ?? '')).map((q) => <option key={q.code} value={q.code}>{q.code}</option>)}</select>
          <select aria-label="Expected evaluation result" className="field" value="" disabled={!evalQ} onChange={(e) => { if (e.target.value) setExp({ evaluations: { ...evals, [evalQ]: e.target.value } }); }} data-testid="scn-exp-eval-result"><option value="">Result…</option>{results.map((r) => <option key={r} value={r}>{EVAL_LABEL[r] ?? humanize(r)}</option>)}</select>
        </div>
        {Object.keys(evals).length ? <ul className="plain-list row wrap" style={{ gap: 6, flexDirection: 'row' }}>{Object.entries(evals).map(([q, r]) => <li key={q}><Badge tone={EVAL_TONE[r] ?? 'gray'}>{`${q}: ${EVAL_LABEL[r] ?? humanize(r)}`}</Badge> <button type="button" className="link xsmall" onClick={() => { const n = { ...evals }; delete n[q]; setExp({ evaluations: n }); }} aria-label={`Remove expected evaluation of ${q}`}>remove</button></li>)}</ul> : null}
      </div>
      <FindingsExpectation exp={exp} o={o} questions={questions} setExp={setExp} />
      <div className="stack xsmall" style={{ gap: 4 }}>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={exp.applicable_questions != null} onChange={(e) => setExp({ applicable_questions: e.target.checked ? questions.filter((q) => q.applicable).map((q) => q.code) : null })} data-testid="scn-exp-applicable" /> Expect exactly these applicable questions{exp.applicable_questions ? `: ${exp.applicable_questions.join(', ')}` : ''}</label>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={exp.sequence != null} onChange={(e) => setExp({ sequence: e.target.checked ? [] : null })} disabled={exp.sequence == null} /> Expect exactly this question sequence{exp.sequence ? `: ${exp.sequence.join(' → ') || '(use a dry run to capture it)'}` : ' (capture it with a dry run)'}</label>
      </div>
    </fieldset>
  );
}

function PreviewCard({ p, onUse }: { p: Preview; onUse?: () => void }) {
  const a = p.actual as Record<string, unknown>;
  return (
    <Card title="Dry run result" subtitle={`${p.version_label} · not recorded`} aside={<Badge tone={STATUS_TONE[p.status] ?? 'gray'}>{humanize(p.status)}</Badge>}>
      <div className="stack" style={{ gap: 8 }} data-testid="scn-preview">
        <ResultExplanation status={p.status} failures={p.failures} problems={p.problems} error={p.error} stale={p.stale_reasons} />
        <ActualSummary a={a} />
        {Array.isArray(a.evaluations) ? <EvaluationTable items={a.evaluations as EvaluationItem[]} testId="scn-preview-eval" /> : null}
        {onUse && a.outcome ? <div><Button tiny onClick={onUse} data-testid="scn-use-actual">Use actual behaviour as expectations</Button> <span className="xsmall muted">This records a <strong>generated baseline</strong>, not independently validated expected behaviour. Review before saving: expectations should state what the script is meant to do.</span></div> : null}
      </div>
    </Card>
  );
}

export function ResultExplanation({ status, failures, problems, error, stale }: { status: string; failures: Record<string, unknown>[]; problems: string[]; error: string | null; stale: string[] }) {
  return (
    <div className="stack" style={{ gap: 4 }} data-testid="result-explanation">
      {status === 'PASSED' ? <p className="small" style={{ margin: 0 }}>Every expectation matched the controller's actual behaviour.</p> : null}
      {failures.length ? <ul className="plain-list stack small" style={{ gap: 2 }} aria-label="Differences">{failures.map((f, i) => <li key={i}><Badge tone="red">Difference</Badge> {String(f.message)}</li>)}</ul> : null}
      {problems.length ? <ul className="plain-list stack small" style={{ gap: 2 }} aria-label="Problems">{problems.map((x, i) => <li key={i}><Badge tone="gray">Invalid</Badge> {x}</li>)}</ul> : null}
      {error ? <p className="small" style={{ margin: 0 }}><Badge tone="amber">Execution error</Badge> {error}</p> : null}
      {stale.length ? <ul className="plain-list stack small" style={{ gap: 2 }} aria-label="Stale">{stale.map((x, i) => <li key={i}><Badge tone="amber">Stale</Badge> {x}</li>)}</ul> : null}
    </div>
  );
}

export function ActualSummary({ a }: { a: Record<string, unknown> }) {
  if (!a.outcome) return null;
  const gates = (a.gates ?? {}) as Record<string, string>;
  return (
    <dl className="kv xsmall" data-testid="actual-summary">
      <dt>Outcome</dt><dd>{humanize(String(a.outcome))}{a.termination_reason ? ` — ${humanize(String(a.termination_reason))} at ${humanize(String(a.termination_stage ?? ''))}` : ''}</dd>
      <dt>Gates (simulated)</dt><dd>{Object.entries(gates).map(([g, s]) => `${humanize(g.toUpperCase())}: ${humanize(s)}`).join(' · ')}</dd>
      <dt>Mandatory</dt><dd>{a.mandatory_complete ? 'All applicable mandatory completed' : [
        (a.mandatory_unresolved as string[] | undefined)?.length ? `Unresolved: ${(a.mandatory_unresolved as string[]).join(', ')}` : '',
        (a.mandatory_open as string[] | undefined)?.length ? `${a.termination_reason ? 'Not reached (terminated)' : 'Still open'}: ${(a.mandatory_open as string[]).join(', ')}` : '',
      ].filter(Boolean).join(' · ') || 'Incomplete'}</dd>
      <dt>Sequence</dt><dd className="mono">{((a.sequence as string[]) ?? []).join(' → ')}</dd>
      {Array.isArray(a.findings_view) ? <><dt>Findings</dt><dd data-testid="actual-findings">{(a.findings_view as { question: string; category: string; severity: string }[]).length ? (a.findings_view as { question: string; category: string; severity: string }[]).map((f) => `${f.question} ${humanize(f.category).toLowerCase()} (${f.severity})`).join('; ') : 'None'}</dd></> : null}
      {a.evaluation_totals ? <><dt>Answer evaluation</dt><dd><EvaluationTotals totals={a.evaluation_totals as Record<string, number>} testId="actual-eval-totals" /></dd></> : null}
      <dt>Compliance</dt><dd>Not evaluated (answer evaluation is not a compliance decision)</dd>
    </dl>
  );
}

function FindingsExpectation({ exp, o, questions, setExp }: { exp: Expect; o: Options; questions: Plan['questions']; setExp: (p: Partial<Expect>) => void }) {
  const list = exp.findings ?? null;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [sev, setSev] = useState('');
  const cats = (o as { finding_categories?: string[] }).finding_categories ?? [];
  const sevs = (o as { finding_severities?: string[] }).finding_severities ?? [];
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="scn-exp-findings">
      <label className="row xsmall" style={{ gap: 6 }}><input type="checkbox" checked={list != null} onChange={(e) => setExp({ findings: e.target.checked ? [] : null })} data-testid="scn-exp-findings-check" />
        Check generated findings (with the published finding rules){list != null && !list.length ? ' — expect no findings' : ''}</label>
      {list != null ? (
        <>
          <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
            <select aria-label="Question for an expected finding" className="field" value={q} onChange={(e) => setQ(e.target.value)} data-testid="scn-exp-finding-q"><option value="">Question…</option>{questions.map((x) => <option key={x.code} value={x.code}>{x.code}</option>)}</select>
            <select aria-label="Expected finding category" className="field" value={cat} onChange={(e) => setCat(e.target.value)} data-testid="scn-exp-finding-cat"><option value="">Category…</option>{cats.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>
            <select aria-label="Expected finding severity" className="field" value={sev} onChange={(e) => setSev(e.target.value)} data-testid="scn-exp-finding-sev"><option value="">Any severity</option>{sevs.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <Button tiny disabled={!q || !cat} onClick={() => { setExp({ findings: [...list, { question: q, category: cat, severity: (sev || null) as 'LOW' | null }] }); setQ(''); setCat(''); setSev(''); }} data-testid="scn-exp-finding-add">Add expected finding</Button>
          </div>
          {list.length ? <ul className="plain-list row wrap" style={{ gap: 6, flexDirection: 'row' }}>{list.map((f, i) => <li key={i}><Badge tone="red">{`${f.question}: ${humanize(f.category)}${f.severity ? ` · ${f.severity}` : ''}`}</Badge> <button type="button" className="link xsmall" onClick={() => setExp({ findings: list.filter((_, j) => j !== i) })} aria-label={`Remove expected finding ${i + 1}`}>remove</button></li>)}</ul> : null}
        </>
      ) : null}
    </div>
  );
}

export function BasisBadge({ basis }: { basis: string | null }) {
  if (basis === 'INDEPENDENT') return <Badge tone="green">Independently specified expectations</Badge>;
  if (basis === 'GENERATED_BASELINE') return <span data-testid="scn-basis-generated"><Badge tone="amber">Generated baseline · not independently validated</Badge></span>;
  return <Badge tone="gray">Expectation origin not recorded</Badge>;
}

export function scenarioLink(id: string) { return <Link className="link" to={`/simulator?tab=scenarios&scenario=${id}`}>Open scenario</Link>; }
