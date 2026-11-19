import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { a11yAndLayout } from './cp04a-checks';
import { accounts, signIn } from './helpers';

// S1-E.1 Voice Lab on the real stack (backend 8001 + call360_test), Chromium with the fake microphone (voice project).
// Mock providers only — no network provider exists. Configure prompt (versions) → Start a recorded full-duplex session
// with interruption → recording, transcript and trace → golden test case with a synthetic WAV fixture → mock
// experiment → deterministic evaluation → budget rejections (paid provider, per-experiment limit) → emergency stop
// (manager) refuses new sessions → spend evidence shows zero paid expenditure.
test.describe.configure({ timeout: 240_000 });
const FIXTURE = fileURLToPath(new URL('../../Call360-backend/tests/fixtures/golden_audio/g01_us_greeting.wav', import.meta.url));

test('S1-E.1 Voice Lab: prompt → session → recording/transcript → dataset → mock experiment → evaluation → budget refusals → kill switch', async ({ page, browser }) => {
  const run = Date.now().toString(36);
  await signIn(page, accounts().user, '/voice-lab');
  await expect(page.getByRole('heading', { name: 'Voice Lab' })).toBeVisible();
  await expect(page.getByTestId('lab-playground')).toBeVisible();

  // Prompt configuration and versioning.
  await page.getByTestId('lab-prompt-select').selectOption('');
  await page.getByTestId('lab-prompt-name').fill(`E2E prompt ${run}`);
  await page.getByTestId('lab-system-prompt').fill('You are a synthetic test voice. Speak politely.');
  await page.getByTestId('lab-turns').fill('Greet the caller\nAsk them to say hello');
  await page.getByTestId('lab-save-prompt').click();
  await expect(page.getByTestId('lab-current-version')).toContainText('v1');
  await page.getByTestId('lab-system-prompt').fill('You are a synthetic test voice. Be brief.');
  await page.getByTestId('lab-note').fill('Shorter wording');
  await page.getByTestId('lab-save-prompt').click();
  await expect(page.getByTestId('lab-version-select')).toContainText('v2 · Shorter wording');
  await expect(page.getByTestId('lab-version-select')).toContainText('v1 · Initial version');
  await expect(page.getByTestId('lab-estimate')).toContainText('USD 0.0000');

  // Recorded mock session with interruption (the fake microphone says hello while the mock speaks).
  await page.getByTestId('lab-record').check();
  await page.getByTestId('lab-start').click();
  await expect(page.getByTestId('lab-playground')).toContainText('Live', { timeout: 15_000 });
  await expect.poll(async () => (await page.getByTestId('lab-live').innerText()).match(/Interruptions: (\d+)/)?.[1], { timeout: 30_000 }).not.toBe('0');
  await a11yAndLayout(page, 's1e1-playground-live');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('lab-stop').click();
  await expect(page.getByTestId('lab-ended')).toContainText('You stopped the session.');
  const ev = page.locator('[data-testid^="lab-session-LAB-S-"]');
  await expect(ev.getByTestId('lab-session-metrics')).toContainText('First audio');
  await expect(ev.getByTestId('lab-audio-MIC')).toBeVisible();
  await expect(ev.getByTestId('lab-audio-PROVIDER_PLAYBACK')).toBeVisible();
  await expect(ev.getByTestId('lab-transcript')).toContainText('Completed', { timeout: 90_000 });
  await ev.getByTestId('lab-trace').locator('summary').click();
  await expect(ev.getByTestId('lab-trace')).toContainText('BARGE_IN');
  await expect(ev.getByTestId('lab-trace')).toContainText('Greet the caller');

  // Golden dataset with a synthetic audio fixture; the mock reports a deviating wording.
  await page.getByTestId('lab-tab-datasets').click();
  await page.getByTestId('lab-dataset-name').fill(`E2E golden ${run}`);
  await page.getByTestId('lab-dataset-create').click();
  await expect(page.getByTestId('lab-dataset-select')).toContainText(`E2E golden ${run}`);
  await page.getByTestId('lab-case-new').click();
  await page.getByTestId('lab-case-name').fill('Greeting wording');
  await page.getByTestId('lab-case-expected_statement').fill('Good morning. I am calling about your policy renewal today.');
  await page.getByTestId('lab-case-mock_output').fill('Good morning. I am calling about my policy renewal.');
  await page.getByTestId('lab-case-customer_response').fill('Yes, that is fine');
  await page.getByTestId('lab-case-answer').fill('answer=YES');
  await page.getByTestId('lab-case-expected_behaviour').fill('No sales pitch');
  await page.getByTestId('lab-case-wav').setInputFiles(FIXTURE);
  await page.getByTestId('lab-case-save').click();
  await expect(page.getByTestId('lab-cases')).toContainText('Greeting wording');
  await expect(page.getByTestId('lab-cases')).toContainText('s WAV');

  // Mock experiment → evaluation.
  await page.getByTestId('lab-tab-experiments').click();
  await page.getByTestId('lab-exp-name').fill(`E2E mock run ${run}`);
  await page.getByTestId('lab-exp-dataset').selectOption({ label: await page.getByTestId('lab-exp-dataset').locator('option', { hasText: `E2E golden ${run}` }).innerText() });
  const pv = page.getByTestId('lab-exp-prompt');
  await pv.selectOption({ label: await pv.locator('option', { hasText: 'v2 · MOCK' }).first().innerText() });
  await expect(page.getByTestId('lab-exp-estimate')).toContainText('USD 0.0000');
  await page.getByTestId('lab-exp-create').click();
  await expect(page.getByTestId('lab-exp-created')).toContainText('Ready');
  const row = page.locator('[data-testid^="lab-exp-LAB-E-"]', { hasText: `E2E mock run ${run}` });
  await row.locator('[data-testid^="lab-exp-run-"]').click();
  await expect(row).toContainText('Completed', { timeout: 90_000 });
  await row.locator('[data-testid^="lab-exp-results-"]').click();
  const trial = page.locator('[data-testid^="lab-trial-"]').first();
  await expect(trial.getByTestId('lab-trial-said')).toContainText('omitted today');
  await expect(trial.getByTestId('lab-trial-said')).toContainText('your→my');
  await expect(trial.getByTestId('lab-trial-attributions')).toContainText('Suspected speech deviation');
  await expect(page.getByTestId('lab-results-summary')).toContainText('Fail: 1');
  await a11yAndLayout(page, 's1e1-results');
  await page.setViewportSize({ width: 1440, height: 900 });

  // Budget rejections: a metered experiment above the per-experiment limit, and a paid provider session.
  await page.getByTestId('lab-tab-playground').click();
  await page.getByTestId('lab-prompt-select').selectOption('');
  await page.getByTestId('lab-prompt-name').fill(`E2E metered ${run}`);
  await page.getByTestId('lab-provider').selectOption('MOCK_METERED');
  await page.getByTestId('lab-system-prompt').fill('Synthetic metering test.');
  await page.getByTestId('lab-save-prompt').click();
  await expect(page.getByTestId('lab-estimate')).toContainText('USD 0.8000');
  await page.getByTestId('lab-tab-experiments').click();
  await page.getByTestId('lab-exp-name').fill(`E2E over budget ${run}`);
  await page.getByTestId('lab-exp-dataset').selectOption({ label: await page.getByTestId('lab-exp-dataset').locator('option', { hasText: `E2E golden ${run}` }).innerText() });
  await pv.selectOption({ label: await pv.locator('option', { hasText: 'MOCK_METERED' }).first().innerText() });
  await page.getByTestId('lab-exp-spend').fill('5');
  await page.getByTestId('lab-exp-create').click();
  await expect(page.getByTestId('editor-error')).toContainText('PER_EXPERIMENT_LIMIT');
  await page.getByTestId('lab-tab-playground').click();
  await page.getByTestId('lab-prompt-select').selectOption('');
  await page.getByTestId('lab-prompt-name').fill(`E2E paid ${run}`);
  await page.getByTestId('lab-provider').selectOption('OPENAI_GPT_LIVE');
  await page.getByTestId('lab-system-prompt').fill('Never runs.');
  await page.getByTestId('lab-save-prompt').click();
  await expect(page.getByTestId('lab-estimate')).toContainText('USD 0.1000'); // 120 s smoke-test maximum at USD 0.05 / min
  await expect(page.getByTestId('lab-paid-note')).toContainText('none issued');
  await page.getByTestId('lab-start').click();
  await expect(page.getByTestId('lab-refusal')).toContainText('PAID_DISABLED');
  await expect(page.getByTestId('lab-refusal')).toContainText('SMOKE_TEST_NOT_AUTHORISED');

  // S1-E.2A: Azure OpenAI (preferred) without a verified price on this server fails closed.
  await page.getByTestId('lab-prompt-select').selectOption('');
  await page.getByTestId('lab-prompt-name').fill(`E2E Azure ${run}`);
  await page.getByTestId('lab-provider').selectOption('AZURE_OPENAI_GPT_LIVE');
  await page.getByTestId('lab-model').fill('gpt-live-1');
  await page.getByTestId('lab-system-prompt').fill('Never runs.');
  await page.getByTestId('lab-save-prompt').click();
  await expect(page.getByTestId('lab-estimate')).toContainText('cannot be estimated');
  await page.getByTestId('lab-start').click();
  await expect(page.getByTestId('lab-refusal')).toContainText('COST_UNKNOWN');
  await expect(page.getByTestId('lab-refusal')).toContainText('PROVIDER_NOT_AVAILABLE');

  // S1-E.2: the GPT-Live adapter against the mocked protocol server (Azure profile: 24 kHz on the wire) — live audio, interruption, live instruction,
  // live trace, confirmed close and reconciliation from the provider-reported usage.
  await page.getByTestId('lab-prompt-select').selectOption('');
  await page.getByTestId('lab-prompt-name').fill(`E2E GPT-Live mock ${run}`);
  await page.getByTestId('lab-provider').selectOption('GPT_LIVE_MOCK');
  await page.getByTestId('lab-system-prompt').fill('You are a synthetic test voice.');
  // S1-E.2B: the mock now waits for the caller like the live model; the opening instruction makes it speak first.
  await page.getByTestId('lab-opening').fill('Greet the caller now and say this is a synthetic test.');
  await expect(page.getByTestId('lab-quiet-room')).toContainText('quiet room');
  await page.getByTestId('lab-turns').fill('Ask the caller to confirm they can hear you');
  await page.getByTestId('lab-save-prompt').click();
  await expect(page.getByTestId('lab-estimate')).toContainText('synthetic metering');
  await page.getByTestId('lab-start').click();
  await expect(page.getByTestId('lab-playground')).toContainText('Live', { timeout: 15_000 });
  const live = page.locator('[data-testid^="lab-session-LAB-S-"]');
  await expect.poll(async () => (await page.getByTestId('lab-live').innerText()).match(/Interruptions: (\d+)/)?.[1], { timeout: 30_000 }).not.toBe('0');
  await page.getByTestId('lab-instruction').fill('Keep every reply short');
  await page.getByTestId('lab-instruction-send').click();
  await live.getByTestId('lab-trace').locator('summary').click();
  await expect(live.getByTestId('lab-trace')).toContainText('PROVIDER_SESSION_STARTED', { timeout: 10_000 });
  await expect(live.getByTestId('lab-trace')).toContainText('OPENING_INSTRUCTION_APPENDED', { timeout: 10_000 });
  await expect(live.getByTestId('lab-trace')).toContainText('PLAYGROUND_INSTRUCTION', { timeout: 10_000 });
  await page.getByTestId('lab-stop').click();
  await expect(page.getByTestId('lab-ended')).toContainText('You stopped the session.');
  await expect(live.getByTestId('lab-session-termination')).toContainText('Confirmed', { timeout: 15_000 });
  await expect(live.getByTestId('lab-session-cost')).toContainText('Reconciled');

  // Manager: spend evidence and the emergency stop (always released at the end).
  const actx = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const admin = await actx.newPage();
  await signIn(admin, accounts().admin, '/voice-lab?tab=settings');
  await expect(admin.getByTestId('lab-paid-spend')).toContainText('USD 0.0000');
  // Smoke-test authorisation: issued and revoked by the manager (single use; issuing is not execution).
  await expect(admin.getByTestId('lab-azure-rate')).toContainText('fail closed');
  await admin.getByTestId('lab-auth-provider').selectOption('OPENAI_GPT_LIVE');
  await admin.getByTestId('lab-auth-reason').fill('E2E authorisation drill (never executed)');
  await admin.getByTestId('lab-auth-issue').click();
  const auth = admin.locator('[data-testid^="lab-auth-LAB-A-"]').first();
  await expect(auth).toContainText('Issued');
  await auth.locator('[data-testid^="lab-auth-revoke-"]').click();
  await expect(auth).toContainText('Revoked');
  try {
    await admin.getByTestId('lab-kill-reason').fill('E2E emergency stop drill');
    await admin.getByTestId('lab-kill-toggle').click();
    await expect(admin.getByTestId('lab-settings')).toContainText('Engaged');
    await page.getByTestId('lab-prompt-select').selectOption({ label: await page.getByTestId('lab-prompt-select').locator('option', { hasText: `E2E prompt ${run}` }).innerText() });
    await page.getByTestId('lab-start').click();
    await expect(page.getByTestId('lab-refusal')).toContainText('KILL_SWITCH');
    await a11yAndLayout(admin, 's1e1-settings');
  } finally {
    await admin.getByTestId('lab-kill-reason').fill('E2E drill complete');
    await admin.getByTestId('lab-kill-toggle').click();
    await expect(admin.getByTestId('lab-settings')).toContainText('Released');
    await actx.close();
  }
});
