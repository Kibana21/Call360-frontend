// S1-D playback helpers. The evidence WAV of a track holds only the stored chunks, back to back; the server's
// timeline maps each stored span to its position on the session timeline (shared by both tracks). For playback the
// browser lays each track's stored spans on that timeline in memory, so both tracks play in sync and a recording
// gap plays as silence *and is shown as a gap*. The evidence file itself is never changed and nothing is filled in.
import type { components } from '../../api/generated/schema';

export type Timeline = components['schemas']['RecordingTimeline'];
export type TimelineGap = components['schemas']['TimelineGap'];
export type Segment = components['schemas']['TranscriptSegmentOut'];
export type TrackName = 'MIC' | 'PROVIDER_PLAYBACK';

export const TRACK_LABEL: Record<TrackName, string> = { MIC: 'Microphone', PROVIDER_PLAYBACK: 'Mock voice' };
export const SPEAKER_LABEL: Record<string, string> = {
  CALLER_MIC: 'Caller (browser microphone)',
  MOCK_PROVIDER: 'Mock voice (Call360 test)',
};
export const GAP_LABEL: Record<string, string> = {
  MISSING: 'chunk missing',
  UPLOAD_FAILED: 'chunk not uploaded',
  OBJECT_UNREADABLE: 'stored chunk unreadable',
  DISCONTINUITY: 'audio discontinuity',
  SESSION_INTERRUPTED: 'connection interrupted',
  END_NOT_CONFIRMED: 'end not confirmed by the browser',
  CAPTURE_INTERRUPTED: 'capture ended early',
};

/** PCM16 samples of a WAV file (the `data` chunk), or throws when the file is not 16-bit mono PCM. */
export function parseWav(buf: ArrayBuffer): { rate: number; pcm: Int16Array } {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let o = 12;
  let rate = 0;
  while (o + 8 <= buf.byteLength) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      const format = v.getUint16(o + 8, true), channels = v.getUint16(o + 10, true), bits = v.getUint16(o + 22, true);
      if (format !== 1 || channels !== 1 || bits !== 16) throw new Error('unsupported WAV format');
      rate = v.getUint32(o + 12, true);
    }
    if (id === 'data') {
      const n = Math.min(size, buf.byteLength - o - 8) >> 1;
      return { rate, pcm: new Int16Array(buf.slice(o + 8, o + 8 + n * 2)) };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('WAV has no data');
}

/** One track on the session timeline: stored spans copied to their timeline positions; everything else silent. */
export function layTrack(pcm: Int16Array, spans: Timeline['tracks'][string]['spans'], total: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(new ArrayBuffer(Math.max(total, 1) * 4));
  for (const s of spans) {
    for (let i = 0; i < s.sample_count; i += 1) {
      const src = s.wav_offset + i, dst = s.timeline_start + i;
      if (src < pcm.length && dst < out.length) out[dst] = (pcm[src] ?? 0) / 32768;
    }
  }
  return out;
}

export const samplesToMs = (samples: number, rate: number) => Math.floor((samples * 1000) / rate);

export function clock(ms: number): string {
  const t = Math.max(0, ms) / 1000;
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

export interface GapMark { track: TrackName; startMs: number; endMs: number; gap: TimelineGap }

/** Gaps with a duration, in timeline milliseconds (point markers such as an interruption have start = end). */
export function gapMarks(tl: Timeline): GapMark[] {
  const out: GapMark[] = [];
  for (const [track, t] of Object.entries(tl.tracks)) {
    for (const g of t.gaps) {
      out.push({ track: track as TrackName, startMs: samplesToMs(g.timeline_start, tl.sample_rate), endMs: samplesToMs(g.timeline_end, tl.sample_rate), gap: g });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.track.localeCompare(b.track));
}

export type TranscriptItem =
  | { kind: 'turn'; speaker: string; track: TrackName; startMs: number; segments: Segment[] }
  | { kind: 'gap'; mark: GapMark };

/** Conversation order: consecutive segments of one speaker form a turn; recording gaps are placed where they occur. */
export function transcriptItems(segments: Segment[], marks: GapMark[]): TranscriptItem[] {
  const events: Array<{ at: number; order: number; seg?: Segment; mark?: GapMark }> = [
    ...segments.map((seg) => ({ at: seg.timeline_start_ms, order: 1, seg })),
    ...marks.map((mark) => ({ at: mark.startMs, order: 0, mark })),
  ].sort((a, b) => a.at - b.at || a.order - b.order);
  const out: TranscriptItem[] = [];
  for (const e of events) {
    if (e.mark) { out.push({ kind: 'gap', mark: e.mark }); continue; }
    const seg = e.seg!;
    const last = out[out.length - 1];
    if (last && last.kind === 'turn' && last.speaker === seg.speaker) last.segments.push(seg);
    else out.push({ kind: 'turn', speaker: seg.speaker, track: seg.track as TrackName, startMs: seg.timeline_start_ms, segments: [seg] });
  }
  return out;
}

/** The segment being heard at `ms` (the latest one that has started and not ended), per track. */
export function activeSegments(segments: Segment[], ms: number): Set<string> {
  const ids = new Set<string>();
  for (const s of segments) if (s.timeline_start_ms <= ms && ms < s.timeline_end_ms) ids.add(segmentKey(s));
  return ids;
}

export const segmentKey = (s: Pick<Segment, 'track' | 'run_ref' | 'ordinal'>) => `${s.track}:${s.run_ref}:${s.ordinal}`;

/** Is the playhead inside a gap of this track? */
export function inGap(marks: GapMark[], track: TrackName, ms: number): GapMark | undefined {
  return marks.find((m) => m.track === track && m.endMs > m.startMs && m.startMs <= ms && ms < m.endMs);
}
