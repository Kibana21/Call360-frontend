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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
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
      env: { VITE_API_TARGET: 'http://127.0.0.1:8001' },
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
