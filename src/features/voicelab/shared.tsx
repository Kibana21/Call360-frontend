// Voice Lab shared pieces (S1-E.1): typed API shapes, money formatting, mutation helper and the session detail view
// (metrics, cost, recording playback, independent transcript and the provider event trace) used by the Playground and
// Session History.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { Badge, Button, Card, type Tone } from '../../components/ui';
import { humanize, when } from '../cases/shared';

export type LabSettings = components['schemas']['LabSettingsOut'];
export type LabPrompt = components['schemas']['LabPromptOut'];
export type LabPromptVersion = components['schemas']['LabPromptVersionOut'];
export type LabDataset = components['schemas']['LabDatasetOut'];
export type LabCase = components['schemas']['LabCaseOut'];
export type LabSession = components['schemas']['LabSessionOut'];
export type LabSessionStart = components['schemas']['LabSessionStart'];
export type LabExperiment = components['schemas']['LabExperimentOut'];
export type LabTrial = components['schemas']['LabTrialOut'];

export const usd = (v: string | number | null | undefined) => (v === null || v === undefined ? '—' : `USD ${Number(v).toFixed(4)}`);
export const ms = (v: unknown) => (typeof v === 'number' ? `${v} ms` : 'Not measured');

export const SPEND_LABEL: Record<string, [string, Tone]> = {
  NONE: ['No cost (mock)', 'green'], SIMULATED: ['Synthetic metering — no money', 'blue'], PAID: ['Paid — disabled', 'red'],
};
export function SpendBadge({ cls }: { cls: string }) {
  const [l, t] = SPEND_LABEL[cls] ?? [cls, 'gray'];
  return <Badge tone={t}>{l}</Badge>;
}

export const STATUS_TONE: Record<string, Tone> = {
  CREATED: 'blue', LIVE: 'green', ENDED: 'gray', FAILED: 'red', READY: 'blue', RUNNING: 'green', COMPLETED: 'gray',
  CANCELLED: 'amber', AWAITING_AUTHORISATION: 'amber', PASS: 'green', FAIL: 'red', NEEDS_HUMAN_REVIEW: 'amber', NOT_EVALUATED: 'gray',
  HELD: 'amber', RECONCILED: 'gray', RELEASED: 'gray',
};
export const StatusBadge = ({ s }: { s: string }) => <Badge tone={STATUS_TONE[s] ?? 'gray'}>{humanize(s)}</Badge>;

export function useSettings() {
  return useQuery({ queryKey: ['voicelab', 'settings'], queryFn: async () => unwrap(await api.GET('/api/v1/voice-lab/settings')) });
}

/** A mutation that refreshes every Voice Lab query afterwards. */
export function useLabAction<T>() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fn: () => Promise<T>) => fn(),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ['voicelab'] }); },
  });
}

const TRACK: Record<string, string> = { MIC: 'Microphone (as received by the server)', PROVIDER_PLAYBACK: 'Provider audio (as sent by the server)' };

export function SessionDetail({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['voicelab', 'session', id],
    queryFn: async () => unwrap(await api.GET('/api/v1/voice-lab/sessions/{session_id}', { params: { path: { session_id: id } } })),
    refetchInterval: (query) => (query.state.data && ['CREATED', 'LIVE'].includes(query.state.data.status)) || query.state.data?.transcript_status === 'PENDING' ? 1500 : false,
  });
  const s = q.data;
  if (!s) return <p className="small muted">{q.isError ? 'The session could not be loaded.' : 'Loading session…'}</p>;
  const m = s.metrics as Record<string, unknown>;
  const lat = (m.interruption_latency_ms as number[] | undefined) ?? [];
  return (
    <div className="stack" style={{ gap: 12 }} data-testid={`lab-session-${s.session_ref}`}>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="mono strong">{s.session_ref}</span><StatusBadge s={s.status} /><SpendBadge cls={s.spend_class} />
        <Badge tone="purple">{humanize(s.mode)}</Badge>{s.end_reason ? <Badge tone="gray">{humanize(s.end_reason)}</Badge> : null}
      </div>
      <dl className="kv" data-testid="lab-session-metrics">
        <dt>Provider</dt><dd>{s.provider} · {s.model} · {s.voice}</dd>
        <dt>Prompt</dt><dd>{s.prompt_ref ? `${s.prompt_ref} v${s.prompt_version_no} (${s.prompt_name})` : '—'}</dd>
        <dt>Duration</dt><dd>{typeof m.duration_ms === 'number' ? `${(m.duration_ms / 1000).toFixed(1)} s` : '—'} (maximum {s.max_duration_s} s, idle {s.idle_timeout_s} s)</dd>
        <dt>First audio</dt><dd>{ms(m.first_audio_ms)}</dd>
        <dt>Interruptions</dt><dd>{String(m.interruptions ?? 0)}{lat.length ? ` · latency ${lat.join(', ')} ms` : ''}</dd>
        <dt>Estimated maximum</dt><dd>{usd(s.estimated_max_usd)}</dd>
        <dt>Reconciled cost</dt><dd data-testid="lab-session-cost">{usd(s.reconciled_usd)}{s.reservation_status ? ` · reservation ${humanize(s.reservation_status)} (${usd(s.reserved_usd)})` : ''}</dd>
        {s.termination_status !== 'NOT_APPLICABLE' ? <>
          <dt>Provider termination</dt><dd data-testid="lab-session-termination"><Badge tone={TERMINATION_TONE[s.termination_status] ?? 'gray'}>{humanize(s.termination_status)}</Badge>{s.provider_session_id ? <span className="mono xsmall"> · {s.provider_session_id}</span> : null}</dd>
          <dt>Provider usage</dt><dd>{s.provider_usage_seconds != null ? `${s.provider_usage_seconds} s` : 'Not reported'}{s.usage_source ? ` · ${humanize(s.usage_source)}` : ''}</dd>
        </> : null}
        {s.authorisation_ref ? <><dt>Smoke-test authorisation</dt><dd className="mono">{s.authorisation_ref}</dd></> : null}
        {typeof m.delegations === 'number' ? <><dt>Delegations / instructions</dt><dd>{String(m.delegations)} answered by the deterministic Python responder · {String(m.instructions_sent ?? 0)} instructions</dd></> : null}
      </dl>
      {s.termination_status === 'UNCONFIRMED' ? <UnconfirmedActions s={s} /> : null}
      {typeof m.timing_basis === 'string' ? <p className="xsmall muted">Timing: {m.timing_basis}.</p> : null}
      <div className="stack" style={{ gap: 6 }}>
        <span className="form-label">Recording</span>
        {s.media.length ? s.media.map((t) => t.purged_at ? (
          <p key={t.track} className="xsmall muted">{TRACK[t.track] ?? t.track}: deleted on {when(t.purged_at)} under the local retention policy (checksum kept: <span className="mono">{t.sha256.slice(0, 12)}…</span>)</p>
        ) : (
          <div key={t.track} className="stack" style={{ gap: 2 }}>
            <span className="xsmall">{TRACK[t.track] ?? t.track} · {(t.samples / 16000).toFixed(1)} s · <span className="mono">{t.sha256.slice(0, 12)}…</span></span>
            <audio controls preload="none" src={`/api/v1/voice-lab/sessions/${s.id}/audio/${t.track}`} data-testid={`lab-audio-${t.track}`} style={{ width: '100%' }} />
          </div>
        )) : <p className="xsmall muted">{s.record ? 'No recording was saved.' : 'Not recorded (recording was not chosen for this session).'}</p>}
      </div>
      <div className="stack" style={{ gap: 6 }} data-testid="lab-transcript">
        <span className="form-label">Independent transcript (local faster-whisper) · {humanize(s.transcript_status)}</span>
        {s.transcripts.map((t) => (
          <p key={`${t.source}-${t.track}`} className="small" style={{ margin: 0 }}>
            <span className="muted">{t.source === 'PROVIDER_TRANSCRIPT' ? 'Provider’s own transcript (not independent)' : 'Independent'} · {t.track === 'MIC' ? 'caller' : 'provider audio'}: </span>
            {t.purged_at ? <em className="muted">deleted under the local retention policy</em> : t.text || '(no speech recognised)'}
          </p>
        ))}
        {s.transcript_status === 'PENDING' ? <p className="xsmall muted">Transcribing…</p> : null}
      </div>
      <details data-testid="lab-trace">
        <summary className="small strong">Provider event trace ({s.events.length})</summary>
        <ol className="plain-list xsmall mono" style={{ marginTop: 6, flexDirection: 'column', overflowWrap: 'anywhere', minWidth: 0 }}>
          {s.events.map((e) => (
            <li key={e.seq}>+{e.offset_ms} ms · {e.source} · {e.event_type}{Object.keys(e.details).length ? ` · ${JSON.stringify(e.details)}` : ''}</li>
          ))}
        </ol>
      </details>
      <p className="xsmall muted">Created {when(s.created_at)} · synthetic experiment record, isolated from operational cases and KPIs.</p>
    </div>
  );
}

const TERMINATION_TONE: Record<string, Tone> = { CONFIRMED: 'green', NOT_STARTED: 'gray', UNCONFIRMED: 'red', RESOLVED: 'blue' };

function UnconfirmedActions({ s }: { s: LabSession }) {
  const settings = useSettings();
  const act = useLabAction<unknown>();
  const [sec, setSec] = useState('');
  const [why, setWhy] = useState('');
  return (
    <div className="field-error stack" role="alert" style={{ gap: 6 }} data-testid="lab-unconfirmed">
      <strong>Provider termination or usage was not confirmed.</strong>
      <span className="small">The reservation stays held at its maximum ({usd(s.reserved_usd)}) — an unconfirmed charge is never treated as zero. Check the provider’s usage page, then record the reported seconds, or close the provider session over the sideband.</span>
      {settings.data?.can_manage ? (
        <div className="row wrap" style={{ gap: 6, alignItems: 'flex-end' }}>
          <input className="field labelled" aria-label="Provider-reported usage (seconds)" inputMode="decimal" style={{ width: 120 }} value={sec} onChange={(e) => setSec(e.target.value)} data-testid="lab-resolve-seconds" />
          <input className="field labelled" aria-label="Reason" value={why} onChange={(e) => setWhy(e.target.value)} data-testid="lab-resolve-reason" />
          <Button tiny disabled={act.isPending || !sec || why.trim().length < 5} data-testid="lab-resolve"
            onClick={() => act.mutate(async () => unwrap(await api.POST('/api/v1/voice-lab/sessions/{session_id}/resolve-usage', { params: { path: { session_id: s.id } }, body: { usage_seconds: Number(sec), source: 'PROVIDER_USAGE_DASHBOARD', reason: why } })))}>Record provider usage</Button>
          {s.provider_session_id ? <Button tiny disabled={act.isPending} data-testid="lab-provider-close"
            onClick={() => act.mutate(async () => unwrap(await api.POST('/api/v1/voice-lab/sessions/{session_id}/provider-close', { params: { path: { session_id: s.id } } })))}>Close provider session (sideband)</Button> : null}
        </div>
      ) : <span className="xsmall">A Voice Lab manager resolves it.</span>}
    </div>
  );
}

export function SessionCard({ id, title = 'Session evidence' }: { id: string; title?: string }) {
  return <Card title={title}><SessionDetail id={id} /></Card>;
}
