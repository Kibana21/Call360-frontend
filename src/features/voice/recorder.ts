// S1-C consent-gated recorder (VOICE-007/008/010). It only receives audio after the server confirms an active
// recording on `session.ready` (consent was granted when the session was created), so nothing captured earlier —
// e.g. while the microphone was being opened — can enter a recording. Two tracks share one 16 kHz AudioContext clock:
// MIC (the frames sent to the server) and PROVIDER_PLAYBACK (what the browser's audio graph actually rendered after
// barge-in clearing; not the acoustic speaker output). Frames are cut into chunks of up to 2 s, hashed (SHA-256) and
// uploaded with retries. Each connection is one segment; when it ends the browser sends its manifest (chunks
// produced, chunks it could not upload, why capture ended). The server computes coverage; nothing is filled in.
import { api, ApiFailure } from '../../api/client';

export type Track = 'MIC' | 'PROVIDER_PLAYBACK';
export type CloseReason = 'STOPPED' | 'MIC_DEVICE_LOST' | 'CONNECTION_LOST' | 'PAGE_CLOSED' | 'UPLOAD_FAILED' | 'CAPTURE_ERROR';
export interface RecorderStatus { active: boolean; segment: number; uploaded: number; pending: number; failed: number; closedSegments: number }

const TRACKS: Track[] = ['MIC', 'PROVIDER_PLAYBACK'];
const RETRIES = 3;
const FLUSH_TIMEOUT_MS = 8000;

interface TrackState { seq: number; cursor: number; buf: Int16Array; filled: number; failed: number[]; startedAt: number }

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export class SessionRecorder {
  private segment = 0;
  private chunkSamples = 32000;
  private tracks = new Map<Track, TrackState>();
  private inflight = new Set<Promise<void>>();
  private status: RecorderStatus = { active: false, segment: 0, uploaded: 0, pending: 0, failed: 0, closedSegments: 0 };

  constructor(private readonly sessionId: string, private readonly onStatus: (s: RecorderStatus) => void) {}

  get active(): boolean { return this.status.active; }

  private emit(patch: Partial<RecorderStatus>) { this.status = { ...this.status, ...patch }; this.onStatus(this.status); }

  /** A new connection segment confirmed by the server. Everything before this call is never recorded. */
  startSegment(segment: number, chunkSamples: number) {
    this.segment = segment;
    this.chunkSamples = Math.max(320, Math.min(chunkSamples, 32000));
    this.tracks = new Map(TRACKS.map((t) => [t, { seq: 0, cursor: 0, buf: new Int16Array(this.chunkSamples), filled: 0, failed: [], startedAt: Date.now() }]));
    this.emit({ active: true, segment });
  }

  /** One 20 ms PCM16 frame of a track; ignored unless a segment is active. */
  push(track: Track, pcm: ArrayBuffer) {
    if (!this.status.active) return;
    const t = this.tracks.get(track);
    if (!t) return;
    const src = new Int16Array(pcm);
    let i = 0;
    while (i < src.length) {
      const n = Math.min(src.length - i, t.buf.length - t.filled);
      t.buf.set(src.subarray(i, i + n), t.filled);
      t.filled += n; i += n;
      if (t.filled === t.buf.length) this.emitChunk(track, t);
    }
  }

  private emitChunk(track: Track, t: TrackState) {
    if (!t.filled) return;
    const samples = t.buf.slice(0, t.filled);
    t.seq += 1;
    const seq = t.seq, start = t.cursor, segment = this.segment;
    t.cursor += t.filled;
    t.buf = new Int16Array(this.chunkSamples); t.filled = 0;
    const p = this.upload(track, segment, seq, start, samples).then((ok) => {
      if (!ok) t.failed.push(seq);
    });
    this.inflight.add(p);
    this.emit({ pending: this.inflight.size });
    void p.finally(() => { this.inflight.delete(p); this.emit({ pending: this.inflight.size }); });
  }

  private async upload(track: Track, segment: number, seq: number, start: number, samples: Int16Array): Promise<boolean> {
    const bytes = new Uint8Array(samples.buffer as ArrayBuffer, samples.byteOffset, samples.byteLength);
    const body = {
      track, segment, seq, start_sample: start, sample_count: samples.length,
      sha256: await sha256Hex(bytes), data_b64: toBase64(bytes), captured_at: new Date().toISOString(),
    };
    for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
      try {
        const r = await api.POST('/api/v1/voice/sessions/{session_id}/recording/chunks', { params: { path: { session_id: this.sessionId } }, body });
        if (r.data) { this.emit({ uploaded: this.status.uploaded + 1 }); return true; }
        const status = r.response.status;
        if (status !== 429 && status < 500) break; // refused (e.g. closed or invalid): retrying cannot help
      } catch (e) {
        if (e instanceof ApiFailure && e.status > 0 && e.status < 500 && e.status !== 429) break;
      }
      await sleep(400 * 2 ** (attempt - 1));
    }
    this.emit({ failed: this.status.failed + 1 });
    return false;
  }

  /** End the current segment: flush partial chunks, wait (bounded) for uploads, then send the manifest. */
  async endSegment(reason: CloseReason): Promise<void> {
    if (!this.status.active) return;
    this.emit({ active: false });
    const segment = this.segment;
    for (const [track, t] of this.tracks) this.emitChunk(track, t);
    const pending = [...this.inflight];
    await Promise.race([Promise.allSettled(pending), sleep(FLUSH_TIMEOUT_MS)]);
    const tracks = [...this.tracks].map(([track, t]) => ({
      // `failed` lists the chunks that never reached the server; the reason says only why capture ended.
      track, segment, chunks: t.seq, failed: [...t.failed].sort((a, b) => a - b), reason,
    }));
    try {
      await api.POST('/api/v1/voice/sessions/{session_id}/recording/close', { params: { path: { session_id: this.sessionId } }, body: { tracks } });
      this.emit({ closedSegments: this.status.closedSegments + 1 });
    } catch { /* the server finalises unclosed segments as END_NOT_CONFIRMED after its upload window */ }
  }
}
