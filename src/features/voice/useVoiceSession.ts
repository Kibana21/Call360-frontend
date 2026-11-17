// Browser voice session (S1-A transport, S1-B persistence): microphone (echo-cancelled) → 16 kHz PCM16 frames over a
// same-origin WebSocket → server mock provider → frames back into a clearable playback queue. The server decides
// turns and barge-in and persists the session; the browser drops frames of any cleared response, so interrupted
// speech never resumes and nothing plays twice. Client events carry an ID and sequence so retries are stored once.
// If the connection drops without a stop, the hook resumes the same persisted session (up to 3 tries within the
// server's 30 s window); otherwise the server finalises it. Leaving the page stops the session. Every failure ends
// the session and releases the microphone. S1-C: with recording consent (decided before Start; default no recording)
// a SessionRecorder receives the microphone frames and the rendered provider playback, but only from the moment the
// server confirms an active recording on `session.ready` — microphone permission is never taken as consent.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiFailure, unwrap } from '../../api/client';
import type { components } from '../../api/generated/schema';
import { SessionRecorder, type CloseReason, type RecorderStatus } from './recorder';

export type VoiceSessionInfo = components['schemas']['VoiceSessionOut'];
export type VoicePhase = 'idle' | 'requesting-mic' | 'connecting' | 'live' | 'reconnecting' | 'ending' | 'ended' | 'error';
export interface VoiceLogItem { at: number; text: string }
export interface VoiceState {
  phase: VoicePhase;
  session: VoiceSessionInfo | null;
  agentSpeaking: boolean;
  userSpeaking: boolean;
  muted: boolean;
  micLevel: number;
  responses: number;
  interruptions: number;
  error: string | null;
  endReason: string | null;
  finalState: string | null;
  log: VoiceLogItem[];
  recording: RecorderStatus | null; // null: this session is not recorded (consent declined)
}

const INITIAL: VoiceState = {
  phase: 'idle', session: null, agentSpeaking: false, userSpeaking: false, muted: false, micLevel: 0,
  responses: 0, interruptions: 0, error: null, endReason: null, finalState: null, log: [], recording: null,
};
const MAX_RESUME_TRIES = 3;

export function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access was blocked. Allow the microphone for this site in the browser address bar, then start again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Connect one and start again.';
  if (name === 'NotReadableError') return 'The microphone is in use by another application or could not be opened.';
  return 'The microphone could not be started.';
}

export const END_REASONS: Record<string, string> = {
  STOPPED_BY_USER: 'You stopped the session.',
  DISCONNECTED: 'The connection closed.',
  IDLE_TIMEOUT: 'No microphone audio reached the server for 20 seconds.',
  MAX_DURATION: 'The 5-minute test limit was reached.',
  MIC_DEVICE_LOST: 'The microphone was disconnected.',
};

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function useVoiceSession() {
  const [state, setState] = useState<VoiceState>(INITIAL);
  const refs = useRef<{
    ws: WebSocket | null; ctx: AudioContext | null; stream: MediaStream | null; player: AudioWorkletNode | null;
    session: VoiceSessionInfo | null; response: number; cleared: Set<number>; muted: boolean; closing: boolean;
    ended: boolean; resumeTries: number; seq: number; reconnect: (() => Promise<void>) | null; pageHiding: boolean;
    recorder: SessionRecorder | null;
  }>({ ws: null, ctx: null, stream: null, player: null, session: null, response: 0, cleared: new Set(), muted: false,
    closing: false, ended: false, resumeTries: 0, seq: 0, reconnect: null, pageHiding: false, recorder: null });

  const note = useCallback((text: string) => setState((s) => ({ ...s, log: [{ at: Date.now(), text }, ...s.log].slice(0, 12) })), []);

  const clientEvent = useCallback((event: Record<string, unknown>): boolean => {
    const r = refs.current;
    if (!r.ws || r.ws.readyState !== WebSocket.OPEN) return false;
    r.seq += 1;
    r.ws.send(JSON.stringify({ ...event, event_id: newId(), seq: r.seq, at: new Date().toISOString() }));
    return true;
  }, []);

  const release = useCallback(() => {
    const r = refs.current;
    const ws = r.ws;
    r.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000);
    r.stream?.getTracks().forEach((t) => t.stop());
    void r.ctx?.close().catch(() => undefined);
    r.ctx = null; r.stream = null; r.player = null;
  }, []);

  const restStop = useCallback(async () => {
    const id = refs.current.session?.session_id;
    if (!id) return;
    try { await api.POST('/api/v1/voice/sessions/{session_id}/stop', { params: { path: { session_id: id } } }); } catch { /* the server sweeper finalises it */ }
  }, []);

  const endRecording = useCallback((reason: CloseReason) => refs.current.recorder?.endSegment(reason) ?? Promise.resolve(), []);

  const fail = useCallback((message: string, reason?: string) => {
    const r = refs.current;
    r.closing = true;
    void endRecording(reason === 'MIC_DEVICE_LOST' ? 'MIC_DEVICE_LOST' : 'CAPTURE_ERROR');
    if (!clientEvent({ type: 'session.stop', reason: reason ?? 'STOPPED_BY_USER' })) void restStop();
    setTimeout(release, 300); // let the stop reach the server before closing
    setState((s) => ({ ...s, phase: 'error', error: message, agentSpeaking: false, userSpeaking: false, micLevel: 0 }));
  }, [clientEvent, endRecording, release, restStop]);

  const openSocket = useCallback((session: VoiceSessionInfo) => {
    const r = refs.current;
    r.session = session; r.response = 0; r.cleared = new Set(); r.ended = false;
    setState((s) => ({ ...s, session }));
    const ws = new WebSocket(`${window.location.origin.replace(/^http/, 'ws')}${session.stream_path}`);
    ws.binaryType = 'arraybuffer';
    r.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'session.auth', credential: session.credential }));
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') {
        const buf = ev.data as ArrayBuffer;
        const response = new DataView(buf).getUint32(0, true);
        if (response !== r.response || r.cleared.has(response)) return; // stale or interrupted: never played
        r.player?.port.postMessage({ type: 'push', pcm: buf.slice(4) });
        return;
      }
      const m = JSON.parse(ev.data) as { type: string; response?: number; reason?: string; code?: string; completed?: boolean; resumed?: boolean; state?: string;
        recording?: { state: string; segment?: number; chunk_max_samples?: number; reason?: string } };
      if (m.type === 'session.ready') {
        r.resumeTries = 0;
        if (r.recorder && m.recording?.state === 'RECORDING' && m.recording.segment) {
          r.recorder.startSegment(m.recording.segment, m.recording.chunk_max_samples ?? 32000);
          note(`Recording started (segment ${m.recording.segment}) — microphone and played test audio`);
        } else if (r.recorder) note('Recording could not start on the server; this session is not recorded');
        void r.ctx?.resume();
        setState((s) => ({ ...s, phase: 'live', error: null }));
        note(m.resumed ? 'Reconnected — the same session resumed' : 'Connected to the mock voice provider');
        if (r.muted) clientEvent({ type: 'input.mute', muted: true });
      } else if (m.type === 'response.started') {
        r.response = m.response ?? 0;
        setState((s) => ({ ...s, responses: s.responses + 1 }));
        note(`Mock voice speaking (response ${m.response})`);
      } else if (m.type === 'playback.clear') {
        r.cleared.add(m.response ?? -1);
        r.player?.port.postMessage({ type: 'clear' });
        setState((s) => ({ ...s, interruptions: s.interruptions + 1, agentSpeaking: false }));
        note('You interrupted — mock speech stopped and queued audio cleared');
      } else if (m.type === 'response.done' && m.completed) note('Mock voice finished the test message');
      else if (m.type === 'input.speech_started') { setState((s) => ({ ...s, userSpeaking: true })); note('Your speech detected'); }
      else if (m.type === 'input.speech_stopped') setState((s) => ({ ...s, userSpeaking: false }));
      else if (m.type === 'session.ended') { r.ended = true; setState((s) => ({ ...s, endReason: m.reason ?? null, finalState: m.state ?? null })); }
      else if (m.type === 'error') fail(m.code === 'SESSION_CREDENTIAL_INVALID' ? 'The session credential was refused. Start a new session.' : 'The voice session could not continue.');
    };
    ws.onclose = (ev) => {
      if (r.ws !== ws) return; // an older socket
      r.ws = null;
      if (r.recorder?.active) void r.recorder.endSegment(r.closing || r.ended ? 'STOPPED' : 'CONNECTION_LOST');
      r.player?.port.postMessage({ type: 'clear' });
      if (r.closing || r.ended) {
        release();
        setState((s) => (s.phase === 'error' ? s : { ...s, phase: 'ended', agentSpeaking: false, userSpeaking: false, micLevel: 0 }));
        return;
      }
      if (ev.code === 4401 || ev.code === 4403 || ev.code === 4409) {
        release();
        setState((s) => ({ ...s, phase: 'error', error: 'The voice service refused the connection (not signed in, wrong origin, not permitted or no longer resumable).', agentSpeaking: false, userSpeaking: false, micLevel: 0 }));
        return;
      }
      void r.reconnect?.();
    };
  }, [clientEvent, fail, note, release]);

  refs.current.reconnect = async () => {
    const r = refs.current;
    const id = r.session?.session_id;
    setState((s) => ({ ...s, phase: 'reconnecting', agentSpeaking: false, userSpeaking: false }));
    note('Connection lost — trying to resume the same session');
    while (id && r.resumeTries < MAX_RESUME_TRIES && !r.closing) {
      r.resumeTries += 1;
      await new Promise((ok) => setTimeout(ok, 1500 * r.resumeTries));
      if (r.closing) return;
      try {
        openSocket(unwrap(await api.POST('/api/v1/voice/sessions/{session_id}/resume', { params: { path: { session_id: id } } })));
        return;
      } catch (e) {
        if (e instanceof ApiFailure && e.status > 0 && e.status < 500) break; // no longer resumable
      }
    }
    if (r.closing) return;
    release();
    setState((s) => ({ ...s, phase: 'error', error: 'The connection was lost and the session could not be resumed. The server finalises it.', micLevel: 0 }));
  };

  const start = useCallback(async (caseId: string, resumeId?: string, recordingConsent?: { notice_version: string } | null) => {
    const r = refs.current;
    r.closing = false; r.muted = false; r.resumeTries = 0; r.seq = 0; r.recorder = null;
    setState({ ...INITIAL, phase: 'requesting-mic' });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      setState({ ...INITIAL, phase: 'error', error: micErrorMessage(e) });
      return;
    }
    r.stream = stream;
    setState((s) => ({ ...s, phase: 'connecting' }));
    let session: VoiceSessionInfo;
    try {
      session = resumeId
        ? unwrap(await api.POST('/api/v1/voice/sessions/{session_id}/resume', { params: { path: { session_id: resumeId } } }))
        : unwrap(await api.POST('/api/v1/voice/sessions', { body: recordingConsent
          ? { case_id: caseId, recording_consent: 'GRANTED', consent_notice_version: recordingConsent.notice_version }
          : { case_id: caseId, recording_consent: 'DECLINED' } }));
    } catch (e) {
      release();
      setState({ ...INITIAL, phase: 'error', error: e instanceof ApiFailure ? `${e.message}${e.code ? ` (${e.code})` : ''}` : 'The session could not be created.' });
      return;
    }
    if (session.recording_consent === 'GRANTED') {
      r.recorder = new SessionRecorder(session.session_id, (status) => setState((s) => ({ ...s, recording: status })));
      setState((s) => ({ ...s, recording: { active: false, segment: 0, uploaded: 0, pending: 0, failed: 0, closedSegments: 0 } }));
    }
    try {
      const ctx = new AudioContext({ sampleRate: session.sample_rate, latencyHint: 'interactive' });
      r.ctx = ctx;
      await ctx.audioWorklet.addModule('/audio/capture-worklet.js');
      await ctx.audioWorklet.addModule('/audio/player-worklet.js');
      const player = new AudioWorkletNode(ctx, 'call360-player', { outputChannelCount: [1] });
      player.connect(ctx.destination);
      player.port.onmessage = (e) => setState((s) => ({ ...s, agentSpeaking: !!e.data.playing }));
      r.player = player;
      if (r.recorder) { // the provider audio as rendered by the browser (after barge-in clearing), for the recording
        const tap = new AudioWorkletNode(ctx, 'call360-capture');
        player.connect(tap);
        tap.port.onmessage = (e) => { if (r.ws?.readyState === WebSocket.OPEN) r.recorder?.push('PROVIDER_PLAYBACK', e.data.pcm); };
      }
      const capture = new AudioWorkletNode(ctx, 'call360-capture');
      ctx.createMediaStreamSource(stream).connect(capture);
      capture.port.onmessage = (e) => {
        // While muted the track is disabled and yields silence; frames keep flowing so the session stays alive.
        if (r.ws && r.ws.readyState === WebSocket.OPEN) {
          r.recorder?.push('MIC', e.data.pcm); // copied into the recorder before the buffer is sent
          r.ws.send(e.data.pcm);
        }
        setState((s) => (Math.abs(s.micLevel - e.data.rms) > 0.01 ? { ...s, micLevel: r.muted ? 0 : e.data.rms } : s));
      };
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        // Closing or reloading the tab also ends the track: that is not a device loss (the session stays resumable).
        if (r.pageHiding) return;
        fail('The microphone was disconnected. The session was ended safely.', 'MIC_DEVICE_LOST');
      });
      openSocket(session);
    } catch {
      fail('Audio could not be started in this browser.');
    }
  }, [fail, openSocket, release]);

  const stop = useCallback(async () => {
    const r = refs.current;
    r.closing = true;
    setState((s) => ({ ...s, phase: 'ending' }));
    if (r.recorder?.active) await r.recorder.endSegment('STOPPED'); // last chunks and the manifest before the stop
    if (clientEvent({ type: 'session.stop', reason: 'STOPPED_BY_USER' })) return; // the server finalises and closes
    await restStop(); // no live connection (e.g. while reconnecting): finalise through the API; repeated Stop is safe
    release();
    setState((s) => ({ ...s, phase: 'ended', endReason: 'STOPPED_BY_USER' }));
  }, [clientEvent, release, restStop]);

  const setMuted = useCallback((muted: boolean) => {
    const r = refs.current;
    r.muted = muted;
    r.stream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    clientEvent({ type: 'input.mute', muted });
    setState((s) => ({ ...s, muted, micLevel: muted ? 0 : s.micLevel }));
  }, [clientEvent]);

  useEffect(() => {
    const hide = () => { refs.current.pageHiding = true; };
    window.addEventListener('pagehide', hide);
    window.addEventListener('beforeunload', hide);
    return () => { window.removeEventListener('pagehide', hide); window.removeEventListener('beforeunload', hide); };
  }, []);

  useEffect(() => () => { // navigating away inside the portal ends the session (a refresh or closed tab is resumable)
    const r = refs.current;
    const ws = r.ws;
    r.closing = true;
    if (!ws) { release(); return; } // nothing live (also React's development double-mount): release at once
    if (r.recorder?.active && !r.pageHiding) void r.recorder.endSegment('PAGE_CLOSED');
    if (ws.readyState === WebSocket.OPEN) clientEvent({ type: 'session.stop', reason: 'PAGE_CLOSED' });
    r.ws = null;
    setTimeout(() => ws.close(1000), 200); // only this socket, after the stop has been sent
    r.stream?.getTracks().forEach((t) => t.stop());
    void r.ctx?.close().catch(() => undefined);
    r.ctx = null; r.stream = null; r.player = null;
  }, [clientEvent, release]);

  return { state, start, stop, setMuted };
}
