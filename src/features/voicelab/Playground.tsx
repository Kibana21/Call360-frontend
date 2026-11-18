// Voice Lab Playground (S1-E.1): configure a prompt (provider, model, voice, system prompt, per-turn instructions),
// save it as a new version (history kept), see the estimated session cost, then Start / Mute / Stop a full-duplex
// session through the same browser audio client as Voice Studio. Opening this page connects to nothing; the server
// refuses paid providers and anything the budget does not allow, and the reasons are shown.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, unwrap } from '../../api/client';
import { Badge, Button, Card } from '../../components/ui';
import { ErrorBox, Field } from '../scripts/ScriptEditor';
import { errorText } from '../simulator/ScenarioLibrary';
import { END_REASONS, useVoiceSession, type VoiceAdapter, type VoicePhase } from '../voice/useVoiceSession';
import { SessionCard, SpendBadge, usd, useLabAction, type LabPrompt, type LabSessionStart, type LabSettings } from './shared';

type Start = LabSessionStart & { session_id: string };
const PHASE: Record<VoicePhase, [string, 'gray' | 'blue' | 'green' | 'amber' | 'red']> = {
  idle: ['Not started', 'gray'], 'requesting-mic': ['Requesting microphone…', 'blue'], connecting: ['Connecting…', 'blue'],
  live: ['Live', 'green'], reconnecting: ['Reconnecting…', 'amber'], ending: ['Ending…', 'amber'], ended: ['Ended', 'gray'],
  error: ['Stopped — see message', 'red'],
};
const EMPTY = { name: '', system_prompt: '', turns: '', provider: 'MOCK', model: 'mock-fixed-message-1', voice: 'synthetic-fixed', note: '' };

export function Playground({ settings }: { settings: LabSettings }) {
  const prompts = useQuery({ queryKey: ['voicelab', 'prompts'], queryFn: async () => unwrap(await api.GET('/api/v1/voice-lab/prompts')) });
  const [promptId, setPromptId] = useState<string>('');
  const [versionId, setVersionId] = useState<string>('');
  const [form, setForm] = useState(EMPTY);
  const [record, setRecord] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);
  const [startError, setStartError] = useState<ReturnType<typeof errorText> | null>(null);
  const save = useLabAction<LabPrompt>();
  const list = useMemo(() => prompts.data?.items ?? [], [prompts.data]);
  const current = list.find((p) => p.id === promptId) ?? null;
  const version = current?.versions.find((v) => v.id === versionId) ?? current?.versions[0] ?? null;

  const [autoPicked, setAutoPicked] = useState(false); // pick the latest prompt once; "New prompt…" then stays chosen
  useEffect(() => { if (!autoPicked && list[0]) { setPromptId(list[0].id); setAutoPicked(true); } }, [list, autoPicked]);
  useEffect(() => {
    if (!current) return;
    const v = current.versions.find((x) => x.id === versionId) ?? current.versions[0]!;
    setForm({ name: current.name, system_prompt: v.system_prompt, turns: v.turn_instructions.join('\n'), provider: v.provider, model: v.model, voice: v.voice, note: '' });
  }, [current, versionId]);

  const provider = settings.providers.find((p) => p.code === form.provider);
  const paid = provider?.spend_class === 'PAID';
  const issued = settings.authorisations.find((a) => a.status === 'ISSUED');
  const maxS = useMemo(() => {
    const b = settings.budgets.find((x) => x.spend_class === (paid ? 'PAID' : 'SIMULATED'));
    const base = b?.interactive_max_s ?? 300;
    return paid ? Math.min(base, issued?.max_duration_s ?? 120) : base;
  }, [paid, issued, settings.budgets]);
  const est = useMemo(() => {
    const r = provider?.rate_card as { input_usd_per_audio_min?: string | null; output_usd_per_audio_min?: string | null; session_usd_per_min?: string } | undefined;
    if (!r || r.input_usd_per_audio_min == null || r.output_usd_per_audio_min == null) return null;
    return ((Number(r.input_usd_per_audio_min) + Number(r.output_usd_per_audio_min) + Number(r.session_usd_per_min ?? 0)) * maxS) / 60;
  }, [provider, maxS]);

  const adapter = useMemo<VoiceAdapter<Start>>(() => ({
    create: async () => {
      try {
        const s = unwrap(await api.POST('/api/v1/voice-lab/sessions', { body: { prompt_version_id: versionId || version!.id, record } }));
        setLastId(s.id);
        return { ...s, session_id: s.id };
      } catch (e) {
        setStartError(errorText(e)); // the server's refusal reasons (cost controls, kill switch, paid provider)
        throw e;
      }
    },
    stop: async (id) => { await api.POST('/api/v1/voice-lab/sessions/{session_id}/stop', { params: { path: { session_id: id } } }); },
  }), [record, versionId, version]);
  const { state, start, stop, setMuted, send } = useVoiceSession<Start>(adapter);
  const [instruction, setInstruction] = useState('');
  const active = ['requesting-mic', 'connecting', 'live', 'reconnecting', 'ending'].includes(state.phase);
  const [label, tone] = PHASE[state.phase];
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (state.phase !== 'live') return;
    const t0 = Date.now();
    const h = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(h);
  }, [state.phase]);

  const body = () => ({
    name: form.name, system_prompt: form.system_prompt, turn_instructions: form.turns.split('\n').map((t) => t.trim()).filter(Boolean),
    provider: form.provider, model: form.model, voice: form.voice, change_note: form.note || null,
  });
  const saveNew = () => save.mutate(async () => {
    const p = current
      ? unwrap(await api.POST('/api/v1/voice-lab/prompts/{prompt_id}/versions', { params: { path: { prompt_id: current.id } }, body: { ...body(), expected_version: current.versions[0]!.version_no } }))
      : unwrap(await api.POST('/api/v1/voice-lab/prompts', { body: body() }));
    setPromptId(p.id); setVersionId(p.versions[0]!.id);
    return p;
  });
  const startLab = async () => { setStartError(null); await start(''); };
  const models = provider?.models.length ? provider.models : null;
  const voices = provider?.voices.length ? provider.voices : null;
  const killed = settings.control.kill_switch;

  return (
    <div className="layout cols-2" data-testid="lab-playground">
      <Card title="Prompt configuration" subtitle="Each save creates a new version; earlier versions are kept and can be selected.">
        <div className="stack" style={{ gap: 10 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <Field id="lab-prompt" label="Prompt">{(p) => (
              <select {...p} className="field" value={promptId} onChange={(e) => { setAutoPicked(true); setPromptId(e.target.value); setVersionId(''); if (!e.target.value) setForm(EMPTY); }} data-testid="lab-prompt-select">
                <option value="">New prompt…</option>
                {list.map((x) => <option key={x.id} value={x.id}>{x.prompt_ref} · {x.name}</option>)}
              </select>)}</Field>
            {current ? <Field id="lab-version" label="Version">{(p) => (
              <select {...p} className="field" value={versionId || current.versions[0]!.id} onChange={(e) => setVersionId(e.target.value)} data-testid="lab-version-select">
                {current.versions.map((v) => <option key={v.id} value={v.id}>v{v.version_no} · {v.change_note}</option>)}
              </select>)}</Field> : null}
          </div>
          <Field id="lab-name" label="Name">{(p) => <input {...p} className="field labelled" value={form.name} disabled={!!current} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="lab-prompt-name" />}</Field>
          <div className="row wrap" style={{ gap: 8 }}>
            <Field id="lab-provider" label="Voice provider">{(p) => (
              <select {...p} className="field" value={form.provider} data-testid="lab-provider"
                onChange={(e) => { const pr = settings.providers.find((x) => x.code === e.target.value); setForm({ ...form, provider: e.target.value, model: pr?.models[0] ?? '', voice: pr?.voices[0] ?? '' }); }}>
                {[...settings.providers].filter((x) => !x.hidden || x.code === form.provider).sort((a, b) => Number(b.preferred) - Number(a.preferred))
                  .map((x) => <option key={x.code} value={x.code}>{x.label}{x.available ? '' : ' (not available)'}</option>)}
              </select>)}</Field>
            <Field id="lab-model" label={form.provider === 'AZURE_OPENAI_GPT_LIVE' ? 'Deployment' : 'Model'}>{(p) => models
              ? <select {...p} className="field" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} data-testid="lab-model">{models.map((m) => <option key={m}>{m}</option>)}</select>
              : <input {...p} className="field labelled" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} data-testid="lab-model" />}</Field>
            <Field id="lab-voice" label="Voice">{(p) => voices
              ? <select {...p} className="field" value={form.voice} onChange={(e) => setForm({ ...form, voice: e.target.value })} data-testid="lab-voice">{voices.map((m) => <option key={m}>{m}</option>)}</select>
              : <input {...p} className="field labelled" value={form.voice} onChange={(e) => setForm({ ...form, voice: e.target.value })} data-testid="lab-voice" />}</Field>
          </div>
          {provider ? <p className="xsmall muted" data-testid="lab-provider-note"><SpendBadge cls={provider.spend_class} /> {provider.reason}</p> : null}
          <Field id="lab-system" label="System prompt" hint={provider?.vendor != null ? 'Synthetic content only. Sent once in session.start (immutable for the session).' : 'Synthetic content only. The mock provider does not interpret prompts.'}>{(p) => (
            <textarea {...p} className="field textarea labelled" rows={4} value={form.system_prompt} onChange={(e) => setForm({ ...form, system_prompt: e.target.value })} data-testid="lab-system-prompt" />)}</Field>
          <Field id="lab-turns" label="Per-turn instructions" hint={provider?.vendor != null ? 'One per line; instruction n is appended (session.instructions.append) after the caller’s turn n.' : 'One per line; instruction n is attached to response n in the event trace.'}>{(p) => (
            <textarea {...p} className="field textarea labelled" rows={3} value={form.turns} onChange={(e) => setForm({ ...form, turns: e.target.value })} data-testid="lab-turns" />)}</Field>
          <Field id="lab-note" label="Change note">{(p) => <input {...p} className="field labelled" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} data-testid="lab-note" />}</Field>
          <ErrorBox error={save.error ? errorText(save.error) : null} />
          <div className="row" style={{ gap: 8 }}>
            <Button variant="primary" onClick={saveNew} disabled={save.isPending || !form.name || !form.system_prompt || active} data-testid="lab-save-prompt">
              {current ? 'Save as new version' : 'Create prompt'}</Button>
            {version ? <span className="xsmall muted" data-testid="lab-current-version">Selected: v{version.version_no} · <span className="mono">{version.sha256.slice(0, 10)}</span></span> : null}
          </div>
        </div>
      </Card>
      <div className="stack" style={{ gap: 16 }}>
        <Card title="Session" subtitle="Full-duplex browser audio with interruption. Use headphones." aside={<Badge tone={tone}>{label}</Badge>}>
          <div className="stack" style={{ gap: 10 }}>
            <p className="small" style={{ margin: 0 }} data-testid="lab-estimate">
              Estimated maximum cost of a session: <strong>{est === null ? 'cannot be estimated — refused' : usd(est)}</strong>
              {provider?.spend_class === 'NONE' ? ' (keyless mock, no charge)' : provider?.spend_class === 'SIMULATED' ? ' (synthetic metering — no money is spent)' : est === null ? ' (no verified price for this provider)' : ' (paid voice minutes at the configured rate)'}.
              Limits: {maxS} s maximum, idle timeout {settings.budgets[0]?.idle_timeout_s} s.
            </p>
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={record} disabled={active || !settings.recording_available} onChange={(e) => setRecord(e.target.checked)} data-testid="lab-record" />
              Record this lab session (server-side, encrypted locally; synthetic speech only)</label>
            {paid ? (
              <p className="small" data-testid="lab-paid-note" style={{ margin: 0 }}>
                <strong>Paid provider.</strong> A session needs the server&apos;s {provider?.vendor === 'AZURE' ? 'Azure OpenAI' : 'OpenAI'} configuration ({provider?.available ? 'configured' : 'not configured'}),
                the paid switch ({settings.control.paid_enabled ? 'on' : 'off'}) and a single-use smoke-test authorisation issued by another user
                ({issued ? `${issued.authorisation_ref}, ${issued.max_duration_s} s, up to USD ${Number(issued.max_usd).toFixed(4)}` : 'none issued'}). The server refuses otherwise.
              </p>
            ) : null}
            {killed ? <p className="field-error" role="alert" data-testid="lab-killed">The emergency stop is engaged: new sessions are refused.</p> : null}
            <div className="row wrap" style={{ gap: 8 }}>
              <Button variant="primary" icon="phone" onClick={() => void startLab()} disabled={active || !version} data-testid="lab-start">Start</Button>
              <Button icon="mic" onClick={() => setMuted(!state.muted)} disabled={state.phase !== 'live'} aria-pressed={state.muted} data-testid="lab-mute">{state.muted ? 'Unmute' : 'Mute'}</Button>
              <Button variant="danger" icon="close" onClick={() => void stop()} disabled={!active || state.phase === 'ending'} data-testid="lab-stop">Stop</Button>
            </div>
            {!version ? <p className="xsmall muted">Create or select a prompt version to start.</p> : null}
            <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end' }}>
              <Field id="lab-instruction" label="Dynamic instruction (live)" hint="Sent as an instruction append; it adds context and may interrupt speech — it is not proof of what is said.">{(p) => (
                <input {...p} className="field labelled" value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={1500} disabled={state.phase !== 'live'} data-testid="lab-instruction" />)}</Field>
              <Button onClick={() => { if (send({ type: 'lab.instruction', text: instruction })) setInstruction(''); }} disabled={state.phase !== 'live' || !instruction.trim()} data-testid="lab-instruction-send">Send</Button>
            </div>
            <div className="row wrap small" style={{ gap: 12 }} aria-live="polite" data-testid="lab-live">
              <span>Duration: {state.phase === 'live' ? `${elapsed} s` : '—'}</span>
              <span>Provider speaking: {state.agentSpeaking ? 'yes' : 'no'}</span>
              <span>You speaking: {state.userSpeaking ? 'yes' : 'no'}</span>
              <span>Interruptions: {state.interruptions}</span>
            </div>
            {startError ? <div data-testid="lab-refusal"><ErrorBox error={startError} /></div>
              : state.error ? <p className="field-error" role="alert" data-testid="lab-error">{state.error}</p> : null}
            {state.endReason ? <p className="small" data-testid="lab-ended">{END_REASONS[state.endReason] ?? state.endReason}</p> : null}
            <ul className="plain-list xsmall" style={{ flexDirection: 'column' }}>{state.log.map((l, i) => <li key={`${l.at}-${i}`}>{new Date(l.at).toLocaleTimeString()} · {l.text}</li>)}</ul>
            {provider?.code === 'MOCK' || provider?.code === 'MOCK_METERED' ? <p className="xsmall muted">Mock provider message: “{settings.mock_message.join(' ')}”</p> : null}
          </div>
        </Card>
        {lastId ? <SessionCard key={lastId} id={lastId} title={active ? 'Live session — event trace (updates every 1.5 s)' : 'Last session — recording, transcript and trace'} /> : null}
      </div>
    </div>
  );
}
