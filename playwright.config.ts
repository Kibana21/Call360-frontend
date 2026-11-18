import { defineConfig, devices } from '@playwright/test';

// Browser tests run against the REAL FastAPI backend and PostgreSQL — the isolated test schema call360_test
// via the least-privilege test role (backend .env.test) — never the development schema.
const backend = '../Call360-backend';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', testIgnore: /voice\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      // S1-A: Chromium's fake capture device plays a synthetic WAV through the real getUserMedia pipeline.
      name: 'voice',
      testMatch: /voice\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${new URL('./e2e/fixtures/fake-mic-hello.wav', import.meta.url).pathname}`,
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'uv run uvicorn --factory app.main:app_factory --host 127.0.0.1 --port 8001',
      cwd: backend,
      // S1-E.2: the GPT-Live adapter is exercised only against the mocked protocol server below (loopback).
      env: { CALL360_ENV_FILE: '.env.test', VOICE_LAB_GPT_LIVE_MOCK_URL: 'ws://127.0.0.1:8766/v1/live/sessions' },
      url: 'http://127.0.0.1:8001/health/live',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // S1-E.2 mocked GPT-Live protocol server (no model, no key, no network beyond loopback).
      command: 'uv run call360 --env-file .env.test gpt-live-mock --port 8766',
      cwd: backend,
      port: 8766,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5174 --strictPort',
      env: { VITE_API_TARGET: 'http://127.0.0.1:8001' },
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
