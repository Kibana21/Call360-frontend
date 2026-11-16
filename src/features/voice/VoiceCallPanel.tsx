// S1-A call panel: Start / Mute / Stop, live speaking indicators and meters, connection and error states, and the
// session's fixed boundaries (mock provider, fixed synthetic test message, no recording, no transcript, identity not
// performed, compliance not evaluated). The event list describes what happened; it is not a transcript.
import { Link } from 'react-router-dom';
import { Badge, Button, Card } from '../../components/ui';
import { END_REASONS, useVoiceSession, type VoicePhase } from './useVoiceSession';
import { VoiceSessionTimeline } from './VoiceSessionTimeline';

const PHASE: Record<VoicePhase, [string, 'gray' | 'blue' | 'green' | 'amber' | 'red']> = {
  idle: ['Not started', 'gray'], 'requesting-mic': ['Requesting microphone…', 'blue'], connecting: ['Connecting…', 'blue'],
  live: ['Live', 'green'], reconnecting: ['Reconnecting…', 'amber'], ending: ['Ending…', 'amber'], ended: ['Ended', 'gray'],
  error: ['Stopped — see message', 'red'],
};

export function VoiceCallPanel({ caseId, caseRef, testMessage, resumeId, onResumeHandled }: {
  caseId: string; caseRef: string; testMessage: string[]; resumeId?: string | null; onResumeHandled?: () => void;
}) {
  const { state, start, stop, setMuted } = useVoiceSession();
  const active = ['requesting-mic', 'connecting', 'live', 'reconnecting', 'ending'].includes(state.phase);
  const [label, tone] = PHASE[state.phase];
  const s = state.session;
  return (
    <div className="layout cols-2" data-testid="voice-panel">
      <Card title={`Synthetic audio test · ${caseRef}`} subtitle="Local engineering POC with a mock voice provider. Use headphones for the cleanest interruption test."
        aside={<Badge tone={tone}>{label}</Badge>}>
        <div className="row wrap" style={{ gap: 8 }}>
          <Button variant="primary" icon="phone" onClick={() => void start(caseId)} disabled={active} data-testid="voice-start">Start</Button>
          {resumeId ? <Button icon="refresh" onClick={() => { onResumeHandled?.(); void start(caseId, resumeId); }} disabled={active} data-testid="voice-resume">Resume earlier session</Button> : null}
          <Button icon="mic" onClick={() => setMuted(!state.muted)} disabled={state.phase !== 'live'} aria-pressed={state.muted} data-testid="voice-mute">
            {state.muted ? 'Unmute' : 'Mute'}</Button>
          <Button variant="danger" icon="close" onClick={() => void stop()} disabled={!active || state.phase === 'ending'} data-testid="voice-stop">Stop</Button>
        </div>
        <div className="voice-indicators" aria-live="polite" data-testid="voice-indicators">
          <div className={`voice-indicator${state.agentSpeaking ? ' on' : ''}`} data-testid="agent-speaking">
            <span className="dot" aria-hidden="true" /> Mock voice {state.agentSpeaking ? 'speaking' : 'silent'}
          </div>
          <div className={`voice-indicator${state.userSpeaking ? ' on' : ''}`} data-testid="user-speaking">
            <span className="dot" aria-hidden="true" /> You {state.muted ? 'muted' : state.userSpeaking ? 'speaking' : 'silent'}
          </div>
        </div>
        <label className="form-label" htmlFor="mic-level">Microphone level</label>
        <meter id="mic-level" className="voice-meter" min={0} max={0.3} value={Math.min(state.micLevel, 0.3)} />
        <div className="row wrap small" style={{ marginTop: 12, gap: 16 }}>
          <span>Responses: <strong data-testid="voice-responses">{state.responses}</strong></span>
          <span>Interruptions: <strong data-testid="voice-interruptions">{state.interruptions}</strong></span>
        </div>
        {state.error ? <div className="form-error" role="alert" data-testid="voice-error">{state.error}</div> : null}
        {state.phase === 'ended' ? (
          <div className="topnotice" role="status" style={{ marginTop: 14 }} data-testid="voice-ended">
            <span>Session ended{state.finalState ? ` (${state.finalState === 'FINALIZED' ? 'completed' : 'ended abnormally'})` : ''}. {END_REASONS[state.endReason ?? ''] ?? ''} It is saved with its event timeline. Nothing was recorded and nothing was verified.</span></div>
        ) : null}
        <div className="section-label" style={{ marginTop: 16 }}>Session events</div>
        {state.log.length ? (
          <ul className="plain-list xsmall" data-testid="voice-log">{state.log.map((l) => <li key={l.at + l.text}>{new Date(l.at).toLocaleTimeString('en-SG')} · {l.text}</li>)}</ul>
        ) : <p className="xsmall muted" style={{ margin: 0 }}>No events yet.</p>}
      </Card>
      <div className="stack" style={{ gap: 18 }}>
      {s ? <VoiceSessionTimeline sessionId={s.session_id} live={active} title={`Persisted session · ${s.attempt_ref}`} /> : null}
      <Card title="Session boundaries" subtitle="Fixed for every session">
        <dl className="kv rw-kv">
          <dt>Provider</dt><dd>Mock (server-side, keyless)</dd>
          <dt>What it says</dt><dd>Only the fixed synthetic test message, repeated after you speak</dd>
          <dt>Identity verification</dt><dd><Badge tone="gray">Not performed</Badge></dd>
          <dt>Compliance outcome</dt><dd><Badge tone="gray">Not evaluated</Badge></dd>
          <dt>Recording</dt><dd>Disabled (consent-gated recording arrives in S1-C)</dd>
          <dt>Transcript</dt><dd>Not available (S1-D)</dd>
          {s ? <><dt>Pinned script</dt><dd>{s.script.family} v{s.script.version_label} (not used for questions in S1)</dd>
            <dt>Contact (masked)</dt><dd>{s.contact.masked_name} · {s.contact.role} · <span className="mono">{s.contact.masked_contact ?? '—'}</span></dd>
            <dt>Session limit</dt><dd>{Math.round(s.max_duration_s / 60)} minutes</dd></> : null}
          <dt>Case</dt><dd><Link className="link" to={`/cases/${caseId}`}>{caseRef}</Link></dd>
        </dl>
        <div className="section-label" style={{ marginTop: 14 }}>Fixed test message</div>
        <blockquote className="softbox small" style={{ margin: 0 }} data-testid="voice-message">{testMessage.join(' ')}</blockquote>
      </Card>
      </div>
    </div>
  );
}
