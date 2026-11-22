import { defineConfig, devices } from '@playwright/test';

// FI-1 — Survey Studio in PERSISTED mode, full stack: Chromium → Vite → FastAPI → PostgreSQL (the isolated test schema
// call360_test, reset by the global setup; never the development schema). A SEPARATE configuration: the standard suite
// (playwright.config.ts) and the in-memory prototype journeys (playwright.prototype.config.ts) are untouched. The
// backend runs with the survey-definition and component-library (LIB-1) settings ON; Vite with the persisted-mode setting ON and the prototype setting
// off. It uses the standard test ports, so it is never run at the same time as the other two.
const backend = '../Call360-backend';

export default defineConfig({
  testDir: 'e2e/persisted',
  testMatch: /\.persisted\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/persisted/global-setup.ts',
  outputDir: 'test-results/persisted',
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure' },
  projects: [{ name: 'persisted', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: 'uv run uvicorn --factory app.main:app_factory --host 127.0.0.1 --port 8001',
      cwd: backend,
      // These journeys sign several different people in within a minute; the per-address sign-in limit of the product
      // (20 a minute) is raised for THIS test server only. The limit itself is covered by the backend's own tests.
      env: { CALL360_ENV_FILE: '.env.test', SURVEY_DEFINITIONS_ENABLED: 'true', SURVEY_LIBRARY_ENABLED: 'true', LOGIN_IP_PER_MINUTE: '300' },
      url: 'http://127.0.0.1:8001/health/live',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 5174 --strictPort',
      env: { VITE_API_TARGET: 'http://127.0.0.1:8001', VITE_SURVEY_STUDIO_PERSISTED: '1' },
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
