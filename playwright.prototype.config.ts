import { defineConfig, devices } from '@playwright/test';

// SS-02A — Survey Studio prototype walkthroughs. A SEPARATE configuration so the standard suite (playwright.config.ts)
// is untouched: this one starts Vite with the prototype build setting ON, on the standard test port (the backend trusts only that origin), against the same isolated
// test backend. The prototype itself makes no API calls beyond the application shell's sign-in.
const backend = '../Call360-backend';

export default defineConfig({
  testDir: 'e2e/prototype',
  testMatch: /\.proto\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  outputDir: 'test-results/prototype',
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure' },
  projects: [{ name: 'prototype', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: 'uv run uvicorn --factory app.main:app_factory --host 127.0.0.1 --port 8001',
      cwd: backend,
      env: { CALL360_ENV_FILE: '.env.test' },
      url: 'http://127.0.0.1:8001/health/live',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5174 --strictPort',
      env: { VITE_API_TARGET: 'http://127.0.0.1:8001', VITE_SURVEY_STUDIO_PROTOTYPE: '1' },
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
