// Voice Lab (`/voice-lab`, S1-E.1): a module of Call360 for voice experiments with the mock provider —
// Playground, Golden Dataset, Experiments, Evaluation Results, Session History, and Budget and Settings. Records are
// synthetic and isolated from operational cases and KPIs. Paid providers are disabled; the server enforces every
// cost control (this page only displays them). Opening the page connects to nothing.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, unwrap } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Icon } from '../../components/Icon';
import { Forbidden } from '../../components/StateView';
import { Badge, Button, Card, PageHead } from '../../components/ui';
import { humanize, Region, when } from '../cases/shared';
import { ErrorBox, Field } from '../scripts/ScriptEditor';
import { errorText, LINK_BUTTON } from '../simulator/ScenarioLibrary';
import { Datasets } from './Datasets';
import { Experiments, Results } from './Experiments';
import { Playground } from './Playground';
import { SessionDetail, SpendBadge, StatusBadge, usd, useLabAction, useSettings, type LabSettings } from './shared';

const TABS = [['playground', 'Playground'], ['datasets', 'Golden Dataset'], ['experiments', 'Experiments'], ['results', 'Evaluation Results'],
  ['sessions', 'Session History'], ['settings', 'Budget and Settings']] as const;

export function VoiceLabPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const allowed = can('voicelab.use') || can('voicelab.manage');
  const settings = useSettings();
  if (!allowed) return <Forbidden />;
  const user = can('voicelab.use');
  const tabs = TABS.filter(([k]) => user || k === 'experiments' || k === 'results' || k === 'sessions' || k === 'settings');
  const tab = params.get('tab') ?? (user ? 'playground' : 'settings');
  const s = settings.data;
  return (
    <>
      <PageHead eyebrow="Experimentation" title="Voice Lab"
        description="Voice experiments and evaluation, isolated from operational callbacks. Every cost control is enforced by the server."
        actions={s ? <span className="row" style={{ gap: 6 }}>{s.control.kill_switch ? <Badge tone="red">Emergency stop engaged</Badge> : null}<Badge tone="green">Paid providers disabled</Badge></span> : null} />
      <div className="topnotice" role="note"><div className="row"><Icon name="info" size="sm" />
        <span><strong>Synthetic experiments only.</strong> Never use real customer data or speech. Lab sessions are not contact attempts or conversations and never affect KPIs, queues or compliance. Runnable here: the keyless mock providers and the GPT-Live adapter against a local mocked protocol server. Paid providers are disabled; a paid session would need the server configuration, the paid switch and a single-use authorisation.</span></div></div>
      <div className="subtabs" role="tablist" aria-label="Voice Lab sections" style={{ marginBottom: 14 }}>
        {tabs.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} data-testid={`lab-tab-${k}`}
            onClick={() => setParams({ tab: k })}>{l}</button>
        ))}
      </div>
      <Region query={settings} label="Voice Lab settings">{() => {
        const st = s!;
        if (tab === 'datasets' && user) return <Datasets />;
        if (tab === 'experiments') return <Experiments settings={st} />;
        if (tab === 'results') return <Results />;
        if (tab === 'sessions') return <Sessions />;
        if (tab === 'settings') return <Settings settings={st} />;
        return user ? <Playground settings={st} /> : <Settings settings={st} />;
      }}</Region>
    </>
  );
}

function Sessions() {
  const q = useQuery({ queryKey: ['voicelab', 'sessions'], queryFn: async () => unwrap(await api.GET('/api/v1/voice-lab/sessions')) });
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="layout cols-2" data-testid="lab-sessions">
      <Card title="Session history" subtitle="Playground sessions and experiment trials (latest 50)">
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Lab sessions"><table className="data-table">
          <thead><tr><th>Session</th><th>Mode</th><th>Status</th><th>Cost</th></tr></thead>
          <tbody>
            {(q.data?.items ?? []).map((s) => (
              <tr key={s.id} className={sel === s.id ? 'selected' : ''} data-testid={`lab-row-${s.session_ref}`}>
                <td><button type="button" className="link mono small" style={LINK_BUTTON} onClick={() => setSel(s.id)}>{s.session_ref}</button>
                  <div className="xsmall muted">{when(s.created_at)} · {s.provider}{s.experiment_ref ? ` · ${s.experiment_ref}` : ''}</div></td>
                <td className="small">{humanize(s.mode)}</td>
                <td><StatusBadge s={s.status} />{s.end_reason ? <div className="xsmall">{humanize(s.end_reason)}</div> : null}</td>
                <td className="small">{usd(s.reconciled_usd)}<div><SpendBadge cls={s.spend_class} /></div></td>
              </tr>
            ))}
            {q.data && !q.data.items.length ? <tr><td colSpan={4} className="small muted">No lab sessions yet.</td></tr> : null}
          </tbody>
        </table></div>
      </Card>
      <Card title="Session evidence">{sel ? <SessionDetail id={sel} /> : <p className="small muted">Select a session.</p>}</Card>
    </div>
  );
}

function Settings({ settings: s }: { settings: LabSettings }) {
  return (
    <div className="stack" style={{ gap: 16 }} data-testid="lab-settings">
      <div className="layout cols-2">
        <Card title="Spend evidence" subtitle="From the application's own records">
          <dl className="kv" data-testid="lab-paid-spend">
            <dt>Paid spend</dt><dd><strong>{usd(s.paid_spend.paid_usd)}</strong></dd>
            <dt>Paid reservations</dt><dd>{s.paid_spend.paid_reservations}</dd>
            <dt>Paid sessions</dt><dd>{s.paid_spend.paid_sessions}</dd>
            <dt>Paid experiments</dt><dd>{s.paid_spend.paid_experiments}</dd>
            <dt>Paid switch</dt><dd data-testid="lab-paid-switch-state">{s.control.paid_enabled ? 'On (each paid session still needs a single-use authorisation)' : 'Off (default)'}</dd>
            <dt>Automatic retries</dt><dd>{s.control.retries_enabled ? 'Enabled' : 'Disabled'}</dd>
            <dt>Scheduled experiments</dt><dd>{s.control.scheduling_enabled ? 'Enabled' : 'Disabled'}</dd>
          </dl>
        </Card>
        <KillSwitch s={s} />
      </div>
      <GptLiveCard s={s} />
      {s.budgets.map((b) => <BudgetCard key={b.spend_class} b={b} canManage={s.can_manage} />)}
      <Card title="Voice providers" subtitle="Real provider rates must come from the provider's current official price list before one is ever configured.">
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Voice providers"><table className="data-table" data-testid="lab-providers">
          <thead><tr><th>Provider</th><th>Cost class</th><th>Availability</th><th>Rate card (USD per audio minute)</th></tr></thead>
          <tbody>{s.providers.map((p) => {
            const r = p.rate_card as { input_usd_per_audio_min: string | null; output_usd_per_audio_min: string | null; basis: string };
            return (
              <tr key={p.code} data-testid={`lab-provider-${p.code}`}>
                <td><span className="strong small">{p.label}</span><div className="xsmall mono">{p.code}</div></td>
                <td><SpendBadge cls={p.spend_class} /></td>
                <td className="small">{p.available ? <Badge tone="green">Available</Badge> : <Badge tone="red">Not enabled</Badge>}<div className="xsmall">{p.reason}</div></td>
                <td className="small">{r.input_usd_per_audio_min === null ? 'Unknown — refused (fail closed)' : `in ${r.input_usd_per_audio_min} · out ${r.output_usd_per_audio_min}`}<div className="xsmall muted">{r.basis}</div></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </Card>
      <Card title="Change history" subtitle="Budget and emergency-stop changes (insert-only)">
        <ul className="plain-list small" style={{ flexDirection: 'column' }} data-testid="lab-config-history">
          {s.history.length ? s.history.map((h, i) => <li key={i}>{when(h.created_at)} · {h.target} · {h.reason} · {JSON.stringify(h.after)}</li>) : <li className="muted">No changes yet.</li>}
        </ul>
      </Card>
    </div>
  );
}

function KillSwitch({ s }: { s: LabSettings }) {
  const [reason, setReason] = useState('');
  const act = useLabAction<unknown>();
  const on = s.control.kill_switch;
  return (
    <Card title="Emergency stop" subtitle="Stops live sessions at once and running experiments before their next trial; refuses new work." aside={on ? <Badge tone="red">Engaged</Badge> : <Badge tone="green">Released</Badge>}>
      {on && s.control.kill_reason ? <p className="small">Reason: {s.control.kill_reason}</p> : null}
      {s.can_manage ? (
        <div className="stack" style={{ gap: 6 }}>
          <Field id="ks-reason" label="Reason (required)">{(p) => <input {...p} className="field labelled" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="lab-kill-reason" />}</Field>
          <div><Button variant={on ? '' : 'danger'} disabled={reason.trim().length < 5 || act.isPending} data-testid="lab-kill-toggle"
            onClick={() => act.mutate(async () => { const r = unwrap(await api.POST('/api/v1/voice-lab/kill-switch', { body: { engaged: !on, reason } })); setReason(''); return r; })}>
            {on ? 'Release emergency stop' : 'Engage emergency stop'}</Button></div>
          <ErrorBox error={act.error ? errorText(act.error) : null} />
        </div>
      ) : <p className="xsmall muted">Only a Voice Lab manager can change the emergency stop.</p>}
    </Card>
  );
}

function GptLiveCard({ s }: { s: LabSettings }) {
  const act = useLabAction<unknown>();
  const [why, setWhy] = useState('');
  const [f, setF] = useState({ provider: 'AZURE_OPENAI_GPT_LIVE', voice: 'marin', max_duration_s: '120', expires_in_h: '24', reason: '' });
  const g = s.gpt_live;
  const z = s.azure;
  const azure = s.providers.find((p) => p.code === 'AZURE_OPENAI_GPT_LIVE');
  const openai = s.providers.find((p) => p.code === 'OPENAI_GPT_LIVE');
  const chosen = f.provider === 'AZURE_OPENAI_GPT_LIVE' ? azure : openai;
  type Rate = { session_usd_per_min?: string; input_usd_per_audio_min?: string | null; verified_on?: string | null; source?: string; basis?: string };
  const rateOf = (p: typeof azure) => (p?.rate_card ?? {}) as Rate;
  const known = (p: typeof azure) => rateOf(p).input_usd_per_audio_min != null;
  const oRate = rateOf(openai);
  const zRate = rateOf(azure);
  const model = chosen?.models[0] ?? '';
  const issued = s.authorisations.find((a) => a.status === 'ISSUED');
  const maxUsd = known(chosen) ? (Number(rateOf(chosen).session_usd_per_min ?? 0) * Number(f.max_duration_s || 0)) / 60 : null;
  return (
    <Card title="GPT-Live providers (S1-E.2 / S1-E.2A)" subtitle="One shared adapter, verified offline against a mocked protocol server. No live connection has been made. Azure OpenAI is the preferred live provider."
      aside={<Badge tone={azure?.available ? 'amber' : 'gray'}>{azure?.available ? 'Azure configured on this server' : 'Azure not configured'}</Badge>}>
      <div className="layout cols-2" style={{ gap: 16 }}>
        <div className="stack" style={{ gap: 12 }}>
          <div className="stack" style={{ gap: 4 }}>
            <span className="form-label">Azure OpenAI GPT-Live <Badge tone="blue">Preferred</Badge></span>
            <dl className="kv" data-testid="lab-azure-config">
              <dt>Mode</dt><dd>{z.mode}</dd>
              <dt>Endpoint host</dt><dd className="mono">{z.endpoint_host ?? 'Not configured'}</dd>
              <dt>Deployment</dt><dd className="mono">{z.deployment ?? 'Not configured'} <span className="xsmall muted">(sent as session.model)</span></dd>
              <dt>Authentication</dt><dd>{z.auth === 'API_KEY' ? 'API key (api-key header)' : `Microsoft Entra ID / Managed Identity (scope ${z.entra_scope})`} · {z.credential_configured ? 'credential configured (never shown or sent to the browser)' : z.auth === 'ENTRA' && !z.entra_available ? 'azure-identity not installed' : 'not configured'}</dd>
              <dt>Wire audio</dt><dd>PCM16 {z.audio_rate} Hz (browser 16 kHz, resampled on the server)</dd>
              <dt>Deployment type / region</dt><dd>{z.deployment_type ?? '—'} · {z.region ?? '—'}</dd>
              <dt>Rate card</dt><dd data-testid="lab-azure-rate">{known(azure) ? `USD ${zRate.session_usd_per_min} per minute · source ${zRate.source} · verified ${zRate.verified_on}` : 'Unknown — every Azure session is refused (fail closed). The direct OpenAI price is not reused.'}</dd>
              {z.missing.length ? <><dt>Not yet configured</dt><dd className="xsmall">{z.missing.join('; ')}</dd></> : null}
            </dl>
            <p className="xsmall muted">Azure budgets and cost alerts notify; they are not hard spending caps. Call360&apos;s own limits, the single-use authorisation and the deployment&apos;s quota are the controls.</p>
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <span className="form-label">OpenAI GPT-Live (direct)</span>
            <dl className="kv" data-testid="lab-gpt-config">
              <dt>Mode</dt><dd>{g.mode}</dd>
              <dt>Backend API key</dt><dd>{g.api_key_configured ? 'Configured (never shown or sent to the browser)' : 'Not configured'}</dd>
              <dt>Endpoint host</dt><dd className="mono">{g.endpoint_host}</dd>
              <dt>Verified rate</dt><dd>USD {oRate.session_usd_per_min} per minute, billed per second · verified {oRate.verified_on} ({oRate.source})</dd>
            </dl>
          </div>
          <dl className="kv">
            <dt>Mocked protocol server</dt><dd>{g.mock_endpoint_configured ? `Configured (loopback, ${g.mock_profile === 'AZURE' ? 'Azure OpenAI' : 'OpenAI'} profile)` : 'Not configured'}</dd>
            <dt>Close confirmation timeout</dt><dd>{g.close_timeout_s} s</dd>
            <dt>Protocol notes</dt><dd className="mono xsmall">{g.protocol_notes}</dd>
          </dl>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <div className="stack" style={{ gap: 6 }}>
            <span className="form-label">Paid switch: {s.control.paid_enabled ? 'on' : 'off'}</span>
            {s.can_manage ? (
              <div className="row wrap" style={{ gap: 6 }}>
                <input className="field labelled" aria-label="Reason for the paid switch change" value={why} onChange={(e) => setWhy(e.target.value)} data-testid="lab-paid-reason" />
                <Button tiny disabled={why.trim().length < 5 || act.isPending} data-testid="lab-paid-toggle"
                  onClick={() => act.mutate(async () => { const r = unwrap(await api.POST('/api/v1/voice-lab/paid-switch', { body: { enabled: !s.control.paid_enabled, reason: why } })); setWhy(''); return r; })}>
                  {s.control.paid_enabled ? 'Switch paid providers off' : 'Switch paid providers on'}</Button>
              </div>
            ) : null}
          </div>
          <div className="stack" style={{ gap: 6 }} data-testid="lab-smoke-tests">
            <span className="form-label">Single-use smoke-test authorisations</span>
            {s.authorisations.length ? (
              <ul className="plain-list small" style={{ flexDirection: 'column' }}>
                {s.authorisations.map((a) => (
                  <li key={a.id} data-testid={`lab-auth-${a.authorisation_ref}`}>
                    <span className="mono">{a.authorisation_ref}</span> <Badge tone={a.status === 'ISSUED' ? 'amber' : 'gray'}>{humanize(a.status)}</Badge> {a.model} · {a.voice} · {a.max_duration_s} s · up to {usd(a.max_usd)} · expires {when(a.expires_at)}
                    {a.consumed_session_ref ? <> · used by <span className="mono">{a.consumed_session_ref}</span></> : null}
                    {a.status === 'ISSUED' && s.can_manage ? <> <Button tiny data-testid={`lab-auth-revoke-${a.authorisation_ref}`} disabled={act.isPending}
                      onClick={() => act.mutate(async () => unwrap(await api.POST('/api/v1/voice-lab/paid-authorisations/{authorisation_id}/revoke', { params: { path: { authorisation_id: a.id } }, body: { reason: 'Revoked from Budget and Settings' } })))}>Revoke</Button></> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="xsmall muted">None issued.</p>}
            {s.can_manage && !issued ? (
              <div className="row wrap" style={{ gap: 6, alignItems: 'flex-end' }} data-testid="lab-auth-form">
                <Field id="au-provider" label="Provider">{(p) => <select {...p} className="field" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} data-testid="lab-auth-provider">
                  <option value="AZURE_OPENAI_GPT_LIVE">Azure OpenAI (preferred)</option><option value="OPENAI_GPT_LIVE">OpenAI (direct)</option></select>}</Field>
                <Field id="au-voice" label="Voice">{(p) => <select {...p} className="field" value={f.voice} onChange={(e) => setF({ ...f, voice: e.target.value })}>{(chosen?.voices ?? []).map((v) => <option key={v}>{v}</option>)}</select>}</Field>
                <Field id="au-dur" label="Maximum duration (s, ≤ 120)">{(p) => <input {...p} className="field labelled" style={{ width: 110 }} value={f.max_duration_s} onChange={(e) => setF({ ...f, max_duration_s: e.target.value })} data-testid="lab-auth-duration" />}</Field>
                <Field id="au-exp" label="Expires in (h)">{(p) => <input {...p} className="field labelled" style={{ width: 90 }} value={f.expires_in_h} onChange={(e) => setF({ ...f, expires_in_h: e.target.value })} />}</Field>
                <Field id="au-why" label="Reason">{(p) => <input {...p} className="field labelled" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} data-testid="lab-auth-reason" />}</Field>
                <Button tiny variant="primary" disabled={f.reason.trim().length < 5 || act.isPending || !model} data-testid="lab-auth-issue"
                  onClick={() => act.mutate(async () => unwrap(await api.POST('/api/v1/voice-lab/paid-authorisations', { body: { provider: f.provider as 'AZURE_OPENAI_GPT_LIVE', model, voice: f.voice, max_duration_s: Number(f.max_duration_s), expires_in_h: Number(f.expires_in_h), reason: f.reason } })))}>
                  {maxUsd === null ? 'Issue (price unknown — will be refused)' : `Issue (up to ${usd(maxUsd)})`}</Button>
                {!model ? <span className="xsmall muted">{f.provider === 'AZURE_OPENAI_GPT_LIVE' ? 'No Azure deployment is configured on this server.' : ''}</span> : null}
              </div>
            ) : null}
            <p className="xsmall muted">Issuing is not execution: another user (with Voice Lab access) must start the one session, and every other gate is re-checked then.</p>
          </div>
          <ErrorBox error={act.error ? errorText(act.error) : null} />
        </div>
      </div>
    </Card>
  );
}

type Budget = LabSettings['budgets'][number];

function BudgetCard({ b, canManage }: { b: Budget; canManage: boolean }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ overall_usd: b.overall_usd, daily_usd: b.daily_usd, per_experiment_usd: b.per_experiment_usd, max_concurrent_sessions: b.max_concurrent_sessions, interactive_max_s: b.interactive_max_s, idle_timeout_s: b.idle_timeout_s, reason: '' });
  const act = useLabAction<unknown>();
  const u = b.usage;
  const title = b.spend_class === 'PAID' ? 'Paid providers budget (no paid provider is enabled)' : 'Synthetic metering budget (mock — no money)';
  return (
    <Card title={title} subtitle={b.basis} aside={canManage ? <Button tiny onClick={() => setEdit(!edit)} data-testid={`lab-budget-edit-${b.spend_class}`}>{edit ? 'Close' : 'Change limits'}</Button> : null}>
      <dl className="kv" data-testid={`lab-budget-${b.spend_class}`}>
        <dt>Overall</dt><dd>{usd(u?.overall)} used or reserved of {usd(b.overall_usd)}</dd>
        <dt>Today (Singapore)</dt><dd>{usd(u?.daily)} of {usd(b.daily_usd)}</dd>
        <dt>Per experiment / session</dt><dd>{usd(b.per_experiment_usd)}</dd>
        <dt>Held now</dt><dd>{usd(u?.held)} in {u?.active ?? 0} active reservation(s) · maximum concurrent {b.max_concurrent_sessions}</dd>
        <dt>Interactive maximum</dt><dd>{b.interactive_max_s} s · idle timeout {b.idle_timeout_s} s</dd>
      </dl>
      {edit ? (
        <div className="stack" style={{ gap: 8, marginTop: 10 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            {(['overall_usd', 'daily_usd', 'per_experiment_usd', 'max_concurrent_sessions', 'interactive_max_s', 'idle_timeout_s'] as const).map((k) => (
              <Field key={k} id={`b-${b.spend_class}-${k}`} label={humanize(k.toUpperCase())}>{(p) => (
                <input {...p} className="field labelled" style={{ width: 130 }} value={String(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.value })} data-testid={`lab-budget-${k}`} />)}</Field>
            ))}
          </div>
          <Field id={`b-${b.spend_class}-reason`} label="Reason (required)">{(p) => <input {...p} className="field labelled" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} data-testid="lab-budget-reason" />}</Field>
          <div><Button variant="primary" disabled={v.reason.trim().length < 5 || act.isPending} data-testid="lab-budget-save"
            onClick={() => act.mutate(async () => { const r = unwrap(await api.PUT('/api/v1/voice-lab/budgets/{spend_class}', { params: { path: { spend_class: b.spend_class as 'SIMULATED' | 'PAID' } }, body: {
              expected_row_version: b.row_version, overall_usd: String(v.overall_usd), daily_usd: String(v.daily_usd), per_experiment_usd: String(v.per_experiment_usd),
              max_concurrent_sessions: Number(v.max_concurrent_sessions), interactive_max_s: Number(v.interactive_max_s), idle_timeout_s: Number(v.idle_timeout_s), reason: v.reason,
            } })); setEdit(false); return r; })}>Save limits</Button></div>
          <ErrorBox error={act.error ? errorText(act.error) : null} />
        </div>
      ) : null}
    </Card>
  );
}
