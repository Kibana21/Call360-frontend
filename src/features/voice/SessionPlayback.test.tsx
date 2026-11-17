// S1-D: playback timeline helpers and the Call Detail transcript panel (server values only; nothing invented).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, renderAt, stubApi } from '../../test/render';
import { activeSegments, clock, gapMarks, inGap, layTrack, parseWav, transcriptItems, type Segment, type Timeline } from './playback';
import { PlaybackProvider, RecordingPlayer, TranscriptPanel } from './SessionPlayback';

afterEach(() => vi.unstubAllGlobals());

const SR = 16000;
function wav(samples: number[]): ArrayBuffer {
  const b = new ArrayBuffer(44 + samples.length * 2), v = new DataView(b);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SR, true);
  v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => v.setInt16(44 + i * 2, s, true));
  return b;
}

// MIC: chunk 1 stored (0–2 s), chunk 2 lost (2–4 s), chunk 3 stored (4–6 s). Provider: complete.
const TL: Timeline = {
  session_id: 's1', sample_rate: SR, total_samples: 6 * SR,
  segments: [{ segment: 1, timeline_start: 0, length: 6 * SR, started_at: '2026-11-17T00:00:00Z' }],
  tracks: {
    MIC: { asset_ref: 'MA-1-M', media_status: 'AVAILABLE', coverage: 'PARTIAL', content_sha256: 'a'.repeat(64), stored_samples: 4 * SR,
      spans: [{ segment: 1, seq: 1, start_sample: 0, sample_count: 2 * SR, timeline_start: 0, wav_offset: 0 },
        { segment: 1, seq: 3, start_sample: 4 * SR, sample_count: 2 * SR, timeline_start: 4 * SR, wav_offset: 2 * SR }],
      gaps: [{ type: 'UPLOAD_FAILED', segment: 1, seqs: [2], timeline_start: 2 * SR, timeline_end: 4 * SR, estimated: false, reason: null }] },
    PROVIDER_PLAYBACK: { asset_ref: 'MA-1-P', media_status: 'AVAILABLE', coverage: 'COMPLETE', content_sha256: 'b'.repeat(64), stored_samples: 6 * SR,
      spans: [{ segment: 1, seq: 1, start_sample: 0, sample_count: 6 * SR, timeline_start: 0, wav_offset: 0 }], gaps: [] },
  },
};
const seg = (over: Partial<Segment>): Segment => ({
  track: 'MIC', speaker: 'CALLER_MIC', speaker_label: 'Caller (browser microphone)', run_ref: 'TR-1-M-r1', ordinal: 1, kind: 'SPEECH',
  confidence: 'NORMAL', rec_segment: 1, start_sample: 0, end_sample: SR, timeline_start_ms: 0, timeline_end_ms: 1000, wav_offset_ms: 0,
  time_alignment: 'APPROXIMATE', avg_logprob: -0.2, no_speech_prob: 0.01, word_count: 2, uncertain_words: 0, text: 'Hello there.',
  text_available: true, words: [], flags: [], ...over,
});

describe('playback helpers', () => {
  it('parses PCM16 WAV and lays stored spans on the timeline with the gap left silent', () => {
    const { rate, pcm } = parseWav(wav([1000, -1000, 2000, 3000]));
    expect(rate).toBe(SR);
    expect(Array.from(pcm)).toEqual([1000, -1000, 2000, 3000]);
    const out = layTrack(pcm, [{ segment: 1, seq: 1, start_sample: 0, sample_count: 2, timeline_start: 0, wav_offset: 0 },
      { segment: 1, seq: 3, start_sample: 4, sample_count: 2, timeline_start: 4, wav_offset: 2 }], 6);
    expect(Array.from(out).map((x) => Math.round(x * 32768))).toEqual([1000, -1000, 0, 0, 2000, 3000]);
    expect(() => parseWav(new ArrayBuffer(10))).toThrow();
  });
  it('places gaps between speaker turns and finds the active segment and gaps under the playhead', () => {
    const marks = gapMarks(TL);
    expect(marks).toHaveLength(1);
    expect(inGap(marks, 'MIC', 3000)?.gap.seqs).toEqual([2]);
    expect(inGap(marks, 'PROVIDER_PLAYBACK', 3000)).toBeUndefined();
    const a = seg({}), b = seg({ ordinal: 2, timeline_start_ms: 1200, timeline_end_ms: 1900 });
    const c = seg({ track: 'PROVIDER_PLAYBACK', speaker: 'MOCK_PROVIDER', run_ref: 'TR-1-P-r1', timeline_start_ms: 2500, timeline_end_ms: 3500 });
    const d = seg({ ordinal: 3, timeline_start_ms: 4500, timeline_end_ms: 5500 });
    const items = transcriptItems([d, c, b, a], marks);
    expect(items.map((i) => (i.kind === 'gap' ? 'gap' : `${i.speaker}x${i.segments.length}`))).toEqual(['CALLER_MICx2', 'gap', 'MOCK_PROVIDERx1', 'CALLER_MICx1']);
    expect([...activeSegments([a, b, c], 1500)]).toEqual(['MIC:TR-1-M-r1:2']);
    expect(clock(65_430)).toBe('1:05.4');
  });
});

const OVERVIEW = {
  session_id: 's1', availability: 'AVAILABLE', status: 'PARTIAL', reason: 'RECORDING_GAPS',
  message: 'Transcribed; the recording has gaps, which are never transcribed or filled in — machine transcript, not reviewed or certified',
  session_transcript_status: 'PARTIAL', review_status: 'NOT_REVIEWED', uncertain: true, language: 'en', recording_status: 'PARTIAL',
  can_read_text: true, can_retry: false,
  tracks: (['MIC', 'PROVIDER_PLAYBACK'] as const).map((t) => ({
    track: t, speaker: t === 'MIC' ? 'CALLER_MIC' : 'MOCK_PROVIDER', speaker_label: t, revisions: 1, speech_segments: 1, unrecognized_segments: 0,
    low_confidence_segments: 0, uncertain_words: t === 'MIC' ? 1 : 0,
    run: { run_ref: `TR-1-${t[0]}-r1`, track: t, revision: 1, status: 'DONE', attempts: 1, error_code: null, language: 'en', engine: 'faster-whisper',
      engine_version: 'faster-whisper 1.2.1; ctranslate2 4.9.0', model_id: 'Systran/faster-whisper-small.en', model_revision: 'd1d751a5f8271d482d14ca55d9e2deeebbae577f',
      model_sha256: '6'.repeat(64), config: {}, config_sha256: 'c'.repeat(64), input_content_sha256: 'a'.repeat(64), text_sha256: 'd'.repeat(64),
      source_event_seq: 9, requested_at: '2026-11-17T00:00:00Z', started_at: null, finished_at: null, metrics: { realtime_factor: 0.2 }, purged_at: null },
  })),
};
const SEGMENTS = {
  session_id: 's1', status: 'PARTIAL', review_status: 'NOT_REVIEWED', problems: [], timeline: TL,
  segments: [
    seg({ text: 'I am not sure this plan', words: [
      { text: 'I', timeline_start_ms: 0, timeline_end_ms: 100, probability: 0.9, uncertain: false },
      { text: 'am', timeline_start_ms: 100, timeline_end_ms: 200, probability: 0.9, uncertain: false },
      { text: 'plan', timeline_start_ms: 300, timeline_end_ms: 500, probability: 0.53, uncertain: true }], uncertain_words: 1 }),
    seg({ track: 'PROVIDER_PLAYBACK', speaker: 'MOCK_PROVIDER', run_ref: 'TR-1-P-r1', ordinal: 1, kind: 'UNRECOGNIZED', text: null, text_available: false,
      word_count: 0, timeline_start_ms: 4200, timeline_end_ms: 5000, confidence: 'LOW' }),
  ],
};

describe('Call Detail transcript panel', () => {
  it('shows speaker turns, uncertain words, unrecognised speech and the recording gap; a segment click loads audio for playback', async () => {
    const requested: string[] = [];
    stubApi({
      'GET /api/v1/sessions/s1/media/timeline': () => json(200, TL),
      'GET /api/v1/sessions/s1/transcript': () => json(200, OVERVIEW),
      'GET /api/v1/sessions/s1/transcript/segments': () => json(200, SEGMENTS),
      'GET /api/v1/sessions/s1/media/MIC/audio': (r) => { requested.push(r.url); return new Response(wav([1, 2, 3])); },
      'GET /api/v1/sessions/s1/media/PROVIDER_PLAYBACK/audio': (r) => { requested.push(r.url); return new Response(wav([4, 5, 6])); },
    });
    const started: number[] = [];
    class FakeCtx {
      currentTime = 0; destination = {};
      createBuffer = (_c: number, n: number) => ({ length: n, copyToChannel: () => undefined });
      createGain = () => ({ gain: { value: 1 }, connect: () => undefined });
      createBufferSource = () => ({ buffer: null, connect: () => undefined, start: (_at: number, off: number) => started.push(off), stop: () => undefined, onended: null });
      resume = async () => undefined; close = async () => undefined;
    }
    vi.stubGlobal('AudioContext', FakeCtx);
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    renderAt(<PlaybackProvider sessionId="s1" canPlay enabled><RecordingPlayer /><TranscriptPanel sessionId="s1" /></PlaybackProvider>);
    const list = await screen.findByTestId('transcript-list');
    expect(screen.getByTestId('transcript-status')).toHaveTextContent('Transcript partial');
    expect(screen.getByTestId('transcript-notice')).toHaveTextContent('not reviewed or certified');
    expect(within(list).getByText('plan').closest('mark')).toHaveClass('uncertain-word');
    expect(within(list).getByText('(uncertain)')).toBeInTheDocument();
    expect(within(list).getByTestId('transcript-gap')).toHaveTextContent('Microphone audio missing 0:02.0–0:04.0 (chunk not uploaded, chunk 2) — not transcribed.');
    expect(within(list).getByText(/not recognised — no text is shown/)).toBeInTheDocument();
    expect(list.textContent).not.toContain('synthetic audio test'); // the mock's scheduled message never appears
    expect(screen.getAllByTestId('gap-lane-MIC')[0]!.querySelectorAll('.gap-span')).toHaveLength(1);
    await userEvent.click(within(list).getAllByTestId('segment-seek')[0]!);
    await waitFor(() => expect(requested).toHaveLength(2));
    expect(requested.every((u) => u.includes('purpose=PLAYBACK'))).toBe(true);
    await waitFor(() => expect(started).toEqual([0, 0])); // both tracks start together at the segment's time
    await userEvent.click(screen.getByTestId('mute-MIC'));
    expect(screen.getByTestId('mute-MIC')).toHaveAttribute('aria-pressed', 'false');
  });

  it('polls while transcription is pending, offers retry after a failure, and hides text without permission', async () => {
    stubApi({
      'GET /api/v1/sessions/s2/media/timeline': () => json(200, { ...TL, session_id: 's2' }),
      'GET /api/v1/sessions/s2/transcript': () => json(200, {
        ...OVERVIEW, session_id: 's2', status: 'FAILED', reason: 'ENGINE_ERROR', availability: 'FAILED', message: 'Transcription failed (ENGINE_ERROR)',
        can_read_text: false, can_retry: true, tracks: OVERVIEW.tracks.map((t) => ({ ...t, run: { ...t.run, status: 'FAILED', error_code: 'ENGINE_ERROR', attempts: 3 } })),
      }),
      'POST /api/v1/sessions/s2/transcript/retry': () => json(200, { session_id: 's2', queued_tracks: ['MIC', 'PROVIDER_PLAYBACK'], status: 'PENDING' }),
    });
    renderAt(<PlaybackProvider sessionId="s2" canPlay={false} enabled><TranscriptPanel sessionId="s2" /></PlaybackProvider>);
    expect(await screen.findByTestId('transcript-status')).toHaveTextContent('Transcription failed');
    expect(screen.queryByTestId('transcript-list')).toBeNull();
    await userEvent.click(screen.getByTestId('transcript-retry'));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([r]) => r instanceof Request && r.method === 'POST')).toBe(true));
  });

  it('tells a restricted role that text is withheld', async () => {
    stubApi({
      'GET /api/v1/sessions/s3/media/timeline': () => json(200, TL),
      'GET /api/v1/sessions/s3/transcript': () => json(200, { ...OVERVIEW, session_id: 's3', availability: 'RESTRICTED', can_read_text: false }),
    });
    renderAt(<PlaybackProvider sessionId="s3" canPlay={false} enabled><RecordingPlayer /><TranscriptPanel sessionId="s3" /></PlaybackProvider>);
    expect(await screen.findByTestId('transcript-restricted')).toBeInTheDocument();
    expect(screen.getByTestId('player-restricted')).toBeInTheDocument();
    expect(screen.queryByTestId('transcript-segment')).toBeNull();
  });
});
