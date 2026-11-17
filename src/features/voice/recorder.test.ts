// S1-C recorder: nothing is recorded before a segment starts; chunks carry sequence, start sample, sample count and
// a SHA-256 of their bytes; a chunk that cannot be uploaded is retried, then declared failed in the manifest.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, stubApi } from '../../test/render';
import { SessionRecorder, sha256Hex } from './recorder';

const frame = (v: number) => new Int16Array(320).fill(v).buffer;

describe('SessionRecorder', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('records only after the segment starts, cuts chunks and sends an honest manifest', async () => {
    const chunks: Array<Record<string, unknown>> = [];
    let closed: Record<string, unknown> | null = null;
    stubApi({
      'POST /api/v1/voice/sessions/s1/recording/chunks': (req) => {
        void req.clone().json().then((b) => chunks.push(b as Record<string, unknown>));
        return json(200, { stored: true, duplicate: false });
      },
      'POST /api/v1/voice/sessions/s1/recording/close': (req) => { void req.clone().json().then((b) => { closed = b as Record<string, unknown>; }); return json(200, {}); },
    });
    const rec = new SessionRecorder('s1', () => undefined);
    rec.push('MIC', frame(7)); // before consent-confirmed segment start: dropped
    rec.startSegment(1, 640); // 2 frames per chunk
    for (let i = 0; i < 5; i += 1) rec.push('MIC', frame(i + 1));
    rec.push('PROVIDER_PLAYBACK', frame(9));
    await rec.endSegment('STOPPED');
    await vi.waitFor(() => expect(closed).not.toBeNull());
    const mic = chunks.filter((c) => c.track === 'MIC').sort((a, b) => Number(a.seq) - Number(b.seq));
    expect(mic.map((c) => [c.seq, c.start_sample, c.sample_count])).toEqual([[1, 0, 640], [2, 640, 640], [3, 1280, 320]]);
    const first = Uint8Array.from(atob(String(mic[0]!.data_b64)), (ch) => ch.charCodeAt(0));
    expect(new Int16Array(first.buffer)[0]).toBe(1); // the pre-segment frame (7) is not in the recording
    expect(mic[0]!.sha256).toBe(await sha256Hex(first));
    expect((closed as unknown as { tracks: unknown[] }).tracks).toEqual([
      { track: 'MIC', segment: 1, chunks: 3, failed: [], reason: 'STOPPED' },
      { track: 'PROVIDER_PLAYBACK', segment: 1, chunks: 1, failed: [], reason: 'STOPPED' },
    ]);
  });

  it('declares a chunk it could not upload instead of hiding it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let closed: { tracks: Array<Record<string, unknown>> } | null = null;
    stubApi({
      'POST /api/v1/voice/sessions/s1/recording/chunks': () => json(503, { code: 'DOWN' }),
      'POST /api/v1/voice/sessions/s1/recording/close': (req) => { void req.clone().json().then((b) => { closed = b as typeof closed; }); return json(200, {}); },
    });
    const statuses: number[] = [];
    const rec = new SessionRecorder('s1', (s) => statuses.push(s.failed));
    rec.startSegment(1, 320);
    rec.push('MIC', frame(3));
    const done = rec.endSegment('STOPPED');
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    await vi.waitFor(() => expect(closed).not.toBeNull());
    expect(closed!.tracks[0]).toEqual({ track: 'MIC', segment: 1, chunks: 1, failed: [1], reason: 'STOPPED' });
    expect(Math.max(...statuses)).toBe(1);
    vi.useRealTimers();
  });
});
