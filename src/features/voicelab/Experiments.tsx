// Voice Lab Experiments and Evaluation Results (S1-E.1). Configure dataset, prompt version, selected tests,
// repetitions, maximum duration and maximum authorised spend; the estimated maximum cost is shown before anything is
// created and fixed by the server on creation. Metered experiments need explicit spend authorisation by a different
// user (Voice Lab manager) confirming the exact amount; every run reserves the estimate first and is never retried.
// Results: deterministic wording (said vs heard), suspected speech deviation vs suspected transcription error,
// structured answer accuracy, latencies, cost and failures — with the audio fixture for human assessment.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { api, unwrap } from '../../api/client';
import { Badge, Button, Card } from '../../components/ui';
import { humanize, when } from '../cases/shared';
import { ErrorBox, Field } from '../scripts/ScriptEditor';
import { errorText } from '../simulator/ScenarioLibrary';
import { ms, SpendBadge, StatusBadge, usd, useLabAction, type LabExperiment, type LabSettings, type LabTrial } from './shared';

export function Experiments({ settings }: { settings: LabSettings }) {
  const [, setParams] = useSearchParams();
  const { can } = useAuth();
  const exps = useQuery({
    queryKey: ['voicelab', 'experiments'], queryFn: async () => unwrap(await api.GET('/api/v1/voice-lab/experiments')),
    refetchInterval: (q) => (q.state.data?.items.some((e) => e.status === 'RUNNING') ? 1500 : false),
  });
  return (
    <div className="stack" style={{ gap: 16 }} data-testid="lab-experiments">
      {can('voicelab.use') ? <NewExperiment settings={settings} /> : null}
      <Card title="Experiments" subtitle="Each experiment runs once; nothing is scheduled or retried automatically.">
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Experiments"><table className="data-table" data-testid="lab-experiment-list">
          <thead><tr><th>Experiment</th><th>Configuration</th><th>Status</th><th>Estimated max</th><th>Actual</th><th /></tr></thead>
          <tbody>
            {(exps.data?.items ?? []).map((e) => (
              <tr key={e.id} data-testid={`lab-exp-${e.experiment_ref}`}>
                <td><span className="mono small">{e.experiment_ref}</span><div className="small">{e.name}</div><div className="xsmall muted">{when(e.created_at)}</div></td>
                <td className="xsmall">{e.dataset_ref} · {e.case_revision_ids.length} test(s) × {e.repetitions} · {e.prompt_ref} v{e.prompt_version_no}<div><SpendBadge cls={e.spend_class} /></div></td>
                <td><StatusBadge s={e.status} />{e.end_reason && e.end_reason !== 'ALL_TRIALS_RUN' ? <div className="xsmall">{humanize(e.end_reason)}</div> : null}</td>
                <td className="small">{usd(e.estimated_max_usd)}</td>
                <td className="small">{usd(e.actual_usd)}</td>
                <td><ExperimentActions e={e} settings={settings} onOpen={() => setParams({ tab: 'results', experiment: e.id })} /></td>
              </tr>
            ))}
            {exps.data && !exps.data.items.length ? <tr><td colSpan={6} className="small muted">No experiments yet.</td></tr> : null}
          </tbody>
        </table></div>
      </Card>
    </div>
  );
}

function NewExperiment({ settings }: { settings: LabSettings }) {
  const ds = useQuery({ queryKey: ['voicelab', 'datasets'], queryFn: async () => unwrap(await api.GET('/api/v1/voice-lab/datasets')) });
  const pr = useQuery({ queryKey: ['voicelab', 'prompts'], queryFn: async () => unwrap(await api.GET('/api/v1/voice-lab/prompts')) });
  const [name, setName] = useState('');
  const [dsId, setDsId] = useState('');
  const [pvId, setPvId] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reps, setReps] = useState(1);
  const [maxS, setMaxS] = useState(30);
  const [maxSpend, setMaxSpend] = useState('0');
  const create = useLabAction<LabExperiment>();
  const dataset = ds.data?.items.find((d) => d.id === dsId);
  const cases = (dataset?.cases ?? []).filter((c) => !c.retired);
  useEffect(() => { setPicked(new Set(cases.map((c) => c.id))); }, [dsId, dataset?.cases.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const versions = (pr.data?.items ?? []).flatMap((p) => p.versions.map((v) => ({ p, v })));
  const chosen = versions.find((x) => x.v.id === pvId);
  const provider = settings.providers.find((p) => p.code === chosen?.v.provider);
  const est = useMemo(() => {
    const r = provider?.rate_card as { input_usd_per_audio_min?: string | null; output_usd_per_audio_min?: string | null } | undefined;
    if (!r || r.input_usd_per_audio_min == null || r.output_usd_per_audio_min == null) return null;
    return ((Number(r.input_usd_per_audio_min) + Number(r.output_usd_per_audio_min)) * maxS * picked.size * reps) / 60;
  }, [provider, maxS, picked.size, reps]);
  const submit = () => create.mutate(async () => unwrap(await api.POST('/api/v1/voice-lab/experiments', { body: {
    name, dataset_id: dsId, prompt_version_id: pvId, case_revision_ids: [...picked], repetitions: reps, max_duration_s: maxS, max_spend_usd: maxSpend,
  } })));
  return (
    <Card title="Configure an experiment" subtitle="Mock providers only. The estimate is an upper bound: audio both ways for the whole maximum duration of every trial.">
      <div className="stack" style={{ gap: 10 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          <Field id="ex-name" label="Name">{(p) => <input {...p} className="field labelled" value={name} onChange={(e) => setName(e.target.value)} data-testid="lab-exp-name" />}</Field>
          <Field id="ex-ds" label="Dataset">{(p) => (
            <select {...p} className="field" value={dsId} onChange={(e) => setDsId(e.target.value)} data-testid="lab-exp-dataset">
              <option value="">Choose…</option>{(ds.data?.items ?? []).map((d) => <option key={d.id} value={d.id}>{d.dataset_ref} · {d.name}</option>)}
            </select>)}</Field>
          <Field id="ex-pv" label="Prompt version and model">{(p) => (
            <select {...p} className="field" value={pvId} onChange={(e) => setPvId(e.target.value)} data-testid="lab-exp-prompt">
              <option value="">Choose…</option>{versions.map(({ p: x, v }) => <option key={v.id} value={v.id}>{x.prompt_ref} v{v.version_no} · {v.provider} · {v.model}</option>)}
            </select>)}</Field>
        </div>
        {dataset ? (
          <fieldset className="stack" style={{ gap: 4, border: 0, padding: 0, margin: 0 }} data-testid="lab-exp-tests">
            <legend className="form-label">Tests ({picked.size} of {cases.length} selected)</legend>
            {cases.map((c) => (
              <label key={c.id} className="row small" style={{ gap: 6 }}>
                <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(c.id); else n.delete(c.id); setPicked(n); }} />
                <span className="mono">{c.case_ref}</span> r{c.revision} · {c.name}
              </label>
            ))}
          </fieldset>
        ) : null}
        <div className="row wrap" style={{ gap: 8 }}>
          <Field id="ex-reps" label="Repetitions (1–5)">{(p) => <input {...p} className="field labelled" type="number" min={1} max={5} style={{ width: 100 }} value={reps} onChange={(e) => setReps(Number(e.target.value))} data-testid="lab-exp-reps" />}</Field>
          <Field id="ex-max" label="Maximum duration per trial (s)">{(p) => <input {...p} className="field labelled" type="number" min={5} max={120} style={{ width: 120 }} value={maxS} onChange={(e) => setMaxS(Number(e.target.value))} data-testid="lab-exp-maxs" />}</Field>
          <Field id="ex-spend" label="Maximum authorised spend (USD)">{(p) => <input {...p} className="field labelled" inputMode="decimal" style={{ width: 140 }} value={maxSpend} onChange={(e) => setMaxSpend(e.target.value)} data-testid="lab-exp-spend" />}</Field>
        </div>
        <p className="small" style={{ margin: 0 }} data-testid="lab-exp-estimate">
          Estimated maximum cost: <strong>{chosen ? (est === null ? 'cannot be estimated — will be refused' : usd(est)) : '—'}</strong>
          {provider ? <> <SpendBadge cls={provider.spend_class} /></> : null} · {picked.size * reps} trial(s). The server recomputes and enforces this.
        </p>
        <ErrorBox error={create.error ? errorText(create.error) : null} />
        {create.data ? <p className="small" role="status" data-testid="lab-exp-created">Created {create.data.experiment_ref}: {humanize(create.data.status)} · estimated maximum {usd(create.data.estimated_max_usd)}</p> : null}
        <div><Button variant="primary" onClick={submit} disabled={create.isPending || name.trim().length < 3 || !dsId || !pvId || !picked.size} data-testid="lab-exp-create">Create experiment</Button></div>
      </div>
    </Card>
  );
}

function ExperimentActions({ e, settings, onOpen }: { e: LabExperiment; settings: LabSettings; onOpen: () => void }) {
  const { can } = useAuth();
  const act = useLabAction<LabExperiment>();
  const [authOpen, setAuthOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row wrap" style={{ gap: 4 }}>
        {e.status === 'READY' && can('voicelab.use') ? <Button tiny variant="primary" disabled={act.isPending} data-testid={`lab-exp-run-${e.experiment_ref}`}
          onClick={() => act.mutate(async () => unwrap(await api.POST('/api/v1/voice-lab/experiments/{experiment_id}/run', { params: { path: { experiment_id: e.id } } })))}>
          Run ({usd(e.estimated_max_usd)} max)</Button> : null}
        {e.status === 'AWAITING_AUTHORISATION' && settings.can_manage ? <Button tiny onClick={() => setAuthOpen(!authOpen)} data-testid={`lab-exp-authorise-${e.experiment_ref}`}>Authorise spend</Button> : null}
        {['COMPLETED', 'CANCELLED', 'FAILED', 'RUNNING'].includes(e.status) ? <Button tiny onClick={onOpen} data-testid={`lab-exp-results-${e.experiment_ref}`}>Results</Button> : null}
      </div>
      {e.status === 'AWAITING_AUTHORISATION' && !settings.can_manage ? <span className="xsmall muted">Needs spend authorisation by a Voice Lab manager (another user).</span> : null}
      {authOpen && e.status === 'AWAITING_AUTHORISATION' ? (
        <div className="stack" style={{ gap: 4 }} data-testid="lab-authorise-form">
          <span className="xsmall">Type the exact estimated maximum ({usd(e.estimated_max_usd)}) to authorise. Synthetic metering — no money is spent.</span>
          <input className="field labelled" aria-label="Confirm amount (USD)" value={confirm} onChange={(x) => setConfirm(x.target.value)} data-testid="lab-authorise-amount" />
          <input className="field labelled" aria-label="Reason" value={reason} onChange={(x) => setReason(x.target.value)} data-testid="lab-authorise-reason" />
          <Button tiny variant="primary" disabled={act.isPending || reason.trim().length < 5} data-testid="lab-authorise-submit"
            onClick={() => act.mutate(async () => unwrap(await api.POST('/api/v1/voice-lab/experiments/{experiment_id}/authorise', { params: { path: { experiment_id: e.id } }, body: { confirm_usd: confirm, reason } })))}>Authorise</Button>
        </div>
      ) : null}
      <ErrorBox error={act.error ? errorText(act.error) : null} />
    </div>
  );
}

// ---- results ---------------------------------------------------------------------------------------------------
const ATTRIBUTION: Record<string, string> = {
  SUSPECTED_SPEECH_DEVIATION: 'Suspected speech deviation (the provider’s own text shows it)',
  SUSPECTED_TRANSCRIPTION_ERROR: 'Suspected transcription error (provider text matches the expected wording) — listen',
  UNATTRIBUTED: 'Unattributed (no provider text) — listen',
  PROVIDER_TEXT_ONLY: 'In the provider text only (not heard in the audio) — listen',
};

export function Results() {
  const [params, setParams] = useSearchParams();
  const list = useQuery({ queryKey: ['voicelab', 'experiments'], queryFn: async () => unwrap(await api.GET('/api/v1/voice-lab/experiments')) });
  const done = (list.data?.items ?? []).filter((e) => e.status !== 'AWAITING_AUTHORISATION' && e.status !== 'READY');
  const id = params.get('experiment') ?? done[0]?.id ?? '';
  const q = useQuery({
    queryKey: ['voicelab', 'experiment', id], enabled: !!id,
    queryFn: async () => unwrap(await api.GET('/api/v1/voice-lab/experiments/{experiment_id}', { params: { path: { experiment_id: id } } })),
    refetchInterval: (x) => (x.state.data?.status === 'RUNNING' ? 1500 : false),
  });
  const e = q.data;
  return (
    <div className="stack" style={{ gap: 16 }} data-testid="lab-results">
      <Card title="Evaluation results" subtitle="Deterministic measurements only; no automated judge. Suspicions are for a person to confirm by listening.">
        <Field id="res-exp" label="Experiment">{(p) => (
          <select {...p} className="field" value={id} onChange={(x) => setParams({ tab: 'results', experiment: x.target.value })} data-testid="lab-results-select">
            {done.length ? null : <option value="">No experiments have run yet</option>}
            {done.map((x) => <option key={x.id} value={x.id}>{x.experiment_ref} · {x.name} · {humanize(x.status)}</option>)}
          </select>)}</Field>
        {e ? (
          <div className="row wrap small" style={{ gap: 14, marginTop: 10 }} data-testid="lab-results-summary">
            <StatusBadge s={e.status} />
            {(['PASS', 'FAIL', 'NEEDS_HUMAN_REVIEW', 'NOT_EVALUATED'] as const).map((v) => <span key={v}>{humanize(v)}: <strong>{(e.summary as { verdicts?: Record<string, number> }).verdicts?.[v] ?? 0}</strong></span>)}
            <span>Failures: <strong>{(e.summary as { failed?: number }).failed ?? 0}</strong></span>
            <span>Cost: <strong>{usd(e.actual_usd)}</strong> of {usd(e.estimated_max_usd)} reserved</span>
          </div>
        ) : null}
      </Card>
      {e ? e.trials.map((t) => <TrialCard key={t.id} t={t} />) : null}
    </div>
  );
}

function Words({ m }: { m: Record<string, unknown> | null | undefined }) {
  if (!m) return <span className="muted">Not measured</span>;
  const sub = (m.substituted as { expected: string; actual: string }[]) ?? [];
  return (
    <span>{m.exact_match ? 'Exact match' : 'Differs'} · WER {String(m.wer)}
      {(m.omitted as string[]).length ? <> · omitted <strong>{(m.omitted as string[]).join(', ')}</strong></> : null}
      {(m.added as string[]).length ? <> · added <strong>{(m.added as string[]).join(', ')}</strong></> : null}
      {sub.length ? <> · substituted <strong>{sub.map((s) => `${s.expected}→${s.actual}`).join(', ')}</strong></> : null}
    </span>
  );
}

const SPEECH: Record<string, [string, 'green' | 'amber' | 'red' | 'gray' | 'blue']> = {
  AUTOMATED_TRANSCRIPT_MATCH: ['Automated transcript match', 'green'],
  SUSPECTED_SPEECH_DEVIATION: ['Suspected speech deviation', 'red'],
  SUSPECTED_TRANSCRIPTION_ERROR: ['Suspected transcription error', 'amber'],
  INSUFFICIENT_AUDIO_EVIDENCE: ['Insufficient audio evidence', 'gray'],
  CONFIRMED_AS_EXPECTED: ['Human-confirmed: as expected', 'green'],
  CONFIRMED_DEVIATION: ['Human-confirmed: deviation', 'red'],
  INCONCLUSIVE: ['Human-assessed: inconclusive', 'gray'],
};

function SpeechAssessment({ t }: { t: LabTrial }) {
  const act = useLabAction<unknown>();
  const [result, setResult] = useState('CONFIRMED_AS_EXPECTED');
  const [notes, setNotes] = useState('');
  const [listened, setListened] = useState(false);
  const human = t.assessments[0] as { result?: string; notes?: string; assessed_at?: string } | undefined;
  const [label, tone] = SPEECH[t.speech_result ?? ''] ?? ['Not evaluated', 'gray'];
  return (
    <div className="stack" style={{ gap: 6 }} data-testid={`lab-speech-${t.case_ref}-${t.repetition}`}>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="form-label">Speech result</span><Badge tone={tone}>{label}</Badge>
        {human?.result ? <Badge tone={SPEECH[human.result]?.[1] ?? 'gray'}>{SPEECH[human.result]?.[0] ?? human.result}</Badge> : null}
      </div>
      <span className="xsmall muted">The independent transcript is the primary automated source but is not proof of verbatim delivery; only a person who listened can confirm what was said.</span>
      {human?.notes ? <span className="xsmall">Human note: {human.notes}{human.assessed_at ? ` (${when(human.assessed_at)})` : ''}</span> : null}
      {t.has_audio && t.status === 'COMPLETED' ? (
        <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
          <select className="field" aria-label="Human speech result" value={result} onChange={(e) => setResult(e.target.value)} data-testid="lab-assess-result">
            <option value="CONFIRMED_AS_EXPECTED">Confirmed as expected</option><option value="CONFIRMED_DEVIATION">Confirmed deviation</option><option value="INCONCLUSIVE">Inconclusive</option>
          </select>
          <input className="field labelled" aria-label="Assessment notes" value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="lab-assess-notes" />
          <label className="row xsmall" style={{ gap: 4 }}><input type="checkbox" checked={listened} onChange={(e) => setListened(e.target.checked)} data-testid="lab-assess-listened" /> I listened to the audio</label>
          <Button tiny disabled={!listened || notes.trim().length < 5 || act.isPending} data-testid="lab-assess-save"
            onClick={() => act.mutate(async () => unwrap(await api.POST('/api/v1/voice-lab/trials/{trial_id}/assessments', { params: { path: { trial_id: t.id } }, body: { result: result as 'CONFIRMED_AS_EXPECTED', notes, listened } })))}>Record human result</Button>
        </div>
      ) : null}
      <ErrorBox error={act.error ? errorText(act.error) : null} />
    </div>
  );
}

function TrialCard({ t }: { t: LabTrial }) {
  const m = t.metrics as Record<string, unknown>;
  const att = (m.attributions as { op: string; expected: string | null; actual: string | null; attribution: string }[]) ?? [];
  const ans = m.answer as { accuracy: number; fields: { field: string; expected: unknown; extracted: unknown; match: boolean }[] } | null;
  return (
    <Card title={`${t.case_ref} r${t.case_revision} · ${t.case_name} · repetition ${t.repetition}`} aside={<div className="row" style={{ gap: 6 }}><StatusBadge s={t.status} /><StatusBadge s={t.verdict} /></div>}>
      <div className="stack small" style={{ gap: 8 }} data-testid={`lab-trial-${t.case_ref}-${t.repetition}`}>
        {t.failure ? <p className="field-error" role="alert">{t.failure}</p> : null}
        <dl className="kv">
          <dt>Expected</dt><dd>{t.expected_statement}</dd>
          <dt>Provider said (text)</dt><dd>{t.provider_text ?? '—'}</dd>
          <dt>Wording (said)</dt><dd data-testid="lab-trial-said"><Words m={m.said as Record<string, unknown>} /></dd>
          <dt>Heard (faster-whisper)</dt><dd>{t.heard_text ?? `Not available (${humanize(String(m.heard_basis ?? 'NO_AUDIO_FIXTURE'))})`}</dd>
          <dt>Wording (heard)</dt><dd data-testid="lab-trial-heard"><Words m={m.heard as Record<string, unknown>} /></dd>
          <dt>Structured answer</dt><dd>{ans ? `${Math.round(ans.accuracy * 100)}% · ${ans.fields.map((f) => `${f.field}: ${String(f.extracted ?? '—')} (expected ${String(f.expected)})`).join('; ')}` : 'No expected answer'}</dd>
          <dt>First audio</dt><dd>{ms(m.first_audio_ms)}</dd>
          <dt>Interruption latency</dt><dd>{ms(m.interruption_ms)}</dd>
          <dt>Session duration</dt><dd>{ms(m.session_duration_ms)} · output audio {String(m.output_audio_s ?? '—')} s</dd>
          <dt>Cost</dt><dd>{usd(t.cost_usd)}</dd>
          <dt>Expected behaviour</dt><dd>{t.expected_behaviour ? <>{t.expected_behaviour} <Badge tone="amber">Human assessment required</Badge></> : '—'}</dd>
        </dl>
        {att.length ? (
          <div data-testid="lab-trial-attributions"><span className="form-label">Deviations</span>
            <ul className="plain-list" style={{ flexDirection: 'column' }}>{att.map((a, i) => (
              <li key={i}>{humanize(a.op)} {a.expected ? `“${a.expected}”` : ''}{a.actual ? ` → “${a.actual}”` : ''}: {ATTRIBUTION[a.attribution] ?? a.attribution}</li>
            ))}</ul></div>
        ) : null}
        {t.checks.length ? (
          <div><span className="form-label">Criteria</span>
            <ul className="plain-list" style={{ flexDirection: 'column' }}>{t.checks.map((c, i) => <li key={i}>{String(c.label)}: <strong>{humanize(String(c.result))}</strong> ({String(c.value ?? '—')}; {String(c.detail)})</li>)}</ul></div>
        ) : null}
        <SpeechAssessment t={t} />
        {t.has_audio ? <audio controls preload="none" src={`/api/v1/voice-lab/test-case-revisions/${t.test_case_revision_id}/audio`} aria-label="Provider audio fixture for human assessment" style={{ width: '100%' }} /> : null}
        <p className="xsmall muted">{String(m.content_basis ?? '')} {String(m.timing_basis ?? '')}</p>
      </div>
    </Card>
  );
}
