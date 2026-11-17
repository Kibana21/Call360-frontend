import { expect, test } from '@playwright/test';
import { a11yAndLayout } from './cp04a-checks';
import { accounts, signIn } from './helpers';

// S1-A — full-duplex browser voice POC on the real stack (backend 8001 + call360_test), Chromium with a fake
// microphone that plays a synthetic "Hello. Hello there." every ~7 s through the real getUserMedia pipeline.
// Start → microphone → mock speech → interruption (mock stops, queue cleared) → speak again → new response → Stop.
// Also: microphone denial, device loss, held cases refused, CSRF/permission, and nothing recorded or verified.
// S1-C (below): consent-gated recording — consent → record → interruption → stop → evidence; refusal; partial capture.
test.describe.configure({ timeout: 120_000 });

test('S1-A browser voice: full duplex with barge-in, safe stop and failure states (USER)', async ({ page, context }) => {
  await signIn(page, accounts().user);
  const pre = await (await page.request.get('/api/v1/voice/preflight')).json();
  expect(pre.status).toBe('AVAILABLE');
  const target = pre.callable_cases[0];

  // Start from Call Detail (pre-check passed) → Voice Studio.
  await page.goto(`/cases/${target.case_id}`);
  await page.getByTestId('cd-start-voice').click();
  await expect(page).toHaveURL(new RegExp(`/voice-studio\\?case=${target.case_id}`));
  await expect(page.getByTestId('voice-message')).toContainText('This test does not verify an insurance transaction.');
  await page.getByTestId('voice-start').click();
  await expect(page.getByTestId('voice-panel')).toContainText('Live', { timeout: 15_000 });
  await expect(page.getByTestId('agent-speaking')).toContainText('Mock voice speaking', { timeout: 10_000 });
  // The fake microphone says hello while the mock speaks: barge-in stops it and clears queued audio …
  await expect(page.getByTestId('voice-interruptions')).not.toHaveText('0', { timeout: 15_000 });
  await expect(page.getByTestId('voice-log')).toContainText('You interrupted — mock speech stopped and queued audio cleared');
  // … then, after the caller's turn ends, the mock speaks again (a new response).
  await expect.poll(async () => Number(await page.getByTestId('voice-responses').innerText()), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  // Rapid repeated interruptions keep working (the clip repeats every ~7 s).
  await expect.poll(async () => Number(await page.getByTestId('voice-interruptions').innerText()), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('voice-log')).toContainText('Your speech detected');
  await a11yAndLayout(page, 'voice-live');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('voice-stop').click();
  await expect(page.getByTestId('voice-ended')).toContainText('You stopped the session.');
  await expect(page.getByTestId('voice-ended')).toContainText('Nothing was recorded. Nothing was verified.'); // S1-C default: not recorded
  await expect(page.getByTestId('voice-start')).toBeEnabled();

  // The case was not verified or changed by the session.
  const after = await (await page.request.get(`/api/v1/cases/${target.case_id}`)).json();
  expect(after.verified_at).toBeNull();
  expect(after.state).toBe(target.state);

  // Session creation needs the CSRF token and an in-scope case (holds and scope are covered in tests/test_voice.py).
  const csrf = (await context.cookies()).find((c) => c.name === 'c360_csrf')!.value;
  const noCsrf = await page.request.post('/api/v1/voice/sessions', { data: { case_id: target.case_id } });
  expect(noCsrf.status()).toBe(403);
  const unknown = await page.request.post('/api/v1/voice/sessions', {
    data: { case_id: '00000000-0000-0000-0000-000000000000' }, headers: { 'X-CSRF-Token': csrf, Origin: new URL(page.url()).origin },
  });
  expect(unknown.status()).toBe(404);

  // Device loss: the microphone track ends mid-session → the session ends safely and the microphone is released.
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await original(c);
      (window as unknown as { __c360TestStream: MediaStream }).__c360TestStream = s;
      return s;
    };
  });
  await page.reload();
  await page.getByTestId('voice-start').click();
  await expect(page.getByTestId('voice-panel')).toContainText('Live', { timeout: 15_000 });
  await page.evaluate(() => {
    const t = (window as unknown as { __c360TestStream: MediaStream }).__c360TestStream.getAudioTracks()[0]!;
    t.stop();
    t.dispatchEvent(new Event('ended'));
  });
  await expect(page.getByTestId('voice-error')).toContainText('The microphone was disconnected. The session was ended safely.');
  await expect(page.getByTestId('voice-start')).toBeEnabled();
});

test('S1-A browser voice: a denied microphone never creates a session', async ({ page }) => {
  await signIn(page, accounts().user);
  const pre = await (await page.request.get('/api/v1/voice/preflight')).json();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  const posts: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/v1/voice/sessions')) posts.push(r.url()); });
  await page.goto(`/voice-studio?case=${pre.callable_cases[0].case_id}`);
  await page.getByTestId('voice-start').click();
  await expect(page.getByTestId('voice-error')).toContainText('Microphone access was blocked');
  expect(posts).toEqual([]);
});

test('S1-B persistence: Start → Stop survives a refresh; a mid-session refresh resumes the same session; Call Detail shows the history', async ({ page }) => {
  await signIn(page, accounts().user);
  const pre = await (await page.request.get('/api/v1/voice/preflight')).json();
  const target = pre.callable_cases[1] ?? pre.callable_cases[0];
  await page.goto(`/voice-studio?case=${target.case_id}`);

  // Normal Start → Stop is persisted and still visible after a refresh.
  await page.getByTestId('voice-start').click();
  await expect(page.getByTestId('voice-panel')).toContainText('Live', { timeout: 15_000 });
  await expect(page.getByTestId('voice-session-record')).toContainText('Live', { timeout: 10_000 });
  await expect(page.getByTestId('voice-interruptions')).not.toHaveText('0', { timeout: 15_000 });
  await page.getByTestId('voice-stop').click();
  await expect(page.getByTestId('voice-ended')).toContainText('It is saved with its event timeline');
  await expect(page.getByTestId('voice-stop')).toBeDisabled(); // nothing left to stop
  await expect(page.getByTestId('voice-session-record')).toContainText('Completed'); // the stored record caught up
  await page.reload();
  const history = page.getByTestId('voice-history');
  await expect(history.locator('tbody tr').first()).toContainText('Completed');
  await history.getByRole('button', { name: /^Timeline of / }).first().click();
  await expect(page.getByTestId('voice-session-events')).toContainText('Session ended');
  await expect(page.getByTestId('voice-session-reason')).toContainText('Stopped by the user');
  const done = (await (await page.request.get(`/api/v1/voice/sessions?case_id=${target.case_id}`)).json()).items[0];
  const repeat = await page.request.post(`/api/v1/voice/sessions/${done.session_id}/stop`, {
    headers: { 'X-CSRF-Token': (await page.context().cookies()).find((c) => c.name === 'c360_csrf')!.value, Origin: new URL(page.url()).origin },
  });
  expect(repeat.status()).toBe(200); // repeated Stop is safe
  expect((await repeat.json()).events.filter((e: { event_type: string }) => e.event_type === 'ENDED')).toHaveLength(1);

  // A refresh during a live session leaves it INTERRUPTED; Voice Studio offers to resume the same session.
  await page.getByTestId('voice-start').click();
  await expect(page.getByTestId('voice-panel')).toContainText('Live', { timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId('voice-resumable')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('voice-resume').click();
  await expect(page.getByTestId('voice-log')).toContainText('Reconnected — the same session resumed', { timeout: 15_000 });
  await page.getByTestId('voice-stop').click();
  await expect(page.getByTestId('voice-ended')).toBeVisible();
  const resumed = (await (await page.request.get(`/api/v1/voice/sessions?case_id=${target.case_id}`)).json()).items[0];
  const timeline = await (await page.request.get(`/api/v1/voice/sessions/${resumed.session_id}`)).json();
  const kinds = timeline.events.map((e: { event_type: string }) => e.event_type);
  expect(kinds).toEqual(expect.arrayContaining(['CONNECTED', 'DISCONNECTED', 'RESUMED', 'ENDED']));
  expect(kinds.filter((k: string) => k === 'CONNECTED')).toHaveLength(1);
  expect(timeline.status).toBe('FINALIZED');

  // Call Detail: the browser attempts appear in contact history with their persisted timeline; the case is unchanged.
  await page.goto(`/cases/${target.case_id}`);
  await page.getByRole('button', { name: /Browser voice test/ }).first().click();
  await expect(page.getByTestId('voice-session-record')).toContainText(resumed.attempt_ref);
  await expect(page.getByTestId('voice-session-events')).toContainText('Reconnected (resumed)');
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByText(/Browser voice test session .* started/).first()).toBeVisible();
  const caseAfter = await (await page.request.get(`/api/v1/cases/${target.case_id}`)).json();
  expect(caseAfter.verified_at).toBeNull();
  await a11yAndLayout(page, 'voice-call-detail');
});

test('S1-B tab closure: the session is interrupted, then finalised as abandoned', async ({ page, context }) => {
  test.setTimeout(150_000);
  await signIn(page, accounts().user);
  const pre = await (await page.request.get('/api/v1/voice/preflight')).json();
  const target = pre.callable_cases[2] ?? pre.callable_cases[0];
  const tab = await context.newPage();
  await tab.goto(`/voice-studio?case=${target.case_id}`);
  await tab.getByTestId('voice-start').click();
  await expect(tab.getByTestId('voice-panel')).toContainText('Live', { timeout: 15_000 });
  const id = (await (await page.request.get(`/api/v1/voice/sessions?case_id=${target.case_id}`)).json()).items[0].session_id;
  await tab.close();
  await expect.poll(async () => (await (await page.request.get(`/api/v1/voice/sessions/${id}`)).json()).status, { timeout: 10_000 }).toBe('INTERRUPTED');
  // Nobody resumes within 30 s: the server sweeper (every 15 s) finalises it; no orphaned live session remains.
  await expect.poll(async () => (await (await page.request.get(`/api/v1/voice/sessions/${id}`)).json()).status, { timeout: 90_000, intervals: [5_000] }).toBe('ABORTED');
  const final = await (await page.request.get(`/api/v1/voice/sessions/${id}`)).json();
  expect(final.end_reason).toBe('ABANDONED');
  expect(final.can_resume).toBe(false);
});

// ---- S1-C consent-gated recording ------------------------------------------------------------------------------
type Rec = { status: string; consent: string; tracks: Array<{ track: string; media_status: string; coverage: string; chunks_stored: number;
  gaps: Array<{ type: string }>; content_sha256: string | null }> };
const recordingOf = async (page: import('@playwright/test').Page, id: string): Promise<Rec> =>
  (await (await page.request.get(`/api/v1/voice/sessions/${id}`)).json()).recording as Rec;

test('S1-C recording: consent → record → interruption → stop → complete evidence; refusal records nothing', async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, accounts().user);
  const pre = await (await page.request.get('/api/v1/voice/preflight')).json();
  expect(pre.recording_notice.default_decision).toBe('DECLINED');
  const target = pre.callable_cases[3] ?? pre.callable_cases[0];
  await page.goto(`/voice-studio?case=${target.case_id}`);
  await expect(page.getByTestId('consent-no')).toBeChecked(); // default: do not record
  await expect(page.getByTestId('recording-notice')).toContainText('not approved AIA or MAS consent wording');

  // Consent granted before Start.
  await page.getByTestId('consent-yes').check();
  await page.getByTestId('voice-start').click();
  await expect(page.getByTestId('voice-panel')).toContainText('Live', { timeout: 15_000 });
  await expect(page.getByTestId('recording-indicator')).toContainText('Recording');
  await expect(page.getByTestId('consent-no')).toBeDisabled(); // no change mid-session
  await expect(page.getByTestId('voice-interruptions')).not.toHaveText('0', { timeout: 15_000 });
  await expect(page.getByTestId('recording-live-status')).toContainText(/[2-9]\d* chunks uploaded|\d{2,} chunks uploaded/, { timeout: 15_000 });
  await a11yAndLayout(page, 'voice-recording-live');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('voice-stop').click();
  await expect(page.getByTestId('voice-ended')).toContainText('Recording evidence is shown in the persisted session.');
  await expect(page.getByTestId('recording-indicator')).toHaveCount(0);
  const id = (await (await page.request.get(`/api/v1/voice/sessions?case_id=${target.case_id}`)).json()).items[0].session_id;
  await expect.poll(async () => (await recordingOf(page, id)).status, { timeout: 20_000 }).toBe('COMPLETE');
  const rec = await recordingOf(page, id);
  expect(rec.consent).toBe('GRANTED');
  expect(rec.tracks.map((t) => [t.track, t.media_status, t.coverage])).toEqual([['MIC', 'AVAILABLE', 'COMPLETE'], ['PROVIDER_PLAYBACK', 'AVAILABLE', 'COMPLETE']]);
  expect(rec.tracks.every((t) => t.chunks_stored >= 2 && t.gaps.length === 0)).toBe(true);
  await expect(page.getByTestId('recording-status').first()).toContainText('Recording complete', { timeout: 10_000 });

  // Call Detail: the test session, its recording evidence and an authorised, audited download whose checksum matches.
  await page.goto(`/cases/${target.case_id}`);
  await page.getByRole('button', { name: /Browser voice test/ }).first().click();
  await expect(page.getByTestId(/attempt-kind-/).first()).toContainText('Test session — not a customer contact');
  await expect(page.getByTestId('cd-recording')).toContainText('Recording stored');
  const href = await page.getByTestId('recording-download-MIC').getAttribute('href');
  const wav = await page.request.get(href!);
  expect(wav.status()).toBe(200);
  const body = await wav.body();
  const { createHash } = await import('node:crypto');
  expect(createHash('sha256').update(body.subarray(44)).digest('hex')).toBe(rec.tracks[0]!.content_sha256);
  expect(wav.headers()['x-call360-content-sha256']).toBe(rec.tracks[0]!.content_sha256);
  await a11yAndLayout(page, 'voice-recording-call-detail');

  // Refusal (the default): the session works the same and nothing is stored.
  await page.goto(`/voice-studio?case=${target.case_id}`);
  await page.getByTestId('voice-start').click();
  await expect(page.getByTestId('voice-panel')).toContainText('Live', { timeout: 15_000 });
  await expect(page.getByTestId('recording-indicator')).toHaveCount(0);
  await expect(page.getByTestId('recording-live-status')).toContainText('you chose not to record');
  await page.getByTestId('voice-stop').click();
  await expect(page.getByTestId('voice-ended')).toContainText('Nothing was recorded.');
  const declined = (await (await page.request.get(`/api/v1/voice/sessions?case_id=${target.case_id}`)).json()).items[0];
  const drec = await recordingOf(page, declined.session_id);
  expect([drec.status, drec.consent, drec.tracks.length]).toEqual(['NOT_RECORDED', 'DECLINED', 0]);
});

test('S1-C recording: upload failure and a mid-session refresh are reported as partial, never filled in', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, accounts().user);
  const pre = await (await page.request.get('/api/v1/voice/preflight')).json();
  const target = pre.callable_cases[4] ?? pre.callable_cases[0];
  let failing = false;
  await page.route('**/api/v1/voice/sessions/*/recording/chunks', (route) => (failing ? route.abort('connectionfailed') : route.continue()));
  await page.goto(`/voice-studio?case=${target.case_id}`);
  await page.getByTestId('consent-yes').check();
  await page.getByTestId('voice-start').click();
  await expect(page.getByTestId('voice-panel')).toContainText('Live', { timeout: 15_000 });
  await expect(page.getByTestId('recording-live-status')).toContainText(/[2-9] chunks uploaded|\d{2,} chunks uploaded/, { timeout: 15_000 });
  failing = true; // the network drops chunk uploads: the browser retries, then declares them failed
  await expect(page.getByTestId('recording-upload-failed')).toContainText('could not be uploaded', { timeout: 20_000 });
  failing = false;
  await page.getByTestId('voice-stop').click();
  await expect(page.getByTestId('voice-ended')).toBeVisible();
  const first = (await (await page.request.get(`/api/v1/voice/sessions?case_id=${target.case_id}`)).json()).items[0].session_id;
  await expect.poll(async () => (await recordingOf(page, first)).status, { timeout: 20_000 }).toBe('PARTIAL');
  const r1 = await recordingOf(page, first);
  expect(r1.tracks.flatMap((t) => t.gaps.map((g) => g.type))).toContain('UPLOAD_FAILED');
  expect(r1.tracks.every((t) => t.media_status === 'AVAILABLE')).toBe(true);

  // A refresh mid-recording loses the unsent chunk; resume starts a second segment; the gap is reported.
  await page.getByTestId('consent-yes').check();
  await page.getByTestId('voice-start').click();
  await expect(page.getByTestId('recording-indicator')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('recording-live-status')).toContainText(/[2-9] chunks uploaded|\d{2,} chunks uploaded/, { timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId('voice-resumable')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('voice-resume').click();
  await expect(page.getByTestId('voice-log')).toContainText('Recording started (segment 2)', { timeout: 15_000 });
  await page.waitForTimeout(3_000);
  await page.getByTestId('voice-stop').click();
  await expect(page.getByTestId('voice-ended')).toBeVisible();
  const second = (await (await page.request.get(`/api/v1/voice/sessions?case_id=${target.case_id}`)).json()).items[0].session_id;
  // Segment 1 was never closed by the browser: the server finalises it after its upload window (sweeper, ≤ ~45 s).
  await expect.poll(async () => (await recordingOf(page, second)).status, { timeout: 90_000, intervals: [5_000] }).toBe('PARTIAL');
  const r2 = await recordingOf(page, second);
  for (const t of r2.tracks) {
    const types = t.gaps.map((g) => g.type);
    expect(types).toEqual(expect.arrayContaining(['SESSION_INTERRUPTED', 'END_NOT_CONFIRMED']));
  }
  await page.goto(`/voice-studio?case=${target.case_id}`);
  await expect(page.getByTestId('voice-history').locator('tbody tr').first()).toContainText('Recording partial');
});

// ---- S1-D transcript and playback -------------------------------------------------------------------------------
test('S1-D transcript: recorded conversation → local transcription → Call Detail → synchronised playback → segment seek', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, accounts().user);
  const pre = await (await page.request.get('/api/v1/voice/preflight')).json();
  expect(pre.capabilities.find((c: { code: string }) => c.code === 'TRANSCRIPT').status).toBe('AVAILABLE');
  const target = pre.callable_cases[4] ?? pre.callable_cases[0];
  await page.goto(`/voice-studio?case=${target.case_id}`);
  await page.getByTestId('consent-yes').check();
  await page.getByTestId('voice-start').click();
  await expect(page.getByTestId('voice-panel')).toContainText('Live', { timeout: 15_000 });
  await expect(page.getByTestId('voice-interruptions')).not.toHaveText('0', { timeout: 20_000 }); // barge-in happened
  await expect(page.getByTestId('recording-live-status')).toContainText(/([4-9]|\d{2,}) chunks uploaded/, { timeout: 20_000 });
  await page.getByTestId('voice-stop').click();
  await expect(page.getByTestId('voice-ended')).toContainText('Recording evidence is shown in the persisted session.');
  const attempt = (await (await page.request.get(`/api/v1/voice/sessions?case_id=${target.case_id}`)).json()).items[0].session_id;
  await expect.poll(async () => (await recordingOf(page, attempt)).status, { timeout: 30_000 }).toBe('COMPLETE');
  const attempts = (await (await page.request.get(`/api/v1/cases/${target.case_id}/attempts`)).json()).items;
  const session = attempts.find((a: { id: string }) => a.id === attempt).session.session_id;
  // Transcription runs in the backend worker, outside the request path.
  await expect.poll(async () => (await (await page.request.get(`/api/v1/sessions/${session}/transcript`)).json()).status,
    { timeout: 60_000, intervals: [1000] }).toMatch(/COMPLETE|PARTIAL/);
  const seg = await (await page.request.get(`/api/v1/sessions/${session}/transcript/segments`)).json();
  const caller = seg.segments.filter((s: { track: string; kind: string }) => s.track === 'MIC' && s.kind === 'SPEECH');
  const mock = seg.segments.filter((s: { track: string; kind: string }) => s.track === 'PROVIDER_PLAYBACK' && s.kind === 'SPEECH');
  expect(caller.length).toBeGreaterThan(0);
  expect(caller.map((s: { text: string }) => s.text).join(' ').toLowerCase()).toContain('hello'); // the fake microphone says "hello"
  expect(mock.length).toBeGreaterThan(0); // the mock voice as rendered (interrupted), never the scheduled script

  await page.goto(`/cases/${target.case_id}?attempt=${attempt}`);
  await expect(page.getByTestId('transcript-status')).toContainText(/Transcript (complete|partial)/, { timeout: 15_000 });
  await expect(page.getByTestId('transcript-notice')).toContainText('not reviewed or certified');
  await expect(page.getByTestId('turn-MIC').first()).toContainText('Caller (browser microphone)');
  await expect(page.getByTestId('turn-PROVIDER_PLAYBACK').first()).toContainText('Mock voice (Call360 test)');
  await expect(page.getByTestId('recording-player')).toBeVisible();
  await a11yAndLayout(page, 'transcript-call-detail');
  // Clicking a caller segment loads both tracks (audited PLAYBACK) and seeks the synchronised player there.
  const audio = page.waitForResponse((r) => r.url().includes('/media/MIC/audio') && r.url().includes('purpose=PLAYBACK'));
  await page.getByTestId('turn-MIC').first().getByTestId('segment-seek').first().click();
  expect((await audio).status()).toBe(200);
  await expect(page.getByTestId('player-toggle')).toHaveText('Pause', { timeout: 10_000 });
  const startMs = caller[0].timeline_start_ms as number;
  const parse = (t: string) => { const [m, s] = t.split('/')[0]!.trim().split(':'); return (Number(m) * 60 + Number(s)) * 1000; };
  await expect.poll(async () => parse((await page.getByTestId('player-time').textContent()) ?? '0:0'), { timeout: 5_000 })
    .toBeGreaterThanOrEqual(startMs);
  await page.getByTestId('mute-PROVIDER_PLAYBACK').click();
  await expect(page.getByTestId('mute-PROVIDER_PLAYBACK')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('player-toggle').click();
  await expect(page.getByTestId('player-toggle')).toHaveText('Play');
});
