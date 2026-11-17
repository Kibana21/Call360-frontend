// S1-D Call Detail playback and transcript (VOICE-009, EVD-004, D-53).
// - One synchronised two-track player: both tracks are laid on the server's recording timeline and played from one
//   AudioContext clock, with independent Microphone / Mock voice mute controls. Gaps are drawn on the seek bar and
//   announced while the playhead is inside one; they play as silence and are never filled.
// - Audio is fetched only when the user asks to load it (each retrieval is audited as PLAYBACK by the server), kept in
//   memory for this view and never cached.
// - The transcript is the engine's recognised text only, grouped into speaker turns, with uncertain words, low
//   confidence, unrecognised speech and recording gaps marked. Selecting a segment seeks the player. The mock
//   provider's scheduled message is never shown as what was said.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '../../api/client';
import { apiFetch } from '../../api/session';
import type { components } from '../../api/generated/schema';
import { Badge, Button, type Tone } from '../../components/ui';
import { Icon } from '../../components/Icon';
import {
  GAP_LABEL, SPEAKER_LABEL, TRACK_LABEL, activeSegments, clock, gapMarks, inGap, layTrack, parseWav, samplesToMs,
  segmentKey, transcriptItems, type GapMark, type Segment, type Timeline, type TrackName,
} from './playback';

type Overview = components['schemas']['SessionTranscript'];
const TRACKS: TrackName[] = ['MIC', 'PROVIDER_PLAYBACK'];
const POLL_STATES = new Set(['PENDING', 'PROCESSING']);

export const TRANSCRIPT_STATUS: Record<string, [string, Tone]> = {
  PENDING: ['Transcript pending', 'blue'],
  PROCESSING: ['Transcribing', 'blue'],
  COMPLETE: ['Transcript complete', 'green'],
  PARTIAL: ['Transcript partial', 'amber'],
  FAILED: ['Transcription failed', 'red'],
  UNAVAILABLE: ['No transcript', 'gray'],
};

interface Player {
  timeline?: Timeline;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  playing: boolean;
  positionMs: number;
  totalMs: number;
  muted: Record<TrackName, boolean>;
  canPlay: boolean;
  load: () => Promise<boolean>;
  play: () => void;
  pause: () => void;
  seek: (ms: number, autoplay?: boolean) => Promise<void>;
  toggleMute: (t: TrackName) => void;
}

const PlayerContext = createContext<Player | null>(null);
const usePlayer = () => useContext(PlayerContext);

/** Owns the timeline, decoded audio and the Web Audio transport shared by the player and the transcript. */
export function PlaybackProvider({ sessionId, canPlay, enabled, children }: {
  sessionId: string; canPlay: boolean; enabled: boolean; children: ReactNode;
}) {
  const timeline = useQuery({
    queryKey: ['media-timeline', sessionId],
    enabled: enabled && !!sessionId,
    queryFn: async () => unwrap(await api.GET('/api/v1/sessions/{session_id}/media/timeline', { params: { path: { session_id: sessionId } } })),
  });
  const tl = timeline.data;
  const ctxRef = useRef<AudioContext | null>(null);
  const buffers = useRef<Partial<Record<TrackName, AudioBuffer>>>({});
  const gains = useRef<Partial<Record<TrackName, GainNode>>>({});
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const clockRef = useRef<{ at: number; offset: number } | null>(null);
  const frame = useRef<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [muted, setMuted] = useState<Record<TrackName, boolean>>({ MIC: false, PROVIDER_PLAYBACK: false });
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const totalMs = tl ? samplesToMs(tl.total_samples, tl.sample_rate) : 0;

  const stopSources = () => {
    for (const s of sources.current) { s.onended = null; try { s.stop(); } catch { /* already stopped */ } }
    sources.current = [];
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };

  useEffect(() => () => { // another session selected (or leaving the page): drop its audio and transport
    stopSources();
    void ctxRef.current?.close();
    ctxRef.current = null;
    buffers.current = {};
    gains.current = {};
    clockRef.current = null;
    setLoaded(false); setPlaying(false); setPositionMs(0); setError(null);
  }, [sessionId]);

  const load = useCallback(async (): Promise<boolean> => {
    if (loaded) return true;
    if (!tl || !canPlay) return false;
    setLoading(true); setError(null);
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = ctxRef.current ?? new Ctor();
      ctxRef.current = ctx;
      for (const track of TRACKS) {
        const t = tl.tracks[track];
        if (!t || t.media_status !== 'AVAILABLE') continue;
        const url = `${window.location.origin}/api/v1/sessions/${sessionId}/media/${track}/audio?purpose=PLAYBACK`;
        const res = await apiFetch(new Request(url, { credentials: 'same-origin' }));
        if (!res.ok) throw new Error(res.status === 409 ? 'Stored audio failed its integrity check' : `Audio could not be retrieved (${res.status})`);
        const { rate, pcm } = parseWav(await res.arrayBuffer());
        if (rate !== tl.sample_rate) throw new Error('Unexpected audio sample rate');
        const data = layTrack(pcm, t.spans, tl.total_samples);
        const buf = ctx.createBuffer(1, data.length, tl.sample_rate);
        buf.copyToChannel(data, 0);
        buffers.current[track] = buf;
        const g = ctx.createGain();
        g.gain.value = mutedRef.current[track] ? 0 : 1;
        g.connect(ctx.destination);
        gains.current[track] = g;
      }
      setLoaded(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Audio could not be loaded');
      return false;
    } finally {
      setLoading(false);
    }
  }, [loaded, tl, canPlay, sessionId]);

  const tick = useCallback(() => {
    const ctx = ctxRef.current, c = clockRef.current;
    if (!ctx || !c) return;
    const ms = c.offset + (ctx.currentTime - c.at) * 1000;
    setPositionMs(Math.min(ms, totalMs));
    if (ms >= totalMs) { stopSources(); setPlaying(false); clockRef.current = null; return; }
    frame.current = requestAnimationFrame(tick);
  }, [totalMs]);

  const startAt = useCallback((ms: number) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    stopSources();
    void ctx.resume();
    const offset = Math.max(0, Math.min(ms, totalMs)) / 1000;
    const at = ctx.currentTime + 0.05;
    for (const track of TRACKS) {
      const buf = buffers.current[track], g = gains.current[track];
      if (!buf || !g) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      src.start(at, offset); // both tracks start on the same clock instant: they stay in sync
      sources.current.push(src);
    }
    clockRef.current = { at, offset: offset * 1000 };
    setPlaying(true);
    frame.current = requestAnimationFrame(tick);
  }, [tick, totalMs]);

  const play = useCallback(() => { if (loaded) startAt(positionMs >= totalMs ? 0 : positionMs); }, [loaded, positionMs, startAt, totalMs]);
  const pause = useCallback(() => {
    stopSources();
    clockRef.current = null;
    setPlaying(false);
  }, []);
  const seek = useCallback(async (ms: number, autoplay = false) => {
    const target = Math.max(0, Math.min(ms, totalMs));
    setPositionMs(target);
    if (autoplay || playing) {
      if (await load()) startAt(target);
    }
  }, [load, playing, startAt, totalMs]);
  const toggleMute = useCallback((t: TrackName) => setMuted((m) => {
    const next = { ...m, [t]: !m[t] };
    const g = gains.current[t];
    if (g) g.gain.value = next[t] ? 0 : 1;
    return next;
  }), []);

  const value = useMemo<Player>(() => ({
    timeline: tl, loaded, loading, error, playing, positionMs, totalMs, muted, canPlay, load, play, pause, seek, toggleMute,
  }), [tl, loaded, loading, error, playing, positionMs, totalMs, muted, canPlay, load, play, pause, seek, toggleMute]);
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

/** The synchronised two-track player (D-53). */
export function RecordingPlayer() {
  const p = usePlayer();
  if (!p) return null;
  const tl = p.timeline;
  if (!tl) return <p className="xsmall muted" role="status">Loading the recording timeline…</p>;
  if (!p.canPlay) return <p className="xsmall muted" data-testid="player-restricted">Playback needs the recording.read permission.</p>;
  const marks = gapMarks(tl);
  const total = Math.max(p.totalMs, 1);
  const here = TRACKS.map((t) => [t, inGap(marks, t, p.positionMs)] as const).filter(([, g]) => g);
  return (
    <div className="audio-control stack player" style={{ gap: 10 }} data-testid="recording-player" aria-label="Recording playback">
      <div className="row wrap between" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 6 }}>
          {!p.loaded ? (
            <Button tiny icon="headphones" onClick={() => void p.load()} disabled={p.loading} data-testid="player-load">
              {p.loading ? 'Loading audio…' : 'Load audio for playback'}
            </Button>
          ) : (
            <>
              <Button tiny icon={p.playing ? 'pause' : 'play'} onClick={p.playing ? p.pause : p.play} data-testid="player-toggle"
                aria-label={p.playing ? 'Pause' : 'Play'}>{p.playing ? 'Pause' : 'Play'}</Button>
              <Button tiny onClick={() => void p.seek(p.positionMs - 5000)} aria-label="Back 5 seconds">−5 s</Button>
              <Button tiny onClick={() => void p.seek(p.positionMs + 5000)} aria-label="Forward 5 seconds">+5 s</Button>
            </>
          )}
        </div>
        <span className="mono small" data-testid="player-time" aria-live="off">{clock(p.positionMs)} / {clock(p.totalMs)}</span>
      </div>
      {p.error ? <p className="small" role="alert" style={{ color: '#bb3548', margin: 0 }}>{p.error}. Nothing is played.</p> : null}
      <div className="player-seek">
        <input type="range" className="seekbar" min={0} max={total} step={100} value={Math.min(p.positionMs, total)}
          aria-label="Playback position" aria-valuetext={`${clock(p.positionMs)} of ${clock(p.totalMs)}`}
          disabled={!p.loaded} data-testid="player-seek"
          onChange={(e) => void p.seek(Number(e.target.value))} />
        {TRACKS.filter((t) => tl.tracks[t]).map((t) => (
          <div className="gap-lane" key={t} aria-hidden="true" data-testid={`gap-lane-${t}`}>
            <span className="gap-lane-label">{TRACK_LABEL[t]}</span>
            {marks.filter((m) => m.track === t).map((m, i) => (
              <span key={i} className={m.endMs > m.startMs ? 'gap-span' : 'gap-point'} title={gapTitle(m)}
                style={{ left: `${(100 * m.startMs) / total}%`, width: m.endMs > m.startMs ? `${Math.max(0.6, (100 * (m.endMs - m.startMs)) / total)}%` : undefined }} />
            ))}
          </div>
        ))}
      </div>
      <div className="row wrap" style={{ gap: 6 }} role="group" aria-label="Track audio">
        {TRACKS.filter((t) => tl.tracks[t]).map((t) => (
          <button type="button" key={t} className={`btn tiny${p.muted[t] ? '' : ' subtle'}`} aria-pressed={!p.muted[t]}
            onClick={() => p.toggleMute(t)} data-testid={`mute-${t}`}>
            <Icon name={t === 'MIC' ? 'mic' : 'headphones'} size="sm" />{TRACK_LABEL[t]}: {p.muted[t] ? 'muted' : 'on'}
          </button>
        ))}
      </div>
      <div role="status" aria-live="polite" className="xsmall" data-testid="player-gap-notice">
        {here.length ? here.map(([t, g]) => `${TRACK_LABEL[t]} audio missing here (${GAP_LABEL[g!.gap.type] ?? g!.gap.type}) — silence is played, nothing is filled in.`).join(' ') : ''}
      </div>
      <p className="xsmall muted" style={{ margin: 0 }}>
        Both tracks play in sync on the recording timeline. Hatched areas are recording gaps. Loading audio is recorded in the access audit.
      </p>
    </div>
  );
}

function gapTitle(m: GapMark): string {
  const what = GAP_LABEL[m.gap.type] ?? m.gap.type;
  const where = m.endMs > m.startMs ? `${clock(m.startMs)}–${clock(m.endMs)}${m.gap.estimated ? ' (length estimated)' : ''}` : clock(m.startMs);
  return `${TRACK_LABEL[m.track]}: ${what}${m.gap.seqs.length ? ` (chunk ${m.gap.seqs.join(', ')})` : ''} at ${where}`;
}

/** Transcript status, provenance and the speaker-grouped segments. */
export function TranscriptPanel({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const p = usePlayer();
  const overview = useQuery({
    queryKey: ['transcript', sessionId],
    queryFn: async () => unwrap(await api.GET('/api/v1/sessions/{session_id}/transcript', { params: { path: { session_id: sessionId } } })),
    refetchInterval: (q) => (q.state.data && POLL_STATES.has(q.state.data.status) ? 2000 : false),
  });
  const o = overview.data;
  const segments = useQuery({
    queryKey: ['transcript-segments', sessionId, o?.tracks.map((t) => t.run?.run_ref + ':' + t.run?.status).join('|')],
    enabled: !!o?.can_read_text,
    queryFn: async () => unwrap(await api.GET('/api/v1/sessions/{session_id}/transcript/segments', { params: { path: { session_id: sessionId } } })),
  });
  const retry = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/sessions/{session_id}/transcript/retry', { params: { path: { session_id: sessionId } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['transcript', sessionId] }),
  });
  if (overview.isLoading) return <p className="xsmall muted" role="status">Loading transcript status…</p>;
  if (overview.isError || !o) return <p className="small" role="alert">The transcript status could not be loaded.</p>;
  const [label, tone] = TRANSCRIPT_STATUS[o.status] ?? [o.status, 'gray' as Tone];
  const segs = segments.data?.segments ?? [];
  const tl = segments.data?.timeline ?? p?.timeline;
  const marks = tl ? gapMarks(tl).filter((m) => m.endMs > m.startMs || m.gap.type === 'SESSION_INTERRUPTED') : [];
  const items = transcriptItems(segs, marks);
  const active = p?.playing ? activeSegments(segs, p.positionMs) : new Set<string>();
  return (
    <div className="stack" style={{ gap: 10 }} data-testid="cd-transcript">
      <div className="row wrap" style={{ gap: 8 }} role="status" aria-live="polite">
        <span data-testid="transcript-status"><Badge tone={tone}>{label}</Badge></span>
        {POLL_STATES.has(o.status) ? <span className="spinner" aria-hidden="true" /> : null}
        <span className="small">{o.message}</span>
      </div>
      {o.status === 'COMPLETE' || o.status === 'PARTIAL' ? (
        <p className="explain" style={{ margin: 0 }} data-testid="transcript-notice">
          Machine transcript from a local speech-recognition model — not reviewed or certified. Uncertain words and low-confidence
          markers are development indicators, not calibrated confidence scores. Recording gaps are never transcribed.
        </p>
      ) : null}
      {o.status === 'FAILED' || o.tracks.some((t) => t.run?.status === 'FAILED') ? (
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="small" role="alert">{o.tracks.filter((t) => t.run?.status === 'FAILED').map((t) => `${TRACK_LABEL[t.track]}: ${t.run!.error_code}`).join(' · ')}</span>
          {o.can_retry ? <Button tiny icon="refresh" onClick={() => retry.mutate()} disabled={retry.isPending} data-testid="transcript-retry">
            {retry.isPending ? 'Queuing…' : 'Retry transcription'}</Button> : null}
          {retry.isError ? <span className="small" role="alert">Retry could not be queued.</span> : null}
        </div>
      ) : null}
      {o.availability === 'RESTRICTED' ? <p className="small muted" data-testid="transcript-restricted">Your role can see the transcript status and provenance but not its text.</p> : null}
      {segments.isError ? <p className="small" role="alert">The transcript text could not be loaded.</p> : null}
      {segments.data?.problems.length ? (
        <p className="small" role="alert" data-testid="transcript-problems">
          {segments.data.problems.map((x) => `${TRACK_LABEL[x.track as TrackName] ?? x.track}: ${x.code.replace(/_/g, ' ').toLowerCase()}`).join(' · ')} — affected text is not shown.
        </p>
      ) : null}
      {o.can_read_text && segments.isSuccess ? (
        items.length ? (
          <ol className="transcript-list" aria-label="Transcript by speaker" data-testid="transcript-list">
            {items.map((it, i) => it.kind === 'gap' ? (
              <li key={`g${i}`} className="transcript-gap" data-testid="transcript-gap">
                <Icon name="alert" size="sm" />
                <span>{it.mark.gap.type === 'SESSION_INTERRUPTED' ? `Connection interrupted at ${clock(it.mark.startMs)} — a new recording segment starts here.`
                  : `${TRACK_LABEL[it.mark.track]} audio missing ${clock(it.mark.startMs)}–${clock(it.mark.endMs)}${it.mark.gap.estimated ? ' (length estimated)' : ''} (${GAP_LABEL[it.mark.gap.type] ?? it.mark.gap.type}${it.mark.gap.seqs.length ? `, chunk ${it.mark.gap.seqs.join(', ')}` : ''}) — not transcribed.`}</span>
              </li>
            ) : (
              <li key={`t${i}`} className="transcript-turn" data-testid={`turn-${it.track}`}>
                <div className={`speaker ${it.track === 'MIC' ? 'customer' : 'ai'}`} aria-hidden="true">{it.track === 'MIC' ? 'C' : 'M'}</div>
                <div className="stack" style={{ gap: 4, minWidth: 0, flex: 1 }}>
                  <strong className="small">{SPEAKER_LABEL[it.speaker] ?? it.speaker} <span className="muted mono xsmall">{clock(it.startMs)}</span></strong>
                  {it.segments.map((s) => <SegmentLine key={segmentKey(s)} s={s} active={active.has(segmentKey(s))} />)}
                </div>
              </li>
            ))}
          </ol>
        ) : <p className="small muted" data-testid="transcript-empty">No speech was recognised in the recorded audio. Nothing is shown in its place.</p>
      ) : null}
      {o.tracks.some((t) => t.run) ? <Provenance o={o} /> : null}
    </div>
  );
}

function SegmentLine({ s, active }: { s: Segment; active: boolean }) {
  const p = usePlayer();
  const seekable = !!p?.canPlay;
  const body = s.kind === 'UNRECOGNIZED' ? (
    <em className="muted">Speech-like audio not recognised — no text is shown.</em>
  ) : !s.text_available ? (
    <em className="muted">Text unavailable (failed its integrity check).</em>
  ) : (
    <span className="seg-text">
      {s.words.length ? s.words.map((w, i) => w.uncertain ? (
        <mark key={i} className="uncertain-word" title={`Uncertain word (engine probability ${w.probability.toFixed(2)})`}>
          {w.text}<span className="sr-only"> (uncertain)</span>
        </mark>
      ) : <span key={i}>{w.text}</span>).reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, ' ', el] : [el]), []) : s.text}
    </span>
  );
  const badges = (
    <>
      {s.confidence === 'LOW' && s.kind === 'SPEECH' ? <Badge tone="amber">Low confidence</Badge> : null}
      {s.kind === 'UNRECOGNIZED' ? <Badge tone="gray">Not recognised</Badge> : null}
      {s.uncertain_words ? <Badge tone="amber">{s.uncertain_words} uncertain word{s.uncertain_words === 1 ? '' : 's'}</Badge> : null}
      {s.flags.includes('OVERLAPS_MOCK_VOICE') ? <Badge tone="gray">Overlaps mock voice</Badge> : null}
      {s.flags.includes('REPETITIVE_TEXT') ? <Badge tone="amber">Repetitive text — check against the audio</Badge> : null}
    </>
  );
  const time = `${clock(s.timeline_start_ms)}–${clock(s.timeline_end_ms)}`;
  return (
    <div className={`transcript-line seg${active ? ' active' : ''}`} aria-current={active ? 'true' : undefined} data-testid="transcript-segment"
      data-kind={s.kind} data-confidence={s.confidence}>
      {seekable ? (
        <button type="button" className="seg-seek" onClick={() => void p!.seek(s.timeline_start_ms, true)}
          aria-label={`Play ${time}`} data-testid="segment-seek">
          <Icon name="play" size="sm" /><span className="mono xsmall">{time}</span>
        </button>
      ) : <span className="mono xsmall muted">{time}</span>}
      <div className="stack" style={{ gap: 4, minWidth: 0 }}>
        <p style={{ margin: 0 }}>{body}</p>
        <div className="row wrap" style={{ gap: 5 }}>{badges}</div>
      </div>
    </div>
  );
}

function Provenance({ o }: { o: Overview }) {
  return (
    <details className="provenance" data-testid="transcript-provenance">
      <summary className="small">Engine and provenance</summary>
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
        {o.tracks.map((t) => t.run ? (
          <dl key={t.track} className="kv rw-kv">
            <dt>Track</dt><dd>{TRACK_LABEL[t.track]} · {t.speaker_label} · run {t.run.run_ref} (revision {t.run.revision}{t.revisions > 1 ? ` of ${t.revisions}` : ''})</dd>
            <dt>Status</dt><dd>{t.run.status.toLowerCase()}{t.run.error_code ? ` · ${t.run.error_code}` : ''} · attempts {t.run.attempts}</dd>
            <dt>Engine</dt><dd className="mono">{t.run.engine_version}</dd>
            <dt>Model</dt><dd className="mono" title={t.run.model_sha256}>{t.run.model_id}@{t.run.model_revision.slice(0, 10)} · sha {t.run.model_sha256.slice(0, 12)}…</dd>
            <dt>Language</dt><dd>English only (D-51)</dd>
            <dt>Config</dt><dd className="mono" title={t.run.config_sha256}>sha {t.run.config_sha256.slice(0, 12)}…</dd>
            <dt>Audio in</dt><dd className="mono" title={t.run.input_content_sha256}>sha {t.run.input_content_sha256.slice(0, 12)}…</dd>
            <dt>Result</dt><dd>{t.speech_segments} speech segment{t.speech_segments === 1 ? '' : 's'} · {t.unrecognized_segments} not recognised · {t.low_confidence_segments} low confidence · {t.uncertain_words} uncertain word{t.uncertain_words === 1 ? '' : 's'}
              {typeof t.run.metrics.realtime_factor === 'number' ? ` · processed at ${t.run.metrics.realtime_factor}× real time` : ''}</dd>
          </dl>
        ) : null)}
        <p className="xsmall muted" style={{ margin: 0 }}>Runs are immutable; a retry adds a revision and keeps the earlier one. Text is stored encrypted and deleted with the audio at retention expiry.</p>
      </div>
    </details>
  );
}
